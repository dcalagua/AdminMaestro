import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, DataTable, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { SelectInput } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { useProvisioningTargets, useSaasProvisioningRequests } from '@/services/queries';
import {
  useCreateSaasProvisioningRequest,
  useProvisionTenant,
  useRetrySaasProvisioning,
} from '@/services/mutations';
import { businessErrorMessage } from '@/lib/pgError';
import { providerErrorLabel, type ProvisioningEnvironment } from '@/lib/provisioning';
import { latestRequestByTenant, type ProvisioningRow, type TargetRow } from '@/features/suite/suiteModel';
import { altaEnvironments, altaState } from './flowModel';

export interface AltaTenant {
  tenantId: string;
  tenantName: string;
  productId: string;
  productName: string;
  productCode?: string | null;
  subscriptionId?: string | null;
}

/**
 * «Alta en las apps» (V5 · F4): por cada app contratada, la solicitud de alta
 * (`create_saas_provisioning_request`, en el ambiente donde la app tiene el
 * destino habilitado) y «Ejecutar alta» con el MISMO orquestador que Altas en
 * las apps. Nada se ejecuta solo: cada paso es un botón explícito, con el
 * permiso de provisioning de esa app. La base decide si la solicitud queda
 * lista, pendiente (política, pago, infraestructura) o se reutiliza.
 *
 * Ninguna app tiene trato especial aquí: el ambiente sale de sus destinos.
 */
