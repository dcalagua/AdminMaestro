import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProducts, useTenantOverview, useProductIntegrations } from '@/services/queries';
import { useArchiveProduct } from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, SearchBar, LoadingState, ErrorState, EmptyState, Badge, KpiTile,
} from '@/components/ui/primitives';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { KpiStrip } from '@/features/billing/financeUi';
import { formatMoney, sumByCurrency } from '@/lib/format';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { ProductFormDialog } from './ProductFormDialog';
import {
  billingUnitLabel, countText, entityStatusLabel, entityStatusTabs, entityStatusTone, isForbiddenError,
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
  // MRR vigente por producto y moneda (foto de v_tenant_overview, R-7: nunca se mezclan monedas).
  const mrrByProduct = (productId: string) =>
    sumByCurrency(
      (tenants.data ?? []).filter((t) => t.saas_product_id === productId),
      (t) => t.mrr,
      (t) => t.currency,
    );

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
        <span className="text-compact text-muted">
          {isForbiddenError(integrations.error) ? 'Sin acceso' : 'No se pudo leer'}
        </span>
      );
    }
    if (integrations.isLoading) return <span className="text-compact text-muted">…</span>;
    const summary = summarizeIntegration(integrationsByProduct.get(productId));
    return (
      <div className="min-w-0">
        <Badge tone={summary.tone} dot>
          {summary.label}
        </Badge>
        {summary.detail ? (
          <div className="mt-1 truncate font-mono text-caption text-muted" title={summary.detail}>
            {summary.detail}
          </div>
        ) : null}
      </div>
    );
  }

  function mrrCell(productId: string) {
    if (tenants.error) return <span className="text-compact text-muted">No se pudo leer</span>;
    if (tenants.isLoading) return <span className="text-compact text-muted">…</span>;
    const entries = Object.entries(mrrByProduct(productId)).filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return <span className="text-compact text-muted">Sin recurrente</span>;
    return (
      <span className="flex flex-col">
        {entries.map(([currency, amount]) => (
          <span key={currency} className="tabular-nums">
            {formatMoney(amount, currency)}
          </span>
        ))}
      </span>
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
      <KpiStrip label="Resumen del catálogo">
        <KpiTile label="Productos en catálogo" value={productsCount} footer="Visibles para tu perfil" />
        <KpiTile
          label="Activos en catálogo"
          value={countText(products, activeCount)}
          footer={products.data ? `de ${productsCount} · estado comercial` : 'Estado comercial'}
        />
        <KpiTile
          label="Integración lista y habilitada"
          value={products.error ? 'No se pudo leer' : countText(integrations, readyCount)}
          footer="Configuración registrada; no es certificación"
        />
        <KpiTile
          label="Tenants en la suite"
          value={countText(tenants, (tenants.data ?? []).length)}
          footer="Todos los productos, visibles para tu perfil"
        />
      </KpiStrip>

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
          <ul className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3" aria-label="Productos de la suite">
            {visible.map((p) => (
              <li key={p.id}>
                <article
                  aria-labelledby={`product-${p.id}`}
                  className="flex h-full flex-col overflow-hidden rounded-card border border-border bg-card transition-colors hover:border-border-strong"
                >
                  {/* Color de marca del producto (dato del catálogo): una franja, nunca fondo de texto. */}
                  <span aria-hidden className="h-1 w-full bg-accent" style={p.accent_color ? { background: p.accent_color } : undefined} />
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 id={`product-${p.id}`} className="text-h3 text-fg">
                          <Link className="hover:underline" to={`/products/${p.id}`}>
                            {p.lockup_name ?? p.name}
                          </Link>
                        </h2>
                        <p className="font-mono text-caption text-muted">{p.code}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge tone={entityStatusTone(p.status)} dot>
                          {entityStatusLabel(p.status)}
                        </Badge>
                        {perms.canManagePlatform ? (
                          <ActionMenu
                            variant="icon"
                            label={`Acciones de ${p.short_name}`}
                            items={[
                              { label: 'Abrir ficha', to: `/products/${p.id}` },
                              { label: 'Editar producto', onSelect: () => setDialog({ open: true, product: p }) },
                              p.status !== 'ARCHIVED'
                                ? { label: 'Archivar…', tone: 'danger' as const, onSelect: () => setArchiving(p) }
                                : null,
                            ]}
                          />
                        ) : null}
                      </div>
                    </div>
                    {p.description ? <p className="mt-2 line-clamp-2 text-compact text-fg-2">{p.description}</p> : null}
                    <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4">
                      <div className="min-w-0">
                        <dt className="text-micro text-muted">MRR vigente</dt>
                        <dd className="mt-1 text-compact font-semibold text-fg">{mrrCell(p.id)}</dd>
                      </div>
                      <div>
                        <dt className="text-micro text-muted">Tenants</dt>
                        <dd className="mt-1 text-h3 tabular-nums text-fg">{tenantCell(p.id)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-micro text-muted">Cobro</dt>
                        <dd className="mt-1 text-compact text-fg-2">{billingUnitLabel(p.billing_unit)}</dd>
                      </div>
                    </dl>
                    <div className="mt-auto pt-4">
                      <p className="text-micro text-muted">Integración técnica</p>
                      <div className="mt-1">{integrationCell(p.id)}</div>
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
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
