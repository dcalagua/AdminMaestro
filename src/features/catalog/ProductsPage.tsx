import { Link } from 'react-router-dom';
import { useProducts, useTenantOverview } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatNumber } from '@/lib/format';

/**
 * Catálogo de SaaS.
 *
 * Añadir un producto nuevo a la suite es INSERTAR una fila aquí — no hay ninguna
 * columna `is_esupplier` ni rama de código por producto (prompt fase 3).
 */
export function ProductsPage() {
  const products = useProducts();
  const tenants = useTenantOverview();
  const { term, setTerm, filtered } = useSearchFilter(products.data, (p) => [
    p.code, p.name, p.short_name, p.description,
  ]);

  const tenantsByProduct = new Map<string, number>();
  for (const t of tenants.data ?? []) {
    const key = t.saas_product_id as string;
    tenantsByProduct.set(key, (tenantsByProduct.get(key) ?? 0) + 1);
  }

  return (
    <PageContainer
      title="SaaS Products"
      description="Catálogo de productos de la suite. El core no está atado a ninguno: un SaaS nuevo es una fila más."
    >
      <Card>
        <SearchBar value={term} onChange={setTerm} placeholder="Buscar producto por nombre o código…" />
        {products.isLoading ? (
          <LoadingState />
        ) : products.error ? (
          <ErrorState error={products.error} onRetry={() => void products.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sin productos" description="No hay productos que coincidan con la búsqueda." />
        ) : (
          <DataTable columns={['Producto', 'Código', 'Unidad de cobro', 'Tenants', 'Estado', '']}>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td className="ebim-td">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-6 w-1.5 rounded-full"
                      style={{ background: p.accent_color ?? 'var(--accent)' }}
                      aria-hidden
                    />
                    <div>
                      <div className="font-semibold">{p.lockup_name}</div>
                      <div className="text-xs text-muted">{p.description}</div>
                    </div>
                  </div>
                </td>
                <td className="ebim-td font-mono text-xs text-muted">{p.code}</td>
                <td className="ebim-td"><Badge tone="info">{p.billing_unit}</Badge></td>
                <td className="ebim-td tabular-nums">{formatNumber(tenantsByProduct.get(p.id) ?? 0)}</td>
                <td className="ebim-td">
                  <Badge tone={p.status === 'ACTIVE' ? 'ok' : 'neutral'}>{p.status}</Badge>
                </td>
                <td className="ebim-td text-right">
                  <Link className="ebim-link text-[13px]" to={`/products/${p.id}`}>Ver detalle</Link>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </PageContainer>
  );
}
