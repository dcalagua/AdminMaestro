import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProvisioningRequests } from '@/services/queries';
import { useRetryProvisioning } from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { StatCell, StatStrip } from '@/components/ui/StatStrip';
import { CellTitle, StatusCell, type CellTone } from '@/components/ui/cells';
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react';
import { formatDateTime, formatNumber } from '@/lib/format';
import { relativeAge } from '@/features/suite/suiteModel';
import { EnqueueProvisioningDialog } from './DeploymentDialogs';
import { PROVISIONING_ACTION_LABEL, provisioningRequestTone, provisioningStatusLabel } from './provisioningLabels';

type QueueFilter = 'ALL' | 'OPEN' | 'FAILED' | 'DONE';

const OPEN_STATUSES = ['PENDING', 'VALIDATING', 'RUNNING'];

/**
 * Solicitudes de infraestructura: la cola que crea o ajusta la infraestructura
 * física (espacios, destinos dedicados). Es un eje DISTINTO de las altas SaaS
 * (el tenant dentro de cada producto), que viven en su propia pantalla.
 *
 * Todo corre en DRY_RUN por defecto: la Edge Function `provisioning-worker`
 * simula la operación y registra el timeline sin tocar ninguna API remota. Pasar
 * a LIVE exige un secreto de servidor que la UI nunca ve. Abrir esta pantalla no
 * encola ni ejecuta nada.
 */
