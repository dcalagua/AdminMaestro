/**
 * M2 · Cobro automático con tarjeta guardada (`payment-autocharge`).
 *
 * Módulo PURO con dependencias inyectadas, como `portal.ts`. La autorización
 * (JWT de finanzas o contexto de servicio) la resuelve el `index.ts` ANTES de
 * llegar aquí; este módulo recibe ya el `caller`.
 *
 *   {invoice_id}  → «Cobrar ahora» (MANUAL): ignora el calendario de reintentos.
 *   {run: true}   → «Ejecutar cobros pendientes» (RUN; CRON si llama el servidor):
 *                   solo las facturas que la política de reintentos habilita
 *                   (al vencer, +3 d, +7 d; máximo 3 — lo decide la base).
 *
 * Cada factura sigue: begin_card_charge_attempt (PENDING, idempotente por
 * invoice:attempt_no) → createCharge con la tarjeta guardada (`crd_`) →
 * complete_card_charge_attempt (éxito registra el pago en la MISMA transacción).
 *
 * Un fallo AMBIGUO de la pasarela (sin respuesta, 5xx) deja el intento PENDING
 * en vez de marcarlo fallido: si el cargo llegó a hacerse, reintentarlo
 * cobraría dos veces. La reconciliación lo resuelve.
 */
import { toMinorUnits } from './money.ts';
import { ProviderError, type PaymentProvider } from './types.ts';
import { rpcErrorCode, type RpcResult } from './portal.ts';

export type AutochargeCaller = { kind: 'service' } | { kind: 'user'; userId: string };

export interface AutochargeDeps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  loadAccount: (id: string) => Promise<Record<string, unknown> | null>;
  resolveProvider: (account: Record<string, unknown>) => PaymentProvider;
}

export interface AutochargeItem {
  invoice_number: string | null;
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'REVIEW';
  error_code: string | null;
  amount: number | null;
  currency: string | null;
  attempt_no: number | null;
}

