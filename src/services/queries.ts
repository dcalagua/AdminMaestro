import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DashboardSummary, Enums, FinanceConsolidated } from '@/types/domain';
import { toMarketOptions, type MarketRow } from '@/lib/regional';
import type { SubscriptionBillingStatus } from '@/lib/billing';

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
        .select('*, organization_capabilities(capability), companies(*, markets(code, name))')
        .eq('id', organizationId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

/**
 * ¿Tiene esta organización los datos que la pasarela exige para cobrar con
 * tarjeta?
 *
 * La vista responde con `missing_fields`, así que la UI NO reimplementa la
 * regla: si mañana el proveedor pide un campo más, se añade en la migración y
 * esta pantalla lo refleja sola.
 */
export function useBillingContactReadiness(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['billing-contact', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_billing_contact_readiness')
        .select('*')
        .eq('organization_id', organizationId!)
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

/**
 * Acuerdos de canal con su uso real (tenants administrados, MRR atribuible).
 * La vista es `security_invoker`, así que un partner admin solo ve los suyos.
 */
export function usePartnerAgreements(organizationId?: string) {
  return useQuery({
    queryKey: ['partner-agreements', organizationId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('v_partner_agreements')
        .select('*')
        .order('organization_name')
        .order('product_code');
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
          .select('*, saas_products(code, short_name), plan_prices(*, markets(code, name))')
          .order('sort_order'),
      ),
  });
}

/* ==========================================================================
   Catálogo regional (V3): mercados, monedas y tarifas por mercado
   ========================================================================== */

/**
 * Mercados con sus monedas admitidas. Lectura amplia por RLS: los selectores
 * de cualquier formulario la necesitan. Se normaliza con `toMarketOptions`.
 */
export function useMarkets() {
  return useQuery({
    queryKey: ['markets'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from('markets')
          .select('*, market_currencies(currency_code, status, currencies(status, name))')
          .order('sort_order'),
      );
      return toMarketOptions(rows as unknown as MarketRow[]);
    },
  });
}

/** Catálogo ISO de monedas (incluidas las INACTIVE que sostienen historia). */
export function useCurrencies() {
  return useQuery({
    queryKey: ['currencies'],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap(await supabase.from('currencies').select('*').order('code')),
  });
}

/** Moneda de reporte y tolerancia FX (singleton de configuración). */
export function useReportingSettings() {
  return useQuery({
    queryKey: ['reporting-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('reporting_settings');
      if (error) throw new Error(error.message);
      return (data ?? [])[0] ?? null;
    },
  });
}

/** Tipos de cambio MANUAL (los últimos 300). Lectura: plataforma o finanzas (RLS). */
export function useExchangeRates() {
  return useQuery({
    queryKey: ['exchange-rates'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('exchange_rates')
          .select('*')
          .order('rate_date', { ascending: false })
          .order('base_currency')
          .order('quote_currency')
          .limit(300),
      ),
  });
}

export interface FinanceConsolidatedParams {
  asOf: string;
  groupBy: 'TOTAL' | 'MARKET' | 'PRODUCT' | 'PARTNER';
  marketCode?: string;
  currency?: string;
  saasProductId?: string;
  organizationId?: string;
}

/**
 * Consolidado gerencial (V3). La base suma por moneda, convierte cada total con
 * una tasa explícita y declara lo que falta: la UI solo presenta.
 */
export function useFinanceConsolidated(params: FinanceConsolidatedParams) {
  return useQuery({
    queryKey: ['finance-consolidated', params],
    queryFn: async (): Promise<FinanceConsolidated> => {
      const { data, error } = await supabase.rpc('finance_consolidated', {
        p_as_of: params.asOf,
        p_group_by: params.groupBy,
        p_market_code: params.marketCode || undefined,
        p_currency: params.currency || undefined,
        p_saas_product_id: params.saasProductId || undefined,
        p_organization_id: params.organizationId || undefined,
      });
      if (error) throw new Error(error.message);
      return data as unknown as FinanceConsolidated;
    },
  });
}

/** Tarifas con su mercado. RLS de `plan_prices` decide qué filas ve cada rol. */
export function usePlanPriceCatalog() {
  return useQuery({
    queryKey: ['plans', 'price-catalog'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('v_plan_price_catalog')
          .select('*')
          .order('plan_code')
          .order('market_code')
          .order('valid_from', { ascending: false }),
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

/* ==========================================================================
   Cobranza (Fases 07-08)
   ========================================================================== */

/** Cómo se cobra cada suscripción. `profile_missing` = cobro manual por omisión. */
export function useSubscriptionCollection(subscriptionId?: string) {
  return useQuery({
    queryKey: ['subscription-collection', subscriptionId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('v_subscription_collection').select('*').order('subscription_code');
      if (subscriptionId) q = q.eq('subscription_id', subscriptionId);
      return unwrap(await q);
    },
  });
}

/** Cuentas de proveedor de cobro. No contienen secretos, solo referencias. */
export function useProviderAccounts() {
  return useQuery({
    queryKey: ['provider-accounts'],
    queryFn: async () =>
      unwrap(await supabase.from('payment_provider_accounts').select('*').order('code')),
  });
}

/**
 * Elegibilidad de cuentas de cobro para una suscripción y un método (V3).
 * SECURITY INVOKER: cada rol ve las cuentas que RLS le deja ver; la ruta real la
 * vuelve a calcular el servidor al guardar el perfil.
 */
export function useProviderAccountCandidates(subscriptionId: string | null, method: string) {
  return useQuery({
    queryKey: ['provider-account-candidates', subscriptionId, method],
    enabled: Boolean(subscriptionId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('provider_account_candidates', {
        p_subscription_id: subscriptionId!,
        p_collection_method: method as Enums<'collection_method'>,
      });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** Cuentas de cobro con mercado, monedas y métodos soportados (sin secretos). */
export function useProviderAccountRoutes() {
  return useQuery({
    queryKey: ['provider-accounts', 'routes'],
    queryFn: async () =>
      unwrap(await supabase.from('v_provider_account_routes').select('*').order('market_code').order('code')),
  });
}

/** Órdenes de Servicio / Compra. Un documento aprobado NO es un cobro. */
export function useCommercialDocuments(subscriptionId?: string) {
  return useQuery({
    queryKey: ['commercial-documents', subscriptionId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('subscription_commercial_documents')
        .select('*, subscriptions(code, billed_organization_id, saas_products(short_name))')
        .order('requested_at', { ascending: false });
      if (subscriptionId) q = q.eq('subscription_id', subscriptionId);
      return unwrap(await q);
    },
  });
}

/** Estado documental agregado: ¿tiene hoy la autorización que su método exige? */
export function useSubscriptionDocumentStatus() {
  return useQuery({
    queryKey: ['subscription-document-status'],
    queryFn: async () =>
      unwrap(await supabase.from('v_subscription_documents').select('*')),
  });
}

/**
 * Estado del cobro con proveedor para una suscripción: mapeo externo, medio de
 * pago (marca y últimos 4, nunca el PAN) y próxima fecha de cobro.
 */
export function useProviderSubscription(subscriptionId: string | undefined) {
  return useQuery({
    queryKey: ['provider-subscription', subscriptionId],
    enabled: Boolean(subscriptionId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('provider_subscriptions')
          .select('*, payment_provider_accounts(code, environment, provider_kind, public_key)')
          .eq('subscription_id', subscriptionId!)
          .order('created_at', { ascending: false }),
      ),
  });
}

export function useProviderPaymentMethods(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['provider-payment-methods', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('provider_payment_methods')
          .select('*')
          .eq('organization_id', organizationId!)
          .order('is_default', { ascending: false }),
      ),
  });
}

/** Diagnóstico proveedor vs. local. Describe; no corrige. */
export function useProviderReconciliation() {
  return useQuery({
    queryKey: ['provider-reconciliation'],
    queryFn: async () =>
      unwrap(await supabase.from('v_provider_reconciliation').select('*')),
  });
}

export function useWebhookEvents(limit = 100) {
  return useQuery({
    queryKey: ['webhook-events'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('provider_webhook_events')
          .select('*, payment_provider_accounts(code)')
          .order('received_at', { ascending: false })
          .limit(limit),
      ),
  });
}

export function useSubscription(subscriptionId: string | undefined) {
  return useQuery({
    queryKey: ['subscription', subscriptionId],
    enabled: Boolean(subscriptionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscriptions')
        .select(
          '*, saas_products(code, short_name, lockup_name), plans(name, code), organizations!subscriptions_billed_organization_id_fkey(display_name), tenants(name, slug, deployment_mode), subscription_items(*)',
        )
        .eq('id', subscriptionId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

/**
 * V3.1 · Estado de facturación de un periodo: cargos debidos, total estimado,
 * factura vigente y próxima facturación. Lo calcula la base con el mismo motor
 * que emite; la UI no recalcula periodicidades ni fechas.
 */
export function useSubscriptionBillingStatus(
  subscriptionId: string | undefined,
  periodStart: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ['subscription-billing-status', subscriptionId, periodStart],
    enabled: enabled && Boolean(subscriptionId) && Boolean(periodStart),
    queryFn: async (): Promise<SubscriptionBillingStatus> => {
      const { data, error } = await supabase.rpc('get_subscription_billing_status', {
        p_subscription_id: subscriptionId!,
        p_period_start: periodStart!,
      });
      if (error) throw new Error(error.message);
      return data as unknown as SubscriptionBillingStatus;
    },
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

/* ==========================================================================
   Renovaciones y finanzas (Fases 11-13)
   ========================================================================== */

/** Trabajo de cobranza pendiente. Se materializa con `refresh_billing_alerts`. */
export function useBillingAlerts(status: Enums<'billing_alert_status'> = 'OPEN') {
  return useQuery({
    queryKey: ['billing-alerts', status],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('billing_alerts')
          .select('*, subscriptions(code, saas_products(short_name), organizations!subscriptions_billed_organization_id_fkey(display_name))')
          .eq('status', status)
          .order('due_at'),
      ),
  });
}

/** Cartera por ventana de renovación (7/15/30/45/60 días). */
export function useRenewalDashboard() {
  return useQuery({
    queryKey: ['renewal-dashboard'],
    queryFn: async () =>
      unwrap(await supabase.from('v_renewal_dashboard').select('*').order('renewal_on')),
  });
}

/** Hallazgos de conciliación. Describe; no corrige. */
export function useFinanceReconciliation() {
  return useQuery({
    queryKey: ['finance-reconciliation'],
    queryFn: async () =>
      unwrap(await supabase.from('v_finance_reconciliation').select('*')),
  });
}

export function useProductFinance() {
  return useQuery({
    queryKey: ['product-finance'],
    queryFn: async () =>
      unwrap(await supabase.from('v_product_finance').select('*').order('product_code')),
  });
}

export function usePartnerFinance() {
  return useQuery({
    queryKey: ['partner-finance'],
    queryFn: async () =>
      unwrap(await supabase.from('v_partner_finance').select('*').order('organization_name')),
  });
}

/** Comisiones con su origen legible (licencia, implementación, reverso…). */
export function useCommissionDetail() {
  return useQuery({
    queryKey: ['commission-detail'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('v_commission_detail')
          .select('*')
          .order('earned_on', { ascending: false })
          .limit(300),
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
