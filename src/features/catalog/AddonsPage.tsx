import { useMemo, useState } from 'react';
import { useCatalogItemPrices, useCatalogItemsWithLifecycle, useProducts } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { AddonPriceList } from './AddonPriceList';
import type { CatalogItemPriceRow } from './AddonPriceList';
import { AddonLifecycleDialog, AddonPriceDialog } from './AddonDialogs';
import type { AddonRef } from './AddonDialogs';
import { billingModelLabel, lifecycleStatusLabel, lifecycleStatusTone } from './catalogLabels';

type LifecycleTab = 'ALL' | 'AVAILABLE' | 'COMING_SOON' | 'DRAFT' | 'RETIRED';

/**
 * Add-ons y tarifas (CCP fase 07).
 *
 * El catálogo central de add-ons con su ciclo de vida COMERCIAL (borrador,
 * disponible, próximamente, retirado), su modelo de cobro y sus tarifas por
 * mercado. Dos autoridades distintas, ambas decididas por la base:
 *
 *  · la tarifa la fija FINANZAS (`set_catalog_item_price`);
 *  · el ciclo de vida lo cambia PRODUCTO (`set_catalog_item_lifecycle`), con motivo.
 *
 * Los botones se ofrecen según `usePermissions` sólo para no prometer lo que la
 * RPC va a rechazar. Un add-on sin tarifa vigente dice «Sin precio definido».
 */
export function AddonsPage() {
  const items = useCatalogItemsWithLifecycle();
  const prices = useCatalogItemPrices();
  const products = useProducts();
  const perms = usePermissions();
  const [tab, setTab] = useState<LifecycleTab>('ALL');
  const [priceFor, setPriceFor] = useState<AddonRef | null>(null);
  const [lifecycleFor, setLifecycleFor] = useState<AddonRef | null>(null);

  const productName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products.data ?? []) map.set(p.id, p.short_name);
    return map;
  }, [products.data]);

  const pricesByItem = useMemo(() => {
    const map = new Map<string, CatalogItemPriceRow[]>();
    for (const pr of prices.data ?? []) {
      const code = pr.catalog_item_code ?? '';
      map.set(code, [...(map.get(code) ?? []), pr]);
    }
    return map;
  }, [prices.data]);

  const { term, setTerm, filtered } = useSearchFilter(items.data, (i) => [
    i.code, i.name, i.description, i.saas_product_id ? productName.get(i.saas_product_id) : 'Transversal',
  ]);
  const visible = filtered.filter((i) => tab === 'ALL' || i.lifecycle_status === tab);
  const hasAny = (items.data ?? []).length > 0;

  const count = (status: LifecycleTab) => filtered.filter((i) => i.lifecycle_status === status).length;
  const tabs: Array<{ id: LifecycleTab; label: string; count: number }> = [
    { id: 'ALL', label: 'Todos', count: filtered.length },
    { id: 'AVAILABLE', label: 'Disponibles', count: count('AVAILABLE') },
    { id: 'COMING_SOON', label: 'Próximamente', count: count('COMING_SOON') },
    { id: 'DRAFT', label: 'Borradores', count: count('DRAFT') },
    { id: 'RETIRED', label: 'Retirados', count: count('RETIRED') },
  ];

  const canAct = perms.canReadFinance || perms.canManagePlatform;

  return (
    <PageContainer
      title="Add-ons y tarifas"
      description="Qué se puede contratar además del plan, cómo se cobra y a qué precio en cada mercado. Las tarifas no se editan: se cierra la vigente y se abre una nueva."
    >
      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar add-on por nombre, código o producto…"
          right={<StatusTabs value={tab} onChange={setTab} options={tabs} />}
        />
        {items.isLoading ? (
          <LoadingState label="Cargando add-ons…" />
        ) : items.error ? (
          <ErrorState error={items.error} onRetry={() => void items.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={hasAny ? 'Ningún add-on coincide' : 'Sin add-ons'}
            description={
              hasAny
                ? 'Prueba con otra búsqueda o cambia de pestaña.'
                : 'Todavía no hay add-ons visibles para tu perfil.'
            }
          />
        ) : (
          <>
            {prices.error ? (
              <p className="border-b border-border px-4 py-2 text-xs font-semibold text-warn" role="status">
                No se pudieron leer las tarifas: la columna de tarifas puede estar incompleta.
              </p>
            ) : null}
            <DataTable columns={['Add-on', 'Producto', 'Modelo de cobro', 'Ciclo de vida', 'Tarifas por mercado', '']}>
              {visible.map((i) => {
                const ref: AddonRef = { code: i.code, name: i.name, lifecycle_status: i.lifecycle_status };
                return (
                  <tr key={i.id}>
                    <td className="ebim-td">
                      <div className="font-semibold">{i.name}</div>
                      <div className="font-mono text-[11px] text-muted">{i.code}</div>
                    </td>
                    <td className="ebim-td">
                      {i.saas_product_id ? (productName.get(i.saas_product_id) ?? '—') : (
                        <span className="text-muted">Transversal</span>
                      )}
                    </td>
                    <td className="ebim-td">
                      <Badge tone="accent">{billingModelLabel(i.billing_model)}</Badge>
                    </td>
                    <td className="ebim-td">
                      <Badge tone={lifecycleStatusTone(i.lifecycle_status)}>
                        {lifecycleStatusLabel(i.lifecycle_status)}
                      </Badge>
                    </td>
                    <td className="ebim-td">
                      {prices.isLoading ? (
                        <span className="text-xs text-muted">…</span>
                      ) : (
                        <AddonPriceList prices={pricesByItem.get(i.code)} />
                      )}
                    </td>
                    <td className="ebim-td">
                      {canAct ? (
                        <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                          {perms.canReadFinance ? (
                            <button type="button" className="ebim-link text-[13px]" onClick={() => setPriceFor(ref)}>
                              Nueva tarifa
                            </button>
                          ) : null}
                          {perms.canManagePlatform ? (
                            <button type="button" className="ebim-link text-[13px]" onClick={() => setLifecycleFor(ref)}>
                              Cambiar ciclo de vida
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          </>
        )}
      </Card>

      <AddonPriceDialog open={Boolean(priceFor)} addon={priceFor} onClose={() => setPriceFor(null)} />
      <AddonLifecycleDialog open={Boolean(lifecycleFor)} addon={lifecycleFor} onClose={() => setLifecycleFor(null)} />
    </PageContainer>
  );
}
