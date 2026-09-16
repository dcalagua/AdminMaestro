import { useState } from 'react';
import { Link } from 'react-router-dom';
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
import { businessErrorMessage } from '@/lib/pgError';
import {
  PageContainer, Card, DataTable, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import {
  INTEGRATION_TYPE_LABEL,
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
} from '@/lib/provisioning';
import { NewProvisioningRequestDialog, RegisterManualDialog } from './ProvisioningDialogs';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import type { DeploymentMode } from '@/types/domain';

type QueueFilter = 'ALL' | 'OPEN' | 'WAITING' | 'FAILED' | 'ACTIVE';

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
 */
export function SaasProvisioningPage() {
  const requests = useSaasProvisioningRequests();
  const access = useProvisioningAccess();
  const toast = useToast();

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
        return ['PENDING', 'READY_TO_PROVISION', 'PROVISIONING'].includes(status);
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

  async function runProvision(requestId: string, label: string) {
    try {
      const result = await provision.mutateAsync(requestId);
      if (result.status === 'ACTIVE') {
        toast.success('Tenant provisionado', `${label} · ${result.external_tenant_id ?? ''}`);
      } else if (result.status === 'FAILED') {
        toast.error(
          'El producto rechazó la operación',
          providerErrorLabel(result.error_code) ?? result.message ?? 'Sin detalle',
        );
      } else {
        toast.push('info', 'Provisioning en curso', result.message ?? `Estado: ${result.status}`);
      }
    } catch (error) {
      toast.error('No se pudo provisionar', businessErrorMessage(error));
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
      title="Provisioning SaaS"
      description="El alta de cada tenant DENTRO de cada producto de la suite. MasterAdmin llama a la API del producto; nunca a su base de datos."
      actions={
        access.can('platform.provisioning.execute') || access.ownedProductIds.length > 0 ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setNewOpen(true)}>
            Nueva solicitud
          </button>
        ) : null
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Activos" value={String(countBy('ACTIVE'))} tone="ok" />
        <StatCard label="Listos para provisionar" value={String(countBy('READY_TO_PROVISION'))} />
        <StatCard
          label="Infraestructura pendiente"
          value={String(countBy('WAITING_INFRA'))}
          tone={countBy('WAITING_INFRA') > 0 ? 'warn' : 'neutral'}
        />
        <StatCard
          label="Fallidos"
          value={String(countBy('FAILED'))}
          tone={countBy('FAILED') > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por tenant, producto, destino, correlación o ID externo…"
          right={
            <StatusTabs
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'ALL', label: 'Todas', count: all.length },
                { id: 'OPEN', label: 'En curso' },
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
        ) : rows.length === 0 ? (
          <EmptyState
            title="Sin solicitudes de provisioning"
            description="Crear una cotización NO aprovisiona: la política por defecto es manual hasta certificar el contrato de cada producto."
          />
        ) : (
          <DataTable
            columns={[
              'Tenant',
              'Producto',
              'Ambiente',
              'Destino',
              'Modo',
              'Estado',
              'Intentos',
              'Solicitado por',
              'Creado',
              '',
            ]}
          >
            {rows.map((r) => {
              const status = r.status as SaasProvisioningStatus;
              const id = r.id as string;
              const label = `${r.tenant_name} · ${r.product_short_name}`;
              const canExecute = access.canForProduct(
                'platform.provisioning.execute',
                r.saas_product_id,
              );
              const isExpanded = expanded === id;

              return (
                <>
                  <tr key={id}>
                    <td className="ebim-td">
                      <Link
                        to={`/tenants/${r.tenant_id}`}
                        className="font-semibold text-accent-deep hover:underline"
                      >
                        {r.tenant_name}
                      </Link>
                      <p className="font-mono text-xs text-muted">{r.tenant_slug}</p>
                    </td>
                    <td className="ebim-td">{r.product_short_name}</td>
                    <td className="ebim-td">
                      {
                        PROVISIONING_ENVIRONMENT_LABEL[
                          r.provisioning_environment as ProvisioningEnvironment
                        ]
                      }
                    </td>
                    <td className="ebim-td">
                      {r.deployment_code ? (
                        <span className="font-mono text-[13px]">{r.deployment_code}</span>
                      ) : (
                        <span className="text-muted">Sin asignar</span>
                      )}
                    </td>
                    <td className="ebim-td">
                      <Badge>{DEPLOYMENT_MODE_LABEL[r.deployment_mode as DeploymentMode]}</Badge>
                    </td>
                    <td className="ebim-td">
                      <Badge tone={provisioningStatusTone(status)}>
                        {SAAS_PROVISIONING_STATUS_LABEL[status]}
                      </Badge>
                    </td>
                    <td className="ebim-td tabular-nums">
                      {r.attempt_count}/{r.max_attempts}
                    </td>
                    <td className="ebim-td">{r.requested_by_name ?? '—'}</td>
                    <td className="ebim-td whitespace-nowrap">{formatDateTime(r.requested_at)}</td>
                    <td className="ebim-td text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {canExecute && canProvision(status) ? (
                          <button
                            type="button"
                            className="ebim-btn-primary"
                            disabled={provision.isPending}
                            onClick={() => void runProvision(id, label)}
                          >
                            Provisionar
                          </button>
                        ) : null}
                        {canExecute &&
                        canRetry(status, r.attempt_count as number, r.max_attempts as number) ? (
                          <button
                            type="button"
                            className="ebim-btn-secondary"
                            onClick={() => void runRetry(id)}
                          >
                            Reintentar
                          </button>
                        ) : null}
                        {canExecute && canRegisterManually(status) ? (
                          <button
                            type="button"
                            className="ebim-btn-ghost"
                            onClick={() =>
                              setManualTarget({
                                id,
                                tenant: r.tenant_name as string,
                                product: r.product_short_name as string,
                              })
                            }
                          >
                            Registrar manual
                          </button>
                        ) : null}
                        {access.canForProduct('platform.provisioning.cancel', r.saas_product_id) &&
                        canCancel(status) ? (
                          <button
                            type="button"
                            className="ebim-btn-ghost"
                            onClick={() => setCancelTarget({ id, label })}
                          >
                            Cancelar
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="ebim-btn-ghost"
                          onClick={() => setExpanded(isExpanded ? null : id)}
                        >
                          {isExpanded ? 'Ocultar' : 'Detalle'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr key={`${id}-detail`}>
                      <td className="ebim-td bg-[color:var(--bg)]" colSpan={10}>
                        <RequestDetail request={r as Record<string, unknown>} />
                      </td>
                    </tr>
                  ) : null}
                </>
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
        title="Cancelar solicitud de provisioning"
        message={`${cancelTarget?.label ?? ''} quedará cancelada. No se borra nada: la solicitud queda en el historial y se podrá crear una nueva.`}
        confirmLabel="Cancelar solicitud"
        cancelLabel="Volver"
        onConfirm={() => void confirmCancel()}
        onCancel={() => setCancelTarget(null)}
      />
    </PageContainer>
  );
}

/** Detalle de una solicitud: identidad, configuración, errores y timeline. */
function RequestDetail({ request }: { request: Record<string, unknown> }) {
  const id = request.id as string;
  const events = useSaasProvisioningEvents(id);
  const preconditions = useProvisioningPreconditions(id);
  const status = request.status as SaasProvisioningStatus;

  const blockers = preconditions.data?.blockers ?? [];
  const errorCode = request.last_error_code as string | null;

  return (
    <div className="grid gap-4 py-3 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
          Identidad y trazabilidad
        </p>
        <dl className="space-y-1 text-[13px]">
          <Pair label="Correlación" value={request.correlation_id as string} mono />
          <Pair label="Idempotencia" value={request.idempotency_key as string} mono />
          <Pair label="Versión de la solicitud" value={String(request.request_version)} />
          <Pair
            label="Política aplicada"
            value={PROVISIONING_POLICY_LABEL[request.provisioning_policy as ProvisioningPolicy]}
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
        </dl>

        <p className="mt-4 mb-2 text-xs font-bold uppercase tracking-wide text-muted">
          Identidad en el producto
        </p>
        {request.external_tenant_id ? (
          <dl className="space-y-1 text-[13px]">
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
              <p className="pt-1 text-xs text-muted">Registrado manualmente por un operador.</p>
            ) : null}
          </dl>
        ) : (
          <p className="text-[13px] text-muted">
            Todavía no hay identidad en el producto: el alta no se ha completado.
          </p>
        )}

        {errorCode ? (
          <>
            <p className="mt-4 mb-2 text-xs font-bold uppercase tracking-wide text-muted">
              Último error
            </p>
            <div className="rounded-field border border-danger-soft bg-danger-soft/40 p-3 text-[13px]">
              <p className="font-semibold text-danger">{providerErrorLabel(errorCode)}</p>
              {request.last_error_message ? (
                <p className="mt-1 text-muted">{request.last_error_message as string}</p>
              ) : null}
              {request.provider_http_status ? (
                <p className="mt-1 font-mono text-xs text-muted">
                  HTTP {String(request.provider_http_status)}
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {blockers.length > 0 && status !== 'ACTIVE' ? (
          <>
            <p className="mt-4 mb-2 text-xs font-bold uppercase tracking-wide text-muted">
              Por qué no se puede ejecutar todavía
            </p>
            <ul className="space-y-1 text-[13px] text-muted">
              {blockers.map((code) => (
                <li key={code}>· {blockerLabel(code)}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
          Historial de la solicitud
        </p>
        {events.isLoading ? (
          <LoadingState />
        ) : (events.data ?? []).length === 0 ? (
          <p className="text-[13px] text-muted">Sin eventos.</p>
        ) : (
          <ol className="space-y-2">
            {(events.data ?? []).map((e) => (
              <li key={e.id} className="border-l-2 border-border pl-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={provisioningStatusTone(e.status as SaasProvisioningStatus)}>
                    {SAAS_PROVISIONING_STATUS_LABEL[e.status as SaasProvisioningStatus]}
                  </Badge>
                  <span className="font-mono text-xs text-muted">{e.action}</span>
                  <span className="text-xs text-muted">{formatDateTime(e.occurred_at)}</span>
                </div>
                <p className="mt-0.5 text-[13px] text-fg">{e.message}</p>
                {e.actor_role ? (
                  <p className="text-xs text-muted">Actor: {e.actor_role}</p>
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
    <div className="flex gap-2">
      <dt className="w-44 shrink-0 text-muted">{label}</dt>
      <dd className={mono ? 'min-w-0 break-all font-mono text-xs' : 'min-w-0'}>{value}</dd>
    </div>
  );
}
