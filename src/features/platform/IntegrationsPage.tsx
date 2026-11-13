import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useProductIntegrations, useProvisioningTargets, useProductOwners } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  Badge, Card, DataTable, EmptyState, ErrorState, LoadingState, PageContainer, SearchBar, Skeleton,
} from '@/components/ui/primitives';
import { StatCell, StatStrip } from '@/components/ui/StatStrip';
import { CellTitle, StatusDot } from '@/components/ui/cells';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Avatar } from '@/components/ui/Avatar';
import { DetailDrawer, DetailList } from '@/components/ui/DetailDrawer';
import { formatDateTime, formatNumber } from '@/lib/format';
import { INTEGRATION_TYPE_LABEL, type IntegrationType } from '@/lib/provisioning';
import { isStale, relativeAge } from '@/features/suite/suiteModel';
import { IntegrationDialog } from './IntegrationDialogs';
import { integrationState } from './integrationState';
import {
  ENVIRONMENT_ORDER,
  environmentLabel,
  isEvaluable,
  observedHealthLabel,
  observedHealthTone,
  summarizeByEnvironment,
  type EnvironmentHealthSummary,
} from './targetHealth';
import { EnvironmentHealthList } from './EnvironmentHealth';
import { CutoverStepper } from './CutoverStepper';

const ALL = 'ALL';

type Integration = NonNullable<ReturnType<typeof useProductIntegrations>['data']>[number];
type Product = { code: string; short_name: string; accent_color?: string | null } | null;

function ownerOf(i: Integration): string | null {
  return i.owner_name ?? (i.profiles as { full_name: string | null } | null)?.full_name ?? null;
}

/**
 * Apps › Integraciones (V6 · F1, plan §3.3): cómo se conecta el Admin Maestro
 * con cada app, como TABLA densa (antes, tarjetas de 300 px con el stepper de
 * migración encimado).
 *
 * Una fila por integración: app, nombre (el código técnico va al tooltip),
 * estado de negocio, salud por entorno en una línea, las dos migraciones con
 * `CompactStepper` y el responsable. El detalle completo (salud con fechas,
 * etapas, contrato, propietarios técnicos) va en un panel lateral; la ficha
 * sigue a un clic.
 *
 * Salud (spec §7.3): por entorno y solo con destinos habilitados. Se lee lo
 * persistido por la última verificación explícita; renderizar no llama a
 * ningún producto. Ningún secreto: solo se sabe si la referencia está puesta.
 */
