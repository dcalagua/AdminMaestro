import { parseBusinessError } from './pgError';

/**
 * V3.1 · Presentación de la facturación del PERIODO.
 *
 * Aquí NO vive la billing cadence. Qué líneas tocan en un mes (MONTHLY cada 1,
 * QUARTERLY cada 3, YEARLY cada 12, ONE_TIME una vez) lo decide PostgreSQL
 * (`platform.subscription_due_items` / `get_subscription_billing_status`), y es
 * la misma función que usa la emisión. Duplicarla en React abriría la puerta a
 * que la pantalla diga «no toca» y la base facture, o al revés. Este módulo solo
 * traduce periodos, fechas y respuestas a texto.
 */

/** Respuesta de `platform.get_subscription_billing_status`. */
export interface SubscriptionBillingStatus {
  subscription_id: string;
  currency: string;
  period_start: string;
  period_end: string;
  subscription_billable: boolean;
  has_due_items: boolean;
  due_item_count: number;
  estimated_total: number;
  existing_invoice: {
    invoice_id: string;
    number: string;
    status: string;
    total: number;
    currency: string;
  } | null;
  can_issue: boolean;
  next_billing_period: string | null;
}

/** Respuesta de `platform.issue_subscription_invoice`. */
export interface IssueInvoiceResult {
  invoice_id?: string;
  number?: string;
  created?: boolean;
  total?: number;
  currency?: string;
  status?: string;
  period_start?: string;
}

export const NO_DUE_ITEMS_MESSAGE = 'No existen cargos facturables en este período.';

/** Mes de calendario de una fecha, como valor de `<input type="month">` (`2026-09`). */
export function monthInputValue(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** `2026-09` → `2026-09-01`, el `p_period_start` que esperan las RPC. `null` si no es un mes válido. */
export function periodStartFromMonth(month: string): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  return match ? `${match[1]}-${match[2]}-01` : null;
}

/** `2026-09-01` → `01/09/2026`. Sin `Date`: una fecha de calendario no tiene zona horaria. */
export function formatDateDMY(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

/** `2026-09-01` → `09/2026`. */
export function formatPeriod(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})/.exec(value ?? '');
  return match ? `${match[2]}/${match[1]}` : '—';
}

/** Título del aviso tras emitir. `created: false` = la RPC devolvió la factura que ya existía. */
export function issueResultTitle(result: IssueInvoiceResult | null | undefined): string {
  return result?.created ? 'Factura emitida' : 'La factura del período ya existía';
}

/** Mensaje de error de emisión: los rechazos de cadence se explican, el resto se traduce igual que siempre. */
export function issueErrorMessage(error: unknown): string {
  const parsed = parseBusinessError(error);
  if (parsed.code === 'SIN_LINEAS_FACTURABLES') return NO_DUE_ITEMS_MESSAGE;
  if (parsed.code === 'SIN_IMPORTE_FACTURABLE') {
    return 'Los cargos de este período suman 0: no se emite una factura en cero.';
  }
  return parsed.message;
}
