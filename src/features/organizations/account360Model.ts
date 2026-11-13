import type { AccountSeriesPoint } from '@/services/queries';
import type { CurrencyAmounts } from '@/features/executive/reportContext';

/**
 * Cabecera de la ficha 360 (V5 · F3), lógica pura.
 *
 * - MRR por moneda: el último punto de S11 (hoy) en su moneda NATIVA; nunca se
 *   suman monedas distintas en el navegador.
 * - Responsable comercial: el comercial con más participación vigente en las
 *   atribuciones de la cuenta. Es información comercial, no un acceso.
 */

/** MRR vigente por moneda (último punto de la serie), sin ceros. */
export function currentMrrByCurrency(points: readonly AccountSeriesPoint[] | undefined): CurrencyAmounts {
  const last = points && points.length > 0 ? points[points.length - 1] : undefined;
  const out: CurrencyAmounts = {};
  for (const [currency, amount] of Object.entries(last?.mrrNative ?? {})) {
    if (Number(amount) !== 0) out[currency] = Number(amount);
  }
  return out;
}

export interface AttributionLike {
  attribution_pct: number | string | null;
  status: string | null;
  valid_from: string | null;
  valid_to: string | null;
  sales_agents: { full_name: string | null } | null;
}

/** ¿Vigente hoy? Activa y dentro de su ventana de fechas. */
export function isCurrentAttribution(a: AttributionLike, today: string = new Date().toISOString().slice(0, 10)): boolean {
  if (a.status && a.status !== 'ACTIVE') return false;
  if (a.valid_from && a.valid_from.slice(0, 10) > today) return false;
  if (a.valid_to && a.valid_to.slice(0, 10) < today) return false;
  return true;
}

export interface CommercialOwner {
  name: string;
  /** Otros comerciales con participación vigente en la cuenta. */
  others: string[];
}

/** Responsable comercial: más participación acumulada en las atribuciones vigentes. */
export function commercialOwner(rows: readonly AttributionLike[] | undefined, today?: string): CommercialOwner | null {
  const totals = new Map<string, number>();
  for (const a of rows ?? []) {
    const name = a.sales_agents?.full_name;
    if (!name || !isCurrentAttribution(a, today)) continue;
    totals.set(name, (totals.get(name) ?? 0) + Number(a.attribution_pct ?? 0));
  }
  const ranked = [...totals.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'es'));
  if (ranked.length === 0) return null;
  return { name: ranked[0]![0], others: ranked.slice(1).map(([n]) => n) };
}
