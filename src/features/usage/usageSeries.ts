/**
 * Series de consumo por medidor para la pestaña «Uso» (fase 12, PT-LIST-CHART).
 *
 * Se agregan en el cliente CANTIDADES (no dinero) ya leídas por
 * `useUsageAggregates` (misma caché que la pestaña Agregados), y solo de
 * agregados FINALIZADOS: un período abierto aún no es definitivo (spec §11.4).
 * Nada de esto factura ni decide nada.
 */

export interface AggregateLike {
  product_code: string | null;
  meter_code: string | null;
  period_start: string | null;
  status: string | null;
  quantity: number | string | null;
  allowance_included: number | string | null;
  overage_quantity?: number | string | null;
  unit?: string | null;
}

export const meterKey = (productCode: string | null | undefined, meterCode: string | null | undefined) =>
  `${productCode ?? ''}:${meterCode ?? ''}`;

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Períodos finalizados presentes (asc), como máximo los últimos `months`. */
export function finalizedPeriods(rows: readonly AggregateLike[], months = 12): string[] {
  const set = new Set<string>();
  for (const r of rows) if (r.status === 'FINALIZED' && r.period_start) set.add(r.period_start.slice(0, 10));
  return [...set].sort().slice(-months);
}

export interface MeterSeries {
  periods: string[];
  /** Cantidad finalizada por período; null antes del primer agregado del medidor. */
  values: Array<number | null>;
  last: { period: string; value: number } | null;
}

/** Serie mensual de cantidad finalizada por medidor (suma de tenants). */
export function meterSeries(rows: readonly AggregateLike[], months = 12): Map<string, MeterSeries> {
  const periods = finalizedPeriods(rows, months);
  const index = new Map(periods.map((p, i) => [p, i]));
  const sums = new Map<string, Array<number | null>>();
  for (const r of rows) {
    if (r.status !== 'FINALIZED' || !r.period_start) continue;
    const i = index.get(r.period_start.slice(0, 10));
    if (i === undefined) continue;
    const key = meterKey(r.product_code, r.meter_code);
    const arr = sums.get(key) ?? periods.map(() => null);
    arr[i] = (arr[i] ?? 0) + (num(r.quantity) ?? 0);
    sums.set(key, arr);
  }
  const out = new Map<string, MeterSeries>();
  for (const [key, arr] of sums) {
    // Tras el primer período con agregado, un mes sin agregado es consumo 0.
    const first = arr.findIndex((v) => v !== null);
    const values = arr.map((v, i) => (i < first ? null : (v ?? 0)));
    const lastIdx = values.length - 1;
    out.set(key, {
      periods,
      values,
      last: lastIdx >= 0 && values[lastIdx] !== null ? { period: periods[lastIdx]!, value: values[lastIdx]! } : null,
    });
  }
  return out;
}

export interface ConsumptionRow {
  key: string;
  productCode: string;
  meterCode: string;
  unit: string | null;
  consumed: number;
  /** Suma de lo incluido entre los agregados CON asignación; null si ninguno la tiene. */
  included: number | null;
  /** Consumo de los agregados con asignación (lo que se compara con `included`). */
  consumedWithAllowance: number;
  overage: number;
  tenants: number;
}

/** Consumo frente a lo incluido por medidor en un período finalizado. */
export function consumptionVsIncluded(rows: readonly AggregateLike[], period: string): ConsumptionRow[] {
  const map = new Map<string, ConsumptionRow>();
  for (const r of rows) {
    if (r.status !== 'FINALIZED' || r.period_start?.slice(0, 10) !== period) continue;
    const key = meterKey(r.product_code, r.meter_code);
    const row =
      map.get(key) ??
      ({
        key,
        productCode: r.product_code ?? '',
        meterCode: r.meter_code ?? '',
        unit: r.unit ?? null,
        consumed: 0,
        included: null,
        consumedWithAllowance: 0,
        overage: 0,
        tenants: 0,
      } satisfies ConsumptionRow);
    const q = num(r.quantity) ?? 0;
    const inc = num(r.allowance_included);
    row.consumed += q;
    row.tenants += 1;
    if (inc !== null) {
      row.included = (row.included ?? 0) + inc;
      row.consumedWithAllowance += q;
      row.overage += num(r.overage_quantity) ?? 0;
    }
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.productCode.localeCompare(b.productCode) || a.meterCode.localeCompare(b.meterCode));
}
