/**
 * M1/M2 · Lógica del portal de pago público (`pay-portal`).
 *
 * Módulo PURO: sin Deno ni red propia. Todo pasa por los puertos de
 * `PortalDeps` (RPC con la clave de servicio, proveedor de pago, hash), así que
 * se prueba con vitest sin levantar nada.
 *
 * Reglas que este archivo impone:
 *   · el token del enlace viaja en el CUERPO (la página lo lee del fragmento
 *     `#`, que el navegador no envía ni en la URL ni en `Referer`);
 *   · un token mal formado y uno inexistente dan la MISMA respuesta;
 *   · nunca se devuelven ids internos de cuenta, enlace u organización, ni la
 *     referencia del secreto: solo lo que la página necesita para pintar;
 *   · en una cuenta sin credenciales (MOCK) solo se cobra si el entorno lo
 *     permite explícitamente (`allowMock`): un portal público no puede
 *     fabricar pagos simulados en un entorno desplegado por un descuido;
 *   · respuestas con códigos estables y mensaje en lenguaje de cliente.
 */
import { toMinorUnits } from './money.ts';
import { ProviderError, type PaymentProvider } from './types.ts';

/** Spec §2.3: cuerpo máximo 16 KB. */
export const PORTAL_MAX_BODY_BYTES = 16 * 1024;

/** 32 bytes en base64url sin relleno = 43 caracteres. */
const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Token efímero del Checkout (`tkn_test_…`, `tkn_live_…` o `tkn_mock_…` en modo de prueba). */
const SOURCE_TOKEN_RE = /^tkn_[A-Za-z0-9_]{4,120}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

export const TERMS_VERSION = 'CARD_ON_FILE_V1';

/** Mensajes para el CLIENTE (no para el operador): sin jerga ni ids. */
export const PORTAL_MESSAGES: Record<string, string> = {
  ENLACE_INVALIDO: 'Este enlace de pago no es válido. Pide uno nuevo a tu contacto en EBIM.',
  ENLACE_VENCIDO: 'Este enlace de pago venció. Pide uno nuevo a tu contacto en EBIM.',
  ENLACE_REVOCADO: 'Este enlace de pago ya no está disponible. Pide uno nuevo a tu contacto en EBIM.',
  FACTURA_NO_PAGABLE: 'Esta factura ya no tiene saldo pendiente o no puede pagarse en línea.',
  SOBRECOBRO: 'El importe supera el saldo pendiente de la factura. Recarga la página.',
  TARJETA_RECHAZADA: 'Tu tarjeta fue rechazada. Prueba con otra tarjeta o contacta a tu banco.',
  TARJETA_REQUIERE_AUTENTICACION:
    'Tu banco pide una verificación adicional que este portal todavía no admite. Puedes pagar por transferencia.',
  DEMASIADOS_INTENTOS: 'Hiciste demasiados intentos. Espera una hora antes de volver a intentarlo.',
  CUENTA_NO_CONFIGURADA: 'El pago con tarjeta no está disponible para esta factura. Puedes pagar por transferencia.',
  TERMINOS_NO_ACEPTADOS: 'Debes aceptar los términos del pago automático para continuar.',
  DATOS_FACTURACION_INCOMPLETOS: 'Completa tus datos de facturación para guardar la tarjeta.',
  TARJETA_GUARDADA_NO_PERMITIDA: 'Este enlace no permite activar el pago automático.',
  SOLICITUD_INVALIDA: 'No pudimos procesar la solicitud. Recarga la página e inténtalo otra vez.',
  CUERPO_DEMASIADO_GRANDE: 'La solicitud es demasiado grande.',
  METODO_NO_PERMITIDO: 'Operación no permitida.',
  RUTA_NO_ENCONTRADA: 'Operación no encontrada.',
  PAGO_EN_REVISION:
    'Recibimos tu pago pero no pudimos confirmarlo todavía. No lo repitas: lo revisaremos y te avisaremos.',
  ERROR_INTERNO: 'Ocurrió un problema al procesar tu solicitud. Inténtalo más tarde.',
};

