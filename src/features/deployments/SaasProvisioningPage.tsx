import { useState } from 'react';
import {
  useSaasProvisioningRequests,
  useSaasProvisioningEvents,
  useProvisioningPreconditions,
} from '@/services/queries';
import {
  useProvisionTenant,
  useRetrySaasProvisioning,
  useCancelSaasProvisioning,
} from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { useTaskQueue, type TaskResult } from '@/components/ui/task-queue-context';
import { businessErrorMessage } from '@/lib/pgError';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { StatCell, StatStrip } from '@/components/ui/StatStrip';
import { CellTitle, StatusCell, type CellTone } from '@/components/ui/cells';
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react';
import { formatDateTime, formatNumber } from '@/lib/format';
import { relativeAge } from '@/features/suite/suiteModel';
import { Avatar } from '@/components/ui/Avatar';
import { ActionMenu } from '@/components/ui/ActionMenu';
import {
  INTEGRATION_TYPE_LABEL,
  MAPPING_STATUS_LABEL,
  PROVISIONING_ENVIRONMENT_LABEL,
  PROVISIONING_POLICY_LABEL,
  SAAS_PROVISIONING_STATUS_LABEL,
  blockerLabel,
  canCancel,
  canProvision,
  canRegisterManually,
  canRetry,
  providerErrorLabel,
  provisioningStatusTone,
  type IntegrationType,
  type ProvisioningEnvironment,
  type ProvisioningPolicy,
  type SaasProvisioningStatus,
  type TenantProductMappingStatus,
} from '@/lib/provisioning';
import { NewProvisioningRequestDialog, RegisterManualDialog } from './ProvisioningDialogs';
import { ProductConfigurationForm } from './ProductConfigurationForm';
import { ProvisioningStatusAction } from './ProvisioningStatusAction';
import { contractAdapterFor } from './contractAdapters';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import type { DeploymentMode } from '@/types/domain';

type QueueFilter = 'ALL' | 'OPEN' | 'WAITING' | 'FAILED' | 'ACTIVE';

const OPEN_STATUSES: SaasProvisioningStatus[] = ['PENDING', 'READY_TO_PROVISION', 'PROVISIONING'];

/** Capacidades que declara el contrato de la integración (no son permisos). */
const CAPABILITY_LABEL: Record<string, string> = {
  PROVISION: 'Alta en el producto',
  GET_STATUS: 'Consulta de estado',
  REPLAY_CERTIFICATION: 'Repetición controlada fuera de producción',
};

function mappingTone(status: TenantProductMappingStatus): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (status === 'ACTIVE') return 'ok';
  if (status === 'FAILED') return 'danger';
  if (status === 'PENDING') return 'warn';
  return 'neutral';
}

/**
 * Provisioning SaaS: el alta de cada tenant DENTRO de cada producto.
 *
 * Eje distinto del provisioning de infraestructura (crear un proyecto Supabase),
 * que vive en su propia pantalla. Aquí la pregunta es «¿existe ya este tenant en
 * EWM?», no «¿existe la base de datos?».
 *
 * La ejecución NO sale de esta pantalla hacia el producto: va al orquestador
 * server-side, que comprueba el permiso contra la base antes de hacer nada y
 * resuelve él toda la configuración.
 *
 * Abrir, recargar o volver a esta pantalla sólo LEE: ninguna solicitud se crea
 * ni se ejecuta por navegar. Cada acción es un botón explícito y sólo aparece si
 * el estado, el permiso y la capacidad del contrato la admiten.
 */