export interface AutochargeResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Rechazos DEFINITIVOS: el cargo no se hizo, el intento cuenta como fallido. */
const DEFINITIVE = new Set([
  'TARJETA_RECHAZADA',
  'TARJETA_REQUIERE_AUTENTICACION',
  'IMPORTE_INVALIDO',
  'ORIGEN_INVALIDO',
  'PROVEEDOR_RECHAZO',
  'LIVE_NO_AUTORIZADO',
  'CULQI_LIVE_SIN_CONFIGURAR',
  'LLAVE_NO_COINCIDE',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const AUTOCHARGE_MAX_BATCH = 100;

function isDefinitive(error: unknown): string | null {
  if (!(error instanceof ProviderError)) return null;
  if (DEFINITIVE.has(error.code)) return error.code;
  const http = /^PROVEEDOR_HTTP_(\d{3})$/.exec(error.code);
  if (http && Number(http[1]) >= 400 && Number(http[1]) < 500) return error.code;
  return null;
}

export async function chargeInvoice(
  invoiceId: string,
  source: 'MANUAL' | 'RUN' | 'CRON',
  actor: string | null,
  ignoreSchedule: boolean,
  deps: AutochargeDeps,
): Promise<AutochargeItem> {
  const begin = await deps.rpc('begin_card_charge_attempt', {
    p_invoice_id: invoiceId,
    p_trigger_source: source,
    p_actor: actor,
    p_ignore_schedule: ignoreSchedule,
  });
  if (begin.error) {
    return { invoice_number: null, status: 'SKIPPED', error_code: rpcErrorCode(begin.error) ?? 'ERROR_INTERNO', amount: null, currency: null, attempt_no: null };
  }
  const a = (begin.data ?? {}) as Record<string, unknown>;
  if (a.ok !== true) {
    return { invoice_number: null, status: 'SKIPPED', error_code: String(a.error ?? 'COBRO_NO_PROCEDE'), amount: null, currency: null, attempt_no: null };
  }

  const base = {
    invoice_number: String(a.invoice_number),
    amount: Number(a.amount),
    currency: String(a.currency),
    attempt_no: Number(a.attempt_no),
  };
  const fail = async (code: string): Promise<AutochargeItem> => {
    await deps.rpc('complete_card_charge_attempt', {
      p_attempt_id: a.attempt_id,
      p_succeeded: false,
      p_error_code: code,
    });
    return { ...base, status: 'FAILED', error_code: code };
  };

  const row = await deps.loadAccount(String(a.provider_account_id));
  if (!row) return fail('CUENTA_NO_CONFIGURADA');
  let provider: PaymentProvider;
  try {
    provider = deps.resolveProvider(row);
  } catch (error) {
    return fail(error instanceof ProviderError ? error.code : 'CUENTA_NO_CONFIGURADA');
  }

  let amountMinor: number;
  try {
    amountMinor = toMinorUnits(String(a.amount));
  } catch {
    return fail('IMPORTE_INVALIDO');
  }

  let charged;
  try {
    charged = await provider.createCharge({
      amountMinor,
      currency: base.currency,
      email: String(a.billing_email ?? ''),
      sourceId: String(a.external_payment_method_id),
      description: `Factura ${base.invoice_number}`,
      metadata: { invoice_id: invoiceId, attempt_id: String(a.attempt_id), origin: 'payment-autocharge' },
    });
  } catch (error) {
    const code = isDefinitive(error);
    if (code) return fail(code);
    // Ambiguo: el intento queda PENDING (bloquea otro cargo de la factura).
    return { ...base, status: 'REVIEW', error_code: error instanceof ProviderError ? error.code : 'PROVEEDOR_NO_DISPONIBLE' };
  }

  const done = await deps.rpc('complete_card_charge_attempt', {
    p_attempt_id: a.attempt_id,
    p_succeeded: true,
    p_external_charge_id: charged.externalChargeId,
    p_amount: charged.amount,
    p_currency: charged.currency,
    p_paid_at: charged.paidAt,
  });
  if (done.error) {
    // Cobrado en la pasarela y NO registrado: revisión humana / reconciliación.
    return { ...base, status: 'REVIEW', error_code: rpcErrorCode(done.error) ?? 'REGISTRO_FALLIDO' };
  }
  return { ...base, status: 'SUCCEEDED', error_code: null };
}

export async function handleAutocharge(
  input: { method: string; bodyText: string },
  caller: AutochargeCaller,
  deps: AutochargeDeps,
): Promise<AutochargeResponse> {
  if (input.method !== 'POST') return { status: 405, body: { error: 'METODO_NO_PERMITIDO' } };
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(input.bodyText || '{}') as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('x');
  } catch {
    return { status: 400, body: { error: 'CUERPO_INVALIDO', message: 'Se esperaba un objeto JSON.' } };
  }

  const actor = caller.kind === 'user' ? caller.userId : null;
  const results: AutochargeItem[] = [];

  if (typeof body.invoice_id === 'string') {
    if (!UUID_RE.test(body.invoice_id)) {
      return { status: 400, body: { error: 'FACTURA_INVALIDA', message: 'invoice_id no es un identificador válido.' } };
    }
    results.push(await chargeInvoice(body.invoice_id, caller.kind === 'user' ? 'MANUAL' : 'CRON', actor, true, deps));
  } else if (body.run === true) {
    const limit = Math.min(Math.max(Number(body.limit ?? 50) || 50, 1), AUTOCHARGE_MAX_BATCH);
    const due = await deps.rpc('card_on_file_due_invoices', { p_limit: limit });
    if (due.error) return { status: 500, body: { error: 'COLA_NO_DISPONIBLE', message: 'No se pudo leer la cola de cobro.' } };
    // Secuencial a propósito: cada cargo es dinero real; el orden y el ritmo
    // importan más que la velocidad.
    for (const row of (due.data ?? []) as Array<{ invoice_id: string }>) {
      results.push(await chargeInvoice(row.invoice_id, caller.kind === 'user' ? 'RUN' : 'CRON', actor, false, deps));
    }
  } else {
    return { status: 400, body: { error: 'SOLICITUD_INVALIDA', message: 'Indica invoice_id o run: true.' } };
  }

  return {
    status: 200,
    body: {
      processed: results.length,
      succeeded: results.filter((r) => r.status === 'SUCCEEDED').length,
      failed: results.filter((r) => r.status === 'FAILED').length,
      skipped: results.filter((r) => r.status === 'SKIPPED').length,
      review: results.filter((r) => r.status === 'REVIEW').length,
      results,
    },
  };
}
