import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useProduct, useTenantOverview, usePartnerAgreements, usePlans,
  useProductMargin, useDeploymentTargets, useSubscriptions, useProductIntegrations,
} from '@/services/queries';
import { SectionTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, LoadingState, ErrorState, EmptyState, Badge, KpiTile,
} from '@/components/ui/primitives';
import { KpiStrip, NativeAmountTile } from '@/features/billing/financeUi';
import { initialsOf } from '@/lib/initials';
import { usePermissions } from '@/hooks/usePermissions';
import { formatMoney, formatPercent, formatNumber, formatDateTime, sumByCurrency } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_STATUS_LABEL, TENANT_TYPE_LABEL } from '@/types/domain';
import { StateMessage } from '@/features/executive/components/StateView';
import { fromQuery } from '@/features/executive/dataState';
import { billingUnitLabel, countText, entityStatusLabel, entityStatusTone, summarizeIntegration } from './catalogLabels';
import type { PriceRow } from './catalogLabels';
import { ProductFormDialog } from './ProductFormDialog';
import { RegionalPriceList } from './RegionalPriceList';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { BILLING_RESPONSIBILITY_TEXT } from '@/features/organizations/organizationLabels';
import { PlanFormDialog, PlanPriceDialog } from './PlanDialogs';
import type { PlanDraft } from './PlanDialogs';

interface ReadLike {
  data?: unknown;
  error?: unknown;
  isLoading?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => unknown;
}

/**
 * Guarda de lectura por pestaña: mientras carga o si la lectura falla (o no hay
 * acceso) se dice eso — nunca se pinta como lista vacía ni como cero.
 */
function guard(query: ReadLike): ReactNode | null {
  if (query.isLoading) return <LoadingState variant="page" />;
  if (query.error) {
    return (
      <div className="px-4">
        <StateMessage
          state={fromQuery(query, { isEmpty: () => false })}
          onRetry={query.refetch ? () => void query.refetch!() : undefined}
        />
      </div>
    );
  }
  return null;
}

/**
 * Vista 360 de un SaaS de la suite.
 *
 * Seis pestañas (Fase 03 §7): Resumen, Planes, Partners, Tenants, Finanzas y
 * Deployments. Todo sale de datos, no de código: esta pantalla funciona igual
 * para el sexto producto que se cree desde la UI que para eSupplier.
 */
