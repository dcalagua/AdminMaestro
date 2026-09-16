import { useState } from 'react';
import { useDeploymentTargets, useProvisioningTargets } from '@/services/queries';
import { useCheckDeploymentHealth } from '@/services/mutations';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import {
  DEPLOYMENT_HEALTH_LABEL,
  DEPLOYMENT_TARGET_STATUS_LABEL,
  PROVISIONING_ENVIRONMENT_LABEL,
  healthTone,
  targetStatusTone,
  type DeploymentHealth,
  type DeploymentTargetStatus,
  type ProvisioningEnvironment,
} from '@/lib/provisioning';
import {
  DeploymentProvisioningDialog,
  type TargetProvisioningDraft,
} from './ProvisioningDialogs';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { Link } from 'react-router-dom';
import {
  PageContainer, Card, DataTable, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import { DeploymentTargetDialog, AttachTenantDialog } from './DeploymentDialogs';
import type { TargetDraft } from './DeploymentDialogs';

/**
 * Deployment targets: la infraestructura FÍSICA, desacoplada del tenant lógico.
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

  const all = targets.data ?? [];
  const byMode = (mode: string) => all.filter((t) => t.deployment_mode === mode).length;

  return (
    <PageContainer
      title="Deployments"
      description="Dónde vive físicamente cada tenant. Un target compartido aloja muchos; uno dedicado de cliente, exactamente uno."
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
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Targets totales" value={String(all.length)} />
        <StatCard label="Compartidos" value={String(byMode('SHARED'))} />
        <StatCard label="Dedicados de partner" value={String(byMode('PARTNER_DEDICATED'))} />
        <StatCard label="Dedicados de cliente" value={String(byMode('TENANT_DEDICATED'))} />
      </div>

      <Card>
        <SearchBar value={term} onChange={setTerm} placeholder="Buscar por código, región, proveedor u organización…" />
        {targets.isLoading ? (
          <LoadingState />
        ) : targets.error ? (
          <ErrorState error={targets.error} onRetry={() => void targets.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sin deployment targets" />
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((t) => {
              const deployments = ((t.tenant_deployments ?? []) as Array<Record<string, unknown>>).filter(
                (d) => d.status === 'ACTIVE',
              );
              return (
                <div key={t.id} className="p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold">{t.code}</span>
                    <Badge tone="accent">
                      {DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}
                    </Badge>
                    <Badge tone="info">{t.provider}</Badge>
                    {t.region ? <Badge tone="neutral">{t.region}</Badge> : null}
                    <Badge tone={t.status === 'ACTIVE' ? 'ok' : 'neutral'}>{t.status}</Badge>
                    {perms.canManagePlatform ? (
                      <span className="ml-auto flex gap-3">
                        <button
                          type="button"
                          className="ebim-link text-[13px]"
                          onClick={() =>
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
                            })
                          }
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="ebim-link text-[13px]"
                          onClick={() =>
                            setAttachTarget({ id: t.id, code: t.code, mode: t.deployment_mode })
                          }
                        >
                          Adjuntar tenant
                        </button>
                      </span>
                    ) : null}
                  </div>
                  <p className="mb-1 text-sm text-fg">{t.name}</p>
                  <p className="mb-3 text-xs text-muted">
                    {t.owner_organization_id
                      ? `Dueño: ${(t.organizations as { display_name: string } | null)?.display_name}`
                      : 'Infraestructura de EBIM (compartida)'}
                    {t.saas_products ? ` · ${(t.saas_products as { short_name: string }).short_name}` : ''}
                    {t.cost_center ? ` · centro de costo ${t.cost_center}` : ''}
                    {' · ref pública: '}
                    <span className="font-mono">{(t.provider_project_ref as string) ?? '—'}</span>
                  </p>

                  <ProvisioningPanel
                    row={(provisioning.data ?? []).find((p) => p.deployment_target_id === t.id)}
                    canManage={access.canForProduct('platform.deployment.manage', t.saas_product_id)}
                    canCheck={access.canForProduct('platform.deployment.read', t.saas_product_id)}
                    busy={checkHealth.isPending}
                    onConfigure={setProvisioningDialog}
                    onCheck={(id, code) => void runHealthCheck(id, code)}
                  />

                  {deployments.length === 0 ? (
                    <p className="text-xs text-muted">Sin tenants asignados.</p>
                  ) : (
                    <div className="rounded-card border border-border">
                      <DataTable columns={[`Tenants alojados (${deployments.length})`, 'Slug', 'Estado']}>
                        {deployments.map((d) => {
                          const tenant = d.tenants as { name: string; slug: string } | null;
                          return (
                            <tr key={d.tenant_id as string}>
                              <td className="ebim-td">
                                <Link className="ebim-link" to={`/tenants/${d.tenant_id}`}>
                                  {tenant?.name}
                                </Link>
                              </td>
                              <td className="ebim-td font-mono text-xs text-muted">{tenant?.slug}</td>
                              <td className="ebim-td text-muted">{d.status as string}</td>
                            </tr>
                          );
                        })}
                      </DataTable>
                    </div>
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
  const health = row.health_status as DeploymentHealth;
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
    <div className="mb-3 rounded-card border border-border bg-[color:var(--bg)] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted">
          Provisioning SaaS
        </span>
        {environment ? (
          <Badge tone="info">{PROVISIONING_ENVIRONMENT_LABEL[environment]}</Badge>
        ) : (
          <Badge tone="neutral">Sin ambiente</Badge>
        )}
        <Badge tone={targetStatusTone(status)}>{DEPLOYMENT_TARGET_STATUS_LABEL[status]}</Badge>
        <Badge tone={healthTone(health)}>{DEPLOYMENT_HEALTH_LABEL[health]}</Badge>
        {row.provisioning_enabled ? (
          <Badge tone="ok">Habilitado</Badge>
        ) : (
          <Badge tone="neutral">Deshabilitado</Badge>
        )}

        <span className="ml-auto flex gap-3">
          {canCheck ? (
            <button
              type="button"
              className="ebim-link text-[13px]"
              disabled={busy}
              onClick={() => onCheck(targetId, code)}
            >
              Verificar conexión
            </button>
          ) : null}
          {canManage ? (
            <button
              type="button"
              className="ebim-link text-[13px]"
              onClick={() => onConfigure(draft)}
            >
              Configurar provisioning
            </button>
          ) : null}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
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
            <span className="font-mono">{row.base_url as string}</span>
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
