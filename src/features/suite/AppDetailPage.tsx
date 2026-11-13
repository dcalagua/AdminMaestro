import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SectionTabs } from '@/components/ui/SectionTabs';
import {
  Badge, Card, DataTable, EmptyState, ErrorState, LoadingState, PageContainer,
} from '@/components/ui/primitives';
import { Avatar } from '@/components/ui/Avatar';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { useSaasProvisioningEventsForRequests } from '@/services/queries';
import { formatDateTime } from '@/lib/format';
import {
  SAAS_PROVISIONING_STATUS_LABEL,
  provisioningStatusTone,
  type SaasProvisioningStatus,
} from '@/lib/provisioning';
import { SUBSCRIPTION_STATUS_LABEL } from '@/features/billing/subscriptionLabels';
import { EnvironmentHealthList, HealthDot, HealthText } from '@/features/platform/EnvironmentHealth';
import { RevealSecretRefButton } from '@/features/platform/RevealSecretRef';
import { environmentLabel, observedHealth, summarizeByEnvironment } from '@/features/platform/targetHealth';
import { LastCheck } from './SuiteHealthStrip';
import { AppSummaryBar, ChannelBadges } from './AppSummaryBar';
import { useHealthCheck, useSuiteData } from './useSuiteData';
import { ATTENTION_KINDS, CELL, isStale, moduleState, type ChannelKey, type MatrixTenant } from './suiteModel';

