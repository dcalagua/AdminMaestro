import { useSaasProvisioningRequests, useTenantOverview } from '@/services/queries';
import type { ProvisioningRow, TenantRow } from '@/features/suite/suiteModel';

/**
 * V5 · F6 · Lecturas para «apps y accesos» de un usuario: los tenants con su app
 * (misma caché que Tenants y el Centro de la suite) y, si el perfil gestiona la
 * plataforma (`scope.managePlatform`), las altas en las apps para el estado combinado. Sin altas
 * visibles, `requests` es `null` y se muestra solo el estado del tenant.
 */
export function useUserAppContext(managePlatform: boolean) {
  const tenants = useTenantOverview();
  const requests = useSaasProvisioningRequests({ enabled: managePlatform });
  return {
    tenants: (tenants.data ?? null) as TenantRow[] | null,
    requests: managePlatform && requests.data && !requests.error ? (requests.data as ProvisioningRow[]) : null,
    loading: Boolean(tenants.isLoading),
  };
}