export function ProvisioningPage() {
  const requests = useProvisioningRequests();
  const perms = usePermissions();
  const toast = useToast();
  const retry = useRetryProvisioning();
  const [filter, setFilter] = useState<QueueFilter>('ALL');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [retryTarget, setRetryTarget] = useState<string | null>(null);
  const [enqueueOpen, setEnqueueOpen] = useState(false);

  async function confirmRetry() {
    if (!retryTarget) return;
    try {
      // La RPC crea una solicitud NUEVA que referencia a la fallida: el historial
      // de la original no se muta.
      await retry.mutateAsync({ p_request_id: retryTarget });
      toast.success('Reintento encolado', 'Se creó una solicitud nueva ligada a la fallida.');
    } catch (error) {
      toast.error('No se pudo reintentar', businessErrorMessage(error));
    } finally {
      setRetryTarget(null);
    }
  }
  const { term, setTerm, filtered } = useSearchFilter(requests.data, (r) => [
    r.action, PROVISIONING_ACTION_LABEL[r.action as string], r.status, r.idempotency_key,
    (r.tenants as { name: string } | null)?.name,
    (r.deployment_targets as { code: string } | null)?.code,
  ]);

  const rows = filtered.filter((r) => {
    switch (filter) {
      case 'OPEN': return OPEN_STATUSES.includes(r.status as string);
      case 'FAILED': return r.status === 'FAILED';
      case 'DONE': return r.status === 'SUCCEEDED';
      default: return true;
    }
  });

  const all = requests.data ?? [];
  const failed = all.filter((r) => r.status === 'FAILED').length;
  const open = all.filter((r) => OPEN_STATUSES.includes(r.status as string)).length;
  const done = all.filter((r) => r.status === 'SUCCEEDED').length;
  const toggle = (f: QueueFilter) => setFilter((current) => (current === f ? 'ALL' : f));
  const countIn = (f: QueueFilter) =>
    filtered.filter((r) =>
      f === 'OPEN' ? OPEN_STATUSES.includes(r.status as string) : f === 'FAILED' ? r.status === 'FAILED' : r.status === 'SUCCEEDED',
    ).length;

  return (
    <PageContainer
      title="Solicitudes de infraestructura"
      description="Cola de trabajos de infraestructura física con máquina de estados e idempotencia. No incluye las altas de tenants dentro de cada producto: esas son las altas en las apps."
      actions={
        perms.canManagePlatform ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setEnqueueOpen(true)}>
            Encolar solicitud
          </button>
        ) : null
      }
      titleAside={<Badge tone="info">Modo por defecto: simulación</Badge>}
      meta={
        <>
          ¿Buscas el alta de un tenant en una app?{' '}
          <Link className="ebim-link" to="/apps?tab=altas">
            Ir a Altas en las apps
          </Link>
        </>
      }
    >

      {requests.isLoading || all.length > 0 ? (
        <StatStrip label="Estado de la cola">
          <StatCell
            label="Solicitudes"
            value={formatNumber(all.length)}
            loading={requests.isLoading}
            context="Todas en simulación salvo indicación"
            onSelect={() => setFilter('ALL')}
            selected={filter === 'ALL'}
          />
          <StatCell
            label="En cola"
            value={formatNumber(open)}
            loading={requests.isLoading}
            context="Pendientes o en ejecución"
            tone={open > 0 ? 'warn' : 'neutral'}
            onSelect={() => toggle('OPEN')}
            selected={filter === 'OPEN'}
          />
          <StatCell
            label="Completadas"
            value={formatNumber(done)}
            loading={requests.isLoading}
            tone={done > 0 ? 'ok' : 'neutral'}
            onSelect={() => toggle('DONE')}
            selected={filter === 'DONE'}
          />
          <StatCell
            label="Fallidas"
            value={formatNumber(failed)}
            loading={requests.isLoading}
            tone={failed > 0 ? 'danger' : 'neutral'}
            context={failed > 0 ? 'Revisa el error y reintenta' : 'Ninguna fallida'}
            onSelect={() => toggle('FAILED')}
            selected={filter === 'FAILED'}
          />
        </StatStrip>
      ) : null}

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          total={requests.isLoading ? undefined : all.length}
          placeholder="Buscar por acción, tenant, destino o clave de idempotencia…"
          right={
            <StatusTabs
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'ALL', label: 'Todas', count: filtered.length },
                { id: 'OPEN', label: 'En cola', count: countIn('OPEN') },
                { id: 'FAILED', label: 'Fallidas', count: countIn('FAILED') },
                { id: 'DONE', label: 'Completadas', count: countIn('DONE') },
              ]}
            />
          }
        />
        {requests.isLoading ? (
          <LoadingState />
        ) : requests.error ? (
          <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState title="Sin solicitudes de infraestructura" description="Todavía no se encoló ningún trabajo de infraestructura." />
        ) : rows.length === 0 ? (
          <EmptyState
            variant="no-results"
            title="Ninguna solicitud coincide"
            description="Prueba con otra búsqueda o cambia de pestaña."
            onClear={() => {
              setTerm('');
              setFilter('ALL');
            }}
          />
        ) : (
          <DataTable
            label="Solicitudes de infraestructura"
            minWidth={900}
            columns={[
              { label: 'Acción', sticky: true },
              'Tenant y destino',
              'Estado',
              { label: 'Creada', mobile: false },
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {rows.flatMap((r) => {
              const id = r.id as string;
              const isExpanded = expanded === id;
              const events = ((r.provisioning_events ?? []) as Array<Record<string, unknown>>)
                .slice()
                .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
              return (
                [
                  <tr key={id}>
                    <td className="ebim-td py-2">
                      <div className="max-w-[240px]">
                        <CellTitle
                          title={PROVISIONING_ACTION_LABEL[r.action as string] ?? (r.action as string)}
                          tooltip={`Operación: ${r.action as string}`}
                        />
                      </div>
                    </td>
                    <td className="ebim-td py-2">
                      <div className="max-w-[240px]">
                        <CellTitle
                          title={(r.tenants as { name: string } | null)?.name ?? 'Sin tenant'}
                          to={r.tenant_id ? `/tenants/${r.tenant_id as string}` : undefined}
                          secondary={[(r.deployment_targets as { code: string } | null)?.code ?? 'Sin destino']}
                          monoParts={(r.deployment_targets as { code: string } | null)?.code ? [0] : []}
                        />
                      </div>
                    </td>
                    <td className="ebim-td py-2">
                      <StatusCell
                        label={provisioningStatusLabel(r.status as string)}
                        tone={provisioningRequestTone(r.status as string) as CellTone}
                        detail={
                          r.error_message ? (
                            <span className="block max-w-[220px] truncate text-danger" title={r.error_message as string}>
                              {r.error_message as string}
                            </span>
                          ) : r.mode === 'DRY_RUN' ? (
                            'Simulación'
                          ) : (
                            <span className="text-warn">Real · {r.mode as string}</span>
                          )
                        }
                      />
                    </td>
                    <td className="ebim-td py-2 text-compact">
                      <span className="block whitespace-nowrap leading-tight" title={formatDateTime(r.created_at as string)}>
                        <span className="block text-fg">{relativeAge(r.created_at as string)}</span>
                        {(r.attempts as number) > 1 ? (
                          <span className="block text-caption tabular-nums text-muted">
                            Intento {r.attempts as number} de {r.max_attempts as number}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="ebim-td text-right">
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        {r.status === 'FAILED' && (r.attempts as number) < (r.max_attempts as number) ? (
                          <button
                            type="button"
                            className="ebim-btn-secondary ebim-btn-sm"
                            onClick={() => setRetryTarget(id)}
                          >
                            Reintentar
                          </button>
                        ) : null}
                        {/* Historial bajo la fila: icono con su nombre accesible (lo usa el smoke e2e). */}
                        <button
                          type="button"
                          className="ebim-icon-btn"
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? 'Ocultar' : 'Timeline'}
                          title={isExpanded ? 'Ocultar el historial' : 'Ver el historial de la solicitud'}
                          onClick={() => setExpanded(isExpanded ? null : id)}
                        >
                          {isExpanded ? <CaretDownIcon size={16} aria-hidden /> : <CaretRightIcon size={16} aria-hidden />}
                        </button>
                      </div>
                    </td>
                  </tr>,
                  isExpanded ? (
                    <tr key={`${id}-detalle`}>
                      <td colSpan={5} className="bg-sunken px-4 py-3">
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                          <div className="min-w-0 space-y-2 text-compact">
                            <p className="text-micro text-muted">Resultado</p>
                            <p className="text-fg">
                              {r.mode === 'DRY_RUN'
                                ? 'Simulación: no se llamó a ninguna API remota ni se creó infraestructura.'
                                : 'Ejecución real: el resultado corresponde a la infraestructura del proveedor.'}
                            </p>
                            <p className="text-muted">
                              Clave de idempotencia:{' '}
                              <span className="break-all font-mono text-caption">{r.idempotency_key as string}</span>
                            </p>
                            {r.finished_at ? (
                              <p className="text-muted">Finalizada el {formatDateTime(r.finished_at as string)}</p>
                            ) : null}
                            {r.error_message ? (
                              <div role="note" className="rounded-field bg-danger-soft px-3 py-2 text-caption text-danger">
                                <p className="font-semibold">Error completo</p>
                                <p className="mt-1 whitespace-pre-wrap break-words">{r.error_message as string}</p>
                              </div>
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <p className="mb-2 text-micro text-muted">
                              Historial de la solicitud
                            </p>
                            <ol className="space-y-2">
                              {events.map((e) => (
                                <li key={e.id as string} className="relative border-l-2 border-border pb-1 pl-4 text-caption">
                                  <span
                                    aria-hidden
                                    className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-border-strong ring-2 ring-sunken"
                                  />
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge tone={provisioningRequestTone(e.status as string)}>{provisioningStatusLabel(e.status as string)}</Badge>
                                    <time className="text-muted" dateTime={e.occurred_at as string}>
                                      {formatDateTime(e.occurred_at as string)}
                                    </time>
                                  </div>
                                  <p className="mt-0.5 break-words text-fg">{e.message as string}</p>
                                </li>
                              ))}
                              {events.length === 0 ? (
                                <li className="text-caption text-muted">Sin eventos registrados.</li>
                              ) : null}
                            </ol>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ].filter(Boolean)
              );
            })}
          </DataTable>
        )}
      </Card>

      <ConfirmDialog
        open={retryTarget !== null}
        title="Reintentar solicitud de infraestructura"
        message="Se volverá a encolar la solicitud en simulación. La clave de idempotencia evita duplicar el trabajo si la operación anterior sí llegó a completarse."
        confirmLabel="Reintentar"
        tone="primary"
        onCancel={() => setRetryTarget(null)}
        onConfirm={confirmRetry}
      />

      <EnqueueProvisioningDialog open={enqueueOpen} onClose={() => setEnqueueOpen(false)} />
    </PageContainer>
  );
}