export function ProductDetailPage() {
  const { productId } = useParams();
  const product = useProduct(productId);
  const tenants = useTenantOverview();
  const agreements = usePartnerAgreements();
  const plans = usePlans();
  const margins = useProductMargin();
  const targets = useDeploymentTargets();
  const subs = useSubscriptions();
  const integrations = useProductIntegrations();
  const perms = usePermissions();

  const [editing, setEditing] = useState(false);
  const [planDialog, setPlanDialog] = useState<{ open: boolean; plan: PlanDraft | null }>({
    open: false,
    plan: null,
  });
  const [priceDialog, setPriceDialog] = useState<{ id: string; name: string } | null>(null);

  if (product.isLoading) {
    return (
      <PageContainer title="Producto">
        <LoadingState label="Cargando producto…" />
      </PageContainer>
    );
  }
  if (product.error) {
    return (
      <PageContainer
        title="Producto"
      >
        <Card>
          <ErrorState error={product.error} onRetry={() => void product.refetch()} />
        </Card>
      </PageContainer>
    );
  }
  if (!product.data) {
    return (
      <PageContainer title="Producto no encontrado">
        <Card>
          <EmptyState
            title="No existe ese producto"
            description="Puede haber sido archivado o no tienes acceso."
          />
        </Card>
      </PageContainer>
    );
  }

  const p = product.data;
  const productTenants = (tenants.data ?? []).filter((t) => t.saas_product_id === p.id);
  const productAgreements = (agreements.data ?? []).filter((a) => a.saas_product_id === p.id);
  const productPlans = (plans.data ?? []).filter((pl) => pl.saas_product_id === p.id);
  const productTargets = (targets.data ?? []).filter(
    (t) => t.saas_product_id === p.id || t.saas_product_id === null,
  );
  const productSubs = (subs.data ?? []).filter((s) => s.saas_product_id === p.id);
  // El margen viene agrupado por moneda: no se suman PEN y USD sin FX explícito.
  // V3 · una fila por moneda; la fila sin moneda es «sin actividad», no «USD 0».
  const productMargins = (margins.data ?? []).filter((m) => m.saas_product_id === p.id && m.currency);
  const productIntegrations = ((integrations.data ?? []) as Array<Record<string, unknown>>).filter(
    (i) => i.saas_product_id === p.id,
  );
  const integration = summarizeIntegration(productIntegrations);
  const integrationText = integrations.error
    ? countText(integrations, 0)
    : integrations.isLoading
      ? '…'
      : integration.label;

  return (
    <PageContainer
      title={p.lockup_name ?? p.name}
      description={p.description ?? undefined}
      leading={
        <span
          aria-hidden
          className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-accent-soft text-h3 font-bold text-accent-deep"
        >
          {initialsOf(p.short_name)}
          {/* Color de marca del producto (dato del catálogo) como franja inferior. */}
          <span className="absolute inset-x-0 bottom-0 h-1.5 bg-accent" style={p.accent_color ? { background: p.accent_color } : undefined} />
        </span>
      }
      titleAside={
        <>
          <Badge tone={entityStatusTone(p.status)} dot>
            {entityStatusLabel(p.status)}
          </Badge>
          {integrations.error || integrations.isLoading ? null : (
            <Badge tone={integration.tone}>Integración: {integration.label.toLowerCase()}</Badge>
          )}
        </>
      }
      meta={`${billingUnitLabel(p.billing_unit)} · ${p.is_billable ? 'facturable' : 'no facturable'} · código ${p.code}`}
      actions={
        perms.canManagePlatform ? (
          <button type="button" className="ebim-btn-ghost" onClick={() => setEditing(true)}>
            Editar producto
          </button>
        ) : null
      }
    >
      <KpiStrip label="Indicadores del producto">
        <NativeAmountTile
          label="MRR vigente"
          info="MRR de los tenants del producto por moneda (foto actual); nunca se suman monedas"
          amounts={sumByCurrency(productTenants, (t) => t.mrr, (t) => t.currency)}
          state={fromQuery(tenants, { isEmpty: () => false })}
          onRetry={() => void tenants.refetch()}
          emptyLabel="Sin recurrente vigente"
          footer="Foto actual de los contratos"
        />
        <KpiTile
          label="Tenants"
          value={countText(tenants, productTenants.length)}
          footer={
            tenants.data
              ? `${formatNumber(productTenants.filter((t) => t.tenant_type === 'PRODUCTION').length)} productivos`
              : undefined
          }
        />
        <KpiTile
          label="Canales habilitados"
          value={countText(agreements, productAgreements.length)}
          footer="Partners con acuerdo para este producto"
        />
        <KpiTile label="Planes" value={countText(plans, productPlans.length)} footer="En el catálogo, todos los estados" />
      </KpiStrip>

      <SectionTabs
        tabs={[
          {
            id: 'overview',
            label: 'Resumen',
            content: (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Identidad del producto">
                  <dl className="divide-y divide-border">
                    {[
                      ['Nombre completo', p.name],
                      ['Nombre corto', p.short_name],
                      ['Lockup', p.lockup_name ?? '—'],
                      ['Estado comercial', entityStatusLabel(p.status)],
                      ['Integración técnica', integrationText],
                      ['Unidad de cobro', billingUnitLabel(p.billing_unit)],
                      ['Facturable', p.is_billable ? 'Sí' : 'No'],
                      ['Color de marca', p.accent_color ? 'Propio del producto' : 'Hereda de EBIM'],
                      ['Código técnico', p.code],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex justify-between gap-4 px-5 py-2.5 text-body">
                        <dt className="text-muted">{k}</dt>
                        <dd className="text-right font-medium">{v as string}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>

                <Card
                  title="Distribución de tenants"
                  description="Los tres modelos conviven sin ramas de código."
                >
                  {guard(tenants) ?? (
                  <dl className="divide-y divide-border">
                    {(['SHARED', 'PARTNER_DEDICATED', 'TENANT_DEDICATED'] as const).map((mode) => (
                      <div key={mode} className="flex justify-between gap-4 px-5 py-2.5 text-body">
                        <dt className="text-muted">{DEPLOYMENT_MODE_LABEL[mode]}</dt>
                        <dd className="text-right font-medium tabular-nums">
                          {formatNumber(
                            productTenants.filter((t) => t.deployment_mode === mode).length,
                          )}
                        </dd>
                      </div>
                    ))}
                    <div className="flex justify-between gap-4 px-5 py-2.5 text-body">
                      <dt className="text-muted">Suscripciones activas</dt>
                      <dd className="text-right font-medium tabular-nums">
                        {countText(subs, productSubs.filter((s) => s.status === 'ACTIVE').length)}
                      </dd>
                    </div>
                  </dl>
                  )}
                </Card>
              </div>
            ),
          },
          {
            id: 'plans',
            label: 'Planes',
            content: (
              <Card
                description="El plan define qué se licencia; la tarifa se versiona aparte y nunca se edita en sitio."
                actions={
                  perms.canManagePlatform ? (
                    <button
                      type="button"
                      className="ebim-btn-ghost"
                      onClick={() => setPlanDialog({ open: true, plan: null })}
                    >
                      Nuevo plan
                    </button>
                  ) : null
                }
              >
                {guard(plans) ?? (productPlans.length === 0 ? (
                  <EmptyState
                    title="Sin planes definidos"
                    description="Sin plan no se puede vender este producto."
                  />
                ) : (
                  <DataTable
                    columns={[
                      'Plan', 'Modelo', { label: 'Sociedades incluidas', align: 'right' }, 'Precio recurrente', 'Cargos únicos',
                      { label: 'Acciones', srOnly: true },
                    ]}
                  >
                    {productPlans.map((pl) => (
                      <tr key={pl.id as string}>
                        <td className="ebim-td">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{pl.name}</span>
                            {pl.is_partner_base ? (
                              <Badge tone="accent">Licencia base partner</Badge>
                            ) : null}
                          </div>
                          <div className="text-compact text-fg-2">{pl.description}</div>
                        </td>
                        <td className="ebim-td">
                          {pl.deployment_mode
                            ? DEPLOYMENT_MODE_LABEL[
                                pl.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL
                              ]
                            : 'Cualquiera'}
                        </td>
                        <td className="ebim-td ebim-num">{pl.included_companies}</td>
                        <td className="ebim-td">
                          <RegionalPriceList prices={pl.plan_prices as PriceRow[]} kind="recurring" />
                        </td>
                        <td className="ebim-td">
                          <RegionalPriceList prices={pl.plan_prices as PriceRow[]} kind="one-time" />
                        </td>
                        <td className="ebim-td w-12 text-right">
                          {perms.canManagePlatform ? (
                            <ActionMenu
                              label={`Acciones del plan ${pl.name}`}
                              items={[
                                { label: 'Fijar precio…', onSelect: () => setPriceDialog({ id: pl.id, name: pl.name }) },
                                {
                                  label: 'Editar plan',
                                  onSelect: () =>
                                    setPlanDialog({
                                      open: true,
                                      plan: {
                                        id: pl.id,
                                        code: pl.code,
                                        name: pl.name,
                                        saas_product_id: pl.saas_product_id,
                                        deployment_mode: pl.deployment_mode,
                                        included_companies: pl.included_companies,
                                        multi_country: pl.multi_country,
                                        is_partner_base: pl.is_partner_base,
                                        description: pl.description,
                                        status: pl.status,
                                        sort_order: pl.sort_order,
                                      },
                                    }),
                                },
                              ]}
                            />
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                ))}
              </Card>
            ),
          },
          {
            id: 'partners',
            label: 'Partners',
            content: (
              <Card description="Quién puede comercializar este SaaS y bajo qué condiciones. Un mismo partner puede tener otro margen en otro producto.">
                {guard(agreements) ?? (productAgreements.length === 0 ? (
                  <EmptyState
                    title="Ninguna organización habilitada"
                    description="Nadie puede comercializar este producto todavía. Los acuerdos se crean desde el detalle de la organización."
                  />
                ) : (
                  <DataTable
                    columns={[
                      'Organización', 'Revende', 'Administra', 'Margen',
                      'Modelos permitidos', 'Tenants', 'Factura', 'Estado',
                    ]}
                  >
                    {productAgreements.map((a) => (
                      <tr key={a.agreement_id as string}>
                        <td className="ebim-td font-semibold">
                          <Link className="ebim-link" to={`/organizations/${a.organization_id}`}>
                            {a.organization_name}
                          </Link>
                        </td>
                        <td className="ebim-td">{a.can_resell ? 'Sí' : 'No'}</td>
                        <td className="ebim-td">{a.can_manage_tenants ? 'Sí' : 'No'}</td>
                        <td className="ebim-td tabular-nums font-semibold">
                          {formatPercent(Number(a.margin_rate))}
                        </td>
                        <td className="ebim-td">
                          <div className="flex flex-wrap gap-1">
                            {((a.allowed_deployment_modes ?? []) as string[]).map((m) => (
                              <Badge
                                key={m}
                                tone={m === a.default_deployment_mode ? 'accent' : 'neutral'}
                              >
                                {DEPLOYMENT_MODE_LABEL[m as keyof typeof DEPLOYMENT_MODE_LABEL]}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="ebim-td tabular-nums">
                          {formatNumber(Number(a.managed_tenants))}
                          {a.max_tenants ? (
                            <span className="text-muted"> / {a.max_tenants}</span>
                          ) : null}
                        </td>
                        <td className="ebim-td text-compact text-fg-2">{BILLING_RESPONSIBILITY_TEXT[a.billing_responsibility as string] ?? a.billing_responsibility}</td>
                        <td className="ebim-td">
                          <Badge tone={entityStatusTone(a.status as string)}>
                            {entityStatusLabel(a.status as string)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                ))}
              </Card>
            ),
          },
          {
            id: 'tenants',
            label: 'Tenants',
            content: (
              <Card>
                {guard(tenants) ?? (productTenants.length === 0 ? (
                  <EmptyState title="Sin tenants para este producto" />
                ) : (
                  <DataTable
                    columns={['Tenant', 'Cliente', 'Partner', 'Tipo', 'Modelo', 'MRR', 'Estado']}
                  >
                    {productTenants.map((t) => (
                      <tr key={t.tenant_id as string}>
                        <td className="ebim-td">
                          <Link className="ebim-link" to={`/tenants/${t.tenant_id}`}>
                            {t.name}
                          </Link>
                        </td>
                        <td className="ebim-td">{t.customer_name}</td>
                        <td className="ebim-td text-muted">{t.managing_name ?? 'Directo EBIM'}</td>
                        <td className="ebim-td">
                          <Badge tone={t.tenant_type === 'PRODUCTION' ? 'ok' : 'info'}>
                            {TENANT_TYPE_LABEL[t.tenant_type as keyof typeof TENANT_TYPE_LABEL]}
                          </Badge>
                        </td>
                        <td className="ebim-td">
                          <Badge tone="accent">
                            {
                              DEPLOYMENT_MODE_LABEL[
                                t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL
                              ]
                            }
                          </Badge>
                        </td>
                        <td className="ebim-td tabular-nums">
                          {formatMoney(Number(t.mrr), t.currency as string | null)}
                        </td>
                        <td className="ebim-td text-muted">
                          {TENANT_STATUS_LABEL[t.status as keyof typeof TENANT_STATUS_LABEL] ?? t.status}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                ))}
              </Card>
            ),
          },
          {
            id: 'finance',
            label: 'Finanzas',
            hidden: !perms.canReadFinance && !perms.canManagePlatform,
            content: (
              <Card
                title="Margen del producto"
                description="Agrupado por moneda: no se consolidan PEN y USD sin un tipo de cambio auditable."
              >
                {guard(margins) ?? (productMargins.length === 0 ? (
                  <EmptyState
                    title="Sin margen calculable"
                    description="Aparece en cuanto el producto tenga suscripciones con cobros registrados."
                  />
                ) : (
                  <DataTable
                    label="Margen del producto por moneda"
                    columns={[
                      'Moneda',
                      { label: 'MRR', align: 'right' },
                      { label: 'Cobrado total', align: 'right' },
                      { label: 'One-time cobrado', align: 'right' },
                      { label: 'Costo directo', align: 'right' },
                      { label: 'Comisiones', align: 'right' },
                      { label: 'Margen bruto', align: 'right' },
                    ]}
                  >
                    {productMargins.map((m) => (
                      <tr key={m.currency as string}>
                        <td className="ebim-td font-semibold">{m.currency}</td>
                        <td className="ebim-td ebim-num">{formatMoney(Number(m.mrr), m.currency)}</td>
                        <td className="ebim-td ebim-num">{formatMoney(Number(m.collected_revenue), m.currency)}</td>
                        <td className="ebim-td ebim-num">{formatMoney(Number(m.collected_one_time), m.currency)}</td>
                        <td className="ebim-td ebim-num">{formatMoney(Number(m.direct_cost), m.currency)}</td>
                        <td className="ebim-td ebim-num">
                          {formatMoney(Number(m.commission_total), m.currency)}
                          <span className="block text-compact text-muted">
                            {formatMoney(Number(m.commission_pending), m.currency)} pendiente
                          </span>
                        </td>
                        <td className={`ebim-td ebim-num font-semibold ${Number(m.gross_margin) < 0 ? 'text-danger' : ''}`}>
                          {formatMoney(Number(m.gross_margin), m.currency)}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                ))}
              </Card>
            ),
          },
          {
            id: 'deployments',
            label: 'Deployments',
            content: (
              <Card description="Infraestructura que sirve a este producto. Los targets sin producto asignado son compartidos de propósito general.">
                {guard(targets) ?? (productTargets.length === 0 ? (
                  <EmptyState title="Sin infraestructura asociada" />
                ) : (
                  <DataTable
                    columns={['Target', 'Modelo', 'Proveedor', 'Región', 'Dueño', 'Tenants', 'Estado']}
                  >
                    {productTargets.map((t) => {
                      const active = (
                        (t.tenant_deployments ?? []) as Array<Record<string, unknown>>
                      ).filter((d) => d.status === 'ACTIVE');
                      return (
                        <tr key={t.id}>
                          <td className="ebim-td">
                            <div className="whitespace-nowrap font-mono text-compact font-semibold">{t.code}</div>
                            <div className="text-compact text-fg-2">{t.name}</div>
                          </td>
                          <td className="ebim-td">
                            <Badge tone="accent">
                              {
                                DEPLOYMENT_MODE_LABEL[
                                  t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL
                                ]
                              }
                            </Badge>
                          </td>
                          <td className="ebim-td">{t.provider}</td>
                          <td className="ebim-td text-muted">{t.region ?? '—'}</td>
                          <td className="ebim-td text-muted">
                            {(t.organizations as { display_name: string } | null)?.display_name ??
                              'EBIM'}
                          </td>
                          <td className="ebim-td tabular-nums">{formatNumber(active.length)}</td>
                          <td className="ebim-td">
                            <Badge tone={entityStatusTone(t.status)}>{entityStatusLabel(t.status)}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </DataTable>
                ))}
                {targets.dataUpdatedAt ? (
                  <p className="border-t border-border px-5 py-3 text-caption text-muted">
                    Última lectura de infraestructura: {formatDateTime(new Date(targets.dataUpdatedAt))}.
                  </p>
                ) : null}
              </Card>
            ),
          },
        ]}
      />

      <ProductFormDialog open={editing} product={p} onClose={() => setEditing(false)} />

      <PlanFormDialog
        open={planDialog.open}
        plan={planDialog.plan ?? undefined}
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
