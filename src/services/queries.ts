import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DashboardSummary } from '@/types/domain';

/**
 * Capa de acceso a datos.
 *
 * Todo pasa por PostgREST con la clave anon: lo que cada rol ve lo decide RLS,
 * no este archivo. Por eso las consultas NO llevan filtros de seguridad — si un
 * partner pide `tenants`, la base ya le devuelve sólo los suyos. Añadir aquí un
 * `.eq('organization_id', …)` daría la falsa sensación de que la seguridad vive
 * en el cliente.
 */

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: async (): Promise<DashboardSummary> => {
      const { data, error } = await supabase.rpc('dashboard_summary');
      if (error) throw new Error(error.message);
      return data as unknown as DashboardSummary;
    },
  });
}

export function useProducts() {
  return useQuery({
    queryKey: ['saas-products'],
    queryFn: async () =>
      unwrap(await supabase.from('saas_products').select('*').order('sort_order')),
  });
}

export function useProduct(productId: string | undefined) {
  return useQuery({
    queryKey: ['saas-product', productId],
    enabled: Boolean(productId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('saas_products')
        .select('*')
        .eq('id', productId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('organizations')
          .select('*, organization_capabilities(capability)')
          .order('display_name'),
      ),
  });
}

export function useOrganization(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['organization', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*, organization_capabilities(capability), companies(*)')
        .eq('id', organizationId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useOrganizationAgreements(organizationId?: string) {
  return useQuery({
    queryKey: ['agreements', organizationId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('organization_product_agreements')
        .select('*, saas_products(code, short_name, lockup_name), organizations(display_name)')
        .order('created_at', { ascending: false });
      if (organizationId) q = q.eq('organization_id', organizationId);
      return unwrap(await q);
    },
  });
}

export function useTenantOverview() {
  return useQuery({
    queryKey: ['tenant-overview'],
    queryFn: async () =>
      unwrap(await supabase.from('v_tenant_overview').select('*').order('name')),
  });
}

export function useTenant(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['tenant', tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_tenant_overview')
        .select('*')
        .eq('tenant_id', tenantId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useTenantFeatures(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['tenant-features', tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('tenant_features')
          .select('*')
          .eq('tenant_id', tenantId!)
          .order('feature_key'),
      ),
  });
}

export function useAllFeatureFlags() {
  return useQuery({
    queryKey: ['feature-flags'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('tenant_features')
          .select('*, tenants(name, slug, saas_products(short_name))')
          .order('feature_key'),
      ),
  });
}

export function usePlans() {
  return useQuery({
    queryKey: ['plans'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('plans')
          .select('*, saas_products(code, short_name), plan_prices(*)')
          .order('sort_order'),
      ),
  });
}

export function useSubscriptions() {
  return useQuery({
    queryKey: ['subscriptions'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('subscriptions')
          .select(
            '*, saas_products(code, short_name), plans(name), organizations!subscriptions_billed_organization_id_fkey(display_name), tenants(name, slug, deployment_mode), subscription_items(*)',
          )
          .order('code'),
      ),
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: ['invoices'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('invoices')
          .select('*, organizations(display_name), invoice_lines(*), payments(*)')
          .order('issue_date', { ascending: false, nullsFirst: false })
          .limit(200),
      ),
  });
}

export function useCostEntries() {
  return useQuery({
    queryKey: ['cost-entries'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('cost_entries')
          .select('*, cost_allocations(*, saas_products(short_name), tenants(name), deployment_targets(code))')
          .order('period_start', { ascending: false })
          .limit(200),
      ),
  });
}

export function useProductMargin() {
  return useQuery({
    queryKey: ['product-margin'],
    queryFn: async () => unwrap(await supabase.from('v_product_margin').select('*')),
  });
}

export function usePartnerMargin() {
  return useQuery({
    queryKey: ['partner-margin'],
    queryFn: async () => unwrap(await supabase.from('v_partner_margin').select('*')),
  });
}

export function useTenantMargin() {
  return useQuery({
    queryKey: ['tenant-margin'],
    queryFn: async () => unwrap(await supabase.from('v_tenant_margin').select('*')),
  });
}

export function useSalesAgents() {
  return useQuery({
    queryKey: ['sales-agents'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('sales_agents')
          .select('*, organizations(display_name)')
          .order('full_name'),
      ),
  });
}

export function useAttributions() {
  return useQuery({
    queryKey: ['attributions'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('sales_attributions')
          .select(
            '*, sales_agents(full_name, code, agent_type), saas_products(short_name, code), tenants(name, slug), organizations!sales_attributions_customer_organization_id_fkey(display_name), commission_plans(name, code)',
          )
          .order('valid_from', { ascending: false }),
      ),
  });
}

export function useCommissionPlans() {
  return useQuery({
    queryKey: ['commission-plans'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('commission_plans')
          .select('*, commission_rules(*), saas_products(short_name)')
          .order('code'),
      ),
  });
}

export function useCommissionEvents() {
  return useQuery({
    queryKey: ['commission-events'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('commission_events')
          .select(
            '*, sales_agents(full_name, code), saas_products(short_name), tenants(name), commission_rules(name, basis), commission_settlements(code, status)',
          )
          .order('earned_on', { ascending: false })
          .limit(300),
      ),
  });
}

export function useSettlements() {
  return useQuery({
    queryKey: ['settlements'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('commission_settlements')
          .select('*, sales_agents(full_name, code)')
          .order('period_start', { ascending: false }),
      ),
  });
}

export function useDeploymentTargets() {
  return useQuery({
    queryKey: ['deployment-targets'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('deployment_targets')
          .select(
            '*, organizations(display_name), saas_products(short_name), tenant_deployments(tenant_id, status, tenants(name, slug))',
          )
          .order('code'),
      ),
  });
}

export function useProvisioningRequests() {
  return useQuery({
    queryKey: ['provisioning-requests'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('provisioning_requests')
          .select(
            '*, tenants(name, slug), deployment_targets(code), saas_products(short_name), provisioning_events(*)',
          )
          .order('created_at', { ascending: false }),
      ),
  });
}

export function useAuditLogs() {
  return useQuery({
    queryKey: ['audit-logs'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('audit_logs')
          .select('*')
          .order('occurred_at', { ascending: false })
          .limit(200),
      ),
  });
}

export function useTenantAttributions(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['tenant-attributions', tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('sales_attributions')
          .select('*, sales_agents(full_name, code, agent_type), commission_plans(name)')
          .eq('tenant_id', tenantId!),
      ),
  });
}
