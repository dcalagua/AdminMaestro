import { Badge } from '@/components/ui/primitives';
import { SummaryBar, SummaryItem } from '@/components/ui/SummaryBar';
import { useSubscriptionBillingStatus } from '@/services/queries';
import { formatDateDMY, monthInputValue, periodStartFromMonth } from '@/lib/billing';
import { formatCountNoun, formatMoney } from '@/lib/format';
import type { CurrencyAmounts } from '@/features/executive/reportContext';
import { nativeInline } from './financeModel';

type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'info' | 'accent';

interface Loadable {
  loading?: boolean;
  error?: boolean;
}

/**
 * Cabecera fija del contrato (V6 · T8): estado, recurrente al mes, saldo, próxima
 * factura, método de cobro y documento. Reemplaza cuatro KPI que mostraban
 * texto («Tarjeta (Culqi)», «No aplica») en tamaño de cifra.
 */
export function ContractSummaryBar({
  subscriptionId,
  status,
  monthly,
  oneTime,
  interval,
  showMoney,
  balance,
  method,
  document,
}: {
  subscriptionId: string;
  status: { label: string; tone: Tone };
  monthly: CurrencyAmounts;
  oneTime: CurrencyAmounts;
  interval: string;
  showMoney: boolean;
  balance: Loadable & { amounts: CurrencyAmounts; open: number; overdue: number; partnerStatement: boolean };
  method: Loadable & { label: string | null; auto: boolean; cardOnFile: boolean };
  document: Loadable & { required: boolean; label: string; tone: Tone; validTo: string | null };
}) {
  const hasMonthly = Object.keys(monthly).length > 0;
  const hasOneTime = Object.keys(oneTime).length > 0;
  return (
    <SummaryBar label="Resumen del contrato">
      <SummaryItem label="Estado">
        <Badge tone={status.tone} dot>{status.label}</Badge>
      </SummaryItem>
      <SummaryItem
        label="Recurrente / mes"
        hint={`Líneas recurrentes normalizadas a mes. Cadencia: ${interval}.${
          hasOneTime ? ` Cargos únicos (no cuentan para el MRR): ${nativeInline(oneTime)}.` : ''
        }`}
      >
        {hasMonthly ? (
          <span className="tabular-nums" data-monthly>{nativeInline(monthly)}</span>
        ) : (
          <span className="font-normal text-muted">Sin líneas recurrentes</span>
        )}
      </SummaryItem>
      {showMoney ? (
        <>
          <SummaryItem
            label="Saldo por cobrar"
            hint={`Facturas emitidas o con pago parcial menos cobros confirmados, por moneda. ${formatCountNoun(balance.open, 'factura abierta', 'facturas abiertas')}${
              balance.overdue > 0 ? `, ${formatCountNoun(balance.overdue, 'vencida')}` : ''
            }.`}
          >
            {balance.loading ? '…' : balance.error ? (
              <span className="font-normal text-muted">No disponible</span>
            ) : Object.keys(balance.amounts).length > 0 ? (
              <>
                <span className={`tabular-nums ${balance.overdue > 0 ? 'text-danger' : ''}`} data-balance>
                  {nativeInline(balance.amounts)}
                </span>
                <span className={`text-caption font-normal ${balance.overdue > 0 ? 'text-danger' : 'text-muted'}`} data-balance-detail>
                  {balance.overdue > 0 ? formatCountNoun(balance.overdue, 'vencida') : formatCountNoun(balance.open, 'abierta')}
                </span>
              </>
            ) : (
              <span className="font-normal text-muted">
                {balance.partnerStatement ? 'Lo factura el partner' : 'Sin saldo pendiente'}
              </span>
            )}
          </SummaryItem>
          <NextInvoiceItem subscriptionId={subscriptionId} />
        </>
      ) : null}
      <SummaryItem
        label="Método de cobro"
        hint={method.label ? (method.auto ? 'Con cargo automático' : 'Sin cargo automático') : 'Sin perfil se cobra manualmente; no se presupone tarjeta'}
      >
        {method.loading ? '…' : method.label ? (
          <span>
            {method.label}
            <span className="font-normal text-muted">
              {' · '}
              {method.auto ? 'automático' : 'manual'}
              {method.cardOnFile ? ' · tarjeta guardada' : ''}
            </span>
          </span>
        ) : (
          <Badge tone="warn">Sin configurar</Badge>
        )}
      </SummaryItem>
      <SummaryItem
        label="Documento vigente"
        hint={document.required ? 'El método de cobro exige orden de servicio o de compra' : 'El método de cobro no exige orden de servicio ni de compra'}
      >
        {document.loading ? '…' : !document.required ? (
          <span className="font-normal text-muted">No aplica</span>
        ) : (
          <>
            <Badge tone={document.tone} dot>{document.label}</Badge>
            {document.validTo ? (
              <span className="text-caption font-normal text-muted">hasta {formatDateDMY(document.validTo)}</span>
            ) : null}
          </>
        )}
      </SummaryItem>
    </SummaryBar>
  );
}

/** Próxima facturación según el mismo motor que emite (`get_subscription_billing_status`). */
function NextInvoiceItem({ subscriptionId }: { subscriptionId: string }) {
  // Misma clave de caché que «Emitir factura del período» con el mes en curso.
  const status = useSubscriptionBillingStatus(subscriptionId, periodStartFromMonth(monthInputValue()));
  const st = status.data;
  return (
    <SummaryItem label="Próxima factura" hint="Calculada con la periodicidad de cada línea; la emisión la decide la base">
      {status.isLoading ? '…' : status.error || !st ? (
        <span className="font-normal text-muted">No disponible</span>
      ) : st.existing_invoice == null && st.has_due_items ? (
        <span title={`Total estimado: ${formatMoney(Number(st.estimated_total), st.currency)}`}>Este mes</span>
      ) : st.next_billing_period ? (
        <span className="tabular-nums" data-next-invoice>{formatDateDMY(st.next_billing_period)}</span>
      ) : (
        <span className="font-normal text-muted">Sin cargos en 12 meses</span>
      )}
    </SummaryItem>
  );
}
