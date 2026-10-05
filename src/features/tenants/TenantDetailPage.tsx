import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  useTenant, useTenantFeatures, useTenantAttributions, useTenantProductMappings, useProvisioningTargets,
} from '@/services/queries';
import { useTenantAudit, useTenantInfraRequests, useTenantMarginRows, useTenantRenewals, useTenantSubscriptions } from './tenantQueries';
import { useAccountSeries } from '@/services/queries';
import { Avatar } from '@/components/ui/Avatar';
import { KpiTile } from '@/components/ui/primitives';
import { KpiStrip } from '@/features/billing/financeUi';
import { AccountMrrTile, AccountTrendCharts, HealthTile } from '@/features/organizations/AccountPanels';
import { accountHealth } from '@/features/organizations/accountSeriesModel';
import { AGENT_TYPE_LABEL, SOURCE_LABEL } from '@/features/commercial/commercialLabels';
import { tenantDimensions } from './tenantDimensions';
import { TenantDimensionsView } from './TenantDimensionsView';
import { TenantAddonsPanel } from './TenantAddonsPanel';
import { TenantUsagePanel } from './TenantUsagePanel';
import { useRequestTenantSuspension, useRequestTenantResume } from '@/services/mutations';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { isFinance, canManagePlatform } from '@/features/auth/session';
import { SectionTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatMoney, formatDate, formatDateTime } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL, TENANT_STATUS_LABEL, PROVISIONING_STATUS_LABEL } from '@/types/domain';
import {
  PROVISIONING_ENVIRONMENT_LABEL,
  SAAS_PROVISIONING_STATUS_LABEL,
  provisioningStatusTone,
  type ProvisioningEnvironment,
  type SaasProvisioningStatus,
} from '@/lib/provisioning';

const ENVIRONMENT_TEXT: Record<string, string> = {
  PRODUCTION: 'Producción',
  TRIAL: 'Prueba',
  DEMO: 'Demostración',
  SANDBOX: 'Sandbox',
};

/**
 * Tenant 360 (P31, spec §11.2): cuatro dimensiones visibles — comercial, alta
 * técnica, salud observada y acceso del administrador — sin semáforo global.
 * Cambiar el estado comercial NO afirma una suspensión en los productos: la
 * orden al producto se encola en DRY_RUN y así se dice.
 *
 * Todas las lecturas van acotadas a ESTE tenant en el servidor.
 *
 * Lo que NO aparece aquí, deliberadamente: proveedores, órdenes, inventario,
 * documentos. El Control Plane administra metadatos y gobierno; los datos
 * operativos viven en el proyecto Supabase de cada app (contrato §7).
 */
