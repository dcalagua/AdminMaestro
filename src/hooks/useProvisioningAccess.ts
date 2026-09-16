import { useMemo } from 'react';
import { useProvisioningPermissions } from '@/services/queries';
import {
  EMPTY_PROVISIONING_PERMISSIONS,
  hasProductPermission,
  type ProvisioningPermissions,
} from '@/lib/provisioning';

/**
 * Permisos EFECTIVOS del plano de provisioning.
 *
 * Se resuelven en la BASE (`platform.my_provisioning_permissions()`) y no en el
 * cliente. Aquí sólo se envuelven para que una pantalla pueda preguntar
 * «¿ofrezco este botón?» sin repetir la lógica.
 *
 * ESTO NO ES AUTORIZACIÓN. Si alguien fuerza la llamada, la RPC responde 42501
 * y el orquestador devuelve 403 — así lo comprueban los tests negativos. Ocultar
 * un botón sólo evita el callejón sin salida.
 */
export interface ProvisioningAccess {
  loading: boolean;
  permissions: ProvisioningPermissions;
  /** Permiso transversal (todos los productos). */
  can: (code: string) => boolean;
  /** Permiso sobre UN producto: transversal o por propiedad técnica. */
  canForProduct: (code: string, productId: string | null | undefined) => boolean;
  /** ¿Tiene algún alcance en el plano de provisioning? Decide si ve la sección. */
  hasAnyAccess: boolean;
  isTechLead: boolean;
  ownedProductIds: string[];
}

export function useProvisioningAccess(): ProvisioningAccess {
  const query = useProvisioningPermissions();

  return useMemo(() => {
    const permissions = query.data ?? EMPTY_PROVISIONING_PERMISSIONS;
    const can = (code: string) => permissions.permissions.includes(code);

    return {
      loading: query.isLoading,
      permissions,
      can,
      canForProduct: (code, productId) => hasProductPermission(permissions, code, productId),
      // Un propietario de producto no tiene permisos transversales, pero sí
      // alcance: si sólo se mirara `permissions`, la sección le quedaría oculta.
      hasAnyAccess: permissions.permissions.length > 0 || permissions.owned_products.length > 0,
      isTechLead: permissions.is_super_admin || permissions.roles.includes('TECH_LEAD'),
      ownedProductIds: permissions.owned_products.map((p) => p.saas_product_id),
    };
  }, [query.data, query.isLoading]);
}
