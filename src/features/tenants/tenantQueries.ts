import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Lecturas del Tenant 360 ACOTADAS AL TENANT en el servidor. Antes la ficha
 * descargaba todas las suscripciones, márgenes, solicitudes y los últimos 200
 * eventos de auditoría de la plataforma para filtrarlos aquí. RLS sigue siendo
 * la autoridad sobre cada fila.
 */
function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

export function useTenantSubscriptions(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['tenant360', tenantId, 'subscriptions'],
    enabled: Boolean(tenantId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('subscriptions')
          .select(
            '*, saas_products(code, short_name), plans(name), organizations!subscriptions_billed_organization_id_fkey(display_name), tenants(name, slug, deployment_mode), subscription_items(*)',
          )
          .eq('tenant_id', tenantId!)
          .order('code'),
      ),
  });
}

export function useTenantMarginRows(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['tenant360', tenantId, 'margin'],
    enabled: Boolean(tenantId),
    queryFn: async () => unwrap(await supabase.from('v_tenant_margin').select('*').eq('tenant_id', tenantId!)),
  });
}

export function useTenantInfraRequests(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['tenant360', tenantId, 'infra'],
    enabled: Boolean(tenantId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('provisioning_requests')
          .select('*, tenants(name, slug), deployment_targets(code), saas_products(short_name), provisioning_events(*)')
          .eq('tenant_id', tenantId!)
          .order('created_at', { ascending: false }),
      ),
  });
}

export function useTenantAudit(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['tenant360', tenantId, 'audit'],
    enabled: Boolean(tenantId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('audit_logs')
          .select('*')
          .eq('tenant_id', tenantId!)
          .order('occurred_at', { ascending: false })
          .order('id')
          .limit(100),
      ),
  });
}
