import type { AccountSeriesPoint } from '@/services/queries';
import { monthLongLabel } from '@/features/dashboard/executiveModel';
import { monthShortLabel } from '@/features/dashboard/executiveData';

/**
 * Lectura de la serie S11 de UNA cuenta para las fichas 360 (lógica pura).
 *
 * Una cuenta suele operar en una sola moneda: entonces se grafica en su moneda
 * NATIVA (PEN 2,660 plano, sin ruido de tipo de cambio). Si tiene contratos o
 * facturas en varias monedas, se usa la moneda de reporte que la base ya
 * convirtió; nunca se suman monedas en el navegador.
 */

export interface AccountPoint {
  month: string;
  label: string;
  title: string;
  partial: boolean;
  mrr: number | null;
  invoiced: number | null;
  collected: number | null;
}

export interface AccountSeriesView {
  currency: string;
  /** true: una sola moneda nativa; false: moneda de reporte. */
  native: boolean;
  points: AccountPoint[];
  /** Monedas sin tasa (solo en moneda de reporte). */
  missing: string[];
  hasMrr: boolean;
  hasBilling: boolean;
}

export function accountSeriesView(rows: readonly AccountSeriesPoint[] | undefined): AccountSeriesView | null {
  if (!rows || rows.length === 0) return null;
  const currencies = new Set<string>();
  for (const r of rows) {
    for (const map of [r.mrrNative, r.invoicedNative, r.collectedNative]) {
      for (const [c, v] of Object.entries(map)) if (v !== 0) currencies.add(c);
    }
  }
  const single = currencies.size <= 1;
  const currency = single ? ([...currencies][0] ?? rows[0]!.reportingCurrency) : rows[0]!.reportingCurrency;
  const pick = (native: Record<string, number>, reporting: number | null) =>
    single ? (native[currency] ?? 0) : reporting;
  const points = rows.map((r) => {
    const ym = r.month.slice(0, 7);
    return {
      month: r.month,
      label: monthShortLabel(ym),
      title: monthLongLabel(ym),
      partial: r.isPartial,
      mrr: pick(r.mrrNative, r.mrr),
      invoiced: pick(r.invoicedNative, r.invoiced),
      collected: pick(r.collectedNative, r.collected),
    };
  });
  return {
    currency,
    native: single,
    points,
    missing: single ? [] : [...new Set(rows.flatMap((r) => r.missingCurrencies))].sort(),
    hasMrr: points.some((p) => (p.mrr ?? 0) !== 0),
    hasBilling: points.some((p) => (p.invoiced ?? 0) !== 0 || (p.collected ?? 0) !== 0),
  };
}

export type AccountHealth = 'NO_CONTRACTS' | 'OK' | 'PAST_DUE' | 'SUSPENSION';

/**
 * Salud de cobranza de una cuenta a partir de las banderas que ya calcula la
 * base por contrato (`v_renewal_pipeline`): la peor gana.
 */
export function accountHealth(
  contracts: ReadonlyArray<{ is_past_due?: boolean | null; suspension_pending?: boolean | null }>,
): AccountHealth {
  if (contracts.length === 0) return 'NO_CONTRACTS';
  if (contracts.some((c) => c.suspension_pending)) return 'SUSPENSION';
  if (contracts.some((c) => c.is_past_due)) return 'PAST_DUE';
  return 'OK';
}

export const HEALTH_TEXT: Record<AccountHealth, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger'; detail: string }> = {
  NO_CONTRACTS: { label: 'Sin contratos', tone: 'neutral', detail: 'No hay contratos visibles para medir la cobranza' },
  OK: { label: 'Al día', tone: 'ok', detail: 'Ningún contrato con deuda vencida' },
  PAST_DUE: { label: 'Con deuda vencida', tone: 'warn', detail: 'Al menos un contrato tiene facturas vencidas' },
  SUSPENSION: { label: 'Suspensión pendiente', tone: 'danger', detail: 'Un contrato superó el plazo de gracia' },
};