export function TenantDetailPage() {
  const { tenantId } = useParams();
  const { roles } = useAuth();
  const location = useLocation();
  // Se captura UNA vez al llegar: cambiar de pestaña (#hash) crea otra entrada de
  // historial sin `state` y el contexto de la venta no debe desaparecer.
  const [onboarded] = useState(
    () =>
      (location.state as { onboarded?: { subscriptionId: string | null; productName: string; activated: boolean } } | null)
        ?.onboarded,
  );
  const tenant = useTenant(tenantId);
  const features = useTenantFeatures(tenantId);
  const attributions = useTenantAttributions(tenantId);
  const subscriptions = useTenantSubscriptions(tenantId);
  const margins = useTenantMarginRows(tenantId);
  const targets = useProvisioningTargets();
  // Alta del tenant DENTRO de cada SaaS de la suite. Es otra pregunta que
  // «¿dónde vive la base de datos?»: aquí se responde «¿existe ya este tenant
  // en EWM, en eSupplier, en TMS?».
  const productProvisioning = useTenantProductMappings(tenantId);
  const provisioning = useTenantInfraRequests(tenantId);
  const audit = useTenantAudit(tenantId);
  const series = useAccountSeries({ tenantId });
  const renewals = useTenantRenewals(tenantId);
  const perms = usePermissions();
  const toast = useToast();
  const suspend = useRequestTenantSuspension();
  const resume = useRequestTenantResume();
  const [pendingAction, setPendingAction] = useState<'SUSPEND' | 'RESUME' | null>(null);

  /**
   * Suspender y reanudar pasan por RPC: cambian el estado del tenant Y encolan el
   * trabajo de infraestructura en la misma transacción. Un UPDATE suelto dejaría
   * el tenant apagado en la consola y encendido en la infraestructura.
   */
  async function applyAction() {
    if (!pendingAction || !tenantId) return;
    try {
      if (pendingAction === 'SUSPEND') {
        await suspend.mutateAsync({
          p_tenant_id: tenantId,
          p_reason: 'Suspensión solicitada desde la consola',
        });
        toast.success(
          'Estado comercial: suspendido',
          'Cambió en el Control Plane. La orden SUSPEND_TENANT al producto quedó encolada en simulación (DRY_RUN): el acceso en el producto no cambió.',
        );
      } else {
        await resume.mutateAsync({ p_tenant_id: tenantId });
        toast.success(
          'Estado comercial: activo',
          'Cambió en el Control Plane. La orden RESUME_TENANT al producto quedó encolada en simulación (DRY_RUN).',
        );
      }
    } catch (error) {
      toast.error('No se pudo aplicar el cambio', businessErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  if (tenant.isLoading) return <LoadingState variant="page" />;
  if (tenant.error) return <ErrorState error={tenant.error} />;
  if (!tenant.data) {
    return (
      <PageContainer title="Tenant no encontrado">
        <Card>
          <EmptyState
            title="No existe o no tienes acceso"
            description="RLS impide ver tenants fuera de tu organización o de tu membresía. No es un fallo de la pantalla."
          />
        </Card>
      </PageContainer>
    );
  }

  const t = tenant.data;
  const tenantSubs = subscriptions.data ?? [];
  // V3 · una fila por moneda: un tenant con costo USD y cobro PEN tiene dos.
  const tenantMargins = (margins.data ?? []).filter((m) => m.currency);
  const tenantProvisioning = provisioning.data ?? [];
  const tenantAudit = audit.data ?? [];
  const dims = tenantDimensions(t, productProvisioning.data ?? [], targets.data ?? []);

  const showFinance = isFinance(roles) || canManagePlatform(roles);

  return (
    <PageContainer
      title={t.name as string}
      leading={<Avatar name={(t.customer_name as string) ?? (t.name as string)} size="lg" />}
      titleAside={
        <>
          <Badge tone={t.status === 'ACTIVE' ? 'ok' : t.status === 'SUSPENDED' || t.status === 'CHURNED' ? 'danger' : 'warn'} dot>
            {TENANT_STATUS_LABEL[t.status as keyof typeof TENANT_STATUS_LABEL]}
          </Badge>
          <Badge tone={t.tenant_type === 'PRODUCTION' ? 'neutral' : 'info'}>
            {TENANT_TYPE_LABEL[t.tenant_type as keyof typeof TENANT_TYPE_LABEL]}
          </Badge>
          <Badge tone="neutral">
            {DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}
          </Badge>
        </>
      }
      description={`${t.product_lockup} · ${t.customer_name}${t.managing_name ? ` · administrado por ${t.managing_name}` : ' · venta directa EBIM'}`}
      meta={
        <>
          {t.customer_organization_id ? (
            <Link className="ebim-link" to={`/organizations/${t.customer_organization_id}`}>
              Ficha 360 de {t.customer_name as string}
            </Link>
          ) : null}
          {t.market_code ? <span> · Mercado {t.market_code as string}</span> : null}
        </>
      }
      actions={
        perms.canManagePlatform && t.status === 'ACTIVE' ? (
          <button type="button" className="ebim-btn-ghost" onClick={() => setPendingAction('SUSPEND')}>
            Suspender
          </button>
        ) : perms.canManagePlatform && t.status === 'SUSPENDED' ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setPendingAction('RESUME')}>
            Reactivar
          </button>
        ) : null
      }
    >
      {onboarded ? (
        <section className="ebim-card mb-4 border-l-4 border-l-[color:var(--accent-action)] p-4" aria-labelledby="next-steps-title">
          <h2 id="next-steps-title" className="text-sm font-bold text-fg">Venta registrada: siguientes pasos</h2>
          <p className="mt-1 text-sm text-muted">
            Se crearon el tenant, el contrato y la atribución{onboarded.activated ? ' (contrato activo)' : ' (contrato en borrador para revisión)'}. El alta
            dentro del producto es una decisión aparte: nada de lo de abajo la ejecuta.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {onboarded.subscriptionId ? (
              <li>
                <Link className="ebim-btn-secondary ebim-btn-sm" to={`/subscriptions/${onboarded.subscriptionId}`}>
                  Revisar el contrato
                </Link>
              </li>
            ) : null}
            <li>
              <a className="ebim-btn-ghost ebim-btn-sm" href="#products">
                Ver estado del alta en el producto
              </a>
            </li>
            <li>
              <Link className="ebim-btn-ghost ebim-btn-sm" to="/saas-provisioning">
                Ir a Altas SaaS (decisión manual)
              </Link>
            </li>
          </ul>
        </section>
      ) : null}

      <KpiStrip label="Indicadores del tenant">
        <AccountMrrTile
          query={series}
          info="MRR contratado de los contratos de este tenant, a hoy (misma definición que el Resumen Ejecutivo)"
        />
        <KpiTile
          label="Plan"
          value={t.plan_name ? <span className="text-h2">{t.plan_name as string}</span> : null}
          footer={t.plan_name ? `${t.product_short_name as string} · ${TENANT_TYPE_LABEL[t.tenant_type as keyof typeof TENANT_TYPE_LABEL]}` : 'Sin plan contratado'}
        />
        <KpiTile
          label="Infraestructura"
          value={
            t.deployment_target_code ? (
              <span className="block max-w-full truncate font-mono text-h3" title={t.deployment_target_code as string}>
                {t.deployment_target_code as string}
              </span>
            ) : null
          }
          footer={
            t.deployment_target_code
              ? `${DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}${t.deployment_region ? ` · ${t.deployment_region as string}` : ''}`
              : 'Sin destino asignado'
          }
        />
        <HealthTile
          health={accountHealth(renewals.data ?? [])}
          loading={renewals.isLoading}
          error={Boolean(renewals.error)}
          onRetry={() => void renewals.refetch()}
        />
      </KpiStrip>

      <div className="mb-6">
        {productProvisioning.error ? (
          <p className="mb-2 text-compact font-semibold text-warn" role="status">
            No se pudieron leer las altas SaaS: «Alta técnica» y «Acceso administrador» pueden estar incompletos.
          </p>
        ) : null}
        <TenantDimensionsView dims={dims} />
      </div>

      <SectionTabs
        tabs={[
          {
            id: 'overview',
            label: 'Resumen',
            content: (
              <div className="space-y-4">
                <AccountTrendCharts query={series} subject={t.name as string} />
                <Card title="Datos del tenant">
                  <dl className="grid gap-x-8 px-5 py-2 md:grid-cols-2">
                    {[
                      ['Slug', <span key="slug" className="font-mono text-compact">{t.slug as string}</span>],
                      ['Producto', t.product_lockup],
                      ['Organización cliente', t.customer_name],
                      ['Organización que administra', t.managing_name ?? 'Ninguna (venta directa EBIM)'],
                      ['Tipo', TENANT_TYPE_LABEL[t.tenant_type as keyof typeof TENANT_TYPE_LABEL]],
                      ['Entorno', ENVIRONMENT_TEXT[t.environment as string] ?? t.environment],
                      ['Modelo de despliegue', DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]],
                      ['Correo del administrador', t.admin_email],
                      ['Administrador activado', t.admin_activated_at ? formatDateTime(t.admin_activated_at as string) : 'Pendiente de activar'],
                      ['Creado', formatDateTime(t.created_at as string)],
                      ['Activado', t.activated_at ? formatDateTime(t.activated_at as string) : '—'],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex justify-between gap-4 border-b border-border py-2.5 text-body">
                        <dt className="text-muted">{k as string}</dt>
                        <dd className="min-w-0 truncate text-right font-medium">{(v as React.ReactNode) ?? '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              </div>
            ),
          },
          {
            id: 'commercial',
            label: 'Atribución comercial',
            content: (
              <Card description="Quién se lleva el crédito de esta venta. Estar aquí NO da acceso operacional al tenant (regla §2.3).">
                {(attributions.data ?? []).length === 0 ? (
                  <EmptyState title="Sin atribución comercial" description="Esta venta no tiene comercial asignado." />
                ) : (
                  <DataTable columns={['Comercial', 'Tipo', { label: 'Participación', align: 'right' }, 'Plan de comisión', 'Origen', 'Vigencia']}>
                    {(attributions.data ?? []).map((a) => (
                      <tr key={a.id as string}>
                        <td className="ebim-td font-semibold">
                          {(a.sales_agents as { full_name: string } | null)?.full_name}
                        </td>
                        <td className="ebim-td">
                          <Badge tone="neutral">{AGENT_TYPE_LABEL[(a.sales_agents as { agent_type: string } | null)?.agent_type ?? ''] ?? (a.sales_agents as { agent_type: string } | null)?.agent_type}</Badge>
                        </td>
                        <td className="ebim-td ebim-num">{(Number(a.attribution_pct) * 100).toFixed(0)}%</td>
                        <td className="ebim-td">{(a.commission_plans as { name: string } | null)?.name ?? '—'}</td>
                        <td className="ebim-td text-fg-2">{SOURCE_LABEL[a.source as string] ?? (a.source as string)}</td>
                        <td className="ebim-td text-compact text-muted">
                          {formatDate(a.valid_from as string)} → {a.valid_to ? formatDate(a.valid_to as string) : 'sin fin'}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'subscription',
            label: 'Suscripción',
            content: (
              <Card>
                {tenantSubs.length === 0 ? (
                  <EmptyState
                    title="Sin suscripción"
                    description={
                      t.tenant_type === 'DEMO'
                        ? 'Es un tenant DEMO: por regla de negocio no genera cobro recurrente.'
                        : 'Todavía no se ha creado una suscripción para este tenant.'
                    }
                  />
                ) : (
                  <div className="space-y-4 p-4">
                    {tenantSubs.map((s) => (
                      <div key={s.id} className="rounded-card border border-border">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                          <div>
                            <Link className="ebim-link font-semibold" to={`/subscriptions/${s.id}`}>{s.code}</Link>
                            <span className="ml-2 text-compact text-muted">
                              {(s.plans as { name: string } | null)?.name}
                            </span>
                          </div>
                          <Badge tone={s.status === 'ACTIVE' ? 'ok' : 'warn'}>{s.status}</Badge>
                        </div>
                        <DataTable columns={['Concepto', 'Cargo', 'Cantidad', 'Unitario', 'Periodicidad', 'Total']}>
                          {((s.subscription_items ?? []) as Array<Record<string, unknown>>).map((i) => (
                            <tr key={i.id as string}>
                              <td className="ebim-td">{i.description as string}</td>
                              <td className="ebim-td">
                                <Badge tone={String(i.charge_kind).includes('FEE') ? 'warn' : 'accent'}>
                                  {i.charge_kind as string}
                                </Badge>
                              </td>
                              <td className="ebim-td tabular-nums">{Number(i.quantity)}</td>
                              <td className="ebim-td tabular-nums">{formatMoney(Number(i.unit_amount), i.currency as string)}</td>
                              <td className="ebim-td text-muted">{i.billing_interval as string}</td>
                              <td className="ebim-td tabular-nums font-semibold">
                                {formatMoney(Number(i.amount), i.currency as string)}
                              </td>
                            </tr>
                          ))}
                        </DataTable>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ),
          },
          {
            id: 'deployment',
            label: 'Infraestructura',
            content: (
              <div className="space-y-4">
                <Card title="Dónde vive este tenant">
                  <dl className="divide-y divide-border">
                    {[
                      ['Modelo', DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]],
                      ['Deployment target', t.deployment_target_code ?? 'Sin asignar'],
                      ['Proveedor', t.deployment_provider ?? '—'],
                      ['Región', t.deployment_region ?? '—'],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex justify-between gap-4 px-5 py-2.5 text-body">
                        <dt className="text-muted">{k as string}</dt>
                        <dd className="text-right font-medium">{(v as string) ?? '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>

                <Card title="Solicitudes de provisioning" description="Todo corre en DRY_RUN salvo autorización explícita del operador.">
                  {tenantProvisioning.length === 0 ? (
                    <EmptyState title="Sin solicitudes de provisioning" />
                  ) : (
                    <DataTable columns={['Acción', 'Modo', 'Estado', 'Intentos', 'Creada']}>
                      {tenantProvisioning.map((p) => (
                        <tr key={p.id as string}>
                          <td className="ebim-td font-medium">{p.action as string}</td>
                          <td className="ebim-td"><Badge tone={p.mode === 'DRY_RUN' ? 'info' : 'warn'}>{p.mode as string}</Badge></td>
                          <td className="ebim-td">
                            <Badge tone={p.status === 'SUCCEEDED' ? 'ok' : p.status === 'FAILED' ? 'danger' : 'warn'}>
                              {PROVISIONING_STATUS_LABEL[p.status as keyof typeof PROVISIONING_STATUS_LABEL]}
                            </Badge>
                          </td>
                          <td className="ebim-td tabular-nums">{p.attempts as number}/{p.max_attempts as number}</td>
                          <td className="ebim-td text-compact text-muted">{formatDateTime(p.created_at as string)}</td>
                        </tr>
                      ))}
                    </DataTable>
                  )}
                </Card>
              </div>
            ),
          },
          {
            id: 'products',
            label: 'Productos / Provisioning',
            content: (
              <Card
                title="Alta en los productos de la suite"
                description="Estado del tenant DENTRO de cada SaaS. MasterAdmin muestra los identificadores que devolvió cada producto; no muestra sus datos operativos ni los interpreta."
              >
                {(productProvisioning.data ?? []).length === 0 ? (
                  <EmptyState
                    title="Sin altas registradas en ningún producto"
                    description="Crear una cotización no aprovisiona: la política por defecto es manual hasta certificar el contrato de cada producto."
                    action={
                      <Link to="/saas-provisioning" className="ebim-btn-secondary">
                        Ir a provisioning SaaS
                      </Link>
                    }
                  />
                ) : (
                  <DataTable
                    columns={['Producto', 'Estado', 'Ambiente', 'Destino', 'ID en el producto', 'Provisionado']}
                  >
                    {(productProvisioning.data ?? []).map((r) => (
                      <tr key={r.id as string}>
                        <td className="ebim-td font-medium">{r.product_short_name as string}</td>
                        <td className="ebim-td">
                          <Badge tone={provisioningStatusTone(r.status as SaasProvisioningStatus)}>
                            {SAAS_PROVISIONING_STATUS_LABEL[r.status as SaasProvisioningStatus]}
                          </Badge>
                        </td>
                        <td className="ebim-td">
                          {
                            PROVISIONING_ENVIRONMENT_LABEL[
                              r.provisioning_environment as ProvisioningEnvironment
                            ]
                          }
                        </td>
                        <td className="ebim-td font-mono text-compact">
                          {(r.deployment_code as string) ?? '—'}
                        </td>
                        <td className="ebim-td font-mono text-compact">
                          {(r.external_tenant_id as string) ?? (
                            <span className="text-muted">todavía sin ID</span>
                          )}
                        </td>
                        <td className="ebim-td text-compact text-muted">
                          {r.completed_at ? formatDateTime(r.completed_at as string) : '—'}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'features',
            label: 'Features',
            content: (
              <Card description="`source` explica POR QUÉ está encendido: por plan, por addon contratado o por decisión manual.">
                {(features.data ?? []).length === 0 ? (
                  <EmptyState title="Sin feature flags" description="Este tenant usa la configuración por defecto del plan." />
                ) : (
                  <DataTable columns={['Flag', 'Origen', 'Estado', 'Actualizado']}>
                    {(features.data ?? []).map((f) => (
                      <tr key={f.feature_key}>
                        <td className="ebim-td font-mono text-[13px] font-semibold">{f.feature_key}</td>
                        <td className="ebim-td">
                          <Badge tone={f.source === 'ADDON' ? 'accent' : f.source === 'PLAN' ? 'info' : 'warn'}>
                            {f.source}
                          </Badge>
                        </td>
                        <td className="ebim-td">
                          <Badge tone={f.enabled ? 'ok' : 'neutral'}>{f.enabled ? 'Activo' : 'Inactivo'}</Badge>
                        </td>
                        <td className="ebim-td text-compact text-muted">{formatDateTime(f.updated_at)}</td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'addons',
            label: 'Add-ons y entitlements',
            content: (
              <TenantAddonsPanel
                tenantId={t.tenant_id as string}
                saasProductId={(t.saas_product_id as string | null) ?? null}
              />
            ),
          },
          {
            id: 'usage',
            label: 'Uso y créditos',
            content: <TenantUsagePanel tenantId={t.tenant_id as string} />,
          },
          {
            id: 'costs',
            label: 'Costos y margen',
            hidden: !showFinance,
            content: (
              <Card title="Rentabilidad del tenant" description="Margen bruto = cobrado − costo − comisión, una fila por moneda (nunca se mezclan).">
                {tenantMargins.length > 0 ? (
                  <DataTable
                    label="Margen por moneda"
                    columns={[
                      'Moneda',
                      { label: 'MRR', align: 'right' },
                      { label: 'Ingreso cobrado', align: 'right' },
                      { label: 'Costo directo', align: 'right' },
                      { label: 'Margen bruto', align: 'right' },
                    ]}
                  >
                    {tenantMargins.map((m) => (
                      <tr key={m.currency}>
                        <td className="ebim-td font-semibold">{m.currency}</td>
                        <td className="ebim-td ebim-num">{formatMoney(Number(m.mrr), m.currency)}</td>
                        <td className="ebim-td ebim-num">{formatMoney(Number(m.collected_revenue), m.currency)}</td>
                        <td className="ebim-td ebim-num">{formatMoney(Number(m.direct_cost), m.currency)}</td>
                        <td className={`ebim-td ebim-num font-semibold ${Number(m.gross_margin) < 0 ? 'text-danger' : ''}`}>
                          {formatMoney(Number(m.gross_margin), m.currency)}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                ) : (
                  <EmptyState title="Sin datos de margen para este tenant" />
                )}
              </Card>
            ),
          },
          {
            id: 'audit',
            label: 'Auditoría',
            content: (
              <Card description="Bitácora append-only: no se puede editar ni borrar, ni desde la consola ni por PATCH directo.">
                {tenantAudit.length === 0 ? (
                  <EmptyState title="Sin eventos registrados para este tenant" />
                ) : (
                  <DataTable columns={['Fecha', 'Actor', 'Acción', 'Entidad']}>
                    {tenantAudit.map((a) => (
                      <tr key={a.id as unknown as string}>
                        <td className="ebim-td text-compact text-muted">{formatDateTime(a.occurred_at)}</td>
                        <td className="ebim-td">{a.actor_email ?? '—'}</td>
                        <td className="ebim-td font-semibold">{a.action}</td>
                        <td className="ebim-td text-muted">{a.entity_type}</td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction === 'SUSPEND' ? '¿Suspender este tenant?' : '¿Reactivar este tenant?'}
        message={
          pendingAction === 'SUSPEND'
            ? 'Cambia el estado COMERCIAL a «Suspendido» en el Control Plane y encola una orden SUSPEND_TENANT en simulación (DRY_RUN): no se apaga el acceso en los productos. El motivo queda en auditoría.'
            : 'Cambia el estado COMERCIAL a «Activo» en el Control Plane y encola una orden RESUME_TENANT en simulación (DRY_RUN).'
        }
        confirmLabel={pendingAction === 'SUSPEND' ? 'Suspender (comercial)' : 'Reactivar (comercial)'}
        busy={suspend.isPending || resume.isPending}
        tone={pendingAction === 'SUSPEND' ? 'danger' : 'primary'}
        onConfirm={applyAction}
        onCancel={() => setPendingAction(null)}
      />
    </PageContainer>
  );
}
