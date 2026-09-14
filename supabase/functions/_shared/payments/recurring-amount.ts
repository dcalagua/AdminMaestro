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
 *
 * V3.2 · El Plan del proveedor se crea HOY con un importe fijo y no cambia
 * solo. Mirar únicamente las líneas vigentes hoy dejaba domiciliar:
 *   · MONTHLY hoy + YEARLY dentro de 3 meses → a los 3 meses el contrato es
 *     mixto y el Plan mensual no cobra el soporte anual (subcobro);
 *   · MONTHLY hoy + addon MONTHLY dentro de 3 meses → el Plan sigue cobrando
 *     el importe inicial (subcobro), o al revés si una línea termina (sobrecobro).
 * Por eso cuenta todo lo que el contrato YA SABE que va a estar vigente:
 *   · se ignoran las ONE_TIME, las líneas terminadas antes de hoy y las que
 *     empiezan después del fin del contrato;
 *   · más de una periodicidad → CADENCIA_MIXTA_NO_DOMICILIABLE;
 *   · si el total recurrente cambia en cualquier fecha futura dentro del
 *     contrato → MONTO_RECURRENTE_FUTURO_VARIABLE.
 * No hay reprovisioning automático del Plan: es un rechazo FAIL-SAFE.
 */
import { formatMinorUnits, toMinorUnits } from './money.ts';

export interface RecurringItem {
  billing_interval: string;
  amount: number | string | null;
  valid_from: string;
  valid_to: string | null;
}

export type RecurringAmountError =
  | 'SIN_IMPORTE_RECURRENTE'
  | 'CADENCIA_MIXTA_NO_DOMICILIABLE'
  | 'MONTO_RECURRENTE_FUTURO_VARIABLE';

export type RecurringAmountResult =
  /** `amount` es el texto decimal exacto (`"1250.00"`); `amountMinor`, sus céntimos. */
  | { ok: true; amountMinor: number; amount: string }
  | { ok: false; error: RecurringAmountError; changesOn?: string };

/** Mensajes para el usuario: sin detalles técnicos del proveedor. */
export const RECURRING_ERROR_MESSAGES: Record<RecurringAmountError, string> = {
  SIN_IMPORTE_RECURRENTE: 'La suscripción no tiene cargos recurrentes que domiciliar.',
  CADENCIA_MIXTA_NO_DOMICILIABLE:
    'La suscripción contiene cargos recurrentes con distintas periodicidades y no puede domiciliarse mediante un único plan.',
  MONTO_RECURRENTE_FUTURO_VARIABLE:
    'El importe recurrente cambiará durante la vigencia del contrato. Esta configuración requiere un esquema de cobro distinto.',
};

/** Día siguiente de una fecha de calendario `YYYY-MM-DD`. */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * `asOf` y `contractEndsOn` son fechas de calendario `YYYY-MM-DD`; se comparan
 * como texto ISO. `contractEndsOn` es `subscriptions.ends_on` (null = sin fin).
 */
export function recurringCardAmount(
  items: readonly RecurringItem[],
  subscriptionInterval: string,
  asOf: string,
  contractEndsOn: string | null = null,
): RecurringAmountResult {
  const endsOn = contractEndsOn?.slice(0, 10) ?? null;
  const lines = items
    .filter((i) => i.billing_interval !== 'ONE_TIME')
    .map((i) => ({
      interval: i.billing_interval,
      minor: toMinorUnits(i.amount ?? 0),
      from: i.valid_from.slice(0, 10),
      to: i.valid_to?.slice(0, 10) ?? null,
    }))
    // Terminada antes de hoy, o empieza cuando el contrato ya acabó: nunca se cobrará.
    .filter((l) => (l.to === null || l.to >= asOf) && (endsOn === null || l.from <= endsOn));

  if (lines.some((l) => l.interval !== subscriptionInterval)) {
    return { ok: false, error: 'CADENCIA_MIXTA_NO_DOMICILIABLE' };
  }

  const amountOn = (date: string) =>
    lines
      .filter((l) => l.from <= date && (l.to === null || l.to >= date))
      .reduce((sum, l) => sum + l.minor, 0);

  // El total recurrente solo puede cambiar cuando una línea empieza o termina.
  const current = amountOn(asOf);
  const changeDates = lines
    .flatMap((l) => [l.from > asOf ? l.from : null, l.to !== null ? nextDay(l.to) : null])
    .filter((d): d is string => d !== null && d > asOf && (endsOn === null || d <= endsOn))
    .sort();

  const changesOn = changeDates.find((d) => amountOn(d) !== current);
  if (changesOn) return { ok: false, error: 'MONTO_RECURRENTE_FUTURO_VARIABLE', changesOn };

  return current > 0
    ? { ok: true, amountMinor: current, amount: formatMinorUnits(current) }
    : { ok: false, error: 'SIN_IMPORTE_RECURRENTE' };
}
