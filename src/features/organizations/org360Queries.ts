import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Lecturas de la ficha 360 ACOTADAS POR ORGANIZACIÓN EN EL SERVIDOR (E16).
 *
 * Antes la ficha descargaba nueve universos generales (todas las facturas,
 * todos los tenants…) y los filtraba en el navegador. Aquí cada consulta pide
 * sólo lo de esta organización. Es un filtro de ALCANCE, no de seguridad: RLS
 * sigue decidiendo si el usuario puede ver cada fila.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El id viene de la URL: sólo un UUID bien formado se interpola en un filtro. */
export function isUuid(value: string | undefined): value is string {
  return Boolean(value && UUID.test(value));
}

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

export function useOrgSubscriptions(orgId: string) {
  return useQuery({
    queryKey: ['org360', orgId, 'subscriptions'],
    enabled: isUuid(orgId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('v_subscription_collection')
          .select('*')
          .eq('billed_organization_id', orgId)
          .order('subscription_code'),
      ),
  });
}

export function useOrgDocuments(orgId: string) {
  return useQuery({
    queryKey: ['org360', orgId, 'documents'],
    enabled: isUuid(orgId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('v_subscription_documents')
          .select('*')
          .eq('billed_organization_id', orgId)
          .order('subscription_code'),
      ),
  });
}

/** Tenants de la organización como cliente O como administradora (canal). */
export function useOrgTenants(orgId: string) {
  return useQuery({
    queryKey: ['org360', orgId, 'tenants'],
    enabled: isUuid(orgId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('v_tenant_overview')
          .select('*')
          .or(`customer_organization_id.eq.${orgId},managing_organization_id.eq.${orgId}`)
          .order('name'),
      ),
  });
}

/** Altas SaaS (request + mapping) de los tenants de la organización. */
export function useOrgSaasProvisioning(orgId: string) {
  return useQuery({
    queryKey: ['org360', orgId, 'saas-provisioning'],
    enabled: isUuid(orgId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('v_saas_provisioning')
          .select('*')
          .or(`customer_organization_id.eq.${orgId},managing_organization_id.eq.${orgId}`)
          // Sin tope: alimenta el estado técnico de CADA tenant; un lote truncado
          // haría decir «sin alta» a un tenant con solicitudes antiguas.
          .order('requested_at', { ascending: false }),
      ),
  });
}

/** Comisiones ligadas a los tenants de la organización (depende de la lista de tenants). */
export function useOrgCommissions(orgId: string, tenantIds: string[] | undefined) {
  return useQuery({
    queryKey: ['org360', orgId, 'commissions', tenantIds ?? []],
    enabled: isUuid(orgId) && tenantIds !== undefined,
    queryFn: async () => {
      if (!tenantIds || tenantIds.length === 0) return [];
      return unwrap(
        await supabase
          .from('v_commission_detail')
          .select('*')
          .in('tenant_id', tenantIds)
          .order('earned_on', { ascending: false })
          .order('commission_event_id')
          .limit(25),
      );
    },
  });
}

/** Solicitudes de infraestructura de los tenants de la organización. */
export function useOrgInfraRequests(orgId: string, tenantIds: string[] | undefined) {
  return useQuery({
    queryKey: ['org360', orgId, 'infra', tenantIds ?? []],
    enabled: isUuid(orgId) && tenantIds !== undefined,
    queryFn: async () => {
      if (!tenantIds || tenantIds.length === 0) return [];
      return unwrap(
        await supabase
          .from('provisioning_requests')
          .select('id, action, mode, status, created_at, tenant_id, tenants(name)')
          .in('tenant_id', tenantIds)
          .order('created_at', { ascending: false })
          .limit(20),
      );
    },
  });
}

/** Bitácora de la propia organización (append-only; RLS decide qué eventos ve cada rol). */
export function useOrgAudit(orgId: string) {
  return useQuery({
    queryKey: ['org360', orgId, 'audit'],
    enabled: isUuid(orgId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('audit_logs')
          .select('id, occurred_at, actor_email, action, entity_type, entity_id, tenant_id')
          .or(`organization_id.eq.${orgId},entity_id.eq.${orgId}`)
          .order('occurred_at', { ascending: false })
          .order('id')
          .limit(20),
      ),
  });
}

export function useOrgPartnerFinance(orgId: string) {
  return useQuery({
    queryKey: ['org360', orgId, 'partner-finance'],
    enabled: isUuid(orgId),
    queryFn: async () =>
      unwrap(await supabase.from('v_partner_finance').select('*').eq('organization_id', orgId)),
  });
}

/** Margen del canal de ESTA organización (una fila por moneda). */
export function useOrgPartnerMargin(orgId: string) {
  return useQuery({
    queryKey: ['org360', orgId, 'partner-margin'],
    enabled: isUuid(orgId),
    queryFn: async () =>
      unwrap(await supabase.from('v_partner_margin').select('*').eq('organization_id', orgId)),
  });
}

/** Comerciales afiliados a esta organización. */
export function useOrgSalesAgents(orgId: string) {
  return useQuery({
    queryKey: ['org360', orgId, 'sales-agents'],
    enabled: isUuid(orgId),
    queryFn: async () =>
      unwrap(await supabase.from('sales_agents').select('*').eq('organization_id', orgId).order('full_name')),
  });
}
