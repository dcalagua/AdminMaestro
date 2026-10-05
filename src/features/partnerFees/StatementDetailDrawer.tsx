import { usePartnerFeeStatementLines, usePartnerFeeStatements } from '@/services/queries';
import { DetailDrawer, DetailList } from '@/components/ui/DetailDrawer';
import { Badge, DataTable, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { formatDateTime, formatMoney, formatPercent } from '@/lib/format';
import { formatPeriod, labelOf } from '@/features/usage/usageLabels';
import { LINE_KIND_LABEL, STATEMENT_STATUS } from './feeLabels';

export type Statement = NonNullable<ReturnType<typeof usePartnerFeeStatements>['data']>[number];

/**
 * Detalle de un estado de cuenta de partner: una línea por tenant y producto
 * (base mensualizada, %, fijo y tarifa). Solo lectura: emitir o anular abren
 * su propio diálogo desde la fila.
 */
export function StatementDetailDrawer({ statement, onClose }: { statement: Statement | null; onClose: () => void }) {
  const lines = usePartnerFeeStatementLines(statement?.id ?? null);
  const s = statement;
  const status = labelOf(STATEMENT_STATUS, s?.status);
  const rows = lines.data ?? [];

  return (
    <DetailDrawer
      open={Boolean(s)}
      title={`${s?.partner_name ?? ''} · ${s?.currency ?? ''}`}
      subtitle={`Tarifa de plataforma de ${formatPeriod(s?.period_start)}`}
      onClose={onClose}
    >
      {s ? (
        <div className="space-y-4">
          <DetailList
            items={[
              ['Estado', <Badge key="st" tone={status.tone}>{status.label}</Badge>],
              ['Tenants', String(s.tenant_count ?? 0)],
              ['Base mensual', formatMoney(Number(s.base_total), s.currency)],
              ['Tarifa', formatMoney(Number(s.fee_total), s.currency)],
              ['Factura', s.invoice_number ?? 'Sin emitir'],
              ['Saldo', s.invoice_balance !== null ? formatMoney(Number(s.invoice_balance), s.currency) : '—'],
              ['Calculado', formatDateTime(s.computed_at)],
              ...(s.void_reason ? ([['Motivo de anulación', s.void_reason]] as Array<[string, string]>) : []),
            ]}
          />
          <h3 className="text-sm font-bold text-fg">Detalle por tenant</h3>
          {lines.isLoading ? (
            <LoadingState label="Cargando detalle…" />
          ) : lines.error ? (
            <ErrorState error={lines.error} onRetry={() => void lines.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState title="Sin líneas" description="El estado de cuenta no tiene tenants con tarifa." />
          ) : (
            <DataTable columns={['Tenant', 'Base', '%', 'Fijo', 'Tarifa']}>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="ebim-td">
                    <div className="font-semibold">{l.tenant_name ?? l.tenant_slug ?? '—'}</div>
                    <div className="text-[11px] text-muted">
                      {l.product_short_name}
                      {l.subscription_code ? ` · ${l.subscription_code}` : ''}
                      {l.line_kind && l.line_kind !== 'TENANT' ? ` · ${LINE_KIND_LABEL[l.line_kind] ?? l.line_kind}` : ''}
                    </div>
                  </td>
                  <td className="ebim-td whitespace-nowrap text-xs tabular-nums">
                    {formatMoney(Number(l.base_list_amount), l.currency)}
                  </td>
                  <td className="ebim-td text-xs tabular-nums">
                    {l.fee_rate !== null ? formatPercent(Number(l.fee_rate)) : '—'}
                  </td>
                  <td className="ebim-td whitespace-nowrap text-xs tabular-nums">
                    {l.fee_fixed_amount !== null ? formatMoney(Number(l.fee_fixed_amount), l.currency) : '—'}
                  </td>
                  <td className="ebim-td whitespace-nowrap text-xs font-semibold tabular-nums">
                    {formatMoney(Number(l.fee_amount), l.currency)}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
      ) : null}
    </DetailDrawer>
  );
}