const STATUS: Record<string, number> = {
  ENLACE_INVALIDO: 404,
  ENLACE_VENCIDO: 410,
  ENLACE_REVOCADO: 410,
  FACTURA_NO_PAGABLE: 409,
  SOBRECOBRO: 409,
  TARJETA_RECHAZADA: 402,
  TARJETA_REQUIERE_AUTENTICACION: 402,
  DEMASIADOS_INTENTOS: 429,
  CUENTA_NO_CONFIGURADA: 409,
  TERMINOS_NO_ACEPTADOS: 400,
  DATOS_FACTURACION_INCOMPLETOS: 409,
  TARJETA_GUARDADA_NO_PERMITIDA: 403,
  SOLICITUD_INVALIDA: 400,
  CUERPO_DEMASIADO_GRANDE: 413,
  METODO_NO_PERMITIDO: 405,
  RUTA_NO_ENCONTRADA: 404,
  PAGO_EN_REVISION: 502,
  ERROR_INTERNO: 500,
};

export interface RpcResult {
  data: unknown;
  error: { message?: string } | null;
}

export interface PortalDeps {
  /** RPC con la clave de servicio (solo servidor). */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  /** Fila de `payment_provider_accounts` (sin secretos: solo la referencia). */
  loadAccount: (id: string) => Promise<Record<string, unknown> | null>;
  /** Proveedor para la cuenta (MOCK/TEST/LIVE según `resolvePaymentProvider`). Puede lanzar. */
  resolveProvider: (account: Record<string, unknown>) => PaymentProvider;
  /** ¿Se permite cobrar con una cuenta MOCK? Solo `true` explícito en el entorno. */
  allowMock: boolean;
  sha256Hex: (text: string) => Promise<string>;
}

export interface PortalRequest {
  method: string;
  /** Último segmento de la ruta: statement | charge | enroll | unenroll. */
  route: string;
  bodyText: string;
  contentLength?: number | null;
  clientIp?: string | null;
  userAgent?: string | null;
}

export interface PortalResponse {
  status: number;
  body: Record<string, unknown>;
}

export function portalError(code: string, extra: Record<string, unknown> = {}): PortalResponse {
  const known = code in STATUS ? code : 'ERROR_INTERNO';
  return {
    status: STATUS[known]!,
    body: { error: known, message: PORTAL_MESSAGES[known], ...extra },
  };
}

/** `CODIGO: detalle` de una excepción de la base → `CODIGO`. */
export function rpcErrorCode(error: { message?: string } | null | undefined): string | null {
  const match = /^([A-Z][A-Z0-9_]{2,}):/.exec(String(error?.message ?? '').trim());
  return match ? match[1]! : null;
}

/** `chr_test_abcdef123456` → `chr_…3456`: identificable en el comprobante sin exponerlo entero. */
export function maskChargeId(id: string): string {
  const prefix = id.split('_')[0] ?? 'chr';
  return `${prefix}_…${id.slice(-4)}`;
}

interface AccountView {
  publicKey: string | null;
  mode: 'MOCK' | 'TEST' | 'LIVE' | null;
}

async function accountView(deps: PortalDeps, row: Record<string, unknown>): Promise<AccountView> {
  try {
    const provider = deps.resolveProvider(row);
    if (provider.mode === 'MOCK') {
      return { publicKey: null, mode: deps.allowMock ? 'MOCK' : null };
    }
    const publicKey = typeof row.public_key === 'string' && row.public_key !== '' ? row.public_key : null;
    // Sin llave pública el Checkout no puede tokenizar: no es pagable en línea.
    return { publicKey, mode: publicKey ? provider.mode : null };
  } catch {
    return { publicKey: null, mode: null };
  }
}

async function providerFor(
  deps: PortalDeps,
  accountId: string,
): Promise<{ provider: PaymentProvider; accountId: string } | PortalResponse> {
  const row = await deps.loadAccount(accountId);
  if (!row) return portalError('CUENTA_NO_CONFIGURADA');
  let provider: PaymentProvider;
  try {
    provider = deps.resolveProvider(row);
  } catch {
    return portalError('CUENTA_NO_CONFIGURADA');
  }
  if (provider.mode === 'MOCK' && !deps.allowMock) return portalError('CUENTA_NO_CONFIGURADA');
  return { provider, accountId };
}

