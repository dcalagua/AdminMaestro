import { useMemo } from 'react';
import { useOrganizations, useTenantOverview } from '@/services/queries';
import type { useUserAdminScope } from './useUserAdminScope';

type Scope = ReturnType<typeof useUserAdminScope>;

export interface OrgOption {
  id: string;
  name: string;
  isPartner: boolean;
  isPlatform: boolean;
}

export interface TenantOption {
  id: string;
  name: string;
  product: string | null;
}

/**
 * Destinos que se OFRECEN para dar acceso. RLS ya limita lo que se lee; aquí
 * se recorta a lo que la RPC aceptaría (UX, no seguridad):
 *   · la organización EBIM solo para el super admin;
 *   · un admin de organización, solo sus organizaciones y los tenants de ellas.
 */
export function useAccessOptions(scope: Scope) {
  const orgs = useOrganizations();
  const tenants = useTenantOverview();

  const orgOptions = useMemo<OrgOption[]>(() => {
    const adminIds = new Set(scope.adminOrgs.map((o) => o.organizationId));
    return (orgs.data ?? [])
      .map((o) => {
        const caps = ((o as { organization_capabilities?: Array<{ capability: string }> }).organization_capabilities ?? [])
          .map((c) => c.capability);
        return {
          id: o.id,
          name: o.display_name,
          isPartner: caps.includes('PARTNER') || caps.includes('RESELLER'),
          isPlatform: o.kind === 'PLATFORM',
        };
      })
      .filter((o) =>
        scope.managePlatform ? !o.isPlatform || scope.isSuperAdmin : adminIds.has(o.id),
      );
  }, [orgs.data, scope]);

  const tenantOptions = useMemo<TenantOption[]>(() => {
    const adminIds = new Set(scope.adminOrgs.map((o) => o.organizationId));
    return (tenants.data ?? [])
      .filter((t) =>
        scope.managePlatform ||
        adminIds.has(t.customer_organization_id ?? '') ||
        adminIds.has(t.managing_organization_id ?? ''),
      )
      .filter((t): t is typeof t & { tenant_id: string } => Boolean(t.tenant_id))
      .map((t) => ({ id: t.tenant_id, name: t.name ?? t.slug ?? t.tenant_id, product: t.product_short_name }));
  }, [tenants.data, scope]);

  return { orgOptions, tenantOptions, loading: orgs.isLoading || tenants.isLoading };
}
