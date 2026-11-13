import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  useTenant, useTenantFeatures, useTenantAttributions, useTenantProductMappings, useProvisioningTargets,
} from '@/services/queries';
import { useTenantAudit, useTenantInfraRequests, useTenantMarginRows, useTenantRenewals, useTenantSubscriptions } from './tenantQueries';
import { useAccountSeries } from '@/services/queries';
import { Avatar } from '@/components/ui/Avatar';
import { AccountTrendCharts } from '@/features/organizations/AccountPanels';
import { currentMrrByCurrency } from '@/features/organizations/account360Model';
import { accountHealth } from '@/features/organizations/accountSeriesModel';
import { AGENT_TYPE_LABEL, SOURCE_LABEL } from '@/features/commercial/commercialLabels';
import { tenantDimensions } from './tenantDimensions';
import { TenantDimensionsView } from './TenantDimensionsView';
import { TenantAddonsPanel } from './TenantAddonsPanel';
import { TenantUsagePanel } from './TenantUsagePanel';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { isFinance, canManagePlatform } from '@/features/auth/session';
import { hasFinanceView } from '@/app/navigation';
import { DetailTabs } from '@/components/ui/DetailTabs';
import { MailActivityCard } from '@/features/mail/MailActivity';
import { AccountUsersCard } from '@/features/organizations/Account360';
import { useUserAdminScope } from '@/features/users/useUserAdminScope';
import { PROVISIONING_ACTION_LABEL } from '@/features/deployments/provisioningLabels';
import { accountApps, type ProvisioningRow, type TenantRow } from '@/features/suite/suiteModel';
import { ConfirmActiveButton, PENDING_CONFIRM_EXPLANATION, PendingConfirmNotice } from '@/features/suite/ConfirmActive';
import { useConfirmActive } from '@/features/suite/useConfirmActive';
import { LifecycleDialog } from '@/features/suite/LifecycleDialog';
import { TenantHeader } from './TenantHeader';
import { DetailFacts } from '@/components/ui/DetailFacts';
import {
  PageContainer, Card, DataTable, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatMoney, formatDate, formatDateTime } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL, PROVISIONING_STATUS_LABEL } from '@/types/domain';
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

/** Origen de una función habilitada, en español. */
const FEATURE_SOURCE_LABEL: Record<string, string> = {
  PLAN: 'Plan',
  ADDON: 'Add-on',
  MANUAL: 'Manual',
};

/** Pestañas anteriores a la V5 (`#hash`) → su nueva casa; el nombre viejo queda como ancla. */
const TENANT_LEGACY_TABS: Record<string, string> = {
  overview: 'resumen',
  products: 'app',
  features: 'app',
  usage: 'app',
  deployment: 'app',
  subscription: 'contrato',
  addons: 'contrato',
  costs: 'contrato',
  commercial: 'personas',
  audit: 'actividad',
};

/**
 * Tenant 360 (P31, spec §11.2 → V5 · F3): cuatro dimensiones visibles — comercial, alta
 * técnica, salud observada y acceso del administrador — sin semáforo global.
 * Cambiar el estado comercial NO afirma una suspensión en los productos: la
 * orden al producto se encola en DRY_RUN y así se dice.
 *
 * V5 · F3: cabecera fija (app, cuenta, estado aquí, estado en la app y modo)
 * y cinco pestañas con `?tab=`: Resumen · App y alta · Contrato · Personas ·
 * Actividad. Si la app ya confirmó el alta y aquí sigue «Pendiente», se avisa
 * con la misma acción «Confirmar como activo» del Centro de la suite.
 *
 * Todas las lecturas van acotadas a ESTE tenant en el servidor.
 *
 * Lo que NO aparece aquí, deliberadamente: proveedores, órdenes, inventario,
 * documentos. El Control Plane administra metadatos y gobierno; los datos
 * operativos viven en el proyecto Supabase de cada app (contrato §7).
 */
