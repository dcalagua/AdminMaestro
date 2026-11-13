import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowsClockwiseIcon, CaretDownIcon, CaretRightIcon, GearSixIcon } from '@phosphor-icons/react';
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
  observedHealthLabel,
  summarizeByEnvironment,
  type TargetHealthInput,
} from '@/features/platform/targetHealth';
import { HealthDot, HealthText } from '@/features/platform/EnvironmentHealth';
import { isStale, relativeAge } from '@/features/suite/suiteModel';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { StatCell, StatStrip } from '@/components/ui/StatStrip';
import { CellTitle, StatusCell, type CellTone } from '@/components/ui/cells';
import { formatDateTime, formatNumber } from '@/lib/format';
import {
  DeploymentProvisioningDialog,
  type TargetProvisioningDraft,
} from './ProvisioningDialogs';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState,
} from '@/components/ui/primitives';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import { DeploymentTargetDialog, AttachTenantDialog } from './DeploymentDialogs';
import type { TargetDraft } from './DeploymentDialogs';

const ENVIRONMENT_KIND_LABEL: Record<string, string> = {
  DEMO: 'Demo',
  TRIAL: 'Prueba',
  PRODUCTION: 'Producción',
  SANDBOX: 'Sandbox',
};

const PROVIDER_LABEL: Record<string, string> = {
  SUPABASE: 'Supabase',
  AWS: 'AWS',
  AZURE: 'Azure',
  GCP: 'Google Cloud',
  ON_PREMISE: 'Servidor propio',
};

type ModeFilter = 'ALL' | 'SHARED' | 'PARTNER_DEDICATED' | 'TENANT_DEDICATED' | 'INCIDENT' | 'STALE';
type ProvisioningRow = Record<string, unknown> & TargetHealthInput;

