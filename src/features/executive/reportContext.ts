/**
 * Contexto de reporte — spec §8.2 / AC08.
 *
 * Tres ejes que NO se confunden:
 *   · período transaccional (cobros, costos, comisiones con fecha de hecho);
 *   · fecha de valuación FX (sólo convierte; no mueve el período);
 *   · foto actual (MRR, saldo, antigüedad): vale «al momento de consulta» y NO
 *     cambia al elegir un mes pasado.
 */

export interface ReportPeriod {
  /** Primer día, `YYYY-MM-DD`. */
  start: string;
  /** Último día incluido, `YYYY-MM-DD`. */
  end: string;
  label: string;
  /** El período incluye hoy: todavía no terminó. */
  partial: boolean;
}

export interface ReportContext {
  period: ReportPeriod;
  /** Fecha de tasas FX (`p_as_of`). */
  fxDate: string;
  /** Foto actual: siempre hoy; independiente del período. */
  snapshotDate: string;
}

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Mes calendario que contiene `monthStart` (`YYYY-MM` o `YYYY-MM-DD`). */
export function monthPeriod(month: string, today: Date = new Date()): ReportPeriod {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  const todayIso = isoDate(today);
  const startIso = isoDate(start);
  const endIso = isoDate(end);
  const partial = todayIso >= startIso && todayIso <= endIso;
  return {
    start: startIso,
    end: endIso,
    label: `${MONTHS[m - 1]} ${y}`,
    partial,
  };
}

export function currentMonth(today: Date = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Últimos `n` meses terminando en `month` (incluido), del más antiguo al más reciente. */
export function lastMonths(month: string, n: number): string[] {
  const out: string[] = [];
  let cursor = month;
  for (let i = 0; i < n; i += 1) {
    out.unshift(cursor);
    cursor = previousMonth(cursor);
  }
  return out;
}

export function buildReportContext(
  month: string,
  fxDate: string,
  today: Date = new Date(),
): ReportContext {
  return { period: monthPeriod(month, today), fxDate, snapshotDate: isoDate(today) };
}

export type Comparison =
  | { kind: 'delta'; ratio: number }
  | { kind: 'not-comparable'; reason: string };

/**
 * Variación contra el período anterior (K02).
 * - Base anterior cero o ausente → no comparable (nunca «infinito»).
 * - Período actual parcial → no se compara silenciosamente contra un mes completo.
 */
export function compareToPrevious(
  current: number | null | undefined,
  previous: number | null | undefined,
  options: { currentPartial?: boolean } = {},
): Comparison {
  if (options.currentPartial) {
    return { kind: 'not-comparable', reason: 'Mes en curso: no se compara con un mes completo' };
  }
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return { kind: 'not-comparable', reason: 'Sin dato en uno de los dos períodos' };
  }
  if (previous === 0) return { kind: 'not-comparable', reason: 'Sin base: el período anterior fue cero' };
  return { kind: 'delta', ratio: (current - previous) / Math.abs(previous) };
}

export type CurrencyAmounts = Record<string, number>;

/** Normaliza el mapa jsonb que devuelve Postgres (`numeric` puede llegar como texto). */
export function toCurrencyAmounts(map: Record<string, number | string | null> | null | undefined): CurrencyAmounts {
  const out: CurrencyAmounts = {};
  for (const [currency, value] of Object.entries(map ?? {})) {
    if (value === null || value === undefined) continue;
    const n = Number(value);
    if (!Number.isNaN(n)) out[currency] = n;
  }
  return out;
}

/**
 * Margen gerencial por moneda (K05): cobrado − costo − comisión, SÓLO si las tres
 * fuentes llegaron. Con una fuente ausente el resultado es `null` (no calculable),
 * nunca un margen «completo» que en realidad omite un componente.
 */
export function managementMargin(
  collected: CurrencyAmounts | null,
  cost: CurrencyAmounts | null,
  commission: CurrencyAmounts | null,
): CurrencyAmounts | null {
  if (!collected || !cost || !commission) return null;
  const out: CurrencyAmounts = {};
  const currencies = new Set([...Object.keys(collected), ...Object.keys(cost), ...Object.keys(commission)]);
  for (const c of currencies) {
    out[c] = Math.round(((collected[c] ?? 0) - (cost[c] ?? 0) - (commission[c] ?? 0)) * 100) / 100;
  }
  return out;
}
