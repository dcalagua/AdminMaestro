import { useState } from 'react';
import { useDeploymentTargets } from '@/services/queries';
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
  const perms = usePermissions();
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