/**
 * Entornos y despliegues (V6 · F2, plan §3.3): la infraestructura FÍSICA,
 * desacoplada del tenant lógico, como TABLA de destinos (antes, un bloque por
 * destino con su tabla de tenants abierta: 5.400 px de alto).
 *
 * Una fila por destino: nombre y código, app y dueño, entorno y modo, tenants
 * alojados, estado de las altas y salud en una línea. El detalle técnico de la
 * conexión y la lista de tenants se despliegan bajo la fila, plegados por
 * defecto. «Verificar conexión» y «Configurar altas» quedan en la fila como
 * iconos con su nombre accesible.
 *
 * La salud que se ve es la ÚLTIMA OBSERVACIÓN guardada, con su fecha. Abrir la
 * pantalla no verifica nada ni habilita nada; un destino en borrador o
 * deshabilitado se muestra «No evaluado», no como fallo. Estas filas contienen
 * SÓLO metadata pública (región, referencia del proyecto): ninguna credencial.
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
  const [expanded, setExpanded] = useState<string | null>(null);

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
    (t.saas_products as { short_name: string } | null)?.short_name,
  ]);

  const [mode, setMode] = useState<ModeFilter>('ALL');
  const all = targets.data ?? [];
  const provisioningRows = useMemo(() => (provisioning.data ?? []) as ProvisioningRow[], [provisioning.data]);
  const provisioningOf = useMemo(
    () => new Map(provisioningRows.map((p) => [p.deployment_target_id as string, p])),
    [provisioningRows],
  );
  const healthOf = (id: string) => {
    const p = provisioningOf.get(id);
    return p ? observedHealth(p) : 'NOT_EVALUATED';
  };
  const inMode = (t: (typeof all)[number], m: ModeFilter) => {
    if (m === 'ALL') return true;
    if (m === 'INCIDENT') return ['UNHEALTHY', 'DEGRADED'].includes(healthOf(t.id));
    if (m === 'STALE') {
      const p = provisioningOf.get(t.id);
      return Boolean(p && isEvaluable(p) && isStale(p.health_checked_at as string | null));
    }
    return t.deployment_mode === m;
  };
  const countIn = (m: ModeFilter) => filtered.filter((t) => inMode(t, m)).length;
  const visible = filtered.filter((t) => inMode(t, mode));
  const incidents = all.filter((t) => inMode(t, 'INCIDENT')).length;
  const stale = all.filter((t) => inMode(t, 'STALE')).length;
  const dedicated = all.filter((t) => t.deployment_mode !== 'SHARED').length;
  const toggle = (m: ModeFilter) => setMode((current) => (current === m ? 'ALL' : m));
  const modeTabs: ModeFilter[] = ['ALL', 'SHARED', 'PARTNER_DEDICATED', 'TENANT_DEDICATED'];

  return (
    <PageContainer
      title="Entornos y despliegues"
      description="Dónde vive físicamente cada tenant y a qué destino se llama en cada entorno. Un destino compartido aloja muchos tenants; uno dedicado de cliente, exactamente uno. La salud es la última comprobación guardada, no monitoreo en tiempo real."
      actions={
        perms.canManagePlatform ? (
          <button
            type="button"
            className="ebim-btn-primary"
            onClick={() => setTargetDialog({ open: true, target: null })}
          >
            Nuevo destino
          </button>
        ) : null
      }
    >
      {targets.isLoading || all.length > 0 ? (
        <StatStrip label="Destinos de despliegue">
          <StatCell
            label="Destinos"
            value={formatNumber(all.length)}
            loading={targets.isLoading}
            context={`${formatNumber(provisioningRows.filter(isEvaluable).length)} con altas habilitadas`}
            onSelect={() => setMode('ALL')}
            selected={mode === 'ALL'}
          />
          <StatCell
            label="Compartidos"
            value={formatNumber(all.filter((t) => t.deployment_mode === 'SHARED').length)}
            loading={targets.isLoading}
            context="Infraestructura de EBIM para muchos tenants"
            onSelect={() => toggle('SHARED')}
            selected={mode === 'SHARED'}
          />
          <StatCell
            label="Dedicados"
            value={formatNumber(dedicated)}
            loading={targets.isLoading}
            context={`${formatNumber(all.filter((t) => t.deployment_mode === 'PARTNER_DEDICATED').length)} de partner · ${formatNumber(
              all.filter((t) => t.deployment_mode === 'TENANT_DEDICATED').length,
            )} de cliente`}
          />
          <StatCell
            label="Con incidencia"
            value={formatNumber(incidents)}
            loading={targets.isLoading || provisioning.isLoading}
            tone={incidents > 0 ? 'danger' : 'ok'}
            context={incidents > 0 ? 'Caídos o degradados' : 'Ningún destino caído'}
            onSelect={() => toggle('INCIDENT')}
            selected={mode === 'INCIDENT'}
          />
          <StatCell
            label="Sin comprobar en 24 h"
            value={formatNumber(stale)}
            loading={targets.isLoading || provisioning.isLoading}
            tone={stale > 0 ? 'warn' : 'neutral'}
            context="Salud desactualizada"
            onSelect={() => toggle('STALE')}
            selected={mode === 'STALE'}
          />
        </StatStrip>
      ) : null}

      <EnvironmentMatrix rows={provisioningRows} loading={provisioning.isLoading} error={provisioning.error} />

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          total={targets.isLoading ? undefined : all.length}
          placeholder="Buscar por destino, app, región, proveedor u organización…"
          right={
            <StatusTabs
              label="Modo de despliegue"
              value={mode}
              onChange={setMode}
              options={[
                ...modeTabs.map((id) => ({
                  id,
                  label: { ALL: 'Todos', SHARED: 'Compartidos', PARTNER_DEDICATED: 'De partner', TENANT_DEDICATED: 'De cliente' }[
                    id as 'ALL'
                  ],
                  count: countIn(id),
                })),
                ...(mode === 'INCIDENT' ? [{ id: 'INCIDENT' as const, label: 'Con incidencia', count: countIn('INCIDENT') }] : []),
                ...(mode === 'STALE' ? [{ id: 'STALE' as const, label: 'Sin comprobar', count: countIn('STALE') }] : []),
              ]}
            />
          }
        />
        {targets.isLoading ? (
          <LoadingState />
        ) : targets.error ? (
          <ErrorState error={targets.error} onRetry={() => void targets.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState title="Sin destinos de despliegue" description="No hay destinos visibles para tu perfil." />
        ) : visible.length === 0 ? (
          <EmptyState
            variant="no-results"
            title="Ningún destino coincide"
            description="Prueba con otra búsqueda o cambia de pestaña."
            onClear={() => {
              setTerm('');
              setMode('ALL');
            }}
          />
        ) : (
          <DataTable
            label="Destinos de despliegue"
            minWidth={1040}
            columns={[
              { label: 'Destino', sticky: true },
              { label: 'App y dueño' },
              { label: 'Entorno y modo' },
              { label: 'Tenants', align: 'right' },
              { label: 'Altas en las apps' },
              { label: 'Salud' },
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {visible.flatMap((t) => {
              const deployments = ((t.tenant_deployments ?? []) as Array<Record<string, unknown>>).filter(
                (d) => d.status === 'ACTIVE',
              );
              const row = provisioningOf.get(t.id);
              const env = (row?.provisioning_environment as ProvisioningEnvironment | null) ?? null;
              const product = (t.saas_products as { short_name: string } | null)?.short_name ?? null;
              const owner = t.owner_organization_id
                ? (t.organizations as { display_name: string } | null)?.display_name ?? 'Organización'
                : 'EBIM (compartida)';
              const isOpen = expanded === t.id;
              const canManage = access.canForProduct('platform.deployment.manage', t.saas_product_id);
              const canCheck = access.canForProduct('platform.deployment.read', t.saas_product_id);
              const draft = row ? provisioningDraft(row) : null;
              const cells = [
                <tr key={t.id} data-target={t.code} className={t.status === 'ACTIVE' ? undefined : 'opacity-80'}>
                  <td className="ebim-td py-2">
                    <div className="max-w-[250px]">
                      <CellTitle
                        title={t.name}
                        secondary={[t.code, [PROVIDER_LABEL[t.provider] ?? t.provider, t.region].filter(Boolean).join(' ')]}
                        monoParts={[0]}
                        tooltip={`${t.name}${t.provider_project_ref ? `\nReferencia pública: ${t.provider_project_ref as string}` : ''}${
                          t.cost_center ? `\nCentro de costo: ${t.cost_center as string}` : ''
                        }`}
                      />
                    </div>
                  </td>
                  <td className="ebim-td py-2">
                    <span className="block max-w-[170px] leading-tight">
                      <span className="block truncate font-semibold text-fg">{product ?? 'Varias apps'}</span>
                      <span className="block truncate text-caption text-muted" title={owner}>
                        {owner}
                      </span>
                    </span>
                  </td>
                  <td className="ebim-td py-2 text-compact">
                    <span className="block whitespace-nowrap leading-tight">
                      <span className="block text-fg">
                        {env ? PROVISIONING_ENVIRONMENT_LABEL[env] : ENVIRONMENT_KIND_LABEL[t.environment] ?? t.environment}
                      </span>
                      <span className="block text-caption text-muted">
                        {DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}
                      </span>
                    </span>
                  </td>
                  <td className="ebim-td ebim-num">{formatNumber(deployments.length)}</td>
                  <td className="ebim-td py-2">
                    {row ? <AltasCell row={row} /> : <span className="text-compact text-muted">Sin configurar</span>}
                  </td>
                  <td className="ebim-td py-2">
                    {row ? <HealthCell row={row} /> : <span className="text-compact text-muted">No evaluado</span>}
                  </td>
                  <td className="ebim-td w-[132px] pl-1 pr-3 text-right">
                    <div className="flex items-center justify-end gap-0.5 whitespace-nowrap">
                      {row && canCheck ? (
                        <button
                          type="button"
                          className="ebim-icon-btn"
                          aria-label="Verificar conexión"
                          title={`Verificar la conexión con ${t.code}`}
                          disabled={checkHealth.isPending}
                          onClick={() => void runHealthCheck(t.id, t.code)}
                        >
                          <ArrowsClockwiseIcon size={16} aria-hidden />
                        </button>
                      ) : null}
                      {draft && canManage ? (
                        <button
                          type="button"
                          className="ebim-icon-btn"
                          aria-label="Configurar altas"
                          title={`Configurar las altas en ${t.code}`}
                          onClick={() => setProvisioningDialog(draft)}
                        >
                          <GearSixIcon size={16} aria-hidden />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ebim-icon-btn"
                        aria-expanded={isOpen}
                        aria-label={isOpen ? `Ocultar el detalle de ${t.code}` : `Ver el detalle de ${t.code}`}
                        title={isOpen ? 'Ocultar el detalle' : 'Conexión y tenants alojados'}
                        onClick={() => setExpanded(isOpen ? null : t.id)}
                      >
                        {isOpen ? <CaretDownIcon size={16} aria-hidden /> : <CaretRightIcon size={16} aria-hidden />}
                      </button>
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
                  </td>
                </tr>,
              ];
              if (isOpen) {
                cells.push(
                  <tr key={`${t.id}-detalle`} data-target-detail={t.code}>
                    <td className="ebim-td bg-sunken" colSpan={7}>
                      <TargetDetail row={row} deployments={deployments} code={t.code} />
                    </td>
                  </tr>,
                );
              }
              return cells;
            })}
          </DataTable>
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

function provisioningDraft(row: ProvisioningRow): TargetProvisioningDraft {
  return {
    deployment_target_id: row.deployment_target_id as string,
    code: row.code as string,
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
}

/** Estado de las altas del destino: «Habilitadas» o su estado (borrador ≠ fallo: tono neutro). */
function AltasCell({ row }: { row: ProvisioningRow }) {
  const status = row.provisioning_status as DeploymentTargetStatus;
  const enabled = Boolean(row.provisioning_enabled);
  const env = row.provisioning_environment as ProvisioningEnvironment | null;
  const ready = enabled && status === 'READY';
  const label = ready ? 'Habilitadas' : DEPLOYMENT_TARGET_STATUS_LABEL[status] ?? status;
  const tone: CellTone = ready ? 'ok' : status === 'DISABLED' ? 'neutral' : targetStatusTone(status);
  // El entorno ya va en su columna: aquí solo lo que falta para que las altas funcionen.
  const missing = [env ? null : 'sin entorno', enabled ? null : 'deshabilitadas'].filter(Boolean).join(' · ');
  return <StatusCell label={label} tone={tone} detail={ready || !missing ? undefined : missing.charAt(0).toUpperCase() + missing.slice(1)} />;
}

