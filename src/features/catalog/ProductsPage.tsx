import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProducts, useTenantOverview, useProductIntegrations } from '@/services/queries';
import { useArchiveProduct } from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, StatCard,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { ProductFormDialog } from './ProductFormDialog';
import {
  countText, entityStatusLabel, entityStatusTabs, entityStatusTone, isForbiddenError,
  matchesEntityStatusTab, summarizeIntegration,
} from './catalogLabels';
import type { EntityStatusTab } from './catalogLabels';
import type { SaasProduct } from '@/types/domain';

/**
 * Suite SaaS (P11).
 *
 * Añadir un producto nuevo a la suite es INSERTAR una fila aquí — no hay ninguna
 * columna `is_esupplier` ni rama de código por producto (prompt fase 3).
 *
 * Dos dimensiones que no se mezclan:
 *   - Estado comercial: `saas_products.status` (se ofrece o no en el catálogo).
 *   - Integración técnica: `product_integrations` (existe / habilitada).
 * Ningún conteo es fijo: todo sale de las filas que RLS devuelve. «Activo» no
 * se traduce en «certificado».
 */
export function ProductsPage() {
  const products = useProducts();
  const tenants = useTenantOverview();
  const integrations = useProductIntegrations();
  const perms = usePermissions();
  const toast = useToast();
  const archive = useArchiveProduct();

  const [tab, setTab] = useState<EntityStatusTab>('ALL');
  const [dialog, setDialog] = useState<{ open: boolean; product: SaasProduct | null }>({
    open: false,
    product: null,
  });
  const [archiving, setArchiving] = useState<SaasProduct | null>(null);

  const { term, setTerm, filtered } = useSearchFilter(products.data, (p) => [
    p.code, p.name, p.short_name, p.description,
  ]);
  const visible = filtered.filter((p) => matchesEntityStatusTab(p.status, tab));

  const all = products.data ?? [];
  const activeCount = all.filter((p) => p.status === 'ACTIVE').length;

  const tenantsByProduct = new Map<string, number>();
  for (const t of tenants.data ?? []) {
    const key = t.saas_product_id as string;
    tenantsByProduct.set(key, (tenantsByProduct.get(key) ?? 0) + 1);
  }

  const integrationsByProduct = new Map<string, Array<Record<string, unknown>>>();
  for (const i of (integrations.data ?? []) as Array<Record<string, unknown>>) {
    const key = i.saas_product_id as string;
    integrationsByProduct.set(key, [...(integrationsByProduct.get(key) ?? []), i]);
  }
  const readyCount = all.filter(
    (p) => summarizeIntegration(integrationsByProduct.get(p.id)).tone === 'ok',
  ).length;

  function tenantCell(productId: string) {
    return countText(tenants, tenantsByProduct.get(productId) ?? 0);
  }

  function integrationCell(productId: string) {
    if (integrations.error) {
      return (
        <span className="text-xs text-muted">
          {isForbiddenError(integrations.error) ? 'Sin acceso' : 'No se pudo leer'}
        </span>
      );
    }
    if (integrations.isLoading) return <span className="text-xs text-muted">…</span>;
    const summary = summarizeIntegration(integrationsByProduct.get(productId));
    return (
      <div>
        <Badge tone={summary.tone}>{summary.label}</Badge>
        {summary.detail ? <div className="mt-0.5 font-mono text-[11px] text-muted">{summary.detail}</div> : null}
      </div>
    );
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

  const productsCount = countText(products, all.length);

  return (
    <PageContainer
      title="Suite SaaS"
      description="Productos de la suite con su estado comercial en el catálogo y, por separado, el estado de su integración técnica. Un SaaS nuevo es una fila más."
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
      <div className="mb-4 grid gap-3 sm:grid-cols-3" aria-label="Resumen del catálogo">
        <StatCard label="Productos en catálogo" value={productsCount} hint="Visibles para tu perfil" />
        <StatCard
          label="Activos en catálogo"
          value={countText(products, activeCount)}
          hint={products.data ? `de ${productsCount} · estado comercial` : 'Estado comercial'}
        />
        <StatCard
          label="Integración lista y habilitada"
          value={products.error ? 'No se pudo leer' : countText(integrations, readyCount)}
          hint="Configuración registrada; no es certificación"
        />
      </div>

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar producto por nombre o código…"
          right={<StatusTabs value={tab} onChange={setTab} options={entityStatusTabs(filtered)} />}
        />
        {products.isLoading ? (
          <LoadingState label="Cargando productos…" />
        ) : products.error ? (
          <ErrorState error={products.error} onRetry={() => void products.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={all.length > 0 ? 'Ningún producto coincide' : 'Sin productos'}
            description={
              all.length > 0
                ? 'Prueba con otra búsqueda o cambia de pestaña.'
                : 'Todavía no hay productos visibles para tu perfil.'
            }
            action={
              all.length === 0 && perms.canManagePlatform ? (
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
          <DataTable
            columns={['Producto', 'Estado comercial', 'Integración técnica', 'Tenants', 'Unidad de cobro', '']}
          >
            {visible.map((p) => (
              <tr key={p.id}>
                <td className="ebim-td">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-6 w-1.5 shrink-0 rounded-full"
                      style={{ background: p.accent_color ?? 'var(--accent)' }}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <Link className="font-semibold text-fg hover:underline" to={`/products/${p.id}`}>
                        {p.lockup_name ?? p.name}
                      </Link>
                      {p.description ? <div className="text-xs text-muted">{p.description}</div> : null}
                      <div className="font-mono text-[11px] text-muted">{p.code}</div>
                    </div>
                  </div>
                </td>
                <td className="ebim-td">
                  <Badge tone={entityStatusTone(p.status)}>{entityStatusLabel(p.status)}</Badge>
                </td>
                <td className="ebim-td">{integrationCell(p.id)}</td>
                <td className="ebim-td tabular-nums">{tenantCell(p.id)}</td>
                <td className="ebim-td text-muted">{p.billing_unit}</td>
                <td className="ebim-td">
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap">
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
        busy={archive.isPending}
        onConfirm={confirmArchive}
        onCancel={() => setArchiving(null)}
      />
    </PageContainer>
  );
}