export function TenantDetailPage() {
  const { tenantId } = useParams();
  const { roles, persona } = useAuth();
  const location = useLocation();
  const confirmActive = useConfirmActive();
  const userScope = useUserAdminScope();
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
  const [pendingAction, setPendingAction] = useState<'SUSPEND' | 'RESUME' | null>(null);

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
  const showFinanceView = hasFinanceView(persona, roles);
  // Estado combinado en su app: el MISMO modelo del Centro de la suite.
  const appState =
    accountApps(
      (t.customer_organization_id as string) ?? '',
      [t as TenantRow],
      (productProvisioning.data ?? []) as ProvisioningRow[],
    )[0]?.primary ?? null;

  return (
    <PageContainer
      title={t.name as string}
      leading={<Avatar name={(t.customer_name as string) ?? (t.name as string)} size="lg" />}
      description={t.managing_name ? `Administrado por ${t.managing_name}` : 'Venta directa EBIM'}
      meta={t.market_code ? `Mercado ${t.market_code as string}` : undefined}
      actions={
        perms.canManagePlatform && t.status === 'ACTIVE' ? (
          <button type="button" className="ebim-btn-ghost text-danger" onClick={() => setPendingAction('SUSPEND')}>
            Suspender
          </button>
        ) : perms.canManagePlatform && t.status === 'SUSPENDED' ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setPendingAction('RESUME')}>
            Reactivar
          </button>
        ) : null
      }
    >
      <TenantHeader
        tenant={t}
        appState={appState}
        finance={
          showFinanceView
            ? {
                mrr: { loading: series.isLoading, error: Boolean(series.error), value: currentMrrByCurrency(series.data) },
                health: { loading: renewals.isLoading, error: Boolean(renewals.error), value: accountHealth(renewals.data ?? []) },
              }
            : undefined
        }
      />
      {appState?.kind === 'PENDING_CONFIRM' ? (
        <div className="ebim-card mb-4 overflow-hidden" data-tenant-pending-confirm>
          <PendingConfirmNotice count={1}>
            <ConfirmActiveButton confirm={confirmActive} target={{ tenantId: appState.tenantId, tenantName: appState.tenantName }} />
          </PendingConfirmNotice>
          <p className="px-5 py-3 text-compact text-fg-2">{PENDING_CONFIRM_EXPLANATION}</p>
        </div>
      ) : null}

      {onboarded ? (
        <section className="ebim-card mb-4 border-l-4 border-l-[color:var(--accent-action)] px-5 py-4" aria-labelledby="next-steps-title">
          <h2 id="next-steps-title" className="text-h3 text-fg">Venta registrada: siguientes pasos</h2>
          <p className="mt-1 text-body text-muted">
            Se crearon el tenant, el contrato y la atribución{onboarded.activated ? ' (contrato activo)' : ' (contrato en borrador para revisión)'}. El alta
            dentro del producto es una decisión aparte: nada de lo de abajo la ejecuta.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2 text-body">
            {onboarded.subscriptionId ? (
              <li>
                <Link className="ebim-btn-secondary ebim-btn-sm" to={`/subscriptions/${onboarded.subscriptionId}`}>
                  Revisar el contrato
                </Link>
              </li>
            ) : null}
            <li>
              <Link className="ebim-btn-ghost ebim-btn-sm" to="?tab=app#products">
                Ver estado del alta en el producto
              </Link>
            </li>
            <li>
              <Link className="ebim-btn-ghost ebim-btn-sm" to="/apps?tab=altas">
                Ir a Altas en las apps (decisión manual)
              </Link>
            </li>
          </ul>
        </section>
      ) : null}

      <DetailTabs
        label={`Secciones de ${t.name as string}`}
        legacy={TENANT_LEGACY_TABS}
        tabs={[
          {
            id: 'resumen',
            label: 'Resumen',
            content: (
              <div className="space-y-4">
                <div>
                  {productProvisioning.error ? (
                    <p className="mb-2 text-compact font-semibold text-warn" role="status">
                      No se pudieron leer las altas en las apps: «Alta técnica» y «Acceso administrador» pueden estar incompletos.
                    </p>
                  ) : null}
                  <TenantDimensionsView dims={dims} />
                </div>
                {showFinanceView ? <AccountTrendCharts query={series} subject={t.name as string} /> : null}
                <Card title="Datos del tenant">
                  <DetailFacts
                    items={[
                      ['Código', <span key="slug" className="font-mono text-caption">{t.slug as string}</span>],
                      ['Producto', t.product_lockup as string],
                      ['Organización cliente', t.customer_name as string],
                      ['Organización que administra', (t.managing_name as string) ?? 'Ninguna (venta directa EBIM)'],
                      ['Tipo', TENANT_TYPE_LABEL[t.tenant_type as keyof typeof TENANT_TYPE_LABEL]],
                      ['Entorno', ENVIRONMENT_TEXT[t.environment as string] ?? (t.environment as string)],
                      ['Modelo de despliegue', DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]],
                      ['Correo del administrador', t.admin_email as string],
                      ['Administrador activado', t.admin_activated_at ? formatDateTime(t.admin_activated_at as string) : 'Pendiente de activar'],
                      ['Creado', formatDateTime(t.created_at as string)],
                      ['Activado', t.activated_at ? formatDateTime(t.activated_at as string) : '—'],
                    ]}
                  />
                </Card>
              </div>
            ),
          },
          {
            id: 'app',
            label: 'App y alta',
            content: (
              <div className="space-y-4">
                <Card
                  id="products"
                  title="Alta en los productos de la suite"
                  description="Estado del tenant DENTRO de cada SaaS. El Admin Maestro muestra los identificadores que devolvió cada producto; no muestra sus datos operativos ni los interpreta."
                >
                  {(productProvisioning.data ?? []).length === 0 ? (
                    <EmptyState
                      title="Sin altas registradas en ningún producto"
                      description="Crear una cotización no aprovisiona: la política por defecto es manual hasta certificar el contrato de cada producto."
                      action={
                        <Link to="/apps?tab=altas" className="ebim-btn-secondary">
                          Ir a Altas en las apps
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

                <Card id="features" title="Funciones habilitadas" description="El origen explica por qué está encendida cada función: por el plan, por un add-on contratado o por decisión manual.">
                  {(features.data ?? []).length === 0 ? (
                    <EmptyState title="Sin funciones configuradas" description="Este tenant usa la configuración por defecto del plan." />
                  ) : (
                    <DataTable columns={['Función', 'Origen', 'Estado', 'Actualizado']}>
                      {(features.data ?? []).map((f) => (
                        <tr key={f.feature_key}>
                          <td className="ebim-td font-mono text-[13px] font-semibold">{f.feature_key}</td>
                          <td className="ebim-td">
                            <Badge tone={f.source === 'ADDON' ? 'accent' : f.source === 'PLAN' ? 'info' : 'warn'}>
                              {FEATURE_SOURCE_LABEL[f.source as string] ?? f.source}
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

                <div id="usage" className="scroll-mt-40">
                  <TenantUsagePanel tenantId={t.tenant_id as string} />
                </div>
                <details
                  id="deployment"
                  className="group scroll-mt-40 rounded-card border border-border bg-card"
                  open={location.hash === '#deployment'}
                  data-advanced
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-compact font-semibold text-fg hover:bg-hover">
                    <span>
                      Avanzado · infraestructura
                      <span className="block text-caption font-normal text-muted">
                        Dónde vive el tenant y su cola de infraestructura. Para soporte técnico.
                      </span>
                    </span>
                    <span className="text-caption font-normal text-accent-deep group-open:hidden">Ver detalle</span>
                    <span className="hidden text-caption font-normal text-accent-deep group-open:inline">Ocultar</span>
                  </summary>
                  <div className="space-y-4 border-t border-border p-4">
                    <Card title="Dónde vive este tenant">
                      <dl className="divide-y divide-border">
                        {[
                          ['Modelo', DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]],
                          ['Destino', t.deployment_target_code ?? 'Sin asignar'],
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

                    <Card title="Solicitudes de infraestructura" description="Todo corre en simulación salvo autorización explícita del operador.">
                      {tenantProvisioning.length === 0 ? (
                        <EmptyState title="Sin solicitudes de infraestructura" />
                      ) : (
                        <DataTable columns={['Acción', 'Modo', 'Estado', 'Intentos', 'Creada']}>
                          {tenantProvisioning.map((p) => (
                            <tr key={p.id as string}>
                              <td className="ebim-td font-medium">{PROVISIONING_ACTION_LABEL[p.action as string] ?? (p.action as string)}</td>
                              <td className="ebim-td"><Badge tone={p.mode === 'DRY_RUN' ? 'info' : 'warn'}>{p.mode === 'DRY_RUN' ? 'Simulación' : 'Real'}</Badge></td>
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
                </details>
              </div>
            ),
          },
          {
            id: 'contrato',
            label: 'Contrato',
            content: (
              <div className="space-y-4">
                <Card id="subscription" title="Contrato">
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

                <div id="addons" className="scroll-mt-40">
                  <TenantAddonsPanel
                    tenantId={t.tenant_id as string}
                    saasProductId={(t.saas_product_id as string | null) ?? null}
                  />
                </div>
                {showFinance ? (
                  <Card id="costs" title="Rentabilidad del tenant" description="Margen bruto = cobrado − costo − comisión, una fila por moneda (nunca se mezclan).">
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
                ) : null}
              </div>
            ),
          },
          {
            id: 'personas',
            label: 'Personas',
            content: (
              <div className="space-y-4">
                <Card id="commercial" title="Atribución comercial" description="Quién se lleva el crédito de esta venta. Estar aquí NO da acceso operacional al tenant.">
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

                <Card id="admin" title="Administrador del tenant" description="Quién recibe el acceso inicial en la app.">
                  <dl className="divide-y divide-border">
                    {[
                      ['Correo del administrador', t.admin_email ?? '—'],
                      ['Administrador activado', t.admin_activated_at ? formatDateTime(t.admin_activated_at as string) : 'Pendiente de activar'],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex justify-between gap-4 px-5 py-2.5 text-body">
                        <dt className="text-muted">{k as string}</dt>
                        <dd className="min-w-0 truncate text-right font-medium">{v as string}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
                {userScope.canView && t.customer_organization_id ? (
                  <AccountUsersCard
                    organizationId={t.customer_organization_id as string}
                    tenantId={t.tenant_id as string}
                    title="Usuarios del tenant"
                  />
                ) : null}
              </div>
            ),
          },
          {
            id: 'actividad',
            label: 'Actividad',
            content: (
              <div className="space-y-6">
                <MailActivityCard tenantId={t.tenant_id as string} />
                <Card id="audit" title="Auditoría del tenant" description="Bitácora append-only: no se puede editar ni borrar, ni desde la consola ni por PATCH directo.">
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
              </div>
            ),
          },
        ]}
      />

      <LifecycleDialog
        open={pendingAction !== null}
        mode={pendingAction ?? 'SUSPEND'}
        subject={t.name as string}
        organizationId={t.customer_organization_id as string | null}
        targets={[
          {
            tenantId: t.tenant_id as string,
            tenantName: t.name as string,
            productName: (t.product_short_name as string) ?? '—',
            tenantStatus: (t.status as string) ?? 'PENDING',
          },
        ]}
        onClose={() => setPendingAction(null)}
      />
      {confirmActive.dialog}
    </PageContainer>
  );
}
