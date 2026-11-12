/**
 * Ciclo de una liquidación de comisiones (fase 13): lógica pura de la pantalla.
 *
 *     OPEN ──Aprobar──▶ APPROVED ──Registrar pago──▶ PAID
 *       └──────────Anular (con motivo)──────────▶ CANCELLED
 *
 * Qué acción se OFRECE es UX: la autoridad son las RPCs
 * (`approve_/pay_/cancel_commission_settlement`), que repiten estas reglas.
 */

export type SettlementStatus = 'OPEN' | 'APPROVED' | 'PAID' | 'CANCELLED';
export type SettlementAction = 'approve' | 'pay' | 'cancel';
type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'info';

export const SETTLEMENT_STATUS: Record<SettlementStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Abierta', tone: 'info' },
  APPROVED: { label: 'Aprobada', tone: 'warn' },
  PAID: { label: 'Pagada', tone: 'ok' },
  CANCELLED: { label: 'Anulada', tone: 'neutral' },
};

export function settlementStatus(status: string | null | undefined): { label: string; tone: Tone } {
  return SETTLEMENT_STATUS[status as SettlementStatus] ?? { label: status ?? '—', tone: 'neutral' };
}

/** Medios admitidos por `pay_commission_settlement` (CHECK de la tabla). */
export const PAYMENT_METHODS = [
  { value: 'BANK_TRANSFER', label: 'Transferencia bancaria' },
  { value: 'PAYROLL', label: 'Planilla' },
  { value: 'CHECK', label: 'Cheque' },
  { value: 'CASH', label: 'Efectivo' },
  { value: 'OTHER', label: 'Otro' },
] as const;

export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return '—';
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

/**
 * Acciones posibles según el estado. Una liquidación con total negativo (los
 * reversos superan lo devengado) o sin eventos no se aprueba: se anula y sus
 * eventos entran en la próxima.
 */
export function settlementActions(
  s: { status: string; total_amount: number | string | null; event_count?: number | null },
  canManage: boolean,
): SettlementAction[] {
  if (!canManage) return [];
  const total = Number(s.total_amount ?? 0);
  const approvable = total >= 0 && (s.event_count == null || s.event_count > 0);
  switch (s.status) {
    case 'OPEN':
      return approvable ? ['approve', 'cancel'] : ['cancel'];
    case 'APPROVED':
      return ['pay', 'cancel'];
    default:
      return [];
  }
}

/** Por qué una liquidación abierta no se puede aprobar (o `null` si sí se puede). */
export function approvalBlocker(s: { status: string; total_amount: number | string | null; event_count?: number | null }): string | null {
  if (s.status !== 'OPEN') return null;
  if (s.event_count === 0) return 'No tiene comisiones: anúlala en lugar de aprobarla.';
  if (Number(s.total_amount ?? 0) < 0) {
    return 'Los reversos superan lo devengado y no hay nada que pagar: anúlala para que sus comisiones entren en la próxima liquidación.';
  }
  return null;
}

/** Fecha local `YYYY-MM-DD` (no `toISOString`, que en Lima de noche ya es mañana en UTC). */
export function localIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Período por defecto para generar: el último mes cerrado completo. */
export function previousMonthRange(today: Date = new Date()): { from: string; to: string } {
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const last = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: localIsoDate(first), to: localIsoDate(last) };
}

/** Pasos del ciclo para el «stepper» del detalle. */
export const SETTLEMENT_STEPS = [
  { id: 'OPEN', label: 'Generada' },
  { id: 'APPROVED', label: 'Aprobada' },
  { id: 'PAID', label: 'Pagada' },
] as const;

/** Índice del paso actual (0 generada, 1 aprobada, 2 pagada); `-1` si está anulada. */
export function settlementStep(status: string | null | undefined): number {
  return SETTLEMENT_STEPS.findIndex((s) => s.id === status);
}

/** Texto de búsqueda de una liquidación (código, comercial, referencia, moneda). */
export function settlementSearchText(s: {
  code: string;
  currency: string;
  payment_reference?: string | null;
  sales_agents?: { full_name?: string | null; code?: string | null } | null;
}): Array<string | null | undefined> {
  return [s.code, s.currency, s.payment_reference, s.sales_agents?.full_name, s.sales_agents?.code];
}
