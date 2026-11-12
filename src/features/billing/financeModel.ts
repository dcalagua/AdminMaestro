import type { CurrencyAmounts } from '@/features/executive/reportContext';
import { currentMonth, previousMonth } from '@/features/executive/reportContext';
import { monthLongLabel } from '@/features/dashboard/executiveModel';
import { formatMoneyCompact } from '@/lib/format';

/** Lógica pura de presentación de las pantallas de Finanzas (fase 10). */

export function sortedEntries(amounts: CurrencyAmounts): Array<[string, number]> {
  return Object.entries(amounts)
    .filter(([, v]) => Number.isFinite(v))
    .sort(([a], [b]) => a.localeCompare(b));
}

/** «BOB 686.1 K · PEN 745.4 K»: nativo, compacto, una moneda tras otra. */
export function nativeInline(amounts: CurrencyAmounts): string {
  return sortedEntries(amounts)
    .map(([currency, amount]) => formatMoneyCompact(amount, currency))
    .join(' · ');
}

/* ---- Series mensuales ------------------------------------------------------------------ */

/** Mes analizado de las franjas: el último CERRADO (el en curso es parcial, nota [08]). */
export function analyzedMonth(today: Date = new Date()): string {
  return previousMonth(currentMonth(today));
}

export function shortMonthName(month: string): string {
  return monthLongLabel(month).split(' ')[0] ?? month;
}

/**
 * Punto del mes analizado, el anterior y la tendencia de 12 meses cerrados
 * (para sparkline y variación). `month` en `YYYY-MM`.
 */
export function closedWindow<T extends { month: string }>(rows: readonly T[] | undefined, month: string) {
  const closed = (rows ?? []).filter((r) => r.month.slice(0, 7) <= month);
  const current = closed.find((r) => r.month.slice(0, 7) === month);
  const previous = closed.find((r) => r.month.slice(0, 7) === previousMonth(month));
  return { current, previous, trend: closed.slice(-12) };
}

/** Variación relativa; sin base comparable → null («—»), nunca ±∞. */
export function relChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** Nombre completo del mes («agosto»): «vs ago» se leería como inglés en una comparación. */
export function longMonthName(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString('es-PE', { month: 'long' }).toLocaleLowerCase('es');
}
