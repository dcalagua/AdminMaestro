import { useState } from 'react';
import { useAiCreditBalances } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState } from '@/components/ui/primitives';
import { formatPeriod, formatQuantity, poolLabel } from '@/features/usage/usageLabels';
import { useLookups } from '@/features/usage/useLookups';

/**
 * Saldos de créditos IA por tenant × pool × período (`v_ai_credit_balances`,
 * derivado del ledger). Una reversión cuenta en la categoría de la entrada
 * revertida. Sin política (D-03) no hay incluidos: el saldo no se inventa.
 */
type Tab = 'ALL' | 'NEGATIVE' | 'POSITIVE';

export function BalancesTab({ tenantId }: { tenantId?: string } = {}) {
  const balances = useAiCreditBalances(tenantId);
  const lookups = useLookups();
  const [tab, setTab] = useState<Tab>('ALL');

  const { term, setTerm, filtered } = useSearchFilter(balances.data, (b) => [
    lookups.tenantName(b.tenant_id), poolLabel(b.pool_key), b.pool_key, b.period_start, lookups.productName(b.saas_product_id),
  ]);
  const match = (t: Tab, balance: number | null) =>
    t === 'ALL' || (t === 'NEGATIVE' ? Number(balance ?? 0) < 0 : Number(balance ?? 0) > 0);
  const count = (t: Tab) => filtered.filter((b) => match(t, b.balance)).length;
  const visible = filtered.filter((b) => match(tab, b.balance));
  const hasAny = (balances.data ?? []).length > 0;

  return (
    <Card
      title="Saldos"
      description="Saldo derivado del ledger por tenant, pool y período. Las columnas suman créditos EBIM, no tokens ni dinero."
    >
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder="Buscar por tenant, pool o producto…"
        right={
          <StatusTabs
            value={tab}
            onChange={setTab}
            options={[
              { id: 'ALL', label: 'Todos', count: count('ALL') },
              { id: 'NEGATIVE', label: 'Saldo negativo', count: count('NEGATIVE') },
              { id: 'POSITIVE', label: 'Con saldo', count: count('POSITIVE') },
            ]}
          />
        }
      />
      {balances.isLoading ? (
        <LoadingState label="Cargando saldos…" />
      ) : balances.error ? (
        <ErrorState error={balances.error} onRetry={() => void balances.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={hasAny ? 'Ningún saldo coincide' : 'Sin saldos de créditos'}
          description={
            hasAny
              ? 'Prueba con otra búsqueda o cambia de filtro.'
              : 'No hay movimientos: las políticas, pesos y créditos incluidos siguen sin decidir (D-03).'
          }
        />
      ) : (
        <DataTable
          maxHeight={560}
          label="Saldos de créditos"
          columns={[
            'Tenant',
            'Pool',
            'Período',
            ...['Incluidos', 'Comprados', 'Bono', 'Reservados', 'Usados', 'Expirados', 'Ajuste', 'Saldo'].map((label) => ({
              label,
              align: 'right' as const,
            })),
          ]}
        >
          {visible.map((b) => {
            const negative = Number(b.balance ?? 0) < 0;
            return (
              <tr key={`${b.tenant_id}:${b.pool_key}:${b.period_start}`}>
                <td className="ebim-td">
                  <span className="block max-w-[240px] truncate font-semibold" title={lookups.tenantName(b.tenant_id)}>
                    {lookups.tenantName(b.tenant_id)}
                  </span>
                </td>
                <td className="ebim-td whitespace-nowrap text-compact text-fg-2">{poolLabel(b.pool_key)}</td>
                <td className="ebim-td whitespace-nowrap text-compact">{formatPeriod(b.period_start)}</td>
                {[b.included, b.purchased, b.bonus, b.reserved, b.used, b.expired, b.adjusted].map((v, i) => (
                  <td key={i} className={`ebim-td ebim-num text-compact ${Number(v ?? 0) === 0 ? 'text-muted' : ''}`}>
                    {formatQuantity(v)}
                  </td>
                ))}
                <td className={`ebim-td ebim-num font-semibold ${negative ? 'text-danger' : 'text-fg'}`}>
                  {formatQuantity(b.balance)}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </Card>
  );
}
