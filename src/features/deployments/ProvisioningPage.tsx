import { Fragment, useState } from 'react';
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
  PageContainer, Card, DataTable, SearchBar, KpiTile, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatDateTime, formatNumber } from '@/lib/format';
import { KpiStrip } from '@/features/billing/financeUi';
import { PROVISIONING_STATUS_LABEL } from '@/types/domain';
import { EnqueueProvisioningDialog } from './DeploymentDialogs';

type QueueFilter = 'ALL' | 'OPEN' | 'FAILED' | 'DONE';

const ACTION_LABEL: Record<string, string> = {
  CREATE_TENANT_SPACE: 'Crear espacio de tenant',
  CREATE_DEDICATED_TARGET: 'Crear infraestructura dedicada',
  ATTACH_TENANT_TO_TARGET: 'Adjuntar tenant a destino',
  SUSPEND_TENANT: 'Suspender tenant',
  RESUME_TENANT: 'Reanudar tenant',
  DECOMMISSION_TENANT: 'Dar de baja tenant',
};

const OPEN_STATUSES = ['PENDING', 'VALIDATING', 'RUNNING'];

function statusLabel(status: string): string {
  return PROVISIONING_STATUS_LABEL[status as keyof typeof PROVISIONING_STATUS_LABEL] ?? status;
}

function statusTone(status: string): 'ok' | 'danger' | 'warn' | 'neutral' {
  if (status === 'SUCCEEDED') return 'ok';
  if (status === 'FAILED') return 'danger';
  if (status === 'CANCELLED') return 'neutral';
  return 'warn';
}

/** DRY_RUN y LIVE se dicen con palabras: una simulación no es un resultado real. */
function ModeBadge({ mode }: { mode: string }) {
  return mode === 'DRY_RUN' ? (
    <Badge tone="info">Simulación · DRY_RUN</Badge>
  ) : (
    <Badge tone="warn">Real · {mode}</Badge>
  );
}

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
    r.action, ACTION_LABEL[r.action as string], r.status, r.idempotency_key,
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

  return (
    <PageContainer
      title="Solicitudes de infraestructura"
      description="Cola de trabajos de infraestructura física con máquina de estados e idempotencia. No incluye las altas de tenants dentro de cada producto: esas son las Altas SaaS."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">Modo por defecto: DRY_RUN</Badge>
          {perms.canManagePlatform ? (
            <button type="button" className="ebim-btn-primary" onClick={() => setEnqueueOpen(true)}>
              Encolar solicitud
            </button>
          ) : null}
        </div>
      }
    >
      <p className="-mt-3 mb-5 text-compact text-muted">
        ¿Buscas el alta de un tenant en un producto?{' '}
        <Link className="ebim-link" to="/saas-provisioning">
          Ir a Altas SaaS
        </Link>
      </p>

      <KpiStrip label="Estado de la cola">
        <KpiTile label="Solicitudes" value={formatNumber(all.length)} loading={requests.isLoading} />
        <KpiTile
          label="En cola"
          value={formatNumber(all.filter((r) => OPEN_STATUSES.includes(r.status as string)).length)}
          loading={requests.isLoading}
          footer="Pendientes o en ejecución."
        />
        <KpiTile
          label="Completadas"
          value={formatNumber(all.filter((r) => r.status === 'SUCCEEDED').length)}
          tone="ok"
          loading={requests.isLoading}
        />
        <KpiTile label="Fallidas" value={formatNumber(failed)} tone={failed > 0 ? 'danger' : 'neutral'} loading={requests.isLoading} />
      </KpiStrip>

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por acción, tenant, destino o clave de idempotencia…"
          right={
            <StatusTabs
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'ALL', label: 'Todas', count: filtered.length },
                { id: 'OPEN', label: 'En cola' },
                { id: 'FAILED', label: 'Fallidas' },
                { id: 'DONE', label: 'Completadas' },
              ]}
            />
          }
        />
        {requests.isLoading ? (
          <LoadingState />
        ) : requests.error ? (
          <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="Sin solicitudes de infraestructura" description="Nada en cola para este filtro." />
        ) : (
          <DataTable
            label="Solicitudes de infraestructura"
            columns={['Acción', 'Tenant', 'Destino', 'Modo', 'Estado', { label: 'Intentos', align: 'right' }, 'Creada', { label: 'Acciones', srOnly: true }]}
          >
            {rows.map((r) => {
              const id = r.id as string;
              const isExpanded = expanded === id;
              const events = ((r.provisioning_events ?? []) as Array<Record<string, unknown>>)
                .slice()
                .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
              return (
                <Fragment key={id}>
                  <tr>
                    <td className="ebim-td">
                      <span className="font-medium">{ACTION_LABEL[r.action as string] ?? (r.action as string)}</span>
                      <p className="font-mono text-caption text-muted">{r.action as string}</p>
                    </td>
                    <td className="ebim-td">{(r.tenants as { name: string } | null)?.name ?? '—'}</td>
                    <td className="ebim-td font-mono text-caption text-muted">
                      {(r.deployment_targets as { code: string } | null)?.code ?? '—'}
                    </td>
                    <td className="ebim-td">
                      <ModeBadge mode={r.mode as string} />
                    </td>
                    <td className="ebim-td">
                      <Badge tone={statusTone(r.status as string)} dot>
                        {statusLabel(r.status as string)}
                      </Badge>
                      {r.error_message ? (
                        <p className="mt-1 max-w-[220px] truncate text-caption text-danger" title={r.error_message as string}>
                          {r.error_message as string}
                        </p>
                      ) : null}
                    </td>
                    <td className="ebim-td ebim-num text-compact">
                      {r.attempts as number}/{r.max_attempts as number}
                    </td>
                    <td className="ebim-td whitespace-nowrap text-caption text-muted">{formatDateTime(r.created_at as string)}</td>
                    <td className="ebim-td text-right">
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        <button
                          type="button"
                          className="ebim-btn-ghost ebim-btn-sm"
                          aria-expanded={isExpanded}
                          onClick={() => setExpanded(isExpanded ? null : id)}
                        >
                          {isExpanded ? 'Ocultar' : 'Timeline'}
                        </button>
                        {r.status === 'FAILED' && (r.attempts as number) < (r.max_attempts as number) ? (
                          <button
                            type="button"
                            className="ebim-btn-secondary ebim-btn-sm"
                            onClick={() => setRetryTarget(id)}
                          >
                            Reintentar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr>
                      <td colSpan={8} className="bg-sunken px-4 py-3">
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
                              Timeline de la solicitud
                            </p>
                            <ol className="space-y-2">
                              {events.map((e) => (
                                <li key={e.id as string} className="relative border-l-2 border-border pb-1 pl-4 text-caption">
                                  <span
                                    aria-hidden
                                    className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-border-strong ring-2 ring-sunken"
                                  />
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge tone={statusTone(e.status as string)}>{statusLabel(e.status as string)}</Badge>
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
                  ) : null}
                </Fragment>
              );
            })}
          </DataTable>
        )}
      </Card>

      <ConfirmDialog
        open={retryTarget !== null}
        title="Reintentar solicitud de infraestructura"
        message="Se volverá a encolar la solicitud en modo DRY_RUN. La clave de idempotencia evita duplicar el trabajo si la operación anterior sí llegó a completarse."
        confirmLabel="Reintentar"
        tone="primary"
        onCancel={() => setRetryTarget(null)}
        onConfirm={confirmRetry}
      />

      <EnqueueProvisioningDialog open={enqueueOpen} onClose={() => setEnqueueOpen(false)} />
    </PageContainer>
  );
}