function parseBody(req: PortalRequest): Record<string, unknown> | PortalResponse {
  if (req.method === 'OPTIONS') return portalError('METODO_NO_PERMITIDO');
  if (req.method !== 'POST') return portalError('METODO_NO_PERMITIDO');
  const declared = req.contentLength ?? 0;
  if (declared > PORTAL_MAX_BODY_BYTES || new TextEncoder().encode(req.bodyText).length > PORTAL_MAX_BODY_BYTES) {
    return portalError('CUERPO_DEMASIADO_GRANDE');
  }
  try {
    const parsed = JSON.parse(req.bodyText || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return portalError('SOLICITUD_INVALIDA');
    return parsed as Record<string, unknown>;
  } catch {
    return portalError('SOLICITUD_INVALIDA');
  }
}

function isResponse(value: unknown): value is PortalResponse {
  return Boolean(value) && typeof value === 'object' && 'status' in (value as object) && 'body' in (value as object);
}

async function fingerprint(deps: PortalDeps, req: PortalRequest): Promise<string> {
  // Hash de IP + User-Agent: sirve para agrupar intentos sin guardar la IP.
  const hex = await deps.sha256Hex(`${req.clientIp ?? ''}|${req.userAgent ?? ''}`);
  return hex.slice(0, 32);
}

/** Token del enlace → hash, o la respuesta de enlace inválido (idéntica a la de la base). */
async function linkHash(deps: PortalDeps, body: Record<string, unknown>): Promise<string | PortalResponse> {
  const token = body.token;
  if (typeof token !== 'string' || !LINK_TOKEN_RE.test(token)) return portalError('ENLACE_INVALIDO');
  return deps.sha256Hex(token);
}

/* ==========================================================================
   POST /statement
   ========================================================================== */

async function statement(req: PortalRequest, deps: PortalDeps, body: Record<string, unknown>): Promise<PortalResponse> {
  const hash = await linkHash(deps, body);
  if (typeof hash !== 'string') return hash;

  const { data, error } = await deps.rpc('payment_link_statement', {
    p_token_hash: hash,
    p_client_fingerprint: await fingerprint(deps, req),
  });
  if (error) return portalError('ERROR_INTERNO');
  const st = (data ?? {}) as Record<string, unknown>;
  if (st.valid !== true) return portalError(String(st.error ?? 'ENLACE_INVALIDO'));

  const accounts = new Map<string, AccountView>();
  for (const row of (st.accounts ?? []) as Array<Record<string, unknown>>) {
    accounts.set(String(row.id), await accountView(deps, row));
  }

  const invoices = ((st.invoices ?? []) as Array<Record<string, unknown>>).map((inv) => {
    const view = inv.account_id ? accounts.get(String(inv.account_id)) : undefined;
    const payable = Boolean(view?.mode);
    return {
      id: inv.id,
      number: inv.number,
      status: inv.status,
      currency: inv.currency,
      total: Number(inv.total),
      paid: Number(inv.paid),
      balance: Number(inv.balance),
      issue_date: inv.issue_date ?? null,
      due_date: inv.due_date ?? null,
      period_start: inv.period_start ?? null,
      period_end: inv.period_end ?? null,
      product: inv.product ?? null,
      payable_by_card: payable,
      checkout: payable ? { public_key: view!.publicKey, mode: view!.mode } : null,
    };
  });

  const link = (st.link ?? {}) as Record<string, unknown>;
  const org = (st.organization ?? {}) as Record<string, unknown>;
  const card = st.card_on_file as Record<string, unknown> | null;
  const enrollment = (st.enrollment ?? {}) as Record<string, unknown>;

  let enrollmentCheckout: AccountView | null = null;
  if (enrollment.available === true && typeof enrollment.account_id === 'string') {
    const row = await deps.loadAccount(enrollment.account_id);
    enrollmentCheckout = row ? await accountView(deps, row) : null;
  }

  return {
    status: 200,
    body: {
      organization: { name: org.name ?? null, billing_email_masked: org.billing_email_masked ?? null },
      expires_at: link.expires_at ?? null,
      allow_card_enrollment: link.allow_card_enrollment === true,
      invoices,
      card_on_file: card
        ? {
            brand: card.brand ?? null,
            last4: card.last4 ?? null,
            authorized: card.authorized === true,
            authorized_at: card.authorized_at ?? null,
          }
        : null,
      enrollment: {
        available: enrollment.available === true && Boolean(enrollmentCheckout?.mode),
        missing_fields: Array.isArray(enrollment.missing_fields) ? enrollment.missing_fields : [],
        terms_version: TERMS_VERSION,
        checkout: enrollmentCheckout?.mode
          ? { public_key: enrollmentCheckout.publicKey, mode: enrollmentCheckout.mode }
          : null,
      },
    },
  };
}

/* ==========================================================================
   POST /charge
   ========================================================================== */

async function charge(req: PortalRequest, deps: PortalDeps, body: Record<string, unknown>): Promise<PortalResponse> {
  const hash = await linkHash(deps, body);
  if (typeof hash !== 'string') return hash;
  if (typeof body.invoice_id !== 'string' || !UUID_RE.test(body.invoice_id)) return portalError('FACTURA_NO_PAGABLE');
  if (typeof body.source_token !== 'string' || !SOURCE_TOKEN_RE.test(body.source_token)) {
    return portalError('SOLICITUD_INVALIDA');
  }

  const ctxRes = await deps.rpc('payment_link_charge_context', { p_token_hash: hash, p_invoice_id: body.invoice_id });
  if (ctxRes.error) return portalError('ERROR_INTERNO');
  const ctx = (ctxRes.data ?? {}) as Record<string, unknown>;
  if (ctx.ok !== true) return portalError(String(ctx.error ?? 'ENLACE_INVALIDO'));

  const linkId = String(ctx.link_id);
  const invoice = ctx.invoice as { id: string; number: string; currency: string; balance: number | string };
  const fp = await fingerprint(deps, req);

  const resolved = await providerFor(deps, String(ctx.provider_account_id));
  if (isResponse(resolved)) return resolved;
  const { provider, accountId } = resolved;

  // Un token simulado contra una pasarela real es un error del cliente, no un cargo.
  if (provider.mode !== 'MOCK' && body.source_token.startsWith('tkn_mock_')) return portalError('TARJETA_RECHAZADA');

  const attempt = await deps.rpc('register_payment_link_event', {
    p_link_id: linkId,
    p_kind: 'CHARGE_ATTEMPT',
    p_invoice_id: invoice.id,
    p_client_fingerprint: fp,
  });
  if (attempt.error) return portalError('ERROR_INTERNO');
  if ((attempt.data as { rate_limited?: boolean } | null)?.rate_limited) return portalError('DEMASIADOS_INTENTOS');

  let amountMinor: number;
  try {
    amountMinor = toMinorUnits(invoice.balance);
  } catch {
    return portalError('FACTURA_NO_PAGABLE');
  }
  const email =
    typeof body.email === 'string' && EMAIL_RE.test(body.email.trim())
      ? body.email.trim().toLowerCase()
      : typeof ctx.billing_email === 'string'
        ? ctx.billing_email
        : '';

  let charged;
  try {
    charged = await provider.createCharge({
      amountMinor,
      currency: invoice.currency,
      email,
      sourceId: body.source_token,
      description: `Factura ${invoice.number}`,
      metadata: { invoice_id: invoice.id, link_id: linkId, origin: 'pay-portal' },
    });
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : 'PROVEEDOR_NO_DISPONIBLE';
    await deps.rpc('register_payment_link_event', {
      p_link_id: linkId,
      p_kind: 'CHARGE_FAILED',
      p_invoice_id: invoice.id,
      p_error_code: /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'PROVEEDOR_ERROR',
      p_client_fingerprint: fp,
    });
    if (code === 'TARJETA_REQUIERE_AUTENTICACION') return portalError(code);
    if (code === 'TARJETA_RECHAZADA') {
      // El mensaje del emisor (user_message) está pensado para el titular.
      return portalError(code, error instanceof ProviderError && error.message ? { message: error.message } : {});
    }
    return portalError(code === 'IMPORTE_INVALIDO' ? 'FACTURA_NO_PAGABLE' : 'ERROR_INTERNO');
  }

  const reg = await deps.rpc('register_provider_invoice_payment', {
    p_provider_account_id: accountId,
    p_external_event_key: `portal:${charged.externalChargeId}`,
    p_external_charge_id: charged.externalChargeId,
    p_invoice_id: invoice.id,
    p_amount: charged.amount,
    p_currency: charged.currency,
    p_paid_at: charged.paidAt,
    p_payload: { origin: 'pay-portal', link_id: linkId, mode: provider.mode },
  });

  if (reg.error) {
    const code = rpcErrorCode(reg.error) ?? 'REGISTRO_FALLIDO';
    await deps.rpc('register_payment_link_event', {
      p_link_id: linkId,
      p_kind: 'CHARGE_FAILED',
      p_invoice_id: invoice.id,
      p_external_id: charged.externalChargeId,
      p_error_code: code,
      p_amount: charged.amount,
      p_currency: charged.currency,
      p_client_fingerprint: fp,
    });
    // El dinero ya se cobró: la reconciliación lo verá (MISSING_LOCAL). Al
    // cliente no se le pide repetir el pago.
    return portalError('PAGO_EN_REVISION');
  }

  await deps.rpc('register_payment_link_event', {
    p_link_id: linkId,
    p_kind: 'CHARGE_OK',
    p_invoice_id: invoice.id,
    p_external_id: charged.externalChargeId,
    p_amount: charged.amount,
    p_currency: charged.currency,
    p_client_fingerprint: fp,
  });

  const result = (reg.data ?? {}) as { duplicate?: boolean };
  return {
    status: 200,
    body: {
      ok: true,
      duplicate: result.duplicate === true,
      simulated: provider.mode === 'MOCK',
      receipt: {
        invoice_number: invoice.number,
        charge: maskChargeId(charged.externalChargeId),
        amount: charged.amount,
        currency: charged.currency,
        paid_at: charged.paidAt,
      },
    },
  };
}

/* ==========================================================================
   POST /enroll · POST /unenroll (M2)
   ========================================================================== */

const CONTACT_FIELDS: Array<[string, string]> = [
  ['billing_first_name', 'first_name'],
  ['billing_last_name', 'last_name'],
  ['billing_email', 'email'],
  ['billing_address', 'address'],
  ['billing_city', 'city'],
  ['billing_phone', 'phone'],
];

async function enroll(req: PortalRequest, deps: PortalDeps, body: Record<string, unknown>): Promise<PortalResponse> {
  const hash = await linkHash(deps, body);
  if (typeof hash !== 'string') return hash;
  if (body.accepted_terms !== true) return portalError('TERMINOS_NO_ACEPTADOS');
  if (typeof body.source_token !== 'string' || !SOURCE_TOKEN_RE.test(body.source_token)) {
    return portalError('SOLICITUD_INVALIDA');
  }

  const load = async () => {
    const res = await deps.rpc('payment_link_enrollment_context', { p_token_hash: hash });
    if (res.error) return portalError('ERROR_INTERNO');
    const ctx = (res.data ?? {}) as Record<string, unknown>;
    if (ctx.ok !== true) return portalError(String(ctx.error ?? 'ENLACE_INVALIDO'));
    return ctx;
  };

  let ctx = await load();
  if (isResponse(ctx)) return ctx;
  const linkId = String(ctx.link_id);
  const fp = await fingerprint(deps, req);

  const resolved = await providerFor(deps, String(ctx.provider_account_id));
  if (isResponse(resolved)) return resolved;
  const { provider, accountId } = resolved;
  if (provider.mode !== 'MOCK' && body.source_token.startsWith('tkn_mock_')) return portalError('TARJETA_RECHAZADA');

  const attempt = await deps.rpc('register_payment_link_event', {
    p_link_id: linkId,
    p_kind: 'ENROLL_ATTEMPT',
    p_client_fingerprint: fp,
  });
  if (attempt.error) return portalError('ERROR_INTERNO');
  if ((attempt.data as { rate_limited?: boolean } | null)?.rate_limited) return portalError('DEMASIADOS_INTENTOS');

  // Datos que la pasarela exige y la organización aún no tiene: solo se
  // COMPLETAN (la base no deja reescribir los que ya existen).
  const missing = (Array.isArray(ctx.missing_fields) ? ctx.missing_fields : []) as string[];
  if (missing.length > 0) {
    const contact = (body.billing_contact ?? {}) as Record<string, unknown>;
    const value = (key: string) => (typeof contact[key] === 'string' ? (contact[key] as string).trim() : '');
    const args: Record<string, unknown> = { p_link_id: linkId };
    for (const [, key] of CONTACT_FIELDS) args[`p_${key}`] = value(key) || null;
    const filled = await deps.rpc('set_billing_contact_from_portal', args);
    if (filled.error) {
      const code = rpcErrorCode(filled.error);
      return portalError('DATOS_FACTURACION_INCOMPLETOS', {
        missing_fields: missing,
        ...(code === 'CORREO_INVALIDO' || code === 'TELEFONO_INVALIDO' ? { invalid: code } : {}),
      });
    }
    ctx = await load();
    if (isResponse(ctx)) return ctx;
    const still = (Array.isArray(ctx.missing_fields) ? ctx.missing_fields : []) as string[];
    if (still.length > 0) return portalError('DATOS_FACTURACION_INCOMPLETOS', { missing_fields: still });
  }

  const c = (ctx.contact ?? {}) as Record<string, string | null>;
  let saved;
  try {
    saved = await provider.saveCard({
      token: body.source_token,
      customer: {
        organizationId: String(ctx.organization_id),
        email: String(c.email ?? ''),
        firstName: String(c.first_name ?? ''),
        lastName: String(c.last_name ?? ''),
        address: String(c.address ?? ''),
        addressCity: String(c.city ?? ''),
        phoneNumber: String(c.phone ?? ''),
        countryCode: String(c.country_code ?? ''),
        externalCustomerId: typeof ctx.external_customer_id === 'string' ? ctx.external_customer_id : null,
      },
      metadata: { organization_id: String(ctx.organization_id), origin: 'pay-portal' },
    });
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : 'ERROR_INTERNO';
    if (code === 'TARJETA_RECHAZADA' || code === 'TARJETA_REQUIERE_AUTENTICACION') return portalError(code);
    if (code === 'DATOS_FACTURACION_INCOMPLETOS') return portalError(code, { missing_fields: missing });
    return portalError('ERROR_INTERNO');
  }

  const res = await deps.rpc('enroll_card_on_file', {
    p_link_id: linkId,
    p_provider_account_id: accountId,
    p_external_customer_id: saved.externalCustomerId,
    p_external_payment_method_id: saved.externalPaymentMethodId,
    p_brand: saved.card.brand,
    p_last4: saved.card.last4,
    p_exp_month: saved.card.expMonth,
    p_exp_year: saved.card.expYear,
    p_terms_version: TERMS_VERSION,
    p_client_fingerprint: fp,
  });
  if (res.error) {
    const code = rpcErrorCode(res.error);
    return portalError(code && code in STATUS ? code : 'ERROR_INTERNO');
  }
  const out = (res.data ?? {}) as Record<string, unknown>;
  return {
    status: 200,
    body: {
      ok: true,
      simulated: provider.mode === 'MOCK',
      card: { brand: saved.card.brand, last4: saved.card.last4 },
      subscriptions_switched: Number(out.subscriptions_switched ?? 0),
    },
  };
}

async function unenroll(req: PortalRequest, deps: PortalDeps, body: Record<string, unknown>): Promise<PortalResponse> {
  const hash = await linkHash(deps, body);
  if (typeof hash !== 'string') return hash;
  const res = await deps.rpc('unenroll_card_on_file', {
    p_token_hash: hash,
    p_client_fingerprint: await fingerprint(deps, req),
  });
  if (res.error) return portalError('ERROR_INTERNO');
  const out = (res.data ?? {}) as Record<string, unknown>;
  if (out.ok !== true) return portalError(String(out.error ?? 'ENLACE_INVALIDO'));
  return { status: 200, body: { ok: true, revoked: Number(out.revoked ?? 0) } };
}

/* ==========================================================================
   Entrada
   ========================================================================== */

const ROUTES: Record<
  string,
  (req: PortalRequest, deps: PortalDeps, body: Record<string, unknown>) => Promise<PortalResponse>
> = { statement, charge, enroll, unenroll };

export async function handlePayPortal(req: PortalRequest, deps: PortalDeps): Promise<PortalResponse> {
  const route = ROUTES[req.route];
  if (!route) return portalError('RUTA_NO_ENCONTRADA');
  const body = parseBody(req);
  if (isResponse(body)) return body;
  try {
    return await route(req, deps, body);
  } catch {
    // Nunca el mensaje del runtime ni de la base: puede llevar ids internos.
    return portalError('ERROR_INTERNO');
  }
}
