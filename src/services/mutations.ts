import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

/**
 * Capa de ESCRITURA del Control Plane.
 *
 * Regla estructural (decisión DV2-001): aquí no hay `.insert()`, `.update()` ni
 * `.delete()` sobre tablas de negocio. Todo pasa por RPCs `SECURITY DEFINER` de
 * `platform`, porque la migración 09 del baseline revoca deliberadamente la
 * escritura directa a `authenticated` sobre casi todo el dominio.
 *
 * Eso no es burocracia: una RPC valida el estado previo, aplica la regla de
 * negocio, deja rastro en `audit_logs` y devuelve un error legible. Un `.update()`
 * desde el navegador no hace ninguna de las cuatro cosas.
 *
 * Cada mutación invalida las query keys que realmente cambian. La lista vive
 * junto a la mutación —no en un mapa global— para que al añadir una RPC nueva se
 * vea de inmediato qué pantallas quedan obsoletas.
 */

type Fns = Database['platform']['Functions'];
type Args<K extends keyof Fns> = Fns[K] extends { Args: infer A } ? A : never;
type Ret<K extends keyof Fns> = Fns[K] extends { Returns: infer R } ? R : never;

/** Toda escritura pasa por aquí: un único punto donde se convierte el error de PostgREST. */
async function callRpc<K extends keyof Fns & string>(fn: K, args: Args<K>): Promise<Ret<K>> {
  // El cliente está tipado contra el schema `platform`, así que `fn` y `args`
  // ya vienen validados por el tipo generado desde la base.
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) throw error;
  return data as Ret<K>;
}

function invalidate(qc: QueryClient, keys: string[]) {
  for (const key of keys) void qc.invalidateQueries({ queryKey: [key] });
}

/**
 * Claves que dependen de agregados globales. Casi cualquier escritura de negocio
 * las mueve, así que se invalidan siempre en lugar de olvidarse una por una.
 */
const AGGREGATE_KEYS = [
  'dashboard-summary',
  'product-margin',
  'partner-margin',
  'tenant-margin',
  'audit-logs',
];

function useRpc<K extends keyof Fns & string>(fn: K, keys: string[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: Args<K>) => callRpc(fn, args),
    onSuccess: () => invalidate(qc, [...keys, ...AGGREGATE_KEYS]),
  });
}

/* ==========================================================================
   Catálogo de producto SaaS
   ========================================================================== */

export function useUpsertProduct() {
  return useRpc('upsert_saas_product', ['saas-products', 'saas-product']);
}

export function useArchiveProduct() {
  return useRpc('archive_saas_product', ['saas-products', 'saas-product']);
}

export function useUpsertPlan() {
  return useRpc('upsert_plan', ['plans']);
}

/** Versiona la tarifa: cierra la vigente y abre una nueva. Nunca edita el histórico. */
export function useSetPlanPrice() {
  return useRpc('set_plan_price', ['plans']);
}

export function useUpsertCatalogItem() {
  return useRpc('upsert_catalog_item', ['catalog-items']);
}

/* ==========================================================================
   Organizaciones, partners y sociedades
   ========================================================================== */

export function useUpsertOrganization() {
  return useRpc('upsert_organization', ['organizations', 'organization', 'agreements']);
}

export function useUpsertCompany() {
  return useRpc('upsert_company', ['organization', 'organizations']);
}

/** Condiciones de un canal para UN producto. Un partner puede tener N acuerdos. */
export function useUpsertProductAgreement() {
  return useRpc('upsert_product_agreement', [
    'agreements', 'partner-agreements', 'organization', 'organizations',
  ]);
}

export function useEndProductAgreement() {
  return useRpc('end_product_agreement', ['agreements', 'partner-agreements', 'organization']);
}

/* ==========================================================================
   Onboarding (venta completa)
   ========================================================================== */

/**
 * Convierte una venta en tenant + suscripción + líneas + atribución +
 * provisioning DRY_RUN, en UNA transacción de base de datos. Si algo falla no
 * queda ni un tenant huérfano.
 */
export function useOnboardCustomer() {
  return useRpc('onboard_customer_subscription', [
    'tenant-overview', 'subscriptions', 'attributions', 'provisioning-requests',
    'organizations', 'organization', 'partner-agreements',
  ]);
}

/* ==========================================================================
   Tenants
   ========================================================================== */

/** Alta de tenant: reutiliza `platform.create_tenant()` del baseline, no la duplica. */
export function useCreateTenant() {
  return useRpc('create_tenant', ['tenant-overview', 'organizations', 'organization']);
}

export function useSetTenantStatus() {
  return useRpc('set_tenant_status', ['tenant-overview', 'tenant', 'organization']);
}

export function useUpdateTenant() {
  return useRpc('update_tenant', ['tenant-overview', 'tenant']);
}

export function useSetTenantFeature() {
  return useRpc('set_tenant_feature', ['tenant-features', 'feature-flags']);
}

/** Suspende el tenant Y encola el trabajo de infraestructura, en una transacción. */
export function useRequestTenantSuspension() {
  return useRpc('request_tenant_suspension', [
    'tenant-overview', 'tenant', 'provisioning-requests',
  ]);
}

export function useRequestTenantResume() {
  return useRpc('request_tenant_resume', [
    'tenant-overview', 'tenant', 'provisioning-requests',
  ]);
}

/* ==========================================================================
   Comercial
   ========================================================================== */

export function useUpsertSalesAgent() {
  return useRpc('upsert_sales_agent', ['sales-agents']);
}

export function useCreateAttribution() {
  return useRpc('create_sales_attribution', ['attributions', 'tenant-attributions']);
}

export function useEndAttribution() {
  return useRpc('end_sales_attribution', ['attributions', 'tenant-attributions']);
}

export function useUpsertCommissionPlan() {
  return useRpc('upsert_commission_plan', ['commission-plans']);
}

export function useUpsertCommissionRule() {
  return useRpc('upsert_commission_rule', ['commission-plans']);
}

export function useDeactivateCommissionRule() {
  return useRpc('deactivate_commission_rule', ['commission-plans']);
}

export function useSettleCommissions() {
  return useRpc('settle_commissions', ['commission-events', 'settlements']);
}

/* ==========================================================================
   Suscripciones
   ========================================================================== */

export function useCreateSubscription() {
  return useRpc('create_subscription', ['subscriptions']);
}

export function useSetSubscriptionStatus() {
  return useRpc('set_subscription_status', ['subscriptions']);
}

export function useUpsertSubscriptionItem() {
  return useRpc('upsert_subscription_item', ['subscriptions']);
}

export function useEndSubscriptionItem() {
  return useRpc('end_subscription_item', ['subscriptions']);
}

/* ==========================================================================
   Infraestructura
   ========================================================================== */

export function useUpsertDeploymentTarget() {
  return useRpc('upsert_deployment_target', ['deployment-targets']);
}

export function useAttachTenantToTarget() {
  return useRpc('attach_tenant_to_target', ['deployment-targets', 'tenant-overview', 'tenant']);
}

/** Encola provisioning. DRY_RUN por defecto; LIVE lo rechaza la base salvo super admin. */
export function useEnqueueProvisioning() {
  return useRpc('enqueue_provisioning_request', ['provisioning-requests', 'deployment-targets']);
}

export function useRetryProvisioning() {
  return useRpc('retry_provisioning_request', ['provisioning-requests']);
}
