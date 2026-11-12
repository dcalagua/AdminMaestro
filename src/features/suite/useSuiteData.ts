import { useMemo } from 'react';
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
import { useToast } from '@/components/ui/toast-context';
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
 */
export function useHealthCheck() {
  const toast = useToast();
  const check = useCheckDeploymentHealth();

  async function run(targetId: string, label: string) {
    try {
      const result = await check.mutateAsync(targetId);
      if (result.health === 'HEALTHY') {
        toast.success('Conexión verificada', `${label}: ${result.detail ?? 'respuesta correcta'}`);
      } else if (result.health === 'UNKNOWN') {
        // No se inventa un «sano»: si la app no expone salud, queda sin verificar.
        toast.push('info', 'Sin verificar', result.detail ?? 'La app no expone ruta de salud');
      } else {
        toast.error(
          `${label}: ${DEPLOYMENT_HEALTH_LABEL[result.health as DeploymentHealth] ?? 'sin respuesta'}`,
          result.detail ?? '',
        );
      }
    } catch (error) {
      toast.error('No se pudo verificar la conexión', businessErrorMessage(error));
    }
  }

  return {
    run,
    isPending: check.isPending,
    pendingTargetId: check.isPending ? (check.variables ?? null) : null,
  };
}
