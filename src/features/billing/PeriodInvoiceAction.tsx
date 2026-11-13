import { formatMoney } from '@/lib/format';
import {
  NO_DUE_ITEMS_MESSAGE, formatDateDMY, formatPeriod, issueErrorMessage, type IssueInvoiceResult,
} from '@/lib/billing';
import { MonthField } from '@/components/ui/fields';
import { usePeriodInvoice, type PeriodInvoiceState } from './periodInvoice';

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
  onIssued,
}: {
  subscriptionId: string;
  currency: string;
  /** Tras emitir (o reutilizar) la factura del período: flujos guiados y diálogo de Cobranza. */
  onIssued?: (result: IssueInvoiceResult | null) => void;
}) {
  const state = usePeriodInvoice({ subscriptionId, currency, onIssued });
  return (
    <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
      <PeriodInvoiceFields state={state} />
      <button type="button" className="ebim-btn-ghost" disabled={state.disabled} onClick={() => void state.issue()}>
        {state.pending ? 'Emitiendo…' : `Emitir factura del período (${currency})`}
      </button>
    </div>
  );
}

/** Período y lo que dice la base de ese período (cargos, factura vigente, próxima facturación). */
export function PeriodInvoiceFields({ state }: { state: PeriodInvoiceState }) {
  const { month, setMonth, status } = state;
  const st = status.data;
  return (
    <div className="space-y-1">
      <MonthField
        id="billing-period"
        className="w-72 max-w-full"
        label="Período de facturación"
        ahead={12}
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      />
      <div className="text-compact text-muted" data-testid="billing-status" aria-live="polite">
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
  );
}
