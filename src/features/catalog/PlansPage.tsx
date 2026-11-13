import { useState } from 'react';
import { usePlans } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer,
  Card,
  DataTable,
  SearchBar,
  LoadingState,
  ErrorState,
  EmptyState,
  Badge,
} from '@/components/ui/primitives';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import { RegionalPriceList } from './RegionalPriceList';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { PlanFormDialog, PlanPriceDialog } from './PlanDialogs';
import type { PlanDraft } from './PlanDialogs';
import {
  entityStatusLabel,
  entityStatusTabs,
  entityStatusTone,
  matchesEntityStatusTab,
  planPriceSummary,
} from './catalogLabels';
import { AppChip, CellTitle, MoneyCell, StatusCell, type CellTone } from '@/components/ui/cells';
import { DetailDrawer } from '@/components/ui/DetailDrawer';
import { formatCountNoun, formatMoney } from '@/lib/format';
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
  const [pricesOf, setPricesOf] = useState<string | null>(null);

  const { term, setTerm, filtered } = useSearchFilter(plans.data, (p) => [
    p.code,
    p.name,
    p.description,
    (p.saas_products as { short_name: string } | null)?.short_name,
  ]);
  const visible = filtered.filter((p) => matchesEntityStatusTab(p.status, tab));
  const hasAny = (plans.data ?? []).length > 0;
  const pricesPlan = pricesOf ? (plans.data ?? []).find((p) => p.id === pricesOf) : undefined;

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
          total={plans.data?.length}
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
            variant={hasAny ? 'no-results' : 'empty'}
            onClear={
              hasAny
                ? () => {
                    setTerm('');
                    setTab('ALL');
                  }
                : undefined
            }
            title={hasAny ? 'Ningún plan coincide' : 'Sin planes'}
            description={
              hasAny
                ? 'Prueba con otra búsqueda o cambia de pestaña.'
                : 'Todavía no hay planes visibles para tu perfil.'
            }
          />
        ) : (
          <DataTable
            label="Planes"
            minWidth={960}
            columns={[
              { label: 'Plan', sticky: true },
              { label: 'App' },
              { label: 'Modelo', mobile: false },
              { label: 'Desde', align: 'right' },
              { label: 'Mercados' },
              { label: 'Cargos únicos', align: 'right', mobile: false },
              { label: 'Estado' },
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {visible.map((p) => {
              const prices = p.plan_prices as PriceRow[] | null;
              const summary = planPriceSummary(prices);
              const others = Object.keys(summary.fromByCurrency)
                .filter((c) => c !== summary.from?.currency)
                .sort((a, b) => a.localeCompare(b));
              const product =
                (p.saas_products as { short_name: string } | null)?.short_name ?? null;
              return (
                <tr key={p.id} data-plan={p.code}>
                  <td className="ebim-td py-2">
                    <div className="max-w-[300px]">
                      <CellTitle
                        title={p.name}
                        tooltip={`${p.name} · código ${p.code}`}
                        secondary={[
                          p.code,
                          p.included_companies > 1
                            ? formatCountNoun(p.included_companies, 'sociedad', 'sociedades')
                            : null,
                        ]}
                        monoParts={[0]}
                        aside={
                          <>
                            {p.is_partner_base ? <Badge tone="accent">Base partner</Badge> : null}
                            {p.multi_country ? <Badge tone="info">Multi-país</Badge> : null}
                          </>
                        }
                      />
                    </div>
                  </td>
                  <td className="ebim-td">
                    {product ? <AppChip name={product} /> : <span className="text-muted">—</span>}
                  </td>
                  <td className="ebim-td whitespace-nowrap text-compact">
                    {p.deployment_mode ? (
                      <span className="text-fg-2">
                        {
                          DEPLOYMENT_MODE_LABEL[
                            p.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL
                          ]
                        }
                      </span>
                    ) : (
                      <span className="text-muted">Cualquiera</span>
                    )}
                  </td>
                  <td className="ebim-td ebim-num">
                    {!summary.hasAny ? (
                      <span className="whitespace-nowrap text-compact font-semibold text-warn">
                        Sin precio definido
                      </span>
                    ) : !summary.from ? (
                      <span className="whitespace-nowrap text-compact text-muted">
                        Sin precio recurrente
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex flex-col items-end rounded-sm text-right hover:[&_[data-money]]:underline"
                        aria-label={`Ver las tarifas de ${p.name}`}
                        title="Ver todas las tarifas por mercado"
                        onClick={() => setPricesOf(p.id)}
                      >
                        <span className="whitespace-nowrap">
                          <MoneyCell
                            amount={summary.from.amount}
                            currency={summary.from.currency}
                            empty="Sin cargo"
                          />
                          <span className="text-caption text-muted"> /mes</span>
                        </span>
                        {others.length > 0 ? (
                          <span
                            className="whitespace-nowrap text-caption text-muted"
                            title={others
                              .map(
                                (c) => `desde ${formatMoney(summary.fromByCurrency[c]!, c)} / mes`,
                              )
                              .join('\n')}
                          >
                            también en {others.join(' · ')}
                          </span>
                        ) : null}
                      </button>
                    )}
                  </td>
                  <td className="ebim-td">
                    {summary.markets.length > 0 ? (
                      <ul className="flex flex-wrap gap-1" aria-label={`Mercados de ${p.name}`}>
                        {summary.markets.map((m) => (
                          <li
                            key={m}
                            className={`rounded px-1.5 text-caption font-semibold ${
                              m === 'Sin mercado'
                                ? 'bg-warn-soft text-warn'
                                : 'bg-accent-soft text-accent-deep'
                            }`}
                            title={
                              m === 'Sin mercado'
                                ? 'Tarifa anterior a V3 sin mercado: no se usa para vender'
                                : `Mercado ${m}`
                            }
                          >
                            {m}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="ebim-td ebim-num text-compact">
                    {summary.oneTimeCount > 0 ? (
                      <button
                        type="button"
                        className="ebim-link whitespace-nowrap"
                        aria-label={`Ver los cargos únicos de ${p.name}`}
                        onClick={() => setPricesOf(p.id)}
                      >
                        {formatCountNoun(summary.oneTimeCount, 'cargo')}
                      </button>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="ebim-td">
                    <StatusCell
                      label={entityStatusLabel(p.status)}
                      tone={entityStatusTone(p.status) as CellTone}
                    />
                  </td>
                  <td className="ebim-td w-12 text-right">
                    <ActionMenu
                      label={`Acciones del plan ${p.name}`}
                      items={[
                        summary.hasAny
                          ? { label: 'Ver tarifas', onSelect: () => setPricesOf(p.id) }
                          : null,
                        perms.canManagePlatform
                          ? {
                              label: 'Fijar precio…',
                              onSelect: () => setPriceDialog({ id: p.id, name: p.name }),
                            }
                          : null,
                        perms.canManagePlatform
                          ? {
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
                            }
                          : null,
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <DetailDrawer
        open={Boolean(pricesPlan)}
        title={pricesPlan ? `Tarifas · ${pricesPlan.name}` : 'Tarifas'}
        subtitle={
          pricesPlan ? `Código ${pricesPlan.code} · solo tarifas vigentes, por mercado` : undefined
        }
        size="lg"
        onClose={() => setPricesOf(null)}
        actions={
          pricesPlan && perms.canManagePlatform ? (
            <button
              type="button"
              className="ebim-btn-secondary ebim-btn-sm"
              onClick={() => {
                setPriceDialog({ id: pricesPlan.id, name: pricesPlan.name });
                setPricesOf(null);
              }}
            >
              Fijar precio…
            </button>
          ) : undefined
        }
      >
        {pricesPlan ? (
          <div className="space-y-6" data-plan-prices>
            <section>
              <h3 className="mb-2 text-micro text-muted">Precio recurrente</h3>
              <RegionalPriceList
                prices={pricesPlan.plan_prices as PriceRow[] | null}
                kind="recurring"
              />
            </section>
            <section>
              <h3 className="mb-2 text-micro text-muted">Cargos únicos</h3>
              <RegionalPriceList
                prices={pricesPlan.plan_prices as PriceRow[] | null}
                kind="one-time"
              />
            </section>
          </div>
        ) : null}
      </DetailDrawer>

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
