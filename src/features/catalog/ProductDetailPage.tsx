import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useProduct, useTenantOverview, usePartnerAgreements, usePlans,
  useProductMargin, useDeploymentTargets, useSubscriptions,
} from '@/services/queries';
import { SectionTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, LoadingState, ErrorState, EmptyState, Badge, StatCard,
} from '@/components/ui/primitives';
import { usePermissions } from '@/hooks/usePermissions';
import { formatMoney, formatPercent, formatNumber, formatDate } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL } from '@/types/domain';
import { ProductFormDialog } from './ProductFormDialog';
import { PlanFormDialog, PlanPriceDialog } from './PlanDialogs';
import type { PlanDraft } from './PlanDialogs';

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
  const perms = usePermissions();

  const [editing, setEditing] = useState(false);
  const [planDialog, setPlanDialog] = useState<{ open: boolean; plan: PlanDraft | null }>({
    open: false,
    plan: null,
  });
  const [priceDialog, setPriceDialog] = useState<{ id: string; name: string } | null>(null);

  if (product.isLoading) return <LoadingState />;
  if (product.error) return <ErrorState error={product.error} />;
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
  const productMargins = (margins.data ?? []).filter((m) => m.saas_product_id === p.id);

  return (
    <PageContainer
      title={p.lockup_name ?? p.name}
      description={p.description ?? undefined}
      breadcrumbs={
        <Link className="text-xs text-muted hover:text-fg" to="/products">← SaaS Products</Link>
      }
      actions={
        perms.canManagePlatform ? (
          <button type="button" className="ebim-btn-ghost" onClick={() => setEditing(true)}>
            Editar producto
          </button>
        ) : null
      }
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label="Tenants" value={formatNumber(productTenants.length)} />
        <StatCard label="Canales habilitados" value={formatNumber(productAgreements.length)} />
        <StatCard label="Planes" value={formatNumber(productPlans.length)} />
        <StatCard label="Unidad de cobro" value={p.billing_unit} />
      </div>

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
                      ['Código', p.code],
                      ['Nombre completo', p.name],
                      ['Nombre corto', p.short_name],
                      ['Lockup', p.lockup_name ?? '—'],
                      ['Color de acento', p.accent_color ?? 'Hereda de EBIM'],
                      ['Unidad de cobro', p.billing_unit],
                      ['Facturable', p.is_billable ? 'Sí' : 'No'],
                      ['Estado', p.status],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
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
                  <dl className="divide-y divide-border">
                    {(['SHARED', 'PARTNER_DEDICATED', 'TENANT_DEDICATED'] as const).map((mode) => (
                      <div key={mode} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                        <dt className="text-muted">{DEPLOYMENT_MODE_LABEL[mode]}</dt>
                        <dd className="text-right font-medium tabular-nums">
                          {formatNumber(
                            productTenants.filter((t) => t.deployment_mode === mode).length,
                          )}
                        </dd>
                      </div>
                    ))}
                    <div className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                      <dt className="text-muted">Suscripciones activas</dt>
                      <dd className="text-right font-medium tabular-nums">
                        {formatNumber(productSubs.filter((s) => s.status === 'ACTIVE').length)}
                      </dd>
                    </div>
                  </dl>
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
                {productPlans.length === 0 ? (
                  <EmptyState
                    title="Sin planes definidos"
                    description="Sin plan no se puede vender este producto."
                  />
                ) : (
                  <DataTable
                    columns={['Plan', 'Modelo', 'Sociedades incluidas', 'Precios vigentes', '']}
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
                          <div className="text-xs text-muted">{pl.description}</div>
                        </td>
                        <td className="ebim-td">
                          {pl.deployment_mode
                            ? DEPLOYMENT_MODE_LABEL[
                                pl.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL
                              ]
                            : 'Cualquiera'}
                        </td>
                        <td className="ebim-td tabular-nums">{pl.included_companies}</td>
                        <td className="ebim-td">
                          <div className="space-y-0.5">
                            {((pl.plan_prices ?? []) as Array<Record<string, unknown>>)
                              .filter((pr) => !pr.valid_to)
                              .map((pr) => (
                                <div key={pr.id as string} className="text-xs">
                                  <span className="text-muted">{pr.charge_kind as string}:</span>{' '}
                                  <span className="font-semibold tabular-nums">
                                    {formatMoney(Number(pr.amount), pr.currency as string)}
                                  </span>
                                  <span className="text-muted">
                                    {' '}
                                    / {pr.billing_interval as string}
                                  </span>
                                </div>
                              ))}
                            {((pl.plan_prices ?? []) as unknown[]).length === 0 ? (
                              <span className="text-xs text-muted">Sin precios</span>
                            ) : null}
                          </div>
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
                                  })
                                }
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="ebim-link text-[13px]"
                                onClick={() => setPriceDialog({ id: pl.id, name: pl.name })}
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
            ),
          },
          {
            id: 'partners',
            label: 'Partners',
            content: (
              <Card description="Quién puede comercializar este SaaS y bajo qué condiciones. Un mismo partner puede tener otro margen en otro producto.">
                {productAgreements.length === 0 ? (
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
                        <td className="ebim-td text-xs text-muted">{a.billing_responsibility}</td>
                        <td className="ebim-td">
                          <Badge tone={a.status === 'ACTIVE' ? 'ok' : 'neutral'}>{a.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'tenants',
            label: 'Tenants',
            content: (
              <Card>
                {productTenants.length === 0 ? (
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
                          {formatMoney(Number(t.mrr), (t.currency as string) ?? 'USD')}
                        </td>
                        <td className="ebim-td text-muted">{t.status}</td>
                      </tr>
                    ))}
                  </DataTable>
                )}
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
                {productMargins.length === 0 ? (
                  <EmptyState
                    title="Sin margen calculable"
                    description="Aparece en cuanto el producto tenga suscripciones con cobros registrados."
                  />
                ) : (
                  <div className="space-y-4 p-4">
                    {productMargins.map((m) => (
                      <div key={(m.currency as string) ?? 'USD'}>
                        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                          Moneda {m.currency}
                        </p>
                        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                          <StatCard
                            label="MRR"
                            value={formatMoney(Number(m.mrr), m.currency ?? 'USD')}
                            hint="Solo lo recurrente"
                          />
                          <StatCard
                            label="Cobrado total"
                            value={formatMoney(Number(m.collected_revenue), m.currency ?? 'USD')}
                            tone="ok"
                          />
                          <StatCard
                            label="One-time cobrado"
                            value={formatMoney(Number(m.collected_one_time), m.currency ?? 'USD')}
                            hint="Implementación y servicios"
                          />
                          <StatCard
                            label="Costo directo"
                            value={formatMoney(Number(m.direct_cost), m.currency ?? 'USD')}
                            tone="warn"
                          />
                          <StatCard
                            label="Comisiones"
                            value={formatMoney(Number(m.commission_total), m.currency ?? 'USD')}
                            hint={`${formatMoney(Number(m.commission_pending), m.currency ?? 'USD')} pendiente`}
                            tone="warn"
                          />
                          <StatCard
                            label="Margen bruto"
                            value={formatMoney(Number(m.gross_margin), m.currency ?? 'USD')}
                            tone={Number(m.gross_margin) >= 0 ? 'ok' : 'danger'}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ),
          },
          {
            id: 'deployments',
            label: 'Deployments',
            content: (
              <Card description="Infraestructura que sirve a este producto. Los targets sin producto asignado son compartidos de propósito general.">
                {productTargets.length === 0 ? (
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
                            <div className="font-mono text-xs font-semibold">{t.code}</div>
                            <div className="text-xs text-muted">{t.name}</div>
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
                            <Badge tone={t.status === 'ACTIVE' ? 'ok' : 'neutral'}>{t.status}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </DataTable>
                )}
                <p className="border-t border-border px-4 py-2.5 text-xs text-muted">
                  Última lectura de infraestructura: {formatDate(new Date())}.
                </p>
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
