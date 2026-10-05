import { useState } from 'react';
import { usePlans } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import { RegionalPriceList } from './RegionalPriceList';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { PlanFormDialog, PlanPriceDialog } from './PlanDialogs';
import type { PlanDraft } from './PlanDialogs';
import {
  entityStatusLabel, entityStatusTabs, entityStatusTone, matchesEntityStatusTab,
} from './catalogLabels';
import type { EntityStatusTab, PriceRow } from './catalogLabels';

/**
 * Planes y licencias (P09).
 *
 * Los tres modelos comerciales conviven aquí sin ramas de código:
 *   SHARED            -> licencia por tenant productivo
 *   PARTNER_DEDICATED -> licencia base del partner (is_partner_base) + N licencias
 *   TENANT_DEDICATED  -> licencia Enterprise + infra + soporte
 * Lo que los distingue es `deployment_mode` y los `charge_kind` de sus precios.
 *
 * Un plan sin tarifa abierta NO es gratis: se rotula «Sin precio definido».
 * Lo recurrente y los cargos únicos van en columnas separadas.
 */
export function PlansPage() {
  const plans = usePlans();
  const perms = usePermissions();
  const [tab, setTab] = useState<EntityStatusTab>('ALL');
  const [planDialog, setPlanDialog] = useState<{ open: boolean; plan: PlanDraft | null }>({
    open: false,
    plan: null,
  });
  const [priceDialog, setPriceDialog] = useState<{ id: string; name: string } | null>(null);

  const { term, setTerm, filtered } = useSearchFilter(plans.data, (p) => [
    p.code, p.name, p.description, (p.saas_products as { short_name: string } | null)?.short_name,
  ]);
  const visible = filtered.filter((p) => matchesEntityStatusTab(p.status, tab));
  const hasAny = (plans.data ?? []).length > 0;

  return (
    <PageContainer
      title="Planes y licencias"
      description="Qué se vende de cada producto, con su precio, moneda y periodicidad por mercado. Las tarifas tienen vigencia: no se editan, se cierran y se abre una nueva."
      actions={
        perms.canManagePlatform ? (
          <button
            type="button"
            className="ebim-btn-primary"
            onClick={() => setPlanDialog({ open: true, plan: null })}
          >
            Nuevo plan
          </button>
        ) : null
      }
    >
      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar plan por nombre, código o producto…"
          right={
            <StatusTabs
              value={tab}
              onChange={setTab}
              options={entityStatusTabs(filtered, { active: 'Vigentes', inactive: 'No vigentes' })}
            />
          }
        />
        {plans.isLoading ? (
          <LoadingState label="Cargando planes…" />
        ) : plans.error ? (
          <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={hasAny ? 'Ningún plan coincide' : 'Sin planes'}
            description={
              hasAny
                ? 'Prueba con otra búsqueda o cambia de pestaña.'
                : 'Todavía no hay planes visibles para tu perfil.'
            }
          />
        ) : (
          <DataTable
            columns={[
              'Plan', 'Producto', 'Modelo', { label: 'Sociedades', align: 'right' }, 'Precio recurrente', 'Cargos únicos', 'Estado',
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {visible.map((p) => {
              const prices = p.plan_prices as PriceRow[] | null;
              return (
                <tr key={p.id}>
                  <td className="ebim-td">
                    <div className="flex max-w-[160px] flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold">{p.name}</span>
                      {p.is_partner_base ? <Badge tone="accent">Licencia base partner</Badge> : null}
                      {p.multi_country ? <Badge tone="info">Multi-país</Badge> : null}
                    </div>
                    <div className="max-w-[150px] truncate whitespace-nowrap font-mono text-caption text-muted" title={p.code}>{p.code}</div>
                  </td>
                  <td className="ebim-td">
                    {(p.saas_products as { short_name: string } | null)?.short_name ?? '—'}
                  </td>
                  <td className="ebim-td">
                    {p.deployment_mode ? (
                      <span className="text-fg-2">
                        {DEPLOYMENT_MODE_LABEL[p.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}
                      </span>
                    ) : (
                      <span className="text-muted">Cualquiera</span>
                    )}
                  </td>
                  <td className="ebim-td ebim-num">{p.included_companies}</td>
                  <td className="ebim-td py-2.5">
                    <RegionalPriceList prices={prices} kind="recurring" />
                  </td>
                  <td className="ebim-td py-2.5">
                    <RegionalPriceList prices={prices} kind="one-time" />
                  </td>
                  <td className="ebim-td">
                    <Badge tone={entityStatusTone(p.status)} dot>
                      {entityStatusLabel(p.status)}
                    </Badge>
                  </td>
                  <td className="ebim-td w-12 text-right">
                    {perms.canManagePlatform ? (
                      <ActionMenu
                        label={`Acciones del plan ${p.name}`}
                        items={[
                          { label: 'Fijar precio…', onSelect: () => setPriceDialog({ id: p.id, name: p.name }) },
                          {
                            label: 'Editar plan',
                            onSelect: () =>
                              setPlanDialog({
                                open: true,
                                plan: {
                                  id: p.id,
                                  code: p.code,
                                  name: p.name,
                                  saas_product_id: p.saas_product_id,
                                  deployment_mode: p.deployment_mode,
                                  included_companies: p.included_companies,
                                  multi_country: p.multi_country,
                                  is_partner_base: p.is_partner_base,
                                  description: p.description,
                                  status: p.status,
                                  sort_order: p.sort_order,
                                },
                              }),
                          },
                        ]}
                      />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <PlanFormDialog
        open={planDialog.open}
        plan={planDialog.plan}
        onClose={() => setPlanDialog({ open: false, plan: null })}
      />

      <PlanPriceDialog
        open={Boolean(priceDialog)}
        planId={priceDialog?.id ?? null}
        planName={priceDialog?.name ?? ''}
        onClose={() => setPriceDialog(null)}
      />
    </PageContainer>
  );
}