/** Salud en una línea (punto + estado) y hace cuánto; la fecha exacta y el detalle en el `title`. */
function HealthCell({ row }: { row: ProvisioningRow }) {
  const health = observedHealth(row);
  const evaluable = isEvaluable(row);
  const at = row.health_checked_at as string | null;
  const stale = evaluable && isStale(at);
  const title = [
    `${observedHealthLabel(health)}`,
    evaluable ? (at ? `Observado el ${formatDateTime(at)}` : 'Nunca comprobado') : notEvaluatedReason(row),
    evaluable && row.health_detail ? `Detalle: ${row.health_detail as string}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span className="flex flex-col items-start gap-0.5 leading-tight" title={title} data-health-cell={health}>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-compact">
        <HealthDot health={health} />
        <HealthText health={health} />
      </span>
      <span className={`whitespace-nowrap text-caption ${stale ? 'text-warn' : 'text-muted'}`}>
        {evaluable ? (at ? relativeAge(at) : 'Nunca comprobado') : notEvaluatedReason(row)}
      </span>
    </span>
  );
}

/**
 * Detalle plegado bajo la fila: la conexión técnica (sin ninguna credencial,
 * solo si la referencia está puesta) y los tenants alojados.
 */
function TargetDetail({
  row,
  deployments,
  code,
}: {
  row: ProvisioningRow | undefined;
  deployments: Array<Record<string, unknown>>;
  code: string;
}) {
  return (
    <div className="grid gap-4 py-2 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="mb-2 text-micro text-muted">Conexión para las altas</p>
        {row ? (
          <dl className="space-y-1 text-compact">
            <DetailPair
              label="Integración"
              value={row.integration_code ? `${row.integration_code as string} · ${row.integration_type as string}` : 'Sin configurar'}
              mono={Boolean(row.integration_code)}
            />
            <DetailPair label="URL base" value={(row.base_url as string) ?? 'No aplica'} mono={Boolean(row.base_url)} />
            <DetailPair
              label="Credencial"
              value={`${(row.credential_profile_code as string) ?? 'Sin perfil'}${row.credential_secret_configured ? ' · referencia configurada' : ''}`}
            />
            <DetailPair label="Tiempo de espera" value={`${String(row.timeout_ms)} ms · ${String(row.retry_count)} reintentos`} />
            {isEvaluable(row) && row.health_detail ? (
              <DetailPair label="Última comprobación" value={row.health_detail as string} />
            ) : null}
          </dl>
        ) : (
          <p className="text-compact text-muted">Este destino no tiene configuradas las altas en las apps.</p>
        )}
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-micro text-muted">
          Tenants alojados <span className="tabular-nums">({deployments.length})</span>
        </p>
        {deployments.length === 0 ? (
          <p className="text-compact text-muted">Sin tenants asignados.</p>
        ) : (
          <ul className="grid gap-x-4 gap-y-1 text-compact sm:grid-cols-2" aria-label={`Tenants alojados en ${code}`}>
            {deployments.map((d) => {
              const tenant = d.tenants as { name: string; slug: string } | null;
              return (
                <li key={d.tenant_id as string} className="min-w-0 truncate" title={tenant?.slug ?? undefined}>
                  <Link className="ebim-link" to={`/tenants/${d.tenant_id}`}>
                    {tenant?.name ?? 'Tenant'}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function DetailPair({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <dt className="shrink-0 text-muted sm:w-36">{label}</dt>
      <dd className={mono ? 'min-w-0 break-all font-mono text-caption' : 'min-w-0'}>{value}</dd>
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
      title="Salud por app y entorno"
      description="Última comprobación guardada; solo cuentan los destinos con altas habilitadas."
    >
      <DataTable
        label="Matriz de producto y entorno"
        paginate={false}
        scrollRegion
        mobileCards={false}
        columns={['App', ...environments.map((e) => PROVISIONING_ENVIRONMENT_LABEL[e])]}
      >
        {products.map(([product, targets]) => {
          const summaries = summarizeByEnvironment(targets);
          return (
            <tr key={product}>
              <th scope="row" className="ebim-td text-left font-semibold">
                {product}
              </th>
              {environments.map((e) => {
                const s = summaries.find((x) => x.environment === e);
                return (
                  <td key={e} className="ebim-td">
                    {s ? (
                      <span
                        className="inline-flex items-center gap-1.5 whitespace-nowrap text-compact"
                        data-health-cell={s.health}
                        title={`${s.label}: ${observedHealthLabel(s.health)}${
                          s.latestCheckedAt ? ` · observado el ${formatDateTime(s.latestCheckedAt)}` : ''
                        }\n${s.evaluated} de ${s.total} destino${s.total === 1 ? '' : 's'} con altas habilitadas`}
                      >
                        <HealthDot health={s.health} />
                        <HealthText health={s.health} />
                        {s.health !== 'NOT_EVALUATED' && s.latestCheckedAt ? (
                          <span className={isStale(s.latestCheckedAt) ? 'text-caption text-warn' : 'text-caption text-muted'}>
                            · {relativeAge(s.latestCheckedAt)}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-caption text-muted">Sin destino</span>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </DataTable>
    </Card>
  );
}
