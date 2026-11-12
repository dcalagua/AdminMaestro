import type { InvoiceRow } from '@/services/financeRead';
import { formatNumber } from '@/lib/format';

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

