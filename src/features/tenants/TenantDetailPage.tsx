import { Link, useParams } from 'react-router-dom';
import {
  useTenant, useTenantFeatures, useTenantAttributions, useSubscriptions,
  useTenantMargin, useProvisioningRequests, useAuditLogs,
} from '@/services/queries';
import { useAuth } from '@/hooks/useAuth';
import { isFinance, canManagePlatform } from '@/features/auth/session';
import { SectionTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatMoney, formatDate, formatDateTime } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL, TENANT_STATUS_LABEL, PROVISIONING_STATUS_LABEL } from '@/types/domain';

/**
 * Detalle de tenant en pestañas administrativas (prompt fase 9).
 *
 * Lo que NO aparece aquí, deliberadamente: proveedores, órdenes, inventario,
 * documentos. El Control Plane administra metadatos y gobierno; los datos
 * operativos viven en el proyecto Supabase de cada app (contrato §7).
 */
export function TenantDetailPage() {
  const { tenantId } = useParams();
  const { roles } = useAuth();
  const tenant = useTenant(tenantId);
  const features = useTenantFeatures(tenantId);
  const attributions = useTenantAttributions(tenantId);
  const subscriptions = useSubscriptions();
  const margins = useTenantMargin();
  const provisioning = useProvisioningRequests();
  const audit = useAuditLogs();

  if (tenant.isLoading) return <LoadingState />;
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
  const tenantSubs = (subscriptions.data ?? []).filter((s) => s.tenant_id === tenantId);
  const margin = (margins.data ?? []).find((m) => m.tenant_id === tenantId);
  const tenantProvisioning = (provisioning.data ?? []).filter((p) => p.tenant_id === tenantId);
  const tenantAudit = (audit.data ?? []).filter((a) => a.tenant_id === tenantId);

  const showFinance = isFinance(roles) || canManagePlatform(roles);

  return (
    <PageContainer
      title={t.name as string}
      description={`${t.product_lockup} · ${t.customer_name}${t.managing_name ? ` · administrado por ${t.managing_name}` : ' · venta directa EBIM'}`}
      breadcrumbs={<Link className="text-xs text-muted hover:text-fg" to="/tenants">← Tenants</Link>}
      actions={
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={t.tenant_type === 'PRODUCTION' ? 'ok' : 'info'}>
            {TENANT_TYPE_LABEL[t.tenant_type as keyof typeof TENANT_TYPE_LABEL]}
          </Badge>
          <Badge tone="accent">
            {DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}
          </Badge>
          <Badge tone={t.status === 'ACTIVE' ? 'ok' : 'warn'}>
            {TENANT_STATUS_LABEL[t.status as keyof typeof TENANT_STATUS_LABEL]}
          </Badge>
        </div>
      }
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label="MRR" value={formatMoney(Number(t.mrr), (t.currency as string) ?? 'USD')} tone="ok" />
        <StatCard label="Plan" value={(t.plan_name as string) ?? 'Sin plan'} />
        <StatCard label="Infraestructura" value={(t.deployment_target_code as string) ?? 'Sin asignar'} hint={(t.deployment_region as string) ?? undefined} />
        <StatCard
          label="Administrador"
          value={t.admin_activated_at ? 'Activado' : 'Sin activar'}
          tone={t.admin_activated_at ? 'ok' : 'warn'}
          hint={t.admin_email as string}
        />
      </div>

      <SectionTabs
        tabs={[
          {
            id: 'overview',
            label: 'Resumen',
            content: (
              <Card title="Datos del tenant">
                <dl className="divide-y divide-border">
                  {[
                    ['Slug', t.slug],
                    ['Producto', t.product_lockup],
                    ['Organización cliente', t.customer_name],
                    ['Organización que administra', t.managing_name ?? 'Ninguna (venta directa EBIM)'],
                    ['Tipo', TENANT_TYPE_LABEL[t.tenant_type as keyof typeof TENANT_TYPE_LABEL]],
                    ['Entorno', t.environment],
                    ['Modelo de despliegue', DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]],
                    ['Correo del administrador', t.admin_email],
                    ['Administrador activado', t.admin_activated_at ? formatDateTime(t.admin_activated_at as string) : 'Pendiente de activar'],
                    ['Creado', formatDateTime(t.created_at as string)],
                    ['Activado', t.activated_at ? formatDateTime(t.activated_at as string) : '—'],
                  ].map(([k, v]) => (
                    <div key={k as string} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                      <dt className="text-muted">{k as string}</dt>
                      <dd className="text-right font-medium">{(v as string) ?? '—'}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
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
                  <DataTable columns={['Comercial', 'Tipo', 'Participación', 'Plan de comisión', 'Origen', 'Vigencia']}>
                    {(attributions.data ?? []).map((a) => (
                      <tr key={a.id as string}>
                        <td className="ebim-td font-semibold">
                          {(a.sales_agents as { full_name: string } | null)?.full_name}
                        </td>
                        <td className="ebim-td">
                          <Badge tone="info">{(a.sales_agents as { agent_type: string } | null)?.agent_type}</Badge>
                        </td>
                        <td className="ebim-td tabular-nums">{(Number(a.attribution_pct) * 100).toFixed(0)}%</td>
                        <td className="ebim-td">{(a.commission_plans as { name: string } | null)?.name ?? '—'}</td>
                        <td className="ebim-td text-muted">{a.source as string}</td>
                        <td className="ebim-td text-xs text-muted">
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
                            <span className="font-semibold">{s.code}</span>
                            <span className="ml-2 text-sm text-muted">
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
                      <div key={k as string} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
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
                          <td className="ebim-td text-xs text-muted">{formatDateTime(p.created_at as string)}</td>
                        </tr>
                      ))}
                    </DataTable>
                  )}
                </Card>
              </div>
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
                        <td className="ebim-td text-xs text-muted">{formatDateTime(f.updated_at)}</td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'costs',
            label: 'Costos y margen',
            hidden: !showFinance,
            content: (
              <Card title="Rentabilidad del tenant">
                {margin ? (
                  <div className="grid gap-3 p-4 sm:grid-cols-4">
                    <StatCard label="MRR" value={formatMoney(Number(margin.mrr), margin.currency ?? 'USD')} />
                    <StatCard label="Ingreso cobrado" value={formatMoney(Number(margin.collected_revenue), margin.currency ?? 'USD')} />
                    <StatCard label="Costo directo" value={formatMoney(Number(margin.direct_cost), margin.currency ?? 'USD')} tone="warn" />
                    <StatCard
                      label="Margen bruto"
                      value={formatMoney(Number(margin.gross_margin), margin.currency ?? 'USD')}
                      tone={Number(margin.gross_margin) >= 0 ? 'ok' : 'danger'}
                      hint="cobrado − costo − comisión"
                    />
                  </div>
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
                        <td className="ebim-td text-xs text-muted">{formatDateTime(a.occurred_at)}</td>
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
    </PageContainer>
  );
}
