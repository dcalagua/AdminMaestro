import { env } from '@/lib/env';

/**
 * Cliente del portal de pago PÚBLICO (`pay-portal`).
 *
 * Deliberadamente NO usa el cliente Supabase de la consola: quien paga no
 * tiene sesión, y si un operador abriera el enlace con su sesión iniciada no
 * debe viajar su JWT. Solo se manda la clave pública (anon/publishable), que
 * es pública por diseño. El token del enlace va en el CUERPO; nunca en la URL.
 */

export type PortalMode = 'MOCK' | 'TEST' | 'LIVE';

export interface PortalCheckout {
  public_key: string | null;
  mode: PortalMode;
}

export interface PortalInvoice {
  id: string;
  number: string;
  status: string;
  currency: string;
  total: number;
  paid: number;
  balance: number;
  issue_date: string | null;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  product: string | null;
  payable_by_card: boolean;
  checkout: PortalCheckout | null;
}

export interface PortalStatement {
  organization: { name: string | null; billing_email_masked: string | null };
  expires_at: string | null;
  allow_card_enrollment: boolean;
  invoices: PortalInvoice[];
  card_on_file: { brand: string | null; last4: string | null; authorized: boolean; authorized_at: string | null } | null;
  enrollment: {
    available: boolean;
    missing_fields: string[];
    terms_version: string;
    checkout: PortalCheckout | null;
  };
}

export interface PortalReceipt {
  invoice_number: string;
  charge: string;
  amount: number;
  currency: string;
  paid_at: string;
}

export type PortalResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message: string; missing_fields?: string[] };

const GENERIC_ERROR = 'No pudimos conectar con el portal de pago. Revisa tu conexión e inténtalo otra vez.';

/**
 * Mensajes para el cliente por código estable, para cuando la respuesta no
 * trae el suyo (proxy, versión anterior de la función). Un código conocido
 * nunca se muestra crudo.
 */
export const PORTAL_ERROR_MESSAGES: Record<string, string> = {
  COBRO_EN_CURSO: 'Ya hay un pago en curso para esta factura. Espera un momento y recarga la página.',
  PAGO_EN_REVISION:
    'Recibimos tu pago pero no pudimos confirmarlo todavía. No lo repitas: lo revisaremos y te avisaremos.',
  DEMASIADOS_INTENTOS: 'Hiciste demasiados intentos. Espera una hora antes de volver a intentarlo.',
  SOBRECOBRO: 'El importe supera el saldo pendiente de la factura. Recarga la página.',
  FACTURA_NO_PAGABLE: 'Esta factura ya no tiene saldo pendiente o no puede pagarse en línea.',
  TARJETA_RECHAZADA: 'Tu tarjeta fue rechazada. Prueba con otra tarjeta o contacta a tu banco.',
};

export async function callPortal<T>(
  route: 'statement' | 'charge' | 'enroll' | 'unenroll',
  body: Record<string, unknown>,
): Promise<PortalResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${env.supabaseUrl}/functions/v1/pay-portal/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: env.supabaseAnonKey,
        authorization: `Bearer ${env.supabaseAnonKey}`,
      },
      body: JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 0, error: 'RED', message: GENERIC_ERROR };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: typeof payload.error === 'string' ? payload.error : 'ERROR_INTERNO',
      message:
        typeof payload.message === 'string' && payload.message.trim() !== ''
          ? payload.message
          : (PORTAL_ERROR_MESSAGES[String(payload.error)] ?? GENERIC_ERROR),
      ...(Array.isArray(payload.missing_fields) ? { missing_fields: payload.missing_fields as string[] } : {}),
    };
  }
  return { ok: true, data: payload as T };
}

/** Token del enlace desde el fragmento `#` (el navegador no lo envía al servidor). */
export function readLinkToken(hash: string = window.location.hash): string | null {
  const token = decodeURIComponent(hash.replace(/^#/, '')).trim();
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
