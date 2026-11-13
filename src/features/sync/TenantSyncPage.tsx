import { useState } from 'react';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageContainer,
  SearchBar,
} from '@/components/ui/primitives';
import { StatCell, StatStrip } from '@/components/ui/StatStrip';
import { CellTitle, StatusCell } from '@/components/ui/cells';
import { Avatar } from '@/components/ui/Avatar';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { RevokeWithReasonDialog } from '@/components/ui/RevokeWithReasonDialog';
import { useToast } from '@/components/ui/toast-context';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { businessErrorMessage } from '@/lib/pgError';
import { formatNumber } from '@/lib/format';
import { relativeAge } from '@/features/suite/suiteModel';
import { RegisterFindingDialog } from './RegisterFindingDialog';
import {
  useResolveFinding,
  useRunTenantSync,
  useTenantSyncFindings,
  useTenantSyncRuns,
  useTenantSyncTargets,
} from './syncApi';
import {
  KIND,
  RESOLUTION,
  RUN_STATUS,
  capabilityText,
  errorText,
  findingDetail,
  findingSubject,
  inventoryText,
  linksText,
  outcomeOf,
  when,
  type FindingKind,
  type FindingStatus,
  type SyncFindingRow,
} from './syncModel';

/**
 * Sincronización con las apps (Suite → Apps).
 *
 * Cada día (y con «Sincronizar ahora») el Admin Maestro pregunta a cada app
 * por sus clientes, SOLO leyendo. Aquí se ve qué se pudo comprobar en cada
 * app, las diferencias abiertas con su acción y el historial. La base decide
 * qué es una diferencia y quién la puede cerrar; esta pantalla es UX.
 *
 * V6 · F5: misma anatomía que Cuentas e Integraciones — franja `StatStrip`,
 * tablas densas con celdas tipadas (`CellTitle`, `StatusCell`), primera columna
 * fija y estados vacíos de una línea. La lógica y las RPC no cambian.
 */
const STATUS_TABS: Array<{ id: FindingStatus; label: string }> = [
  { id: 'OPEN', label: 'Abiertos' },
  { id: 'RESOLVED', label: 'Resueltos' },
  { id: 'DISMISSED', label: 'Descartados' },
];

type Closing = { finding: SyncFindingRow; action: 'RESOLVE' | 'DISMISS' } | null;

