import { useState } from 'react';
import { useSubscriptionBillingStatus } from '@/services/queries';
import { useIssueSubscriptionInvoice } from '@/services/mutations';
import { useToast } from '@/components/ui/toast-context';
import { formatMoney } from '@/lib/format';
import {
  NO_DUE_ITEMS_MESSAGE, formatDateDMY, formatPeriod, issueErrorMessage, issueResultTitle,
  monthInputValue, periodStartFromMonth, type IssueInvoiceResult,
} from '@/lib/billing';

/**
 * V3.1 · Emisión de la factura del PERIODO de una suscripción.
 *
 * Antes era «Emitir factura del mes», y la base metía todas las líneas
 * recurrentes cada mes. Ahora el periodo es elegible y la pantalla pinta lo que
 * responde `get_subscription_billing_status` —cargos debidos, total estimado,
 * factura vigente y próxima facturación— sin recalcular periodicidades. Si la
 * consulta falla, el botón sigue disponible: quien decide es la RPC de emisión,
 * que aplica la misma cadence y rechaza un periodo sin cargos.
 */
export function PeriodInvoiceAction({
  subscriptionId,
  currency,
}: {
  subscriptionId: string;
  currency: string;
}) {
  const toast = useToast();
  const [month, setMonth] = useState(() => monthInputValue());
  const periodStart = periodStartFromMonth(month);
  const status = useSubscriptionBillingStatus(subscriptionId, periodStart);
  const issueInvoice = useIssueSubscriptionInvoice();

  const st = status.data;
  const blockedByStatus = Boolean(st) && !st!.can_issue;
  const disabled = !periodStart || issueInvoice.isPending || status.isLoading || blockedByStatus;

  async function issue() {
    if (!periodStart) return;
    try {
      const r = (await issueInvoice.mutateAsync({
        p_subscription_id: subscriptionId,
        p_period_start: periodStart,
      })) as IssueInvoiceResult | null;
      toast.success(
        issueResultTitle(r),
        `${r?.number ?? ''} · ${formatMoney(Number(r?.total ?? 0), r?.currency ?? currency)}`,
      );
    } catch (error) {
      toast.error('No se pudo emitir la factura', issueErrorMessage(error));
    }
  }

  return (
    <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <label className="block text-xs font-semibold text-fg" htmlFor="billing-period">
          Período de facturación
        </label>
        <input
          id="billing-period"
          type="month"
          className="ebim-input w-44"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        <div className="text-xs text-muted" data-testid="billing-status" aria-live="polite">
          {status.isLoading ? (
            <p role="status">Calculando cargos del período…</p>
          ) : status.error ? (
            <p className="text-danger">
              No se pudo consultar el estado de facturación: {issueErrorMessage(status.error)}
            </p>
          ) : st ? (
            <>
              {st.existing_invoice ? (
                <p>
                  Factura del período {formatPeriod(st.period_start)} ya emitida:{' '}
                  <span className="font-mono font-semibold text-fg">{st.existing_invoice.number}</span> ·{' '}
                  {formatMoney(Number(st.existing_invoice.total), st.existing_invoice.currency)}
                </p>
              ) : st.has_due_items ? (
                <p>
                  {st.due_item_count === 1 ? '1 cargo facturable' : `${st.due_item_count} cargos facturables`} en{' '}
                  {formatPeriod(st.period_start)} · Total estimado{' '}
                  <span className="font-semibold text-fg">{formatMoney(Number(st.estimated_total), st.currency)}</span>
                </p>
              ) : (
                <p>{NO_DUE_ITEMS_MESSAGE}</p>
              )}
              <p>
                {st.next_billing_period
                  ? `Próxima facturación: ${formatDateDMY(st.next_billing_period)}`
                  : 'Sin cargos pendientes de facturar en los próximos 12 meses.'}
              </p>
            </>
          ) : null}
        </div>
      </div>
      <button type="button" className="ebim-btn-ghost" disabled={disabled} onClick={() => void issue()}>
        {issueInvoice.isPending ? 'Emitiendo…' : `Emitir factura del período (${currency})`}
      </button>
    </div>
  );
}
