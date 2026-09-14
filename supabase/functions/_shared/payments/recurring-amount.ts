/**
 * V3.1 · Importe que se domicilia en un plan recurrente de tarjeta.
 *
 * Módulo PURO (sin dependencias de Deno) para poder probarlo con vitest.
 *
 * Un plan del proveedor cobra UN importe cada UN intervalo, el de la
 * suscripción. Hasta la V3.1 `payment-setup` sumaba todas las líneas no
 * ONE_TIME: con una licencia MONTHLY y un soporte YEARLY se domiciliaba el
 * soporte anual TODOS los meses, y también líneas ya vencidas. La facturación
 * gerencial aplica la cadence por línea en PostgreSQL
 * (`platform.subscription_due_items`); aquí basta con no mezclar cadencias.
 */

export interface RecurringItem {
  billing_interval: string;
  amount: number | string | null;
  valid_from: string;
  valid_to: string | null;
}

export type RecurringAmountResult =
  | { ok: true; amount: number }
  | { ok: false; error: 'SIN_IMPORTE_RECURRENTE' | 'CADENCIA_MIXTA_NO_DOMICILIABLE' };

/** `asOf` es una fecha de calendario `YYYY-MM-DD`; se compara como texto ISO. */
export function recurringCardAmount(
  items: readonly RecurringItem[],
  subscriptionInterval: string,
  asOf: string,
): RecurringAmountResult {
  const recurringInForce = items.filter(
    (i) =>
      i.billing_interval !== 'ONE_TIME' &&
      i.valid_from.slice(0, 10) <= asOf &&
      (i.valid_to === null || i.valid_to.slice(0, 10) >= asOf),
  );

  if (recurringInForce.some((i) => i.billing_interval !== subscriptionInterval)) {
    return { ok: false, error: 'CADENCIA_MIXTA_NO_DOMICILIABLE' };
  }

  const amount =
    Math.round(recurringInForce.reduce((sum, i) => sum + Number(i.amount ?? 0), 0) * 100) / 100;
  return amount > 0 ? { ok: true, amount } : { ok: false, error: 'SIN_IMPORTE_RECURRENTE' };
}
