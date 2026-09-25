import { useSearchParams } from 'react-router-dom';
import type { ConsolidatedGroup, FinanceConsolidated } from '@/types/domain';
import {
  buildReportContext,
  currentMonth,
  isoDate,
  lastMonths,
  monthPeriod,
  toCurrencyAmounts,
  type CurrencyAmounts,
  type ReportContext,
} from '@/features/executive/reportContext';
import type { CollectionsMonthRow, RenewalRow } from '@/services/financeRead';

/**
 * Contexto del reporte del inicio ejecutivo, en la URL (`?mes=2026-09&fx=…`)
 * para que una vista se pueda compartir y recargar. El período y la fecha FX son
 * parámetros distintos; la foto actual (MRR, saldo, antigüedad) no se mueve.
 */
export function useReportContextParams(today: Date = new Date()) {
  const [params, setParams] = useSearchParams();
  const now = currentMonth(today);
  const month = /^\d{4}-\d{2}$/.test(params.get('mes') ?? '') ? params.get('mes')! : now;
  const fx = /^\d{4}-\d{2}-\d{2}$/.test(params.get('fx') ?? '') ? params.get('fx')! : isoDate(today);
  const ctx: ReportContext = buildReportContext(month, fx, today);
  const set = (key: 'mes' | 'fx', value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(key, value);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  return {
    ctx,
    months: lastMonths(now, 12).reverse(),
    setMonth: (m: string) => set('mes', m),
    setFxDate: (d: string) => set('fx', d),
  };
}

/** Serie mensual por moneda (G01): meses sin cobros son cero REAL (consulta completa). */
export function collectionsSeries(
  rows: readonly CollectionsMonthRow[],
  months: string[],
): Record<string, Array<{ month: string; amount: number; payments: number }>> {
  const byCurrency: Record<string, Array<{ month: string; amount: number; payments: number }>> = {};
  const currencies = [...new Set(rows.map((r) => r.currency))].sort();
  for (const c of currencies) {
    byCurrency[c] = months.map((m) => {
      const row = rows.find((r) => r.currency === c && r.month.slice(0, 7) === m);
      return { month: m, amount: row ? Number(row.amount) : 0, payments: row ? Number(row.payment_count) : 0 };
    });
  }
  return byCurrency;
}

/** Cobrado de un mes por moneda, desde la MISMA serie que dibuja el gráfico. */
export function collectedInMonth(rows: readonly CollectionsMonthRow[], month: string): CurrencyAmounts {
  const out: CurrencyAmounts = {};
  for (const r of rows) if (r.month.slice(0, 7) === month) out[r.currency] = Number(r.amount);
  return out;
}

export const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function monthShortLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`;
}

/** Métrica nativa de un grupo del consolidado. */
export function nativeMetric(group: ConsolidatedGroup | undefined, key: 'MRR' | 'ARR' | 'COLLECTED' | 'COST' | 'COMMISSION'): CurrencyAmounts {
  return toCurrencyAmounts(group?.metrics[key]?.native ?? {});
}

export function totalGroup(data: FinanceConsolidated | undefined): ConsolidatedGroup | undefined {
  return data?.groups[0];
}

/** Renovaciones dentro de la ventana: conteo y MRR vigente por moneda (K06). */
export function renewalsInWindow(rows: readonly RenewalRow[], days: number) {
  const inWindow = rows.filter(
    (r) => r.days_to_renewal !== null && r.days_to_renewal !== undefined && Number(r.days_to_renewal) >= 0 && Number(r.days_to_renewal) <= days,
  );
  const mrr: CurrencyAmounts = {};
  let withoutMrr = 0;
  for (const r of inWindow) {
    if (r.current_mrr === null || r.current_mrr === undefined || !r.currency) {
      withoutMrr += 1;
      continue;
    }
    mrr[r.currency] = Math.round(((mrr[r.currency] ?? 0) + Number(r.current_mrr)) * 100) / 100;
  }
  return { count: inWindow.length, mrr, withoutMrr, rows: inWindow };
}

export function periodLabel(ctx: ReportContext): string {
  return `${ctx.period.label}${ctx.period.partial ? ' (en curso, parcial)' : ''}`;
}

export function monthRange(month: string) {
  const p = monthPeriod(month);
  return { from: p.start, to: p.end };
}
