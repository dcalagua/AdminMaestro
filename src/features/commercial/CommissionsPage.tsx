import { useState } from 'react';
import { useCommissionEvents, useSettlements } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { SectionTabs, StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatMoney, formatCurrencyMap, sumByCurrency, formatPercent, formatDate } from '@/lib/format';
import { COMMISSION_STATUS_LABEL } from '@/types/domain';

type EventFilter = 'ALL' | 'PENDING' | 'PAID';

/**
 * Comisiones y liquidaciones.
 *
 * Cada evento muestra CÓMO se calculó (base × tasa × participación), no sólo el
 * monto: una comisión que no se puede explicar es una comisión que se discute.
 */
export function CommissionsPage() {
  const events = useCommissionEvents();
  const settlements = useSettlements();
  const [filter, setFilter] = useState<EventFilter>('ALL');
  const { term, setTerm, filtered } = useSearchFilter(events.data, (e) => [
    (e.sales_agents as { full_name: string } | null)?.full_name,
    (e.saas_products as { short_name: string } | null)?.short_name,
    (e.tenants as { name: string } | null)?.name,
    e.status,
  ]);

  const rows = filtered.filter((e) => {
    if (filter === 'PAID') return e.status === 'PAID';
    if (filter === 'PENDING') return e.status === 'ELIGIBLE' || e.status === 'ACCRUED';
    return true;
  });

  // V3 · por moneda: una comisión PEN y otra USD no son un solo pendiente (R-7).
  const totals = {
    pending: sumByCurrency(
      (events.data ?? []).filter((e) => e.status !== 'PAID' && e.status !== 'VOID'),
      (e) => e.amount, (e) => e.currency,
    ),
    paid: sumByCurrency((events.data ?? []).filter((e) => e.status === 'PAID'), (e) => e.amount, (e) => e.currency),
  };

  return (
    <PageContainer
      title="Comisiones y liquidaciones"
      description="Cada comisión nace de un cobro confirmado. Una factura emitida pero impaga no devenga nada."
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Comisión pendiente" value={formatCurrencyMap(totals.pending)} tone="warn" hint="Elegible + devengada · por moneda" />
        <StatCard label="Comisión pagada" value={formatCurrencyMap(totals.paid)} tone="ok" hint="Cada liquidación es de una sola moneda" />
        <StatCard label="Liquidaciones" value={String(settlements.data?.length ?? 0)} />
      </div>

      <SectionTabs
        tabs={[
          {
            id: 'events',
            label: 'Eventos de comisión',
            content: (
              <Card>
                <SearchBar
                  value={term}
                  onChange={setTerm}
                  placeholder="Buscar por comercial, producto o tenant…"
                  right={
                    <StatusTabs
                      value={filter}
                      onChange={setFilter}
                      options={[
                        { id: 'ALL', label: 'Todos', count: filtered.length },
                        { id: 'PENDING', label: 'Pendientes' },
                        { id: 'PAID', label: 'Pagadas' },
                      ]}
                    />
                  }
                />
                {events.isLoading ? (
                  <LoadingState />
                ) : events.error ? (
                  <ErrorState error={events.error} onRetry={() => void events.refetch()} />
                ) : rows.length === 0 ? (
                  <EmptyState title="Sin eventos de comisión" description="No hay comisiones devengadas visibles para tu rol." />
                ) : (
                  <DataTable
                    columns={['Fecha', 'Comercial', 'Producto', 'Tenant', 'Regla', 'Cálculo', 'Monto', 'Estado', 'Liquidación']}
                  >
                    {rows.map((e) => (
                      <tr key={e.id}>
                        <td className="ebim-td text-xs text-muted">{formatDate(e.earned_on)}</td>
                        <td className="ebim-td font-semibold">
                          {(e.sales_agents as { full_name: string } | null)?.full_name}
                        </td>
                        <td className="ebim-td">{(e.saas_products as { short_name: string } | null)?.short_name}</td>
                        <td className="ebim-td text-muted">{(e.tenants as { name: string } | null)?.name ?? '—'}</td>
                        <td className="ebim-td text-xs">{(e.commission_rules as { name: string } | null)?.name}</td>
                        {/* Trazabilidad del cálculo: base × tasa × participación */}
                        <td className="ebim-td whitespace-nowrap text-xs text-muted">
                          {formatMoney(Number(e.base_amount), e.currency)}
                          {e.applied_rate !== null ? ` × ${formatPercent(Number(e.applied_rate))}` : ''}
                          {Number(e.attribution_pct) < 1 ? ` × ${formatPercent(Number(e.attribution_pct), 0)}` : ''}
                        </td>
                        <td className="ebim-td tabular-nums font-semibold">
                          {formatMoney(Number(e.amount), e.currency)}
                        </td>
                        <td className="ebim-td">
                          <Badge tone={e.status === 'PAID' ? 'ok' : e.status === 'VOID' ? 'danger' : 'warn'}>
                            {COMMISSION_STATUS_LABEL[e.status as keyof typeof COMMISSION_STATUS_LABEL]}
                          </Badge>
                        </td>
                        <td className="ebim-td font-mono text-xs text-muted">
                          {(e.commission_settlements as { code: string } | null)?.code ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'settlements',
            label: 'Liquidaciones',
            content: (
              <Card description="Una liquidación agrupa eventos de un periodo. Marcarla PAID exige fecha y referencia de pago.">
                {settlements.isLoading ? (
                  <LoadingState />
                ) : (settlements.data ?? []).length === 0 ? (
                  <EmptyState title="Sin liquidaciones" />
                ) : (
                  <DataTable columns={['Código', 'Comercial', 'Periodo', 'Total', 'Estado', 'Referencia de pago']}>
                    {(settlements.data ?? []).map((s) => (
                      <tr key={s.id}>
                        <td className="ebim-td font-mono text-xs font-semibold">{s.code}</td>
                        <td className="ebim-td">{(s.sales_agents as { full_name: string } | null)?.full_name}</td>
                        <td className="ebim-td text-xs text-muted">
                          {formatDate(s.period_start)} → {formatDate(s.period_end)}
                        </td>
                        <td className="ebim-td tabular-nums font-semibold">
                          {formatMoney(Number(s.total_amount), s.currency)}
                        </td>
                        <td className="ebim-td">
                          <Badge tone={s.status === 'PAID' ? 'ok' : s.status === 'CANCELLED' ? 'danger' : 'warn'}>
                            {s.status}
                          </Badge>
                        </td>
                        <td className="ebim-td font-mono text-xs text-muted">{s.payment_reference ?? '—'}</td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
        ]}
      />
    </PageContainer>
  );
}
