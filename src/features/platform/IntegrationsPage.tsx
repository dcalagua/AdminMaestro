import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useProductIntegrations,
  useProvisioningTargets,
  useProductOwners,
} from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import {
  INTEGRATION_STATUS_LABEL,
  INTEGRATION_TYPE_LABEL,
  integrationStatusTone,
  type IntegrationStatus,
  type IntegrationType,
} from '@/lib/provisioning';
import { IntegrationDialog } from './IntegrationDialogs';
import { ENVIRONMENT_ORDER, environmentLabel, isEvaluable, summarizeByEnvironment } from './targetHealth';
import { EnvironmentHealthList } from './EnvironmentHealth';

const ALL = 'ALL';

/**
 * Integraciones SaaS: el catálogo de CÓMO habla MasterAdmin con cada producto
 * de la suite.
 *
 * Todo lo que se ve aquí es configuración administrable. Ningún secreto: los
 * valores reales viven en el almacén del servidor y esta pantalla sólo puede
 * saber si la referencia está puesta o no.
 *
 * Salud (spec §7.3): se resume POR ENTORNO y sólo con destinos habilitados. Se
 * lee lo persistido por la última verificación explícita; al renderizar no se
 * llama a ningún producto.
 */
export function IntegrationsPage() {
  const integrations = useProductIntegrations();
  const targets = useProvisioningTargets();
  const owners = useProductOwners();
  const access = useProvisioningAccess();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [params, setParams] = useSearchParams();

  const { term, setTerm, filtered } = useSearchFilter(integrations.data, (i) => [
    i.code,
    i.name,
    i.integration_type,
    i.contract_version,
    i.owner_name,
    (i.saas_products as { short_name: string } | null)?.short_name,
  ]);

  const all = integrations.data ?? [];
  const targetRows = useMemo(() => targets.data ?? [], [targets.data]);
  const ownerRows = owners.data ?? [];

  // Entornos presentes en los destinos visibles para este usuario (RLS decide).
  const environments = useMemo(() => {
    const present = new Set(targetRows.map((t) => t.provisioning_environment).filter(Boolean) as string[]);
    return ENVIRONMENT_ORDER.filter((e) => present.has(e));
  }, [targetRows]);
  const rawEnv = params.get('entorno') ?? ALL;
  const environment = rawEnv === ALL || environments.includes(rawEnv as never) ? rawEnv : ALL;
  const setEnvironment = (value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === ALL) next.delete('entorno');
        else next.set('entorno', value);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );

  const scopedTargets =
    environment === ALL ? targetRows : targetRows.filter((t) => t.provisioning_environment === environment);
  const enabledTargets = scopedTargets.filter(isEvaluable);

  const rows =
    environment === ALL
      ? filtered
      : filtered.filter((i) => scopedTargets.some((t) => t.product_integration_id === i.id));

  return (
    <PageContainer
      title="Integraciones SaaS"
      description="Cómo se conecta MasterAdmin con cada producto de la suite: contrato, credencial, política y destinos por entorno. La salud mostrada es la última observación guardada, por entorno."
      actions={
        access.can('platform.integration.manage') ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setDialogOpen(true)}>
            Nueva integración
          </button>
        ) : null
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Integraciones" value={String(all.length)} />
        <StatCard label="Listas" value={String(all.filter((i) => i.status === 'READY').length)} />
        <StatCard label="Habilitadas" value={String(all.filter((i) => i.enabled).length)} />
        <StatCard
          label={environment === ALL ? 'Destinos habilitados' : `Destinos habilitados · ${environmentLabel(environment)}`}
          value={`${enabledTargets.length} de ${scopedTargets.length}`}
          hint="Sólo los habilitados entran en el resumen de salud."
        />
      </div>

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por producto, código, tipo o responsable…"
          right={
            environments.length > 0 ? (
              <StatusTabs
                value={environment}
                onChange={setEnvironment}
                options={[
                  { id: ALL, label: 'Todos los entornos' },
                  ...environments.map((e) => ({ id: e, label: environmentLabel(e) })),
                ]}
              />
            ) : null
          }
        />
        {integrations.isLoading ? (
          <LoadingState />
        ) : integrations.error ? (
          <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={all.length === 0 ? 'Sin integraciones configuradas' : 'Sin integraciones en este alcance'}
            description={
              all.length === 0
                ? 'Una integración declara el contrato con un producto: tipo, versión, issuer, audience, scopes y rutas.'
                : 'Ninguna integración coincide con la búsqueda o no tiene destinos en el entorno elegido.'
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((integration) => {
              const product = integration.saas_products as
                | { code: string; short_name: string }
                | null;
              const related = scopedTargets.filter((t) => t.product_integration_id === integration.id);
              const productOwners = ownerRows.filter(
                (o) => o.saas_product_id === integration.saas_product_id,
              );

              return (
                <li key={integration.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                  <div className="min-w-0">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Link
                        to={`/integrations/${integration.id}`}
                        className="break-all font-mono text-sm font-bold text-accent-deep hover:underline"
                      >
                        {integration.code}
                      </Link>
                      <Badge tone="accent">{product?.short_name ?? '—'}</Badge>
                      <Badge tone={integrationStatusTone(integration.status as IntegrationStatus)}>
                        {INTEGRATION_STATUS_LABEL[integration.status as IntegrationStatus]}
                      </Badge>
                      {integration.enabled ? (
                        <Badge tone="ok">Habilitada</Badge>
                      ) : (
                        <Badge tone="neutral">Deshabilitada</Badge>
                      )}
                    </div>
                    <p className="text-sm text-fg">{integration.name}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                      <span>
                        {INTEGRATION_TYPE_LABEL[integration.integration_type as IntegrationType]} · contrato{' '}
                        <span className="font-mono">{integration.contract_version}</span>
                      </span>
                      <span>
                        Responsable:{' '}
                        {integration.owner_name ??
                          (integration.profiles as { full_name: string | null } | null)?.full_name ??
                          'sin asignar'}
                      </span>
                      <span>
                        Propietarios técnicos: {productOwners.length === 0 ? 'ninguno' : productOwners.length}
                      </span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
                      Salud observada por entorno
                    </p>
                    {targets.isLoading ? (
                      <p className="text-xs text-muted" role="status">Leyendo destinos…</p>
                    ) : targets.error ? (
                      <p className="text-xs text-danger" role="alert">No se pudieron leer los destinos.</p>
                    ) : (
                      <EnvironmentHealthList summaries={summarizeByEnvironment(related)} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-border px-4 py-3 text-xs text-muted">
          Un destino deshabilitado o en borrador figura como «No evaluado» y no entra en el resumen.
          La certificación de un contrato no se muestra aquí: la consola no dispone de una fuente
          verificable para afirmarla.
        </p>
      </Card>

      <IntegrationDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </PageContainer>
  );
}
