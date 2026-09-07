import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProducts, useTenantOverview } from '@/services/queries';
import { useArchiveProduct } from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatNumber } from '@/lib/format';
import { ProductFormDialog } from './ProductFormDialog';
import type { SaasProduct } from '@/types/domain';

/**
 * Catálogo de SaaS.
 *
 * Añadir un producto nuevo a la suite es INSERTAR una fila aquí — no hay ninguna
 * columna `is_esupplier` ni rama de código por producto (prompt fase 3).
 */
export function ProductsPage() {
  const products = useProducts();
  const tenants = useTenantOverview();
  const perms = usePermissions();
  const toast = useToast();
  const archive = useArchiveProduct();

  const [dialog, setDialog] = useState<{ open: boolean; product: SaasProduct | null }>({
    open: false,
    product: null,
  });
  const [archiving, setArchiving] = useState<SaasProduct | null>(null);

  const { term, setTerm, filtered } = useSearchFilter(products.data, (p) => [
    p.code, p.name, p.short_name, p.description,
  ]);

  const tenantsByProduct = new Map<string, number>();
  for (const t of tenants.data ?? []) {
    const key = t.saas_product_id as string;
    tenantsByProduct.set(key, (tenantsByProduct.get(key) ?? 0) + 1);
  }

  async function confirmArchive() {
    if (!archiving) return;
    try {
      await archive.mutateAsync({
        p_product_id: archiving.id,
        p_reason: 'Archivado desde la consola',
      });
      toast.success('Producto archivado', archiving.short_name);
    } catch (error) {
      // La RPC bloquea si quedan suscripciones o tenants vivos, y explica cuántos.
      toast.error('No se pudo archivar', businessErrorMessage(error));
    } finally {
      setArchiving(null);
    }
  }

  return (
    <PageContainer
      title="SaaS Products"
      description="Catálogo de productos de la suite. El core no está atado a ninguno: un SaaS nuevo es una fila más."
      actions={
        perms.canManagePlatform ? (
          <button
            type="button"
            className="ebim-btn-primary"
            onClick={() => setDialog({ open: true, product: null })}
          >
            Nuevo producto
          </button>
        ) : null
      }
    >
      <Card>
        <SearchBar value={term} onChange={setTerm} placeholder="Buscar producto por nombre o código…" />
        {products.isLoading ? (
          <LoadingState />
        ) : products.error ? (
          <ErrorState error={products.error} onRetry={() => void products.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Sin productos"
            description="No hay productos que coincidan con la búsqueda."
            action={
              perms.canManagePlatform ? (
                <button
                  type="button"
                  className="ebim-btn-primary"
                  onClick={() => setDialog({ open: true, product: null })}
                >
                  Crear el primer producto
                </button>
              ) : null
            }
          />
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
                <td className="ebim-td">
                  <div className="flex items-center justify-end gap-3">
                    {perms.canManagePlatform ? (
                      <>
                        <button
                          type="button"
                          className="ebim-link text-[13px]"
                          onClick={() => setDialog({ open: true, product: p })}
                        >
                          Editar
                        </button>
                        {p.status !== 'ARCHIVED' ? (
                          <button
                            type="button"
                            className="text-[13px] text-danger hover:underline"
                            onClick={() => setArchiving(p)}
                          >
                            Archivar
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    <Link className="ebim-link text-[13px]" to={`/products/${p.id}`}>Ver detalle</Link>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <ProductFormDialog
        open={dialog.open}
        product={dialog.product}
        onClose={() => setDialog({ open: false, product: null })}
      />

      <ConfirmDialog
        open={Boolean(archiving)}
        title={`¿Archivar ${archiving?.short_name}?`}
        message="El producto dejará de ofrecerse. La base rechazará la operación si aún tiene tenants o suscripciones vivas."
        confirmLabel="Archivar"
        onConfirm={() => void confirmArchive()}
        onCancel={() => setArchiving(null)}
      />
    </PageContainer>
  );
}
