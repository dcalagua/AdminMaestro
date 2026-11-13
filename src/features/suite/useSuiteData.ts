import { useMemo, useState } from 'react';
import {
  useEntitlementSyncStatus,
  useProductIntegrations,
  useProducts,
  useProvisioningTargets,
  useSaasProvisioningRequests,
  useSubscriptionStatuses,
  useTenantOverview,
} from '@/services/queries';
import { useCheckDeploymentHealth } from '@/services/mutations';
import { useAuth } from '@/hooks/useAuth';
import { useTaskQueue, type TaskResult } from '@/components/ui/task-queue-context';
import { hasFinanceView } from '@/app/navigation';
import { businessErrorMessage } from '@/lib/pgError';
import { DEPLOYMENT_HEALTH_LABEL, type DeploymentHealth } from '@/lib/provisioning';
import {
  appHealth,
  buildMatrix,
  suiteApps,
  type IntegrationRow,
  type ModuleSyncRow,
  type ProvisioningRow,
  type TargetRow,
  type TenantRow,
} from './suiteModel';

/**
 * Lecturas del Centro de la suite y de la ficha de app. Todas son consultas que
 * ya existían (mismas claves de caché), así que las acciones de otras
 * pantallas refrescan también ésta.
 *
 * El estado del contrato sólo se pide con vista financiera: un perfil EBIM
 * puramente técnico no lo ve aquí, igual que no ve «Contratos» en el menú.
 */
export function useSuiteData() {
  const { persona, roles } = useAuth();
  const finance = hasFinanceView(persona, roles);
  const products = useProducts();
  const targets = useProvisioningTargets();
  const integrations = useProductIntegrations();
  const tenants = useTenantOverview();
  const requests = useSaasProvisioningRequests();
  const moduleSync = useEntitlementSyncStatus();
  const subscriptions = useSubscriptionStatuses({ enabled: finance });

  const data = useMemo(() => {
    const targetRows = (targets.data ?? []) as TargetRow[];
    const integrationRows = (integrations.data ?? []) as unknown as IntegrationRow[];
    const tenantRows = (tenants.data ?? []) as TenantRow[];
    const requestRows = (requests.data ?? []) as ProvisioningRow[];
    const syncRows = (moduleSync.data ?? []) as ModuleSyncRow[];
    const apps = suiteApps(products.data ?? [], {
      integrations: integrationRows,
      targets: targetRows,
      tenants: tenantRows,
    });
    const subscriptionStatus = finance
      ? new Map((subscriptions.data ?? []).map((s) => [s.id, s.status as string]))
      : null;
    return {
      apps,
      targetRows,
      integrationRows,
      tenantRows,
      requestRows,
      syncRows,
      health: apps.map((app) => appHealth(app, targetRows, integrationRows)),
      matrix: buildMatrix({
        apps,
        tenants: tenantRows,
        requests: requestRows,
        subscriptions: subscriptionStatus,
        moduleSync: syncRows,
      }),
    };
  }, [products.data, targets.data, integrations.data, tenants.data, requests.data, moduleSync.data, subscriptions.data, finance]);

  return {
    ...data,
    finance,
    loading: {
      health: products.isLoading || targets.isLoading || integrations.isLoading,
      matrix: products.isLoading || tenants.isLoading || requests.isLoading,
    },
    error: {
      health: products.error ?? targets.error ?? null,
      matrix: products.error ?? tenants.error ?? requests.error ?? null,
    },
    refetch: {
      health: () => {
        void products.refetch();
        void targets.refetch();
        void integrations.refetch();
      },
      matrix: () => {
        void tenants.refetch();
        void requests.refetch();
      },
    },
  };
}

/**
 * «Verificar ahora»: la acción CHECK_HEALTH del orquestador, la MISMA que usa
 * Entornos y despliegues. Abrir la pantalla nunca verifica nada por sí sola.
 *
 * V5 · F5: cada verificación es una tarea visible en la cola del shell
 * mientras corre y queda con su resultado y el enlace a la ficha de la app.
 * Varias pueden correr a la vez (p. ej. «Verificar salud de las apps» desde ⌘K).
 */
export function useHealthCheck() {
  const queue = useTaskQueue();
  const check = useCheckDeploymentHealth();
  const [running, setRunning] = useState<string[]>([]);

  async function run(targetId: string, label: string, appCode?: string | null) {
    setRunning((current) => [...current, targetId]);
    const link = appCode ? { to: `/apps/${appCode}`, label: 'Ver la ficha de la app' } : undefined;
    try {
      await queue.track(
        { title: `Verificar ${label}`, link },
        () => check.mutateAsync(targetId),
        (result): TaskResult => {
          if (result.health === 'HEALTHY') {
            return { status: 'success', title: `${label}: conexión verificada`, detail: result.detail ?? 'Respuesta correcta' };
          }
          if (result.health === 'UNKNOWN') {
            // No se inventa un «sano»: si la app no expone salud, queda sin verificar.
            return { status: 'info', title: `${label}: sin verificar`, detail: result.detail ?? 'La app no expone ruta de salud' };
          }
          return {
            status: 'error',
            title: `${label}: ${DEPLOYMENT_HEALTH_LABEL[result.health as DeploymentHealth] ?? 'sin respuesta'}`,
            detail: result.detail ?? undefined,
          };
        },
        (error) => ({ status: 'error', title: `No se pudo verificar ${label}`, detail: businessErrorMessage(error) }),
      );
    } catch {
      /* El fallo ya quedó en la cola (o en el aviso) con su motivo. */
    } finally {
      setRunning((current) => {
        const at = current.indexOf(targetId);
        return at === -1 ? current : [...current.slice(0, at), ...current.slice(at + 1)];
      });
    }
  }

  return {
    run,
    isPending: running.length > 0,
    pendingTargetId: running[0] ?? null,
    isRunning: (targetId: string | null | undefined) => Boolean(targetId && running.includes(targetId)),
  };
}
