import { useState } from 'react';
import { useInvoices } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatMoney, formatDate } from '@/lib/format';
import { INVOICE_STATUS_LABEL } from '@/types/domain';

type InvoiceFilter = 'ALL' | 'OPEN' | 'PAID' | 'EXCLUDED';

/**
 * Facturación y cobros.
 *
 * DRAFT y VOID se muestran, pero marcados: existen en la operación y ocultarlos
 * haría que los totales no cuadren con lo que el usuario ve. Lo que NO hacen es
 * contar como ingreso — eso se decide en la vista `v_collected_revenue`.
 */
export function BillingPage() {
  const invoices = useInvoices();
  const [filter, setFilter] = useState<InvoiceFilter>('ALL');
  const { term, setTerm, filtered } = useSearchFilter(invoices.data, (i) => [
    i.number, (i.organizations as { display_name: string } | null)?.display_name, i.status,
  ]);

  const rows = filtered.filter((i) => {
    switch (filter) {
      case 'OPEN': return i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID';
      case 'PAID': return i.status === 'PAID';
      case 'EXCLUDED': return i.status === 'DRAFT' || i.status === 'VOID';
      default: return true;
    }
  });

  const all = invoices.data ?? [];
  const countable = all.filter((i) => !['DRAFT', 'VOID'].includes(i.status));
  const invoiced = countable.reduce((sum, i) => sum + Number(i.total), 0);
  const collected = all.reduce(
    (sum, i) =>
      sum +
      ((i.payments ?? []) as Array<Record<string, unknown>>)
        .filter((p) => p.status === 'CONFIRMED')
        .reduce((a, p) => a + Number(p.amount), 0),
    0,
  );

  return (
    <PageContainer
      title="Facturación y cobros"
      description="Control gerencial, no contabilidad. Las facturas en borrador o anuladas nunca cuentan como ingreso."
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Facturado (emitido)" value={formatMoney(invoiced)} hint="Excluye borrador y anuladas" />
        <StatCard label="Cobrado" value={formatMoney(collected)} tone="ok" hint="Sólo pagos confirmados" />
        <StatCard
          label="Pendiente de cobro"
          value={formatMoney(invoiced - collected)}
          tone={invoiced - collected > 0 ? 'warn' : 'ok'}
        />
      </div>

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por número de factura u organización…"
          right={
            <StatusTabs
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'ALL', label: 'Todas', count: filtered.length },
                { id: 'OPEN', label: 'Por cobrar' },
                { id: 'PAID', label: 'Pagadas' },
                { id: 'EXCLUDED', label: 'Borrador / anuladas' },
              ]}
            />
          }
        />
        {invoices.isLoading ? (
          <LoadingState />
        ) : invoices.error ? (
          <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="Sin facturas" description="No hay facturas visibles para tu rol con ese filtro." />
        ) : (
          <DataTable columns={['Número', 'Organización', 'Periodo', 'Emisión', 'Total', 'Cobrado', 'Estado']}>
            {rows.map((i) => {
              const paid = ((i.payments ?? []) as Array<Record<string, unknown>>)
                .filter((p) => p.status === 'CONFIRMED')
                .reduce((a, p) => a + Number(p.amount), 0);
              const excluded = i.status === 'DRAFT' || i.status === 'VOID';
              return (
                <tr key={i.id} className={excluded ? 'opacity-60' : undefined}>
                  <td className="ebim-td font-mono text-xs font-semibold">{i.number}</td>
                  <td className="ebim-td">{(i.organizations as { display_name: string } | null)?.display_name}</td>
                  <td className="ebim-td text-xs text-muted">
                    {formatDate(i.period_start)} → {formatDate(i.period_end)}
                  </td>
                  <td className="ebim-td text-xs text-muted">{formatDate(i.issue_date)}</td>
                  <td className="ebim-td tabular-nums font-semibold">{formatMoney(Number(i.total), i.currency)}</td>
                  <td className="ebim-td tabular-nums">{formatMoney(paid, i.currency)}</td>
                  <td className="ebim-td">
                    <Badge
                      tone={
                        i.status === 'PAID' ? 'ok'
                        : i.status === 'VOID' ? 'danger'
                        : i.status === 'DRAFT' ? 'neutral'
                        : 'warn'
                      }
                    >
                      {INVOICE_STATUS_LABEL[i.status as keyof typeof INVOICE_STATUS_LABEL]}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>
    </PageContainer>
  );
}