export function SaasProvisioningPage() {
  const requests = useSaasProvisioningRequests();
  const access = useProvisioningAccess();
  const toast = useToast();
  const queue = useTaskQueue();

  const provision = useProvisionTenant();
  const retry = useRetrySaasProvisioning();
  const cancel = useCancelSaasProvisioning();

  const [filter, setFilter] = useState<QueueFilter>('ALL');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; label: string } | null>(null);
  const [manualTarget, setManualTarget] = useState<{
    id: string;
    tenant: string;
    product: string;
  } | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const { term, setTerm, filtered } = useSearchFilter(requests.data, (r) => [
    r.tenant_name,
    r.tenant_slug,
    r.product_short_name,
    r.status,
    r.idempotency_key,
    r.correlation_id,
    r.external_tenant_id,
    r.deployment_code,
  ]);

  const rows = filtered.filter((r) => {
    const status = r.status as SaasProvisioningStatus;
    switch (filter) {
      case 'OPEN':
        return OPEN_STATUSES.includes(status);
      case 'WAITING':
        return status === 'WAITING_INFRA';
      case 'FAILED':
        return status === 'FAILED';
      case 'ACTIVE':
        return status === 'ACTIVE';
      default:
        return true;
    }
  });

  const all = requests.data ?? [];
  const countBy = (status: SaasProvisioningStatus) =>
    all.filter((r) => r.status === status).length;
  const inFlight = all.filter((r) => OPEN_STATUSES.includes(r.status as SaasProvisioningStatus)).length;
  const toggle = (f: QueueFilter) => setFilter((current) => (current === f ? 'ALL' : f));

  /** «Ejecutar alta» (V5 · F5): tarea visible en la cola del shell, con su resultado y el enlace al tenant. */
  async function runProvision(requestId: string, label: string, tenantId: string | null) {
    try {
      await queue.track(
        { title: `Ejecutar alta · ${label}`, link: tenantId ? { to: `/tenants/${tenantId}`, label: 'Ver el tenant' } : undefined },
        () => provision.mutateAsync(requestId),
        (result): TaskResult => {
          if (result.status === 'ACTIVE') {
            return { status: 'success', title: 'Tenant provisionado', detail: `${label}${result.external_tenant_id ? ` · ${result.external_tenant_id}` : ''}` };
          }
          if (result.status === 'FAILED') {
            return {
              status: 'error',
              title: 'El producto rechazó la operación',
              detail: providerErrorLabel(result.error_code) ?? result.message ?? 'Sin detalle',
            };
          }
          return { status: 'info', title: 'Alta en curso', detail: result.message ?? `${label}: la app sigue procesando.` };
        },
        (error) => ({ status: 'error', title: 'No se pudo provisionar', detail: businessErrorMessage(error) }),
      );
    } catch {
      /* El fallo ya quedó en la cola con su motivo. */
    }
  }

  async function runRetry(requestId: string) {
    try {
      await retry.mutateAsync({ p_request_id: requestId });
      toast.success(
        'Reintento habilitado',
        'Se conserva la misma clave de idempotencia: para el producto es el mismo intento.',
      );
    } catch (error) {
      toast.error('No se pudo reintentar', businessErrorMessage(error));
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    try {
      await cancel.mutateAsync({
        p_request_id: cancelTarget.id,
        p_reason: 'Cancelada desde la consola',
      });
      toast.success('Solicitud cancelada', cancelTarget.label);
    } catch (error) {
      toast.error('No se pudo cancelar', businessErrorMessage(error));
    } finally {
      setCancelTarget(null);
    }
  }

  return (
    <PageContainer
      title="Altas en las apps"
      description="El alta del espacio de cada cliente dentro de cada app de la suite. El Admin Maestro llama a la app por su conexión segura, nunca a su base de datos. La infraestructura física tiene su propia cola, en «Solicitudes de infraestructura»."
      actions={
        access.can('platform.provisioning.execute') || access.ownedProductIds.length > 0 ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setNewOpen(true)}>
            Nueva solicitud
          </button>
        ) : null
      }
    >
      {requests.isLoading || all.length > 0 ? (
        <StatStrip label="Estado de las altas">
          <StatCell
            label="Activas"
            value={formatNumber(countBy('ACTIVE'))}
            context={`de ${formatNumber(all.length)} solicitudes`}
            loading={requests.isLoading}
            onSelect={() => toggle('ACTIVE')}
            selected={filter === 'ACTIVE'}
          />
          <StatCell
            label="En curso"
            value={formatNumber(inFlight)}
            context={
              countBy('READY_TO_PROVISION') > 0
                ? `${formatNumber(countBy('READY_TO_PROVISION'))} listas para ejecutar`
                : 'Solicitadas o en ejecución'
            }
            tone={inFlight > 0 ? 'warn' : 'neutral'}
            loading={requests.isLoading}
            onSelect={() => toggle('OPEN')}
            selected={filter === 'OPEN'}
          />
          <StatCell
            label="Infraestructura pendiente"
            value={formatNumber(countBy('WAITING_INFRA'))}
            context="El destino dedicado aún no existe"
            tone={countBy('WAITING_INFRA') > 0 ? 'warn' : 'neutral'}
            loading={requests.isLoading}
            onSelect={() => toggle('WAITING')}
            selected={filter === 'WAITING'}
          />
          <StatCell
            label="Fallidas"
            value={formatNumber(countBy('FAILED'))}
            context={countBy('FAILED') > 0 ? 'Revisa el error y reintenta' : 'Ninguna alta fallida'}
            tone={countBy('FAILED') > 0 ? 'danger' : 'ok'}
            loading={requests.isLoading}
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
          placeholder="Buscar por tenant, app, destino, correlación o ID externo…"
          right={
            <StatusTabs
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'ALL', label: 'Todas', count: all.length },
                { id: 'OPEN', label: 'En curso', count: inFlight },
                { id: 'WAITING', label: 'Infra pendiente', count: countBy('WAITING_INFRA') },
                { id: 'FAILED', label: 'Fallidas', count: countBy('FAILED') },
                { id: 'ACTIVE', label: 'Activas', count: countBy('ACTIVE') },
              ]}
            />
          }
        />

        {requests.isLoading ? (
          <LoadingState />
        ) : requests.error ? (
          <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState
            title="Sin solicitudes de alta"
            description="Crear una cotización no da de alta a nadie: la política por defecto es manual hasta certificar la conexión con cada app."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            variant="no-results"
            title={term ? `Ningún resultado para «${term}»` : 'Ninguna solicitud en este estado'}
            description="Prueba con otra búsqueda o cambia de pestaña."
            onClear={() => {
              setTerm('');
              setFilter('ALL');
            }}
          />
        ) : (
          <DataTable
            label="Solicitudes de alta SaaS"
            minWidth={960}
            columns={[
              { label: 'Tenant', sticky: true },
              { label: 'App y entorno' },
              { label: 'Estado' },
              { label: 'Solicitado', mobile: false },
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {rows.flatMap((r) => {
              const status = r.status as SaasProvisioningStatus;
              const id = r.id as string;
              const label = `${r.tenant_name} · ${r.product_short_name}`;
              const canExecute = access.canForProduct(
                'platform.provisioning.execute',
                r.saas_product_id,
              );
              const isExpanded = expanded === id;

              return (
                [
                  <tr key={id}>
                    <td className="ebim-td py-2">
                      <div className="max-w-[300px]">
                        <CellTitle
                          title={(r.tenant_name as string) ?? '—'}
                          to={`/tenants/${r.tenant_id}`}
                          wrap
                          tooltip={`${r.tenant_name}${r.tenant_slug ? `\nCódigo: ${r.tenant_slug}` : ''}`}
                          leading={<Avatar name={(r.tenant_name as string) ?? '—'} />}
                        />
                      </div>
                    </td>
                    <td className="ebim-td py-2">
                      <div
                        className="max-w-[220px] leading-tight"
                        title={r.deployment_code ? `Destino: ${r.deployment_code}` : 'Sin destino asignado'}
                      >
                        <div className="truncate font-semibold text-fg">{r.product_short_name}</div>
                        <div className="truncate text-caption text-muted">
                          {[
                            PROVISIONING_ENVIRONMENT_LABEL[r.provisioning_environment as ProvisioningEnvironment],
                            DEPLOYMENT_MODE_LABEL[r.deployment_mode as DeploymentMode],
                            r.deployment_code ? null : 'sin destino',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                    </td>
                    <td className="ebim-td py-2">
                      <StatusCell
                        label={SAAS_PROVISIONING_STATUS_LABEL[status]}
                        tone={provisioningStatusTone(status) as CellTone}
                        detail={
                          r.last_error_code && status === 'FAILED' ? (
                            <span
                              className="block max-w-[220px] truncate text-danger"
                              title={providerErrorLabel(r.last_error_code) ?? ''}
                            >
                              {providerErrorLabel(r.last_error_code)}
                            </span>
                          ) : undefined
                        }
                      />
                    </td>
                    <td className="ebim-td py-2 text-compact">
                      <span
                        className="block whitespace-nowrap leading-tight"
                        title={`${r.requested_by_name ?? 'Sin dato'} · ${r.requested_at ? formatDateTime(r.requested_at) : '—'}`}
                      >
                        <span className="block text-fg">{r.requested_at ? relativeAge(r.requested_at) : '—'}</span>
                        {(r.attempt_count as number) > 1 ? (
                          <span className="block text-caption tabular-nums text-muted">
                            Intento {r.attempt_count as number} de {r.max_attempts as number}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="ebim-td text-right">
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        {canExecute && canProvision(status) ? (
                          <button
                            type="button"
                            className="ebim-btn-primary ebim-btn-sm"
                            disabled={provision.isPending}
                            onClick={() => void runProvision(id, label, (r.tenant_id as string | null) ?? null)}
                          >
                            Ejecutar alta
                          </button>
                        ) : null}
                        {canExecute &&
                        canRetry(status, r.attempt_count as number, r.max_attempts as number) ? (
                          <button
                            type="button"
                            className="ebim-btn-secondary ebim-btn-sm"
                            disabled={retry.isPending}
                            onClick={() => void runRetry(id)}
                          >
                            Reintentar
                          </button>
                        ) : null}
                        {/* El detalle se despliega bajo la fila; un icono en lugar de un botón de texto por fila. */}
                        <button
                          type="button"
                          className="ebim-icon-btn"
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? 'Ocultar' : 'Detalle'}
                          title={isExpanded ? 'Ocultar el detalle' : 'Ver el detalle de la solicitud'}
                          onClick={() => setExpanded(isExpanded ? null : id)}
                        >
                          {isExpanded ? <CaretDownIcon size={16} aria-hidden /> : <CaretRightIcon size={16} aria-hidden />}
                        </button>
                        <ActionMenu
                          variant="icon"
                          label={`Acciones de ${label}`}
                          items={[
                            canExecute && canRegisterManually(status)
                              ? {
                                  label: 'Registrar manual',
                                  onSelect: () =>
                                    setManualTarget({
                                      id,
                                      tenant: r.tenant_name as string,
                                      product: r.product_short_name as string,
                                    }),
                                }
                              : null,
                            { label: 'Ver tenant', to: `/tenants/${r.tenant_id}` },
                            access.canForProduct('platform.provisioning.cancel', r.saas_product_id) && canCancel(status)
                              ? { label: 'Cancelar solicitud', tone: 'danger' as const, onSelect: () => setCancelTarget({ id, label }) }
                              : null,
                          ]}
                        />
                      </div>
                    </td>
                  </tr>,
                  isExpanded ? (
                    <tr key={`${id}-detalle`}>
                      <td className="ebim-td bg-sunken" colSpan={5}>
                        <RequestDetail request={r as Record<string, unknown>} />
                      </td>
                    </tr>
                  ) : null,
                ].filter(Boolean)
              );
            })}
          </DataTable>
        )}
      </Card>

      <NewProvisioningRequestDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <RegisterManualDialog
        open={Boolean(manualTarget)}
        requestId={manualTarget?.id ?? null}
        tenantName={manualTarget?.tenant ?? ''}
        productName={manualTarget?.product ?? ''}
        onClose={() => setManualTarget(null)}
      />
      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="Cancelar solicitud de alta"
        message={`${cancelTarget?.label ?? ''} quedará cancelada. No se borra nada: la solicitud queda en el historial y se podrá crear una nueva.`}
        confirmLabel="Cancelar solicitud"
        cancelLabel="Volver"
        onConfirm={confirmCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </PageContainer>
  );
}

/**
 * Detalle de una solicitud como UNA operación legible (spec §12): solicitud →
 * intentos → identidad en el producto (mapping) → error → capacidades, con el
 * historial al lado. Sólo lectura; las acciones siguen en la fila.
 */
function RequestDetail({ request }: { request: Record<string, unknown> }) {
  const id = request.id as string;
  const events = useSaasProvisioningEvents(id);
  const preconditions = useProvisioningPreconditions(id);
  const status = request.status as SaasProvisioningStatus;

  const blockers = preconditions.data?.blockers ?? [];
  const errorCode = request.last_error_code as string | null;
  const capabilities = (request.capabilities as string[] | null | undefined) ?? [];
  const mappingStatus = request.mapping_status as TenantProductMappingStatus | null;

  return (
    <div className="grid gap-4 py-3 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="mb-2 text-micro text-muted">
          Identidad y trazabilidad
        </p>
        <dl className="space-y-1 text-compact">
          <Pair label="Correlación" value={(request.correlation_id as string) ?? '—'} mono />
          <Pair label="Idempotencia" value={(request.idempotency_key as string) ?? '—'} mono />
          <Pair label="Versión de la solicitud" value={String(request.request_version ?? '—')} />
          <Pair
            label="Política aplicada"
            value={PROVISIONING_POLICY_LABEL[request.provisioning_policy as ProvisioningPolicy] ?? '—'}
          />
          <Pair
            label="Adaptador"
            value={
              request.integration_type
                ? INTEGRATION_TYPE_LABEL[request.integration_type as IntegrationType]
                : 'Sin integración'
            }
          />
          <Pair label="Contrato" value={(request.contract_version as string) ?? '—'} />
          <Pair
            label="Forma del contrato"
            value={contractAdapterFor(request.adapter_key as string | null).label}
          />
        </dl>

        <p className="mt-4 mb-2 text-micro text-muted">Intentos</p>
        <dl className="space-y-1 text-compact">
          <Pair
            label="Usados"
            value={`${String(request.attempt_count ?? 0)} de ${String(request.max_attempts ?? '—')}`}
          />
          <Pair
            label="Solicitada"
            value={request.requested_at ? formatDateTime(request.requested_at as string) : '—'}
          />
          <Pair
            label="Inicio de la ejecución"
            value={request.started_at ? formatDateTime(request.started_at as string) : 'Sin ejecutar'}
          />
          <Pair
            label="Finalizada"
            value={request.completed_at ? formatDateTime(request.completed_at as string) : '—'}
          />
          {request.cancelled_at ? (
            <Pair
              label="Cancelada"
              value={`${formatDateTime(request.cancelled_at as string)}${
                request.cancel_reason ? ` · ${request.cancel_reason as string}` : ''
              }`}
            />
          ) : null}
        </dl>

        <p className="mt-4 mb-2 text-micro text-muted">
          Identidad en el producto
        </p>
        {mappingStatus ? (
          <p className="mb-1.5 flex flex-wrap items-center gap-2 text-compact">
            <span className="text-muted">Mapping:</span>
            <Badge tone={mappingTone(mappingStatus)}>{MAPPING_STATUS_LABEL[mappingStatus] ?? mappingStatus}</Badge>
          </p>
        ) : null}
        {request.external_tenant_id ? (
          <dl className="space-y-1 text-compact">
            <Pair label="Tenant externo" value={request.external_tenant_id as string} mono />
            <Pair
              label="Organización externa"
              value={(request.external_organization_id as string) ?? '—'}
              mono
            />
            <Pair
              label="Sociedad externa"
              value={(request.external_company_id as string) ?? '—'}
              mono
            />
            {request.registered_manually ? (
              <p className="pt-1 text-caption text-muted">Registrado manualmente por un operador.</p>
            ) : null}
          </dl>
        ) : (
          <p className="text-compact text-muted">
            Todavía no hay identidad en el producto: el alta no se ha completado.
          </p>
        )}

        {errorCode ? (
          <>
            <p className="mt-4 mb-2 text-micro text-muted">
              Último error
            </p>
            <div role="note" className="rounded-field border border-border bg-danger-soft p-3 text-compact">
              <p className="font-semibold text-danger">{providerErrorLabel(errorCode)}</p>
              <p className="mt-0.5 font-mono text-caption text-muted">{errorCode}</p>
              {request.last_error_message ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-fg">
                  {request.last_error_message as string}
                </p>
              ) : null}
              {request.provider_http_status ? (
                <p className="mt-1 font-mono text-caption text-muted">
                  HTTP {String(request.provider_http_status)}
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        <p className="mt-4 mb-2 text-micro text-muted">
          Capacidades del contrato
        </p>
        {capabilities.length === 0 ? (
          <p className="text-compact text-muted">El contrato no declara capacidades.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label="Capacidades del contrato">
            {capabilities.map((c) => (
              <li key={c}>
                <Badge tone="info">{CAPABILITY_LABEL[c] ?? c}</Badge>
              </li>
            ))}
          </ul>
        )}

        <ProductConfigurationForm request={request} />
        <ProvisioningStatusAction request={request} />

        {blockers.length > 0 && status !== 'ACTIVE' ? (
          <>
            <p className="mt-4 mb-2 text-micro text-muted">
              Por qué no se puede ejecutar todavía
            </p>
            <ul className="space-y-1 text-compact text-muted">
              {blockers.map((code) => (
                <li key={code}>· {blockerLabel(code)}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <div className="min-w-0">
        <p className="mb-2 text-micro text-muted">
          Historial de la solicitud
        </p>
        {events.isLoading ? (
          <LoadingState />
        ) : events.error ? (
          <ErrorState error={events.error} onRetry={() => void events.refetch()} />
        ) : (events.data ?? []).length === 0 ? (
          <p className="text-compact text-muted">Sin eventos.</p>
        ) : (
          <ol className="space-y-2">
            {(events.data ?? []).map((e) => (
              <li key={e.id} className="border-l-2 border-border pl-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={provisioningStatusTone(e.status as SaasProvisioningStatus)}>
                    {SAAS_PROVISIONING_STATUS_LABEL[e.status as SaasProvisioningStatus]}
                  </Badge>
                  <span className="font-mono text-caption text-muted">{e.action}</span>
                  <time className="text-caption text-muted" dateTime={e.occurred_at}>
                    {formatDateTime(e.occurred_at)}
                  </time>
                  {e.attempt ? <span className="text-caption text-muted">Intento {e.attempt}</span> : null}
                  {e.provider_http_status ? (
                    <span className="font-mono text-caption text-muted">HTTP {e.provider_http_status}</span>
                  ) : null}
                </div>
                <p className="mt-0.5 break-words text-compact text-fg">{e.message}</p>
                {e.actor_role ? (
                  <p className="text-caption text-muted">Actor: {e.actor_role}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function Pair({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <dt className="shrink-0 text-muted sm:w-44">{label}</dt>
      <dd className={mono ? 'min-w-0 break-all font-mono text-caption' : 'min-w-0'}>{value}</dd>
    </div>
  );
}
