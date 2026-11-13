import { useMemo } from 'react';
import { useOrganizations, useProducts, useTenantOverview } from '@/services/queries';
import { entityTypeLabel } from './auditActions';

/**
 * V6 · F4 · Nombre legible de la entidad de un evento de auditoría.
 *
 * `audit_logs` solo guarda el tipo y el id (más `tenant_id` y
 * `organization_id`). Con las listas que la consola ya lee (tenants,
 * organizaciones, productos; RLS decide qué llega) se pone nombre:
 *   1. la propia entidad, si es un tenant, una organización o un producto;
 *   2. si no, el tenant o la organización del evento («Alta en la app ·
 *      Andina PD · Cliente A»);
 *   3. si nada se resuelve, solo el tipo; el id completo queda en el detalle.
 * Un nombre para TODO tipo de entidad necesita backend (`entity_label` o una
 * vista `v_audit_log_display`; plan V6 §5.3).
 */
export interface AuditEntityRef {
  entity_type: string | null;
  entity_id: string | null;
  tenant_id?: string | null;
  organization_id?: string | null;
}

export interface AuditEntityView {
  /** Tipo en español («Tenant», «Alta en la app»). */
  type: string;
  /** Nombre resuelto, si se conoce. */
  name: string | null;
  /** Ficha a la que lleva el nombre. */
  to: string | null;
}

interface NameMaps {
  tenants: Map<string, string>;
  organizations: Map<string, string>;
  products: Map<string, string>;
}

const DETAIL_ROUTE: Record<string, (id: string) => string> = {
  tenant: (id) => `/tenants/${id}`,
  organization: (id) => `/organizations/${id}`,
  saas_product: (id) => `/products/${id}`,
  subscription: (id) => `/subscriptions/${id}`,
  product_integration: (id) => `/integrations/${id}`,
  profile: (id) => `/users/${id}`,
};

export function resolveAuditEntity(row: AuditEntityRef, maps: NameMaps): AuditEntityView {
  const type = entityTypeLabel(row.entity_type);
  const id = row.entity_id ?? '';
  const own =
    row.entity_type === 'tenant'
      ? maps.tenants.get(id)
      : row.entity_type === 'organization'
        ? maps.organizations.get(id)
        : row.entity_type === 'saas_product'
          ? maps.products.get(id)
          : undefined;
  if (own) return { type, name: own, to: DETAIL_ROUTE[row.entity_type!]!(id) };
  const tenant = row.tenant_id ? maps.tenants.get(row.tenant_id) : undefined;
  if (tenant) return { type, name: tenant, to: `/tenants/${row.tenant_id}` };
  const org = row.organization_id ? maps.organizations.get(row.organization_id) : undefined;
  if (org) return { type, name: org, to: `/organizations/${row.organization_id}` };
  return { type, name: null, to: null };
}

/** Resolutor con las listas ya cacheadas por la consola. */
export function useAuditEntityResolver(): (row: AuditEntityRef) => AuditEntityView {
  const tenants = useTenantOverview();
  const organizations = useOrganizations();
  const products = useProducts();
  return useMemo(() => {
    const maps: NameMaps = {
      tenants: new Map((tenants.data ?? []).filter((t) => t.tenant_id).map((t) => [t.tenant_id as string, (t.name as string) ?? ''])),
      organizations: new Map((organizations.data ?? []).map((o) => [o.id, o.display_name])),
      products: new Map((products.data ?? []).map((p) => [p.id, p.short_name ?? p.name])),
    };
    return (row: AuditEntityRef) => resolveAuditEntity(row, maps);
  }, [tenants.data, organizations.data, products.data]);
}
