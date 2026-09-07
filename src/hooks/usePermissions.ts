import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { canManagePlatform, isFinance } from '@/features/auth/session';

/**
 * Permisos EFECTIVOS para decidir qué acciones se ofrecen en pantalla.
 *
 * Espeja los helpers de PostgreSQL (`can_manage_platform_entities`,
 * `can_read_finance`, `can_manage_commercial`, `is_org_admin`) para que un botón
 * no prometa algo que la base va a rechazar.
 *
 * ESTO NO ES AUTORIZACIÓN. Si alguien fuerza la llamada igual, la RPC responde
 * 42501 — así lo comprueban los tests negativos de la Fase 16. Ocultar el botón
 * solo evita el callejón sin salida al usuario.
 */
export function usePermissions() {
  const { roles } = useAuth();

  return useMemo(() => {
    const managePlatform = canManagePlatform(roles);
    const finance = isFinance(roles);
    const orgAdminIds = new Set(
      (roles?.organizations ?? [])
        .filter((o) => o.role === 'PARTNER_ADMIN' || o.role === 'ORG_ADMIN')
        .map((o) => o.organizationId),
    );

    return {
      /** EBIM_PRODUCT_ADMIN o super admin: catálogo, tenants, infraestructura. */
      canManagePlatform: managePlatform,
      /** EBIM_FINANCE o super admin: comisiones, liquidaciones, finanzas. */
      canReadFinance: finance,
      /** Espejo de `platform.can_manage_commercial()`: catálogo comercial y suscripciones. */
      canManageCommercial: managePlatform || finance,
      /** Solo el super admin puede pedir provisioning LIVE (contrato §13). */
      isSuperAdmin: roles?.platformRole === 'EBIM_SUPER_ADMIN',
      /** Espejo de `platform.is_org_admin()` para una organización concreta. */
      isOrgAdmin: (organizationId: string | null | undefined) =>
        Boolean(organizationId) && orgAdminIds.has(organizationId as string),
      /** Puede administrar la organización: EBIM o admin de esa misma organización. */
      canManageOrganization: (organizationId: string | null | undefined) =>
        managePlatform || (Boolean(organizationId) && orgAdminIds.has(organizationId as string)),
    };
  }, [roles]);
}
