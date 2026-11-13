import { useState } from 'react';
import { useSubscriptionBillingStatus } from '@/services/queries';
import { useIssueSubscriptionInvoice } from '@/services/mutations';
import { useToast } from '@/components/ui/toast-context';
import { formatMoney } from '@/lib/format';
import { issueErrorMessage, issueResultTitle, monthInputValue, periodStartFromMonth, type IssueInvoiceResult } from '@/lib/billing';

/**
 * Estado y emisión de la factura del PERÍODO de un contrato (V3.1), sin
 * presentación: lo usan `PeriodInvoiceAction` (ficha del contrato, alta) y el
 * diálogo «Emitir factura» de Cobranza (V6: la acción primaria va al pie).
 *
 * Sin contrato (`subscriptionId` vacío) no consulta nada y no se puede emitir.
 * La RPC de emisión decide: aplica la periodicidad y rechaza un período sin cargos.
 */
export function usePeriodInvoice({
  subscriptionId,
  currency,
  onIssued,
}: {
  subscriptionId: string | undefined;
  currency: string;
  onIssued?: (result: IssueInvoiceResult | null) => void;
}) {
  const toast = useToast();
  const [month, setMonth] = useState(() => monthInputValue());
  const periodStart = periodStartFromMonth(month);
  const status = useSubscriptionBillingStatus(subscriptionId, periodStart);
  const issueInvoice = useIssueSubscriptionInvoice();

  const st = status.data;
  const blockedByStatus = Boolean(st) && !st!.can_issue;
  const disabled = !subscriptionId || !periodStart || issueInvoice.isPending || status.isLoading || blockedByStatus;

  async function issue() {
    if (!periodStart || !subscriptionId) return;
    try {
      const r = (await issueInvoice.mutateAsync({
        p_subscription_id: subscriptionId,
        p_period_start: periodStart,
      })) as IssueInvoiceResult | null;
      toast.success(issueResultTitle(r), `${r?.number ?? ''} · ${formatMoney(Number(r?.total ?? 0), r?.currency ?? currency)}`);
      onIssued?.(r);
    } catch (error) {
      toast.error('No se pudo emitir la factura', issueErrorMessage(error));
    }
  }

  return { month, setMonth, status, disabled, pending: issueInvoice.isPending, issue };
}

export type PeriodInvoiceState = ReturnType<typeof usePeriodInvoice>;
