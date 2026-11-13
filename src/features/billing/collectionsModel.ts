import type { InvoiceRow } from '@/services/financeRead';
import { formatDate, formatNumber } from '@/lib/format';

/** «vencida hace 12 días», «vence en 3 días», «vence hoy». */
export function dueText(row: Pick<InvoiceRow, 'due_date' | 'days_overdue'>, today = new Date()): { text: string; overdue: boolean } {
  if (!row.due_date) return { text: 'Sin fecha de vencimiento', overdue: false };
  const days = row.days_overdue ?? 0;
  if (days > 0) return { text: `vencida hace ${formatNumber(days)} ${days === 1 ? 'día' : 'días'}`, overdue: true };
  const due = new Date(`${row.due_date}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const left = Math.round((due.getTime() - start.getTime()) / 86_400_000);
  if (left <= 0) return { text: 'vence hoy', overdue: false };
  return { text: `vence en ${formatNumber(left)} ${left === 1 ? 'día' : 'días'}`, overdue: false };
}


/** Tramos de antigüedad de «Por cobrar» (V6): cada uno es una cifra de la franja y un filtro. */
export const AGING_STRIP = [
  { id: 'VIGENTE', label: 'Por vencer' },
  { id: 'D1_30', label: '1–30 días' },
  { id: 'D31_60', label: '31–60 días' },
  { id: 'D61_90', label: '61–90 días' },
  { id: 'D90_MAS', label: 'Más de 90 días' },
] as const;

export type AgingStripId = (typeof AGING_STRIP)[number]['id'];

export interface AgingCell {
  /** Saldo por moneda (nunca se suman monedas). */
  amounts: Record<string, number>;
  invoices: number;
}

/** Agrupa `receivables_aging` (una fila por tramo × moneda) por tramo. */
export function agingCells(
  rows: ReadonlyArray<{ aging_bucket: string; currency: string; invoice_count: number | string; balance: number | string }>,
): Record<AgingStripId, AgingCell> {
  const out = Object.fromEntries(AGING_STRIP.map((b) => [b.id, { amounts: {}, invoices: 0 }])) as Record<AgingStripId, AgingCell>;
  for (const r of rows) {
    const cell = out[r.aging_bucket as AgingStripId];
    if (!cell) continue;
    const balance = Number(r.balance);
    if (Number.isFinite(balance) && balance !== 0) cell.amounts[r.currency] = (cell.amounts[r.currency] ?? 0) + balance;
    cell.invoices += Number(r.invoice_count) || 0;
  }
  return out;
}

/** V6 · T9: las fechas ISO que trae el detalle (`2026-09-01`) se leen como el resto de la consola. */
export function readableDates(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  return text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => formatDate(iso));
}