export function TenantSyncPage() {
  const targets = useTenantSyncTargets();
  const runs = useTenantSyncRuns();
  const [status, setStatus] = useState<FindingStatus>('OPEN');
  const findings = useTenantSyncFindings(status);
  const run = useRunTenantSync();
  const resolve = useResolveFinding();
  const toast = useToast();
  const [closing, setClosing] = useState<Closing>(null);
  const [registering, setRegistering] = useState<SyncFindingRow | null>(null);

  const { term, setTerm, filtered } = useSearchFilter(findings.data, (f) => [
    f.app_name,
    f.app_code,
    f.tenant_name,
    f.tenant_slug,
    f.external_tenant_id,
    f.product_short_name,
    f.deployment_code,
    KIND[f.kind as FindingKind]?.label,
  ]);

  const allTargets = targets.data ?? [];
  const lastRun = (runs.data ?? [])[0];
  const openTotal = allTargets.reduce((n, t) => n + (t.open_findings ?? 0), 0);
  const appOnly = allTargets.reduce((n, t) => n + (t.last_inventory_unknown ?? 0), 0);
  const withInventory = allTargets.filter((t) => t.inventory_available).length;

  const unavailable = Boolean(targets.error && runs.error && findings.error);

  const syncNow = () =>
    run.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(
          'Sincronización terminada',
          `${formatNumber(r.findings_opened ?? 0)} diferencias nuevas · ${formatNumber(r.findings_closed ?? 0)} resueltas solas.`,
        ),
      onError: (e) => toast.error('No se pudo sincronizar', businessErrorMessage(e)),
    });

  return (
    <PageContainer
      title="Sincronización con las apps"
      description="Cada día el Admin Maestro pregunta a cada app por sus clientes, sin cambiar nada en ellas: detecta vínculos rotos, estados distintos y clientes que la app tiene y aquí no."
      actions={
        <button
          type="button"
          className="ebim-btn-primary"
          disabled={run.isPending}
          onClick={syncNow}
        >
          <ArrowsClockwiseIcon size={16} aria-hidden />
          {run.isPending ? 'Sincronizando…' : 'Sincronizar ahora'}
        </button>
      }
    >
      {unavailable ? (
        // Las tres lecturas fallan (p. ej. el entorno aún no tiene la sincronización):
        // un solo aviso en vez de una franja «No disponible» y tres tarjetas de error.
        <Card>
          <ErrorState
            title="La sincronización con las apps no está disponible"
            error={targets.error}
            onRetry={() => {
              void targets.refetch();
              void runs.refetch();
              void findings.refetch();
            }}
          />
        </Card>
      ) : (
        <>
          <StatStrip label="Resumen de la sincronización">
            <StatCell
              label="Última sincronización"
              value={lastRun?.started_at ? relativeAge(lastRun.started_at) : null}
              emptyLabel="Nunca"
              context={
                lastRun
                  ? `${RUN_STATUS[lastRun.status ?? '']?.label ?? lastRun.status} · ${when(lastRun.started_at)}`
                  : 'Todavía no se ha sincronizado'
              }
              tone={
                lastRun?.status === 'FAILED'
                  ? 'danger'
                  : lastRun?.status === 'PARTIAL'
                    ? 'warn'
                    : 'neutral'
              }
              loading={runs.isLoading}
              error={runs.error}
              onRetry={() => void runs.refetch()}
            />
            <StatCell
              label="Diferencias abiertas"
              value={formatNumber(openTotal)}
              context={openTotal > 0 ? 'Necesitan que una persona decida' : 'Nada pendiente'}
              tone={targets.error ? 'neutral' : openTotal > 0 ? 'warn' : 'ok'}
              onSelect={() => setStatus('OPEN')}
              selected={status === 'OPEN'}
              loading={targets.isLoading}
              error={targets.error}
            />
            <StatCell
              label="Clientes solo en la app"
              value={formatNumber(appOnly)}
              info="Según la última lectura de inventario de cada app."
              context="Sin cuenta en el Admin Maestro"
              tone={!targets.error && appOnly > 0 ? 'warn' : 'neutral'}
              loading={targets.isLoading}
              error={targets.error}
            />
            <StatCell
              label="Apps con inventario"
              value={`${formatNumber(withInventory)} de ${formatNumber(allTargets.length)}`}
              info="Las demás aún no permiten listar sus clientes."
              context="Pueden listar sus clientes"
              loading={targets.isLoading}
              error={targets.error}
            />
          </StatStrip>

          <Card
            title="Última revisión por app"
            description="Qué se pudo comprobar en cada app y entorno."
          >
            {targets.isLoading ? (
              <LoadingState variant="table" label="Cargando las apps…" />
            ) : targets.error ? (
              <ErrorState error={targets.error} onRetry={() => void targets.refetch()} />
            ) : allTargets.length === 0 ? (
              <EmptyState
                illustration="none"
                title="Ninguna app conectada"
                description="Una app aparece aquí cuando tiene un entorno habilitado o clientes dados de alta."
              />
            ) : (
              <DataTable
                label="Revisión por app"
                minWidth={900}
                columns={[
                  { label: 'App', sticky: true, width: 200 },
                  { label: 'Qué se comprueba', mobile: false },
                  { label: 'Clientes vinculados' },
                  { label: 'Inventario' },
                  { label: 'Resultado', width: 220 },
                ]}
              >
                {allTargets.map((t) => {
                  const outcome = outcomeOf(t);
                  const inventory = inventoryText(t);
                  const problem = errorText(t.last_error_code);
                  return (
                    <tr key={t.deployment_target_id}>
                      <td className="ebim-td py-2">
                        <CellTitle
                          title={t.product_short_name ?? '—'}
                          leading={<Avatar name={t.product_short_name ?? '?'} />}
                          secondary={[t.deployment_name ?? t.deployment_code, t.environment]}
                        />
                      </td>
                      <td className="ebim-td text-compact text-fg-2">{capabilityText(t)}</td>
                      <td className="ebim-td text-compact">{linksText(t)}</td>
                      <td className="ebim-td">
                        <StatusCell label={inventory.text} tone={inventory.tone} />
                      </td>
                      <td className="ebim-td">
                        <StatusCell
                          label={outcome.label}
                          tone={outcome.tone}
                          detail={t.last_checked_at ? relativeAge(t.last_checked_at) : undefined}
                          help={
                            t.last_checked_at ? `Revisada el ${when(t.last_checked_at)}` : undefined
                          }
                        />
                        {problem ? (
                          <div className="mt-1 max-w-[260px] text-caption text-warn">{problem}</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </Card>

          <Card
            title="Diferencias"
            description="Decide qué hacer con cada una. Las que dejan de verse se cierran solas."
            className="mt-6"
          >
            <SearchBar
              value={term}
              onChange={setTerm}
              placeholder="Buscar por cliente, app o identificador…"
              right={
                <StatusTabs
                  value={status}
                  onChange={setStatus}
                  options={STATUS_TABS}
                  label="Estado de las diferencias"
                />
              }
            />
            {findings.isLoading ? (
              <LoadingState variant="table" label="Cargando las diferencias…" />
            ) : findings.error ? (
              <ErrorState error={findings.error} onRetry={() => void findings.refetch()} />
            ) : filtered.length === 0 ? (
              term ? (
                <EmptyState
                  variant="no-results"
                  title="Ninguna diferencia coincide"
                  description="Prueba con otra búsqueda."
                  onClear={() => setTerm('')}
                />
              ) : (
                <EmptyState
                  illustration="none"
                  title={status === 'OPEN' ? 'No hay diferencias abiertas' : 'Nada en esta lista'}
                  description={
                    status === 'OPEN'
                      ? 'Todo lo que se pudo comprobar coincide con el Admin Maestro.'
                      : undefined
                  }
                />
              )
            ) : (
              <DataTable
                label="Diferencias con las apps"
                minWidth={1000}
                columns={[
                  { label: 'Cliente', sticky: true, width: 260 },
                  { label: 'Diferencia' },
                  { label: 'App' },
                  { label: 'Detalle' },
                  { label: 'Visto', width: 130 },
                  { label: 'Acciones', srOnly: true },
                ]}
              >
                {filtered.map((f) => {
                  const kind = KIND[f.kind as FindingKind] ?? {
                    label: f.kind ?? '—',
                    tone: 'neutral' as const,
                    help: '',
                  };
                  const closed =
                    f.status !== 'OPEN'
                      ? [
                          RESOLUTION[f.resolution ?? ''] ?? f.resolution,
                          f.registered_tenant_name ? `como «${f.registered_tenant_name}»` : null,
                          f.resolution_reason && f.resolution !== 'REGISTERED'
                            ? f.resolution_reason
                            : null,
                          f.resolved_by_name,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                          .replace(' · como «', ' como «')
                      : null;
                  return (
                    <tr key={f.id}>
                      <td className="ebim-td py-2">
                        <CellTitle
                          title={findingSubject(f)}
                          secondary={
                            f.external_tenant_id
                              ? ['Id en la app', f.external_tenant_id]
                              : undefined
                          }
                          monoParts={[1]}
                        />
                      </td>
                      <td className="ebim-td">
                        <StatusCell label={kind.label} tone={kind.tone} help={kind.help} />
                      </td>
                      <td className="ebim-td py-2">
                        <CellTitle
                          title={f.product_short_name ?? '—'}
                          secondary={[f.environment]}
                        />
                      </td>
                      <td className="ebim-td text-compact">
                        {findingDetail(f)}
                        {closed ? (
                          <div className="mt-1 text-caption text-muted">{closed}</div>
                        ) : null}
                      </td>
                      <td className="ebim-td whitespace-nowrap text-compact">
                        <span title={when(f.last_seen_at)}>
                          {f.last_seen_at ? relativeAge(f.last_seen_at) : '—'}
                        </span>
                        {(f.times_seen ?? 1) > 1 ? (
                          <div className="text-caption text-muted">{f.times_seen} revisiones</div>
                        ) : null}
                      </td>
                      <td className="ebim-td whitespace-nowrap text-right">
                        {f.status === 'OPEN' ? (
                          <div className="flex flex-wrap justify-end gap-1">
                            {f.kind === 'APP_ONLY' ? (
                              <button
                                type="button"
                                className="ebim-btn-secondary ebim-btn-sm"
                                onClick={() => setRegistering(f)}
                              >
                                Registrar en el Admin Maestro
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="ebim-btn-secondary ebim-btn-sm"
                                onClick={() => setClosing({ finding: f, action: 'RESOLVE' })}
                              >
                                Marcar como resuelto
                              </button>
                            )}
                            <button
                              type="button"
                              className="ebim-btn-ghost ebim-btn-sm"
                              onClick={() => setClosing({ finding: f, action: 'DISMISS' })}
                            >
                              Descartar
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </Card>

          <Card title="Historial" description="Las últimas 30 sincronizaciones." className="mt-6">
            {runs.isLoading ? (
              <LoadingState variant="table" label="Cargando el historial…" />
            ) : runs.error ? (
              <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
            ) : (runs.data ?? []).length === 0 ? (
              <EmptyState
                illustration="none"
                title="Todavía no se ha sincronizado"
                description="La primera sincronización corre esta madrugada, o ahora mismo con «Sincronizar ahora»."
              />
            ) : (
              <DataTable
                label="Historial de sincronizaciones"
                columns={[
                  { label: 'Fecha', width: 160 },
                  { label: 'Origen' },
                  { label: 'Resultado' },
                  { label: 'Apps revisadas', align: 'right' },
                  { label: 'Diferencias', align: 'right' },
                ]}
              >
                {(runs.data ?? []).map((r) => {
                  const st = RUN_STATUS[r.status ?? ''] ?? {
                    label: r.status ?? '—',
                    tone: 'neutral' as const,
                  };
                  return (
                    <tr key={r.id}>
                      <td className="ebim-td whitespace-nowrap text-compact">
                        {when(r.started_at)}
                      </td>
                      <td className="ebim-td text-compact">
                        {r.trigger_kind === 'MANUAL'
                          ? `A pedido${r.requested_by_name ? ` de ${r.requested_by_name}` : ''}`
                          : 'Automática diaria'}
                      </td>
                      <td className="ebim-td">
                        <StatusCell
                          label={st.label}
                          tone={st.tone}
                          detail={errorText(r.error_code) ?? undefined}
                        />
                      </td>
                      <td className="ebim-td ebim-num text-compact">
                        {r.targets_checked} de {r.targets_total}
                      </td>
                      <td className="ebim-td ebim-num text-compact">
                        {r.findings_opened} nuevas
                        <div className="text-caption text-muted">
                          {r.findings_closed} resueltas solas
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </Card>
        </>
      )}

      <RevokeWithReasonDialog
        open={closing !== null}
        title={closing?.action === 'DISMISS' ? 'Descartar la diferencia' : 'Marcar como resuelta'}
        description={
          closing?.action === 'DISMISS'
            ? 'Úsalo para datos de demostración, pruebas o clientes internos. Seguirá descartada aunque la app lo siga mostrando.'
            : 'Indica qué se corrigió. Si la próxima sincronización lo vuelve a detectar, se abrirá de nuevo.'
        }
        submitLabel={closing?.action === 'DISMISS' ? 'Descartar' : 'Marcar como resuelta'}
        busy={resolve.isPending}
        onCancel={() => setClosing(null)}
        onSubmit={async (reason) => {
          if (!closing) return;
          await resolve.mutateAsync({ id: closing.finding.id!, action: closing.action, reason });
          toast.success(
            closing.action === 'DISMISS' ? 'Diferencia descartada' : 'Diferencia resuelta',
          );
          setClosing(null);
        }}
      />
      <RegisterFindingDialog finding={registering} onClose={() => setRegistering(null)} />
    </PageContainer>
  );
}
