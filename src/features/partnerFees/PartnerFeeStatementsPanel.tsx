import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePartnerFeeStatements } from '@/services/queries';
import { usePermissions } from '@/hooks/usePermissions';
import { Badge, Card, DataTable, EmptyState, ErrorState, LoadingState, StatCard } from '@/components/ui/primitives';
import { formatDate, formatMoney } from '@/lib/format';
import { formatPeriod, labelOf } from '@/features/usage/usageLabels';
import { STATEMENT_STATUS } from './feeLabels';
import { StatementDetailDrawer, type Statement } from './StatementDetailDrawer';

/**
 * Ficha del partner → «Tarifa de plataforma» (M3, spec §4.4): sus estados de
 * cuenta mensuales y el saldo pendiente por moneda. Lo ven finanzas y el
 * PARTNER_ADMIN de esa organización (RLS); las acciones viven en Finanzas →
 * Tarifas de partners.
 */
export function PartnerFeeStatementsPanel({ organizationId }: { organizationId: string }) {
  const perms = usePermissions();
  const statements = usePartnerFeeStatements({ partnerId: organizationId });
  const [detail, setDetail] = useState<Statement | null>(null);
  const rows = statements.data ?? [];

  const pending = useMemo(() => {
    const byCurrency = new Map<string, number>();
    for (const s of rows) {
      if (s.status !== 'ISSUED' || !s.currency) continue;
      byCurrency.set(s.currency, (byCurrency.get(s.currency) ?? 0) + Number(s.invoice_balance ?? 0));
    }
    return Array.from(byCurrency).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {pending.length === 0 ? (
          <StatCard label="Saldo pendiente" value="Sin saldo" hint="Facturas de tarifa emitidas y no pagadas." />
        ) : (
          pending.map(([currency, amount]) => (
            <StatCard
              key={currency}
              label={`Saldo pendiente · ${currency}`}
              value={formatMoney(amount, currency)}
              tone={amount > 0 ? 'warn' : 'ok'}
            />
          ))
        )}
      </div>
      <Card
        title="Estados de cuenta de la tarifa de plataforma"
        description="Lo que este partner paga a EBIM cada mes por los tenants que gestiona y factura él mismo. No son comisiones."
        actions={
          perms.canReadFinance ? (
            <Link className="ebim-btn-ghost h-8 px-3 text-xs" to="/partner-fees">
              Ir a Tarifas de partners
            </Link>
          ) : null
        }
      >
        {statements.isLoading ? (
          <LoadingState label="Cargando estados de cuenta…" />
        ) : statements.error ? (
          <ErrorState error={statements.error} onRetry={() => void statements.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Sin estados de cuenta"
            description="Aparecen cuando un acuerdo de este partner tiene tarifa de plataforma y finanzas calcula el mes."
          />
        ) : (
          <DataTable columns={['Período', 'Tenants', 'Tarifa', 'Estado', 'Factura', 'Saldo', '']}>
            {rows.map((s) => {
              const st = labelOf(STATEMENT_STATUS, s.status);
              return (
                <tr key={s.id}>
                  <td className="ebim-td whitespace-nowrap text-xs">
                    {formatPeriod(s.period_start)}
                    <div className="text-[11px] text-muted">{s.currency}</div>
                  </td>
                  <td className="ebim-td text-xs tabular-nums">{s.tenant_count}</td>
                  <td className="ebim-td whitespace-nowrap text-xs font-semibold tabular-nums">
                    {formatMoney(Number(s.fee_total), s.currency)}
                  </td>
                  <td className="ebim-td"><Badge tone={st.tone}>{st.label}</Badge></td>
                  <td className="ebim-td text-xs">
                    {s.invoice_number ? (
                      <>
                        <div className="font-mono">{s.invoice_number}</div>
                        {s.invoice_due_date ? <div className="text-[11px] text-muted">Vence {formatDate(s.invoice_due_date)}</div> : null}
                      </>
                    ) : (
                      <span className="text-muted">Sin emitir</span>
                    )}
                  </td>
                  <td className="ebim-td whitespace-nowrap text-xs tabular-nums">
                    {s.invoice_balance !== null ? formatMoney(Number(s.invoice_balance), s.currency) : '—'}
                  </td>
                  <td className="ebim-td text-right">
                    <button type="button" className="ebim-link text-[13px]" onClick={() => setDetail(s)}>
                      Detalle
                    </button>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>
      <StatementDetailDrawer statement={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