export function AppProvisioningPanel({ tenants }: { tenants: AltaTenant[] }) {
  const toast = useToast();
  const access = useProvisioningAccess();
  const requests = useSaasProvisioningRequests();
  const targets = useProvisioningTargets();
  const create = useCreateSaasProvisioningRequest();
  const provision = useProvisionTenant();
  const retry = useRetrySaasProvisioning();

  const [envChoice, setEnvChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (requests.isLoading || targets.isLoading) return <LoadingState label="Leyendo las altas en las apps…" />;
  if (requests.error) return <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />;
  if (tenants.length === 0) {
    return <EmptyState title="Sin apps por dar de alta" description="La cuenta no tiene tenants contratados en la suite." />;
  }

  const latest = latestRequestByTenant((requests.data ?? []) as ProvisioningRow[]);
  const targetRows = (targets.data ?? []) as TargetRow[];

  async function run(t: AltaTenant, fn: () => Promise<void>) {
    setBusy(t.tenantId);
    setErrors((e) => ({ ...e, [t.tenantId]: '' }));
    try {
      await fn();
    } catch (error) {
      const message = businessErrorMessage(error);
      setErrors((e) => ({ ...e, [t.tenantId]: message }));
      toast.error(`No se pudo completar el alta en ${t.productName}`, message);
    } finally {
      setBusy(null);
    }
  }

  async function execute(t: AltaTenant, requestId: string) {
    const result = await provision.mutateAsync(requestId);
    if (result.status === 'ACTIVE') {
      toast.success(`Alta activa en ${t.productName}`, t.tenantName);
    } else if (result.status === 'FAILED') {
      const reason = providerErrorLabel(result.error_code) ?? result.message ?? 'Sin detalle';
      setErrors((e) => ({ ...e, [t.tenantId]: reason }));
      toast.error(`${t.productName} rechazó el alta`, reason);
    } else {
      toast.push('info', 'Alta en curso', result.message ?? `${t.productName}: la app sigue procesando.`);
    }
  }

  function createRequest(t: AltaTenant, env: string) {
    return create.mutateAsync({
      p_tenant_id: t.tenantId,
      p_environment: env as ProvisioningEnvironment,
      p_subscription_id: t.subscriptionId ?? undefined,
    });
  }

  return (
    <DataTable
      label="Alta en cada app"
      paginate={false}
      columns={['App', 'Ambiente', 'Resultado', { label: 'Acciones', srOnly: true }]}
    >
      {tenants.map((t) => {
        const request = latest.get(`${t.tenantId}:${t.productId}`) ?? null;
        const state = altaState(request);
        const envs = altaEnvironments(targetRows, t.productId);
        const env = envChoice[t.tenantId] ?? request?.provisioning_environment ?? envs[0]?.value ?? '';
        const canExecute = access.canForProduct('platform.provisioning.execute', t.productId);
        const rowBusy = busy === t.tenantId;
        const error = errors[t.tenantId];
        return (
          <tr key={t.tenantId} data-alta-app={t.productName} data-alta-outcome={state.outcome}>
            <td className="ebim-td">
              <span className="block font-semibold text-fg">{t.productName}</span>
              <Link className="ebim-link text-caption" to={`/tenants/${t.tenantId}`}>{t.tenantName}</Link>
            </td>
            <td className="ebim-td text-compact">
              {state.outcome === 'NONE' && envs.length > 1 ? (
                <SelectInput
                  label={`Ambiente del alta en ${t.productName}`}
                  labelDisplay="hidden"
                  size="sm"
                  value={env}
                  onChange={(v) => setEnvChoice((c) => ({ ...c, [t.tenantId]: v }))}
                  options={envs}
                />
              ) : envs.length === 0 && state.outcome === 'NONE' ? (
                <span className="text-muted">Sin destino habilitado</span>
              ) : (
                <span>{envs.find((e) => e.value === env)?.label ?? (env || '—')}</span>
              )}
            </td>
            <td className="ebim-td">
              <Badge tone={state.tone} dot>{state.label}</Badge>
              {state.reason ? <span className="mt-0.5 block max-w-[280px] text-caption text-fg-2">{state.reason}</span> : null}
              {error ? (
                <span className="mt-0.5 block max-w-[280px] text-caption text-danger" role="alert">{error}</span>
              ) : null}
            </td>
            <td className="ebim-td">
              <div className="flex flex-wrap justify-end gap-2">
                {!canExecute ? (
                  <span className="text-caption text-muted">Tu rol no ejecuta altas en esta app</span>
                ) : state.outcome === 'NONE' ? (
                  envs.length === 0 ? (
                    t.productCode ? (
                      <Link className="ebim-btn-ghost ebim-btn-sm" to={`/apps/${t.productCode}`}>Revisar la app</Link>
                    ) : null
                  ) : (
                    <button
                      type="button"
                      className="ebim-btn-secondary ebim-btn-sm"
                      disabled={rowBusy}
                      onClick={() =>
                        void run(t, async () => {
                          await createRequest(t, env);
                          toast.success('Solicitud de alta creada', `${t.productName}: revisa el resultado y ejecuta el alta.`);
                        })
                      }
                    >
                      {rowBusy ? 'Creando…' : 'Solicitar alta'}
                    </button>
                  )
                ) : state.outcome === 'READY' && state.requestId ? (
                  <button
                    type="button"
                    className="ebim-btn-primary ebim-btn-sm"
                    disabled={rowBusy}
                    onClick={() => void run(t, () => execute(t, state.requestId!))}
                  >
                    {rowBusy ? 'Ejecutando…' : 'Ejecutar alta'}
                  </button>
                ) : state.outcome === 'FAILED' && state.requestId ? (
                  <button
                    type="button"
                    className="ebim-btn-secondary ebim-btn-sm"
                    disabled={rowBusy || (!state.canRetrySame && envs.length === 0)}
                    onClick={() =>
                      void run(t, async () => {
                        // Con intentos disponibles se reintenta la MISMA solicitud (misma
                        // clave de idempotencia); agotados, la base abre una nueva versión.
                        let id = state.requestId!;
                        if (state.canRetrySame) await retry.mutateAsync({ p_request_id: id });
                        else id = await createRequest(t, env);
                        await execute(t, id);
                      })
                    }
                  >
                    {rowBusy ? 'Reintentando…' : 'Reintentar'}
                  </button>
                ) : null}
              </div>
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}
