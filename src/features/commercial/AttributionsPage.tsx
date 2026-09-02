import { Link } from 'react-router-dom';
import { useAttributions } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatDate } from '@/lib/format';

/**
 * Atribuciones comerciales.
 *
 * La suma de participaciones vigentes sobre un mismo objeto no puede pasar del
 * 100% — lo valida un trigger en la base, no esta pantalla. Ahí es donde nace
 * la comisión duplicada.
 */
export function AttributionsPage() {
  const attributions = useAttributions();
  const { term, setTerm, filtered } = useSearchFilter(attributions.data, (a) => [
    (a.sales_agents as { full_name: string } | null)?.full_name,
    (a.saas_products as { short_name: string } | null)?.short_name,
    (a.tenants as { name: string } | null)?.name,
    (a.organizations as { display_name: string } | null)?.display_name,
    a.source,
  ]);

  return (
    <PageContainer
      title="Atribuciones comerciales"
      description="Quién se lleva el crédito de cada venta, con vigencia. Una venta puede repartirse entre varios participantes sin duplicar la comisión."
    >
      <Card>
        <SearchBar value={term} onChange={setTerm} placeholder="Buscar por comercial, producto, cliente o tenant…" />
        {attributions.isLoading ? (
          <LoadingState />
        ) : attributions.error ? (
          <ErrorState error={attributions.error} onRetry={() => void attributions.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sin atribuciones" description="No hay atribuciones visibles para tu rol." />
        ) : (
          <DataTable columns={['Comercial', 'Producto', 'Cliente', 'Tenant', 'Canal', '%', 'Plan de comisión', 'Origen', 'Vigencia']}>
            {filtered.map((a) => (
              <tr key={a.id}>
                <td className="ebim-td font-semibold">
                  {(a.sales_agents as { full_name: string } | null)?.full_name}
                </td>
                <td className="ebim-td">{(a.saas_products as { short_name: string } | null)?.short_name}</td>
                <td className="ebim-td">{(a.organizations as { display_name: string } | null)?.display_name}</td>
                <td className="ebim-td">
                  {a.tenant_id ? (
                    <Link className="ebim-link" to={`/tenants/${a.tenant_id}`}>
                      {(a.tenants as { name: string } | null)?.name}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="ebim-td text-muted">{a.channel_organization_id ? 'Partner' : 'Directo'}</td>
                <td className="ebim-td tabular-nums font-semibold">
                  {(Number(a.attribution_pct) * 100).toFixed(0)}%
                </td>
                <td className="ebim-td text-muted">
                  {(a.commission_plans as { name: string } | null)?.name ?? 'Sin plan'}
                </td>
                <td className="ebim-td"><Badge tone="info">{a.source}</Badge></td>
                <td className="ebim-td text-xs text-muted">
                  {formatDate(a.valid_from)} → {a.valid_to ? formatDate(a.valid_to) : 'sin fin'}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </PageContainer>
  );
}
