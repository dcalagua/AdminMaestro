import { useState } from 'react';
import { usePlans } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import { RegionalPriceList } from './RegionalPriceList';
import { PlanFormDialog, PlanPriceDialog } from './PlanDialogs';
import type { PlanDraft } from './PlanDialogs';

/**
 * Planes y licencias.
 *
 * Los tres modelos comerciales conviven aquí sin ramas de código:
 *   SHARED            -> licencia por tenant productivo
 *   PARTNER_DEDICATED -> licencia base del partner (is_partner_base) + N licencias
 *   TENANT_DEDICATED  -> licencia Enterprise + infra + soporte
 * Lo que los distingue es `deployment_mode` y los `charge_kind` de sus precios.
 */
export function PlansPage() {
  const plans = usePlans();
  const perms = usePermissions();
  const [planDialog, setPlanDialog] = useState<{ open: boolean; plan: PlanDraft | null }>({
    open: false,
    plan: null,
  });
  const [priceDialog, setPriceDialog] = useState<{ id: string; name: string } | null>(null);

  const { term, setTerm, filtered } = useSearchFilter(plans.data, (p) => [
    p.code, p.name, p.description, (p.saas_products as { short_name: string } | null)?.short_name,
  ]);

  return (
    <PageContainer
      title="Planes y licencias"
      description="Catálogo comercial por producto y modelo de despliegue. Los precios tienen vigencia: nunca se editan, se cierran y se abre uno nuevo."
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
        <SearchBar value={term} onChange={setTerm} placeholder="Buscar plan por nombre, código o producto…" />
        {plans.isLoading ? (
          <LoadingState />
        ) : plans.error ? (
          <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sin planes" description="Ningún plan coincide con la búsqueda." />
        ) : (
          <DataTable columns={['Plan', 'Producto', 'Modelo', 'Sociedades', 'Precios vigentes', '']}>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td className="ebim-td">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    {p.is_partner_base ? <Badge tone="accent">Licencia base partner</Badge> : null}
                    {p.multi_country ? <Badge tone="info">Multi-país</Badge> : null}
                  </div>
                  <div className="font-mono text-xs text-muted">{p.code}</div>
                </td>
                <td className="ebim-td">{(p.saas_products as { short_name: string } | null)?.short_name}</td>
                <td className="ebim-td">
                  {p.deployment_mode ? (
                    <Badge tone="accent">
                      {DEPLOYMENT_MODE_LABEL[p.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}
                    </Badge>
                  ) : (
                    <span className="text-muted">Cualquiera</span>
                  )}
                </td>
                <td className="ebim-td tabular-nums">{p.included_companies}</td>
                <td className="ebim-td">
                  <RegionalPriceList prices={p.plan_prices as Array<Record<string, unknown>>} />
                </td>
                <td className="ebim-td">
                  {perms.canManagePlatform ? (
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        className="ebim-link text-[13px]"
                        onClick={() =>
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
                          })
                        }
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="ebim-link text-[13px]"
                        onClick={() => setPriceDialog({ id: p.id, name: p.name })}
                      >
                        Fijar precio
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
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
