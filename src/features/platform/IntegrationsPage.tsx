import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useProductIntegrations,
  useProvisioningTargets,
  useProductOwners,
} from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import {
  PageContainer, Card, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import {
  DEPLOYMENT_HEALTH_LABEL,
  INTEGRATION_STATUS_LABEL,
  INTEGRATION_TYPE_LABEL,
  PROVISIONING_ENVIRONMENT_LABEL,
  healthTone,
  integrationStatusTone,
  type DeploymentHealth,
  type IntegrationStatus,
  type IntegrationType,
  type ProvisioningEnvironment,
} from '@/lib/provisioning';
import { IntegrationDialog } from './IntegrationDialogs';

/**
 * Integraciones SaaS: el catálogo de CÓMO habla MasterAdmin con cada producto
 * de la suite.
 *
 * Todo lo que se ve aquí es configuración administrable. Ningún secreto: los
 * valores reales viven en el almacén del servidor y esta pantalla sólo puede
 * saber si la referencia está puesta o no.
 */
export function IntegrationsPage() {
  const integrations = useProductIntegrations();
  const targets = useProvisioningTargets();
  const owners = useProductOwners();
  const access = useProvisioningAccess();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { term, setTerm, filtered } = useSearchFilter(integrations.data, (i) => [
    i.code,
    i.name,
    i.integration_type,
    i.contract_version,
    i.owner_name,
    (i.saas_products as { short_name: string } | null)?.short_name,
  ]);

  const all = integrations.data ?? [];
  const targetRows = targets.data ?? [];
  const ownerRows = owners.data ?? [];

  return (
    <PageContainer
      title="Integraciones SaaS"
      description="Cómo se conecta MasterAdmin con cada producto de la suite. Endpoint, contrato, credencial y política: todo se administra aquí, sin tocar SQL ni desplegar código."
      actions={
        access.can('platform.integration.manage') ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setDialogOpen(true)}>
            Nueva integración
          </button>
        ) : null
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Integraciones" value={String(all.length)} />
        <StatCard label="Listas" value={String(all.filter((i) => i.status === 'READY').length)} />
        <StatCard label="Habilitadas" value={String(all.filter((i) => i.enabled).length)} />
        <StatCard
          label="Destinos configurados"
          value={String(targetRows.filter((t) => t.provisioning_environment).length)}
        />
      </div>

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por producto, código, tipo o responsable…"
        />
        {integrations.isLoading ? (
          <LoadingState />
        ) : integrations.error ? (
          <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Sin integraciones configuradas"
            description="Una integración declara el contrato con un producto: tipo, versión, issuer, audience, scopes y rutas."
          />
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((integration) => {
              const product = integration.saas_products as
                | { code: string; short_name: string }
                | null;
              const related = targetRows.filter(
                (t) => t.product_integration_id === integration.id,
              );
              const productOwners = ownerRows.filter(
                (o) => o.saas_product_id === integration.saas_product_id,
              );
              const worstHealth = pickWorstHealth(
                related.map((t) => (t.health_status ?? 'UNKNOWN') as DeploymentHealth),
              );

              return (
                <div key={integration.id} className="p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Link
                      to={`/integrations/${integration.id}`}
                      className="font-mono text-sm font-bold text-accent-deep hover:underline"
                    >
                      {integration.code}
                    </Link>
                    <Badge tone="accent">{product?.short_name ?? '—'}</Badge>
                    <Badge>{INTEGRATION_TYPE_LABEL[integration.integration_type as IntegrationType]}</Badge>
                    <Badge>{integration.contract_version}</Badge>
                    <Badge tone={integrationStatusTone(integration.status as IntegrationStatus)}>
                      {INTEGRATION_STATUS_LABEL[integration.status as IntegrationStatus]}
                    </Badge>
                    {integration.enabled ? (
                      <Badge tone="ok">Habilitada</Badge>
                    ) : (
                      <Badge tone="neutral">Deshabilitada</Badge>
                    )}
                    <Badge tone={healthTone(worstHealth)}>
                      {DEPLOYMENT_HEALTH_LABEL[worstHealth]}
                    </Badge>
                  </div>

                  <p className="text-sm text-fg">{integration.name}</p>

                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
                    <span>
                      Responsable:{' '}
                      {integration.owner_name ??
                        (integration.profiles as { full_name: string | null } | null)?.full_name ??
                        'sin asignar'}
                    </span>
                    <span>
                      Propietarios técnicos: {productOwners.length === 0 ? 'ninguno' : productOwners.length}
                    </span>
                    <span>
                      Ambientes:{' '}
                      {related.length === 0
                        ? 'sin destinos'
                        : related
                            .map((t) =>
                              PROVISIONING_ENVIRONMENT_LABEL[
                                t.provisioning_environment as ProvisioningEnvironment
                              ],
                            )
                            .join(' · ')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <IntegrationDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </PageContainer>
  );
}

/**
 * Salud agregada de una integración.
 *
 * Se muestra la PEOR de sus destinos, no un promedio: si QAS está sano y PRD
 * caído, lo relevante es PRD. Sin destinos, UNKNOWN — que es la verdad.
 */
function pickWorstHealth(values: DeploymentHealth[]): DeploymentHealth {
  if (values.includes('UNHEALTHY')) return 'UNHEALTHY';
  if (values.includes('DEGRADED')) return 'DEGRADED';
  if (values.length > 0 && values.every((v) => v === 'HEALTHY')) return 'HEALTHY';
  return 'UNKNOWN';
}
