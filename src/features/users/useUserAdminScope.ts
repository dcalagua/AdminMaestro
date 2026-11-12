import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import type { OrgRole } from '@/types/domain';

export interface AdminOrg {
  organizationId: string;
  role: OrgRole;
  displayName: string;
}

/**
 * Qué ofrece «Usuarios y accesos» a quien la mira. Espejo de las RPC de M5:
 *   · cualquier rol de consola LEE la lista completa (`admin_list_users`);
 *   · EBIM_PRODUCT_ADMIN / super admin administra membresías;
 *   · solo el super admin toca roles de consola, provisioning y desactivación;
 *   · PARTNER_ADMIN / ORG_ADMIN administran SU organización con su familia de roles.
 * Es UX: la base rechaza igual cualquier llamada forzada.
 */
export function useUserAdminScope() {
  const { roles } = useAuth();
  const perms = usePermissions();

  return useMemo(() => {
    const adminOrgs: AdminOrg[] = (roles?.organizations ?? []).filter(
      (o) => o.role === 'PARTNER_ADMIN' || o.role === 'ORG_ADMIN',
    );
    const consoleRole = Boolean(roles?.platformRole);
    return {
      userId: roles?.userId ?? null,
      isSuperAdmin: perms.isSuperAdmin,
      managePlatform: perms.canManagePlatform,
      manageCommercial: perms.canManageCommercial,
      adminOrgs,
      /** Puede abrir la pantalla (la RPC le devolverá filas). */
      canView: consoleRole || adminOrgs.length > 0,
      /** Puede invitar con al menos un tipo de acceso. */
      canInvite: perms.isSuperAdmin || perms.canManagePlatform || adminOrgs.length > 0,
      adminRoleIn: (organizationId: string): OrgRole | null =>
        adminOrgs.find((o) => o.organizationId === organizationId)?.role ?? null,
    };
  }, [roles, perms]);
}