/** Fila etiqueta/valor de las fichas de configuración. */
function Row({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="w-56 shrink-0 text-micro text-muted">{label}</span>
      <div className="min-w-0 flex-1 break-words text-body text-fg">
        {value}
        {hint ? <p className="mt-0.5 text-caption text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}

const Mono = ({ children }: { children: ReactNode }) => <span className="break-all font-mono text-compact">{children}</span>;
const NOT_SET = <span className="text-muted">Sin configurar</span>;

/** Canal apagado: lo que falta y dónde se mira cuando se encienda. */
function ChannelOff({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <EmptyState title={title} description={description} illustration="none" />
    </Card>
  );
}

/**
 * Ficha de app (V5 · F2): todo lo de UNA app de la suite en un lugar, en vez de
 * repartido entre Integraciones, Entornos, Altas, Módulos y Uso.
 *
 * Conexión muestra endpoints, emisor, audiencia y scopes; de la llave sólo se
 * sabe si su referencia está configurada. El NOMBRE de la referencia se revela
 * con `platform.credentials.manage` (auditado) y el valor nunca llega aquí.
 */
export function AppDetailPage() {
  const { productCode } = useParams<{ productCode: string }>();
  const data = useSuiteData();
  const access = useProvisioningAccess();
  const check = useHealthCheck();

  const app = data.apps.find((a) => a.code === productCode) ?? null;
  const health = app ? data.health.find((h) => h.app.id === app.id) : undefined;
  const integration = app ? (data.integrationRows.find((i) => i.saas_product_id === app.id) ?? null) : null;
  const requests = useMemo(
    () => (app ? data.requestRows.filter((r) => r.saas_product_id === app.id) : []),
    [app, data.requestRows],
  );
  const requestIds = useMemo(() => requests.map((r) => r.id).filter((id): id is string => Boolean(id)), [requests]);
  const events = useSaasProvisioningEventsForRequests(requestIds);

  const tenants = useMemo(() => {
    if (!app) return [] as Array<MatrixTenant & { organizationId: string; organizationName: string }>;
    return data.matrix.flatMap((row) =>
      (row.cells[app.id]?.tenants ?? []).map((t) => ({ ...t, organizationId: row.organizationId, organizationName: row.organizationName })),
    );
  }, [app, data.matrix]);

  if (data.loading.health || data.loading.matrix) return <LoadingState variant="page" />;
  if (data.error.health) return <ErrorState error={data.error.health} onRetry={data.refetch.health} />;
  if (!app || !health) {
    return (
      <PageContainer title="App no encontrada">
        <Card>
          <EmptyState
            title="No existe o no tienes acceso"
            description="La app no está en la suite o tu perfil no la ve."
            action={
              <Link to="/suite" className="ebim-btn-secondary">
                Volver al Centro de la suite
              </Link>
            }
          />
        </Card>
      </PageContainer>
    );
  }

  const channel = (key: ChannelKey) => health.channels.find((c) => c.key === key)!;
  const canCheck = access.canForProduct('platform.deployment.read', app.id);
  const canManageCredentials = access.canForProduct('platform.credentials.manage', app.id);
  const byKind = (pred: (t: MatrixTenant) => boolean) => tenants.filter(pred).length;
  const productSync = data.syncRows.filter((s) => s.saas_product_id === app.id);
  const requestById = new Map(requests.map((r) => [r.id, r]));

  return (
    <PageContainer
      title={app.name}
      description="Salud, tenants, conexión, módulos, uso e historial de altas de esta app."
      leading={<Avatar name={app.name} size="lg" ringColor={app.accent} />}
      meta={
        <span>
          {health.primary ? environmentLabel(health.environment) : 'Sin destino'}
          {health.contractVersion ? ` · contrato de alta ${health.contractVersion}` : ''}
        </span>
      }
      actions={
        canCheck && health.primary?.deployment_target_id ? (
          <button
            type="button"
            className="ebim-btn-secondary"
            disabled={check.isRunning(health.primary.deployment_target_id)}
            onClick={() => void check.run(health.primary!.deployment_target_id!, app.name, app.code)}
          >
            {check.isRunning(health.primary.deployment_target_id) ? 'Verificando…' : 'Verificar ahora'}
          </button>
        ) : null
      }
    >
      <AppSummaryBar
        appId={app.id}
        appCode={app.code}
        health={health.health}
        total={tenants.length}
        active={byKind((t) => t.kind === 'ACTIVE')}
        pendingConfirm={byKind((t) => t.kind === 'PENDING_CONFIRM')}
        attention={byKind((t) => ATTENTION_KINDS.has(t.kind))}
        finance={data.finance}
        tenantRows={data.tenantRows}
      />
      <SectionTabs
        tabs={[
          {
            id: 'resumen',
            label: 'Resumen',
            content: (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card
                    title="Salud por entorno"
                    description="Última comprobación guardada de cada entorno; no es monitoreo en tiempo real."
                  >
                    <div className="flex flex-col gap-3 p-4">
                      <EnvironmentHealthList summaries={summarizeByEnvironment(health.targets)} />
                      {health.primary ? <LastCheck at={health.checkedAt} stale={health.stale} /> : null}
                    </div>
                  </Card>
                  <Card title="Canales con la app" description="Qué intercambia hoy el Admin Maestro con esta app; el detalle de cada canal, al pasar el puntero.">
                    <div className="p-4">
                      <ChannelBadges channels={health.channels} />
                    </div>
                  </Card>
                </div>
              </>
            ),
          },
          {
            id: 'tenants',
            label: 'Tenants',
            count: tenants.length,
            content: (
              <Card>
                {tenants.length === 0 ? (
                  <EmptyState title="Sin tenants" description="Ninguna cuenta visible para tu perfil tiene un tenant en esta app." />
                ) : (
                  <DataTable
                    label={`Tenants de ${app.name}`}
                    columns={['Tenant', 'Cuenta', 'Estado', 'Alta en la app', ...(data.finance ? ['Contrato'] : []), 'Módulos']}
                  >
                    {tenants.map((t) => (
                      <tr key={t.tenantId} data-tenant={t.tenantId}>
                        <td className="ebim-td">
                          <Link to={`/tenants/${t.tenantId}`} className="font-semibold text-fg hover:text-accent-deep hover:underline">
                            {t.tenantName}
                          </Link>
                        </td>
                        <td className="ebim-td">
                          <Link to={`/organizations/${t.organizationId}`} className="ebim-link">
                            {t.organizationName}
                          </Link>
                        </td>
                        <td className="ebim-td">
                          <Badge tone={CELL[t.kind].tone} dot>
                            {CELL[t.kind].short}
                          </Badge>
                          {t.kind === 'PENDING_CONFIRM' ? (
                            <p className="mt-1 text-caption text-muted">Activo en la app · pendiente de confirmar en el Admin Maestro</p>
                          ) : null}
                        </td>
                        <td className="ebim-td text-compact">{t.requestStatusLabel ?? <span className="text-muted">Sin alta</span>}</td>
                        {data.finance ? (
                          <td className="ebim-td text-compact">
                            {t.subscriptionStatus ? SUBSCRIPTION_STATUS_LABEL[t.subscriptionStatus] ?? t.subscriptionStatus : <span className="text-muted">Sin contrato</span>}
                          </td>
                        ) : null}
                        <td className="ebim-td text-compact text-muted">{moduleState(channel('modulos').active, t.moduleSync).label}</td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'conexion',
            label: 'Conexión',
            content: (
              <div className="flex flex-col gap-4">
                <Card
                  title="Contrato de alta"
                  description="Rutas relativas a la URL de cada entorno. La configuración se edita en la ficha de integración."
                  actions={
                    integration ? (
                      <Link to={`/integrations/${integration.id}`} className="ebim-btn-ghost ebim-btn-sm">
                        Ficha de integración
                      </Link>
                    ) : null
                  }
                >
                  <div className="px-5 pb-2">
                    {integration ? (
                      <>
                        <Row label="Versión del contrato" value={<Mono>{integration.contract_version}</Mono>} />
                        <Row label="Ruta de alta" value={integration.create_path_template ? <Mono>{integration.create_path_template}</Mono> : NOT_SET} />
                        <Row label="Ruta de consulta" value={integration.status_path_template ? <Mono>{integration.status_path_template}</Mono> : NOT_SET} />
                        <Row
                          label="Ruta de salud"
                          value={
                            integration.health_path_template ? (
                              <Mono>{integration.health_path_template}</Mono>
                            ) : (
                              <span className="text-muted">La app no expone salud: queda «Sin verificar»</span>
                            )
                          }
                        />
                        <Row label="Ruta de módulos" value={integration.entitlements_path ? <Mono>{integration.entitlements_path}</Mono> : NOT_SET} />
                      </>
                    ) : (
                      <p className="py-6 text-body text-muted">La app no tiene conexión configurada con el Admin Maestro.</p>
                    )}
                  </div>
                </Card>
                {health.targets.length === 0 ? (
                  <ChannelOff title="Sin entornos" description="La app no tiene destinos configurados en ningún entorno." />
                ) : (
                  health.targets.map((t) => (
                    <Card
                      key={t.deployment_target_id ?? t.code}
                      title={`Entorno ${environmentLabel(t.provisioning_environment)}`}
                      description={t.code ?? undefined}
                    >
                      <div className="px-5 pb-2" data-connection={t.provisioning_environment ?? ''}>
                        <Row
                          label="Salud observada"
                          value={
                            <span className="inline-flex flex-wrap items-center gap-2">
                              <HealthDot health={observedHealth(t)} />
                              <HealthText health={observedHealth(t)} />
                              {t.health_checked_at ? <LastCheck at={t.health_checked_at} stale={isStale(t.health_checked_at)} /> : null}
                            </span>
                          }
                        />
                        <Row label="URL base" value={t.base_url ? <Mono>{t.base_url}</Mono> : <span className="text-muted">No aplica</span>} />
                        <Row label="Emisor" value={t.issuer ? <Mono>{t.issuer}</Mono> : NOT_SET} hint="Quién firma el token: el Admin Maestro." />
                        <Row label="Audiencia" value={t.audience ? <Mono>{t.audience}</Mono> : NOT_SET} hint="Para quién es el token: cada app tiene la suya." />
                        <Row
                          label="Permisos"
                          value={
                            t.create_scope || t.read_scope ? (
                              <Mono>{[t.create_scope, t.read_scope].filter(Boolean).join(' ')}</Mono>
                            ) : (
                              NOT_SET
                            )
                          }
                          hint="Alcance del token de alta y de consulta."
                        />
                        <Row
                          label="Llave de firma"
                          value={
                            <span className="flex flex-wrap items-center gap-2">
                              {t.credential_profile_code ? <Mono>{t.credential_profile_code}</Mono> : NOT_SET}
                              {t.credential_secret_configured ? (
                                <Badge tone="ok">Referencia configurada</Badge>
                              ) : (
                                <Badge tone="warn">Sin referencia</Badge>
                              )}
                              {canManageCredentials && t.credential_profile_id ? (
                                <RevealSecretRefButton profileId={t.credential_profile_id} code={t.credential_profile_code ?? ''} />
                              ) : null}
                            </span>
                          }
                          hint="El valor de la llave vive en el servidor y nunca llega a la consola."
                        />
                        <Row label="Tiempo de espera" value={`${t.timeout_ms ?? '—'} ms · ${t.retry_count ?? 0} reintentos`} />
                        {canCheck && t.deployment_target_id ? (
                          <div className="py-3">
                            <button
                              type="button"
                              className="ebim-btn-secondary ebim-btn-sm"
                              disabled={check.isRunning(t.deployment_target_id)}
                              onClick={() => void check.run(t.deployment_target_id!, `${app.name} ${environmentLabel(t.provisioning_environment)}`, app.code)}
                            >
                              Verificar este entorno
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </Card>
                  ))
                )}
              </div>
            ),
          },
          {
            id: 'sincronizacion',
            label: 'Sincronización',
            content: !channel('modulos').active ? (
              <ChannelOff title="Canal de módulos no activo" description={channel('modulos').detail} />
            ) : (
              <Card
                title="Módulos habilitados por tenant"
                description="Lo que el Admin Maestro emitió frente a lo que la app confirma tener."
                actions={
                  <Link to="/apps?tab=sincronizacion" className="ebim-btn-ghost ebim-btn-sm">
                    Sincronizar
                  </Link>
                }
              >
                {productSync.length === 0 ? (
                  <EmptyState title="Sin tenants inscritos" description="Ningún tenant de esta app recibe todavía sus módulos." illustration="none" />
                ) : (
                  <DataTable label="Sincronización de módulos" columns={['Tenant', 'Estado', 'Emitida', 'Aplicada', 'Último envío']}>
                    {productSync.map((s) => (
                      <tr key={s.tenant_id}>
                        <td className="ebim-td">{s.tenant_name}</td>
                        <td className="ebim-td">
                          <Badge tone={moduleState(true, s).tone}>{moduleState(true, s).label}</Badge>
                        </td>
                        <td className="ebim-td tabular-nums">{s.desired_version ?? '—'}</td>
                        <td className="ebim-td tabular-nums">{s.applied_version ?? '—'}</td>
                        <td className="ebim-td text-caption text-muted">{s.last_push_at ? formatDateTime(s.last_push_at) : '—'}</td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'uso',
            label: 'Uso',
            content: !channel('uso').active ? (
              <ChannelOff title="Canal de uso no activo" description={channel('uso').detail} />
            ) : (
              <Card>
                <EmptyState
                  title="La app reporta consumo"
                  description="Los medidores, agregados y rechazos están en Apps › Uso."
                  illustration="none"
                  action={
                    <Link to="/apps?tab=uso" className="ebim-btn-secondary">
                      Ver el uso
                    </Link>
                  }
                />
              </Card>
            ),
          },
          {
            id: 'historial',
            label: 'Historial',
            content: (
              <Card title="Historial de altas" description="Cada paso de las altas de esta app, del más reciente al más antiguo.">
                {requestIds.length === 0 ? (
                  <EmptyState title="Sin altas" description="Todavía no se pidió ninguna alta en esta app." illustration="none" />
                ) : events.isLoading ? (
                  <LoadingState label="Leyendo el historial…" />
                ) : events.error ? (
                  <ErrorState error={events.error} onRetry={() => void events.refetch()} />
                ) : (events.data ?? []).length === 0 ? (
                  <EmptyState title="Sin eventos" description="Las altas de esta app no tienen eventos registrados." illustration="none" />
                ) : (
                  <DataTable label={`Historial de altas de ${app.name}`} columns={['Fecha', 'Tenant', 'Qué pasó', 'Estado']}>
                    {(events.data ?? []).map((e) => {
                      const req = requestById.get(e.saas_provisioning_request_id);
                      const status = e.status as SaasProvisioningStatus;
                      return (
                        <tr key={e.id}>
                          <td className="ebim-td whitespace-nowrap text-caption text-muted">{formatDateTime(e.occurred_at)}</td>
                          <td className="ebim-td">
                            {req?.tenant_id ? (
                              <Link to={`/tenants/${req.tenant_id}`} className="ebim-link">
                                {req.tenant_name ?? '—'}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="ebim-td text-compact" title={e.action}>
                            {e.message}
                            {e.attempt ? <span className="text-caption text-muted"> · intento {e.attempt}</span> : null}
                          </td>
                          <td className="ebim-td">
                            <Badge tone={provisioningStatusTone(status)}>{SAAS_PROVISIONING_STATUS_LABEL[status] ?? status}</Badge>
                          </td>
                        </tr>
                      );
                    })}
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
