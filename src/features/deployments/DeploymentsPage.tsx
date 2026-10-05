import { useMemo, useState } from 'react';
import { useDeploymentTargets, useProvisioningTargets } from '@/services/queries';
import { useCheckDeploymentHealth } from '@/services/mutations';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import {
  DEPLOYMENT_HEALTH_LABEL,
  DEPLOYMENT_TARGET_STATUS_LABEL,
  PROVISIONING_ENVIRONMENT_LABEL,
  targetStatusTone,
  type DeploymentHealth,
  type DeploymentTargetStatus,
  type ProvisioningEnvironment,
} from '@/lib/provisioning';
import {
  ENVIRONMENT_ORDER,
  isEvaluable,
  notEvaluatedReason,
  observedHealth,
  summarizeByEnvironment,
  type TargetHealthInput,
} from '@/features/platform/targetHealth';
import { HealthDot, HealthText, ObservationDate } from '@/features/platform/EnvironmentHealth';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { KpiStrip } from '@/features/billing/financeUi';
import { formatNumber } from '@/lib/format';
import {
  DeploymentProvisioningDialog,
  type TargetProvisioningDraft,
} from './ProvisioningDialogs';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { Link } from 'react-router-dom';
import {
  PageContainer, Card, DataTable, SearchBar, KpiTile, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import { DeploymentTargetDialog, AttachTenantDialog } from './DeploymentDialogs';
import type { TargetDraft } from './DeploymentDialogs';

const TARGET_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  SUSPENDED: 'Suspendido',
  ARCHIVED: 'Archivado',
};

const ENVIRONMENT_KIND_LABEL: Record<string, string> = {
  DEMO: 'Demo',
  TRIAL: 'Prueba',
  PRODUCTION: 'Producción',
  SANDBOX: 'Sandbox',
};

/**
 * Entornos y despliegues: la infraestructura FÍSICA, desacoplada del tenant lógico.
 *
 * La salud que se ve es la ÚLTIMA OBSERVACIÓN guardada, con su fecha. Abrir la
 * pantalla no verifica nada ni habilita nada: «Verificar conexión» es una acción
 * explícita, y un destino en borrador o deshabilitado se muestra «No evaluado»,
 * no como fallo.
 *
 * Estas filas contienen SÓLO metadata pública (region, project ref). No hay
 * passwords, service_role keys ni PATs: un trigger en la base rechaza cualquier
 * clave JSONB que huela a credencial.
 */