export function IntegrationsPage() {
  const integrations = useProductIntegrations();
  const targets = useProvisioningTargets();
  const owners = useProductOwners();
  const access = useProvisioningAccess();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  const { term, setTerm, filtered } = useSearchFilter(integrations.data, (i) => [
    i.code,
    i.name,
    i.integration_type,
    i.contract_version,
    i.owner_name,
    (i.saas_products as Product)?.short_name,
  ]);

  const all = useMemo(() => integrations.data ?? [], [integrations.data]);
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
  const evaluable = scopedTargets.filter(isEvaluable);
  const targetsOf = (id: string) => scopedTargets.filter((t) => t.product_integration_id === id);

  const rows = (environment === ALL ? filtered : filtered.filter((i) => targetsOf(i.id).length > 0))
    .slice()
    .sort(
      (a, b) =>
        ((a.saas_products as Product)?.short_name ?? '').localeCompare((b.saas_products as Product)?.short_name ?? '', 'es') ||
        a.name.localeCompare(b.name, 'es'),
    );

  // Franja: lo que un gerente necesita saber de un vistazo.
  const operative = all.filter((i) => integrationState(i).label === 'Operativa').length;
  const withIncident = all.filter((i) =>
    summarizeByEnvironment(targetsOf(i.id)).some((s) => s.health === 'UNHEALTHY' || s.health === 'DEGRADED'),
  ).length;
  const stale = evaluable.filter((t) => isStale(t.health_checked_at)).length;

  const current = selected ? all.find((i) => i.id === selected) : undefined;

  return (
    <PageContainer
      title="Integraciones"
      description="Cómo se conecta el Admin Maestro con cada app de la suite: contrato, credencial, política y destinos por entorno. La salud es la última observación guardada, por entorno; un destino deshabilitado o en borrador figura como «No evaluado». La certificación de un contrato no se muestra: la consola no dispone de una fuente verificable para afirmarla."
      actions={
        access.can('platform.integration.manage') ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setDialogOpen(true)}>
            Nueva integración
          </button>
        ) : null
      }
    >
      {all.length > 0 || integrations.isLoading ? (
        <StatStrip label="Resumen de integraciones">
          <StatCell
            label="Operativas"
            value={integrations.isLoading ? null : `${formatNumber(operative)} de ${formatNumber(all.length)}`}
            loading={integrations.isLoading}
            context="Listas y habilitadas"
          />
          <StatCell
            label={environment === ALL ? 'Destinos evaluados' : `Destinos · ${environmentLabel(environment)}`}
            value={targets.isLoading ? null : `${formatNumber(evaluable.length)} de ${formatNumber(scopedTargets.length)}`}
            loading={targets.isLoading}
            error={targets.error}
            context="Solo los habilitados entran en la salud"
          />
          <StatCell
            label="Con incidencia"
            value={formatNumber(withIncident)}
            tone={withIncident > 0 ? 'danger' : 'ok'}
            loading={targets.isLoading || integrations.isLoading}
            context={withIncident > 0 ? 'Algún entorno caído o degradado' : 'Ningún entorno caído'}
          />
          <StatCell
            label="Sin comprobar en 24 h"
            value={formatNumber(stale)}
            tone={stale > 0 ? 'warn' : 'neutral'}
            loading={targets.isLoading}
            context="Destinos con la salud desactualizada"
          />
        </StatStrip>
      ) : null}

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          total={integrations.isLoading ? undefined : all.length}
          placeholder="Buscar por app, integración, código o responsable…"
          right={
            environments.length > 0 ? (
              <StatusTabs
                label="Entorno"
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
        ) : all.length === 0 ? (
          <EmptyState
            title="Sin integraciones configuradas"
            description="Una integración declara cómo se conecta el Admin Maestro con una app: tipo, versión, permisos y rutas."
            action={
              access.can('platform.integration.manage') ? (
                <button type="button" className="ebim-btn-primary" onClick={() => setDialogOpen(true)}>
                  Nueva integración
                </button>
              ) : undefined
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            variant="no-results"
            title="Sin integraciones en este alcance"
            description="Ninguna integración coincide con la búsqueda o no tiene destinos en el entorno elegido."
            onClear={() => {
              setTerm('');
              setEnvironment(ALL);
            }}
          />
        ) : (
          <DataTable
            label="Integraciones"
            minWidth={1040}
            columns={[
              { label: 'Integración', sticky: true },
              { label: 'Estado' },
              { label: 'Salud por entorno', width: 230 },
              { label: 'Módulos habilitados', width: 160 },
              { label: 'Cobro', width: 160 },
              { label: 'Responsable' },
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {rows.map((integration) => {
              const product = integration.saas_products as Product;
              const state = integrationState(integration);
              const owner = ownerOf(integration);
              return (
                <tr key={integration.id} data-integration={integration.code}>
                  <td className="ebim-td py-2">
                    <div className="max-w-[340px]">
                      <CellTitle
                        title={integration.name}
                        to={`/integrations/${integration.id}`}
                        tooltip={`${integration.name}\nCódigo: ${integration.code}`}
                        wrap
                        leading={
                          <Avatar name={product?.short_name ?? integration.name} ringColor={product?.accent_color} />
                        }
                        secondary={[
                          // La app solo si el nombre no la dice ya («eChange · API de…»).
                          product?.short_name && !integration.name.startsWith(product.short_name) ? product.short_name : null,
                          INTEGRATION_TYPE_LABEL[integration.integration_type as IntegrationType],
                        ]}
                      />
                    </div>
                  </td>
                  <td className="ebim-td">
                    <Badge tone={state.tone} dot>
                      {state.label}
                    </Badge>
                  </td>
                  <td className="ebim-td py-2">
                    {targets.isLoading ? (
                      <Skeleton className="h-4 w-32" />
                    ) : targets.error ? (
                      <span className="text-compact text-danger">No se pudieron leer los destinos</span>
                    ) : (
                      <HealthLines name={integration.name} summaries={summarizeByEnvironment(targetsOf(integration.id))} />
                    )}
                  </td>
                  <td className="ebim-td py-2">
                    <CutoverStepper axis="entitlements" state={integration.cutover_state_entitlements} heading={false} />
                  </td>
                  <td className="ebim-td py-2">
                    <CutoverStepper axis="billing" state={integration.cutover_state_billing} heading={false} />
                  </td>
                  <td className="ebim-td text-compact">
                    {owner ? (
                      <span className="block max-w-[160px] truncate text-fg" title={owner}>
                        {owner}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="ebim-td w-12 text-right">
                    <ActionMenu
                      label={`Acciones de ${integration.name}`}
                      items={[
                        { label: 'Ver resumen', onSelect: () => setSelected(integration.id) },
                        { label: 'Abrir ficha', to: `/integrations/${integration.id}` },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      {current ? (
        <IntegrationSummaryDrawer
          integration={current}
          targets={targetsOf(current.id)}
          technicalOwners={ownerRows
            .filter((o) => o.saas_product_id === current.saas_product_id)
            .map((o) => (o.profiles as { full_name: string | null } | null)?.full_name ?? '—')}
          onClose={() => setSelected(null)}
        />
      ) : null}

      <IntegrationDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </PageContainer>
  );
}

/**
 * Salud por entorno en una línea por entorno: punto, entorno, estado y hace
 * cuánto se observó. La fecha exacta va en el `title`. «No evaluado» con
 * anillo vacío; una observación de más de 24 h, en tono de aviso.
 */
function HealthLines({ name, summaries }: { name: string; summaries: EnvironmentHealthSummary[] }) {
  if (summaries.length === 0) return <span className="text-compact text-muted">Sin destinos</span>;
  return (
    <ul className="flex flex-col gap-0.5" aria-label={`Salud por entorno de ${name}`}>
      {summaries.map((s) => {
        const evaluated = s.health !== 'NOT_EVALUATED';
        const stale = evaluated && isStale(s.latestCheckedAt);
        const when = s.latestCheckedAt ? `observado el ${formatDateTime(s.latestCheckedAt)}` : 'nunca comprobado';
        return (
          <li
            key={s.environment ?? 'none'}
            className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-caption"
            data-environment={s.environment ?? ''}
            title={`${s.label}: ${observedHealthLabel(s.health)} · ${when}`}
          >
            <StatusDot tone={observedHealthTone(s.health)} hollow={!evaluated || s.health === 'UNKNOWN'} />
            <span className="font-semibold text-fg">{s.label}</span>
            <span className="text-fg-2">{observedHealthLabel(s.health)}</span>
            {evaluated ? (
              <span className={stale ? 'text-warn' : 'text-muted'}>
                · {s.latestCheckedAt ? relativeAge(s.latestCheckedAt) : 'sin comprobar'}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Panel lateral con el detalle que antes repetía cada tarjeta. Solo lectura. */
function IntegrationSummaryDrawer({
  integration,
  targets,
  technicalOwners,
  onClose,
}: {
  integration: Integration;
  targets: Parameters<typeof summarizeByEnvironment>[0];
  technicalOwners: string[];
  onClose: () => void;
}) {
  const product = integration.saas_products as Product;
  const state = integrationState(integration);
  const lastObserved =
    targets
      .map((t) => t.health_checked_at)
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop() ?? null;
  return (
    <DetailDrawer
      open
      title={integration.name}
      subtitle={[product?.short_name, integration.code].filter(Boolean).join(' · ')}
      onClose={onClose}
      actions={
        <Link to={`/integrations/${integration.id}`} className="ebim-btn-primary">
          Abrir ficha
        </Link>
      }
    >
      <div className="space-y-6">
        <DetailList
          items={[
            ['Estado', <Badge key="s" tone={state.tone} dot>{state.label}</Badge>],
            [
              'Tipo · contrato',
              `${INTEGRATION_TYPE_LABEL[integration.integration_type as IntegrationType]} · ${integration.contract_version}`,
            ],
            ['Responsable', ownerOf(integration) ?? 'Sin asignar'],
            ['Propietarios técnicos', technicalOwners.length > 0 ? technicalOwners.join(', ') : 'Ninguno'],
            ['Última observación', lastObserved ? formatDateTime(lastObserved) : 'Nunca comprobada'],
          ]}
        />
        <section aria-label={`Salud de ${integration.name}`}>
          <h3 className="mb-2 text-micro text-muted">Salud por entorno</h3>
          <EnvironmentHealthList summaries={summarizeByEnvironment(targets)} />
        </section>
        <section aria-label={`Migración de ${integration.name}`} className="grid gap-4 sm:grid-cols-2">
          <CutoverStepper axis="entitlements" state={integration.cutover_state_entitlements} />
          <CutoverStepper axis="billing" state={integration.cutover_state_billing} />
        </section>
      </div>
    </DetailDrawer>
  );
}
