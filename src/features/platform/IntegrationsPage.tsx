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
  PageContainer, Card, SearchBar, KpiTile, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { Avatar } from '@/components/ui/Avatar';
import { KpiStrip } from '@/features/billing/financeUi';
import { formatDateTime } from '@/lib/format';
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
import { CutoverStepper } from './CutoverStepper';

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
      <KpiStrip label="Resumen de integraciones">
        <KpiTile label="Integraciones" value={integrations.isLoading ? null : String(all.length)} loading={integrations.isLoading} />
        <KpiTile
          label="Listas"
          value={integrations.isLoading ? null : String(all.filter((i) => i.status === 'READY').length)}
          loading={integrations.isLoading}
          footer="Contrato completo para operar."
        />
        <KpiTile
          label="Habilitadas"
          value={integrations.isLoading ? null : String(all.filter((i) => i.enabled).length)}
          loading={integrations.isLoading}
        />
        <KpiTile
          label={environment === ALL ? 'Destinos habilitados' : `Destinos habilitados · ${environmentLabel(environment)}`}
          value={targets.isLoading ? null : `${enabledTargets.length} de ${scopedTargets.length}`}
          loading={targets.isLoading}
          footer="Sólo los habilitados entran en el semáforo de salud."
        />
      </KpiStrip>

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
          <ul className="grid gap-4 p-5 lg:grid-cols-2 2xl:grid-cols-3" aria-label="Integraciones">
            {rows.map((integration) => {
              const product = integration.saas_products as
                | { code: string; short_name: string; accent_color?: string | null }
                | null;
              const related = scopedTargets.filter((t) => t.product_integration_id === integration.id);
              const productOwners = ownerRows.filter(
                (o) => o.saas_product_id === integration.saas_product_id,
              );
              const lastObserved =
                related
                  .map((t) => t.health_checked_at)
                  .filter((d): d is string => Boolean(d))
                  .sort()
                  .pop() ?? null;

              return (
                <li
                  key={integration.id}
                  className="flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-card transition-colors hover:border-border-strong"
                  data-integration={integration.code}
                >
                  <div className="flex items-start gap-3 border-b border-border px-4 py-3.5">
                    <Avatar name={product?.short_name ?? integration.name} size="md" ringColor={product?.accent_color} />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/integrations/${integration.id}`}
                        className="block truncate text-h3 text-fg hover:text-accent-deep hover:underline"
                        title={integration.name}
                      >
                        {integration.name}
                      </Link>
                      <p className="truncate font-mono text-caption text-muted" title={integration.code}>
                        {integration.code}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={integrationStatusTone(integration.status as IntegrationStatus)}>
                        {INTEGRATION_STATUS_LABEL[integration.status as IntegrationStatus]}
                      </Badge>
                      {integration.enabled ? (
                        <Badge tone="ok" dot>Habilitada</Badge>
                      ) : (
                        <Badge tone="neutral">Deshabilitada</Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col gap-4 px-4 py-4">
                    <section aria-label={`Salud de ${integration.code}`}>
                      <p className="mb-2 text-micro text-muted">Salud por entorno</p>
                      {targets.isLoading ? (
                        <p className="text-compact text-muted" role="status">Leyendo destinos…</p>
                      ) : targets.error ? (
                        <p className="text-compact text-danger" role="alert">No se pudieron leer los destinos.</p>
                      ) : (
                        <EnvironmentHealthList summaries={summarizeByEnvironment(related)} />
                      )}
                    </section>

                    <section aria-label={`Cutover de ${integration.code}`} className="grid gap-3 sm:grid-cols-2">
                      <CutoverStepper axis="entitlements" state={integration.cutover_state_entitlements} />
                      <CutoverStepper axis="billing" state={integration.cutover_state_billing} />
                    </section>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border bg-sunken px-4 py-3 text-caption">
                    <div className="min-w-0">
                      <dt className="text-muted">Tipo · contrato</dt>
                      <dd className="truncate text-fg">
                        {INTEGRATION_TYPE_LABEL[integration.integration_type as IntegrationType]} ·{' '}
                        <span className="font-mono">{integration.contract_version}</span>
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted">Última observación</dt>
                      <dd className="truncate text-fg">
                        {lastObserved ? (
                          <time dateTime={lastObserved}>{formatDateTime(lastObserved)}</time>
                        ) : (
                          'Nunca comprobada'
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted">Responsable</dt>
                      <dd className="truncate text-fg">
                        {integration.owner_name ??
                          (integration.profiles as { full_name: string | null } | null)?.full_name ??
                          'Sin asignar'}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted">Propietarios técnicos</dt>
                      <dd className="text-fg tabular-nums">{productOwners.length === 0 ? 'Ninguno' : productOwners.length}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-border px-5 py-3 text-caption text-muted">
          Un destino deshabilitado o en borrador figura como «No evaluado» y no entra en el resumen.
          La certificación de un contrato no se muestra aquí: la consola no dispone de una fuente
          verificable para afirmarla.
        </p>
      </Card>

      <IntegrationDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </PageContainer>
  );
}