export function DeploymentsPage() {
  const targets = useDeploymentTargets();
  // Eje de PROVISIONING del mismo destino: a qué URL se llama, con qué contrato
  // y con qué credencial. Viene de una vista aparte porque su RLS es distinta —
  // un propietario técnico ve los destinos de SU producto aunque no pertenezca
  // a ninguna de las organizaciones implicadas.
  const provisioning = useProvisioningTargets();
  const perms = usePermissions();
  const access = useProvisioningAccess();
  const toast = useToast();
  const checkHealth = useCheckDeploymentHealth();
  const [provisioningDialog, setProvisioningDialog] = useState<TargetProvisioningDraft | null>(null);

  async function runHealthCheck(targetId: string, code: string) {
    try {
      const result = await checkHealth.mutateAsync(targetId);
      if (result.health === 'HEALTHY') {
        toast.success('Conexión verificada', `${code}: ${result.detail ?? 'respuesta correcta'}`);
      } else if (result.health === 'UNKNOWN') {
        // No se inventa un HEALTHY: si el producto no expone salud, el estado
        // honesto es «sin verificar».
        toast.push('info', 'Sin verificar', result.detail ?? 'El producto no expone ruta de salud');
      } else {
        toast.error(`Destino ${DEPLOYMENT_HEALTH_LABEL[result.health as DeploymentHealth]}`, result.detail ?? '');
      }
    } catch (error) {
      toast.error('No se pudo verificar la conexión', businessErrorMessage(error));
    }
  }
  const [targetDialog, setTargetDialog] = useState<{ open: boolean; target: TargetDraft | null }>({
    open: false,
    target: null,
  });
  const [attachTarget, setAttachTarget] = useState<{ id: string; code: string; mode: string } | null>(
    null,
  );

  const { term, setTerm, filtered } = useSearchFilter(targets.data, (t) => [
    t.code, t.name, t.region, t.provider, t.deployment_mode,
    (t.organizations as { display_name: string } | null)?.display_name,
  ]);

  const [mode, setMode] = useState<string>('ALL');
  const all = targets.data ?? [];
  const byMode = (m: string) => all.filter((t) => t.deployment_mode === m).length;
  const countIn = (m: string) => filtered.filter((t) => m === 'ALL' || t.deployment_mode === m).length;
  const visible = filtered.filter((t) => mode === 'ALL' || t.deployment_mode === mode);
  const provisioningRows = provisioning.data ?? [];

  return (
    <PageContainer
      title="Entornos y despliegues"
      description="Dónde vive físicamente cada tenant y a qué destino se llama en cada entorno. Un destino compartido aloja muchos tenants; uno dedicado de cliente, exactamente uno."
      actions={
        perms.canManagePlatform ? (
          <button
            type="button"
            className="ebim-btn-primary"
            onClick={() => setTargetDialog({ open: true, target: null })}
          >
            Nuevo target
          </button>
        ) : null
      }
    >
      <KpiStrip label="Destinos de despliegue">
        <KpiTile label="Destinos totales" value={targets.isLoading ? null : formatNumber(all.length)} loading={targets.isLoading} />
        <KpiTile
          label="Compartidos"
          value={targets.isLoading ? null : formatNumber(byMode('SHARED'))}
          loading={targets.isLoading}
          footer="Infraestructura de EBIM para muchos tenants."
        />
        <KpiTile label="Dedicados de partner" value={targets.isLoading ? null : formatNumber(byMode('PARTNER_DEDICATED'))} loading={targets.isLoading} />
        <KpiTile label="Dedicados de cliente" value={targets.isLoading ? null : formatNumber(byMode('TENANT_DEDICATED'))} loading={targets.isLoading} />
      </KpiStrip>

      <EnvironmentMatrix rows={provisioningRows} loading={provisioning.isLoading} error={provisioning.error} />

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por código, región, proveedor u organización…"
          right={
            <StatusTabs
              label="Modo de despliegue"
              value={mode}
              onChange={setMode}
              options={[
                { id: 'ALL', label: 'Todos', count: countIn('ALL') },
                { id: 'SHARED', label: 'Compartidos', count: countIn('SHARED') },
                { id: 'PARTNER_DEDICATED', label: 'De partner', count: countIn('PARTNER_DEDICATED') },
                { id: 'TENANT_DEDICATED', label: 'De cliente', count: countIn('TENANT_DEDICATED') },
              ]}
            />
          }
        />
        {targets.isLoading ? (
          <LoadingState />
        ) : targets.error ? (
          <ErrorState error={targets.error} onRetry={() => void targets.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState title="Sin destinos de despliegue" description="No hay destinos visibles para tu perfil o ninguno coincide con la búsqueda." />
        ) : (
          <div className="divide-y divide-border">
            {visible.map((t) => {
              const deployments = ((t.tenant_deployments ?? []) as Array<Record<string, unknown>>).filter(
                (d) => d.status === 'ACTIVE',
              );
              return (
                <div key={t.id} className="min-w-0 px-5 py-4" data-target={t.code}>
                  <div className="mb-3 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="break-all font-mono text-body font-semibold text-fg">{t.code}</span>
                        <Badge tone={t.status === 'ACTIVE' ? 'ok' : 'neutral'} dot>
                          {TARGET_STATUS_LABEL[t.status] ?? t.status}
                        </Badge>
                        <Badge tone="accent">
                          {DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-body text-fg-2">{t.name}</p>
                      <p className="mt-1 flex flex-wrap gap-x-2 text-caption text-muted">
                        <span>
                          {t.owner_organization_id
                            ? `Dueño: ${(t.organizations as { display_name: string } | null)?.display_name}`
                            : 'Infraestructura de EBIM (compartida)'}
                        </span>
                        {t.saas_products ? <span>· {(t.saas_products as { short_name: string }).short_name}</span> : null}
                        <span>· {t.provider}{t.region ? ` ${t.region}` : ''}</span>
                        <span>· {ENVIRONMENT_KIND_LABEL[t.environment] ?? t.environment}</span>
                        {t.cost_center ? <span>· centro de costo {t.cost_center}</span> : null}
                        <span>
                          · ref pública <span className="font-mono">{(t.provider_project_ref as string) ?? '—'}</span>
                        </span>
                      </p>
                    </div>
                    {perms.canManagePlatform ? (
                      <ActionMenu
                        variant="icon"
                        label={`Acciones de ${t.code}`}
                        items={[
                          {
                            label: 'Editar destino',
                            onSelect: () =>
                              setTargetDialog({
                                open: true,
                                target: {
                                  id: t.id,
                                  code: t.code,
                                  name: t.name,
                                  provider: t.provider,
                                  deployment_mode: t.deployment_mode,
                                  environment: t.environment,
                                  region: t.region,
                                  provider_project_ref: t.provider_project_ref,
                                  owner_organization_id: t.owner_organization_id,
                                  saas_product_id: t.saas_product_id,
                                  cost_center: t.cost_center,
                                  status: t.status,
                                },
                              }),
                          },
                          {
                            label: 'Adjuntar tenant',
                            onSelect: () => setAttachTarget({ id: t.id, code: t.code, mode: t.deployment_mode }),
                          },
                        ]}
                      />
                    ) : null}
                  </div>

                  <ProvisioningPanel
                    row={(provisioning.data ?? []).find((p) => p.deployment_target_id === t.id)}
                    canManage={access.canForProduct('platform.deployment.manage', t.saas_product_id)}
                    canCheck={access.canForProduct('platform.deployment.read', t.saas_product_id)}
                    busy={checkHealth.isPending}
                    onConfigure={setProvisioningDialog}
                    onCheck={(id, code) => void runHealthCheck(id, code)}
                  />

                  {deployments.length === 0 ? (
                    <p className="text-caption text-muted">Sin tenants asignados.</p>
                  ) : (
                    <details className="group rounded-card border border-border">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-compact font-semibold text-fg hover:bg-hover">
                        <span>
                          Tenants alojados <span className="font-normal tabular-nums text-muted">{deployments.length}</span>
                        </span>
                        <span className="text-caption font-normal text-accent-deep group-open:hidden">Ver tenants</span>
                        <span className="hidden text-caption font-normal text-accent-deep group-open:inline">Ocultar</span>
                      </summary>
                      <div className="border-t border-border">
                        <DataTable label={`Tenants alojados en ${t.code}`} columns={['Tenant', 'Slug', 'Estado']}>
                          {deployments.map((d) => {
                            const tenant = d.tenants as { name: string; slug: string } | null;
                            return (
                              <tr key={d.tenant_id as string}>
                                <td className="ebim-td">
                                  <Link className="ebim-link" to={`/tenants/${d.tenant_id}`}>
                                    {tenant?.name}
                                  </Link>
                                </td>
                                <td className="ebim-td font-mono text-caption text-muted">{tenant?.slug}</td>
                                <td className="ebim-td text-compact text-muted">
                                  {d.status === 'ACTIVE' ? 'Activo' : (d.status as string)}
                                </td>
                              </tr>
                            );
                          })}
                        </DataTable>
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <DeploymentProvisioningDialog
        open={Boolean(provisioningDialog)}
        target={provisioningDialog}
        onClose={() => setProvisioningDialog(null)}
      />

      <DeploymentTargetDialog
        open={targetDialog.open}
        target={targetDialog.target}
        onClose={() => setTargetDialog({ open: false, target: null })}
      />

      <AttachTenantDialog
        open={Boolean(attachTarget)}
        targetId={attachTarget?.id ?? null}
        targetCode={attachTarget?.code ?? ''}
        targetMode={attachTarget?.mode ?? 'SHARED'}
        onClose={() => setAttachTarget(null)}
      />
    </PageContainer>
  );
}

/**
 * Panel de provisioning de un destino.
 *
 * Distingue visualmente los tres modos porque las preguntas son distintas: un
 * compartido sirve a muchos tenants, uno de partner a los de ese partner, y uno
 * dedicado existe para un solo cliente — y hasta que ese existe, sus solicitudes
 * esperan en «Infraestructura pendiente».
 *
 * No muestra ninguna credencial: sólo si la referencia está configurada.
 */
function ProvisioningPanel({
  row,
  canManage,
  canCheck,
  busy,
  onConfigure,
  onCheck,
}: {
  row: Record<string, unknown> | undefined;
  canManage: boolean;
  canCheck: boolean;
  busy: boolean;
  onConfigure: (draft: TargetProvisioningDraft) => void;
  onCheck: (targetId: string, code: string) => void;
}) {
  if (!row) return null;

  const environment = row.provisioning_environment as ProvisioningEnvironment | null;
  const status = row.provisioning_status as DeploymentTargetStatus;
  const healthInput = row as TargetHealthInput;
  const health = observedHealth(healthInput);
  const evaluable = isEvaluable(healthInput);
  const targetId = row.deployment_target_id as string;
  const code = row.code as string;

  const draft: TargetProvisioningDraft = {
    deployment_target_id: targetId,
    code,
    saas_product_id: row.saas_product_id as string,
    provisioning_environment: (row.provisioning_environment as string) ?? null,
    product_integration_id: (row.product_integration_id as string) ?? null,
    credential_profile_id: (row.credential_profile_id as string) ?? null,
    base_url: (row.base_url as string) ?? null,
    timeout_ms: (row.timeout_ms as number) ?? 15000,
    retry_count: (row.retry_count as number) ?? 2,
    provisioning_status: (row.provisioning_status as string) ?? 'DRAFT',
    provisioning_enabled: Boolean(row.provisioning_enabled),
    effective_provisioning_policy: (row.effective_provisioning_policy as string) ?? null,
  };

  return (
    <div className="mb-3 rounded-card border border-border bg-sunken p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-micro text-muted">Provisioning SaaS</span>
        {environment ? (
          <Badge tone="info">Entorno: {PROVISIONING_ENVIRONMENT_LABEL[environment]}</Badge>
        ) : (
          <Badge tone="neutral">Sin entorno</Badge>
        )}
        {/* Deshabilitado/borrador no es un fallo: tono neutro, nunca rojo. */}
        <Badge tone={status === 'DISABLED' ? 'neutral' : targetStatusTone(status)}>
          {DEPLOYMENT_TARGET_STATUS_LABEL[status]}
        </Badge>
        {row.provisioning_enabled ? (
          <Badge tone="ok">Habilitado</Badge>
        ) : (
          <Badge tone="neutral">Deshabilitado</Badge>
        )}
        <span className="inline-flex items-center gap-1.5 text-compact">
          <HealthDot health={health} />
          <HealthText health={health} />
        </span>
        <span className="text-caption">
          {evaluable ? (
            <ObservationDate at={row.health_checked_at as string | null} />
          ) : (
            <span className="text-muted">{notEvaluatedReason(healthInput)}</span>
          )}
        </span>

        <span className="ml-auto flex flex-wrap gap-2">
          {canCheck ? (
            <button
              type="button"
              className="ebim-btn-secondary ebim-btn-sm"
              disabled={busy}
              onClick={() => onCheck(targetId, code)}
            >
              Verificar conexión
            </button>
          ) : null}
          {canManage ? (
            <button
              type="button"
              className="ebim-btn-ghost ebim-btn-sm"
              onClick={() => onConfigure(draft)}
            >
              Configurar provisioning
            </button>
          ) : null}
        </span>
      </div>

      {evaluable && row.health_detail ? (
        <p className="mb-2 break-words text-caption text-muted">
          Detalle de la última comprobación: {row.health_detail as string}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-caption text-muted">
        <span>
          Integración:{' '}
          {row.integration_code ? (
            <span className="font-mono">
              {row.integration_code as string} · {row.integration_type as string}
            </span>
          ) : (
            'sin configurar'
          )}
        </span>
        <span>
          URL base:{' '}
          {row.base_url ? (
            <span className="break-all font-mono">{row.base_url as string}</span>
          ) : (
            'no aplica'
          )}
        </span>
        <span>
          Credencial:{' '}
          {row.credential_profile_code ? (
            <span className="font-mono">{row.credential_profile_code as string}</span>
          ) : (
            'sin perfil'
          )}
          {row.credential_secret_configured ? ' · referencia configurada' : ''}
        </span>
        <span>
          Timeout {String(row.timeout_ms)} ms · {String(row.retry_count)} reintentos
        </span>
      </div>
    </div>
  );
}

/**
 * Matriz producto × entorno (spec §7.3). Cada celda resume SÓLO los destinos
 * habilitados de ese producto en ese entorno; un entorno sin destinos
 * habilitados es «No evaluado». No hay columna de «peor estado global».
 */
function EnvironmentMatrix({
  rows,
  loading,
  error,
}: {
  rows: ReadonlyArray<TargetHealthInput & { product_short_name?: string | null }>;
  loading: boolean;
  error: unknown;
}) {
  const { products, environments } = useMemo(() => {
    const byProduct = new Map<string, TargetHealthInput[]>();
    for (const r of rows) {
      const key = r.product_short_name ?? 'Sin producto';
      byProduct.set(key, [...(byProduct.get(key) ?? []), r]);
    }
    const present = new Set(rows.map((r) => r.provisioning_environment).filter(Boolean) as string[]);
    return {
      products: [...byProduct.entries()].sort(([a], [b]) => a.localeCompare(b)),
      environments: ENVIRONMENT_ORDER.filter((e) => present.has(e)),
    };
  }, [rows]);

  if (loading || error || products.length === 0 || environments.length === 0) return null;

  return (
    <Card
      className="mb-4"
      title="Salud observada por producto y entorno"
      description="Última comprobación guardada; no es monitoreo en tiempo real. Sólo cuentan los destinos con provisioning habilitado."
    >
      <div className="relative overflow-x-auto" role="region" aria-label="Matriz de producto y entorno" tabIndex={0}>
        <table className="w-full border-collapse">
          <thead className="border-b border-border bg-sunken">
            <tr>
              <th scope="col" className="ebim-th">Producto</th>
              {environments.map((e) => (
                <th key={e} scope="col" className="ebim-th">
                  {PROVISIONING_ENVIRONMENT_LABEL[e]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {products.map(([product, targets]) => {
              const summaries = summarizeByEnvironment(targets);
              return (
                <tr key={product}>
                  {/* Producto y celdas alineados arriba: las celdas con salud ocupan tres líneas. */}
                  <th scope="row" className="ebim-td py-3 text-left align-top font-semibold">
                    {product}
                  </th>
                  {environments.map((e) => {
                    const s = summaries.find((x) => x.environment === e);
                    return (
                      <td key={e} className="ebim-td py-3 align-top">
                        {s ? (
                          <div className="flex flex-col items-start gap-0.5 text-caption" data-health-cell={s.health}>
                            <span className="inline-flex items-center gap-1.5 text-compact">
                              <HealthDot health={s.health} />
                              <HealthText health={s.health} />
                            </span>
                            {s.health === 'NOT_EVALUATED' ? null : <ObservationDate at={s.latestCheckedAt} />}
                            <span className="text-muted">
                              {s.evaluated} de {s.total} habilitado{s.total === 1 ? '' : 's'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-caption text-muted">Sin destino</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
