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

/**
 * Datos de facturación del titular.
 *
 * Existen porque la pasarela los exige para crear el Customer y NO se pueden
 * inventar: viajan al proveedor y acaban en el recibo del cliente. Es una RPC
 * aparte —y no un campo más de `upsert_organization`— para que el permiso sea
 * el suyo: un admin de la propia organización puede corregir su domicilio de
 * facturación sin poder tocar capacidades ni estado.
 */
export function useSetBillingContact() {
  return useRpc('set_billing_contact', ['organization', 'organizations', 'billing-contact']);
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
   Cobranza (Fases 07-08)
   ========================================================================== */

const COLLECTION_KEYS = [
  'subscription-collection', 'subscriptions', 'subscription', 'subscription-document-status',
];

export function useUpsertProviderAccount() {
  return useRpc('upsert_payment_provider_account', ['provider-accounts', ...COLLECTION_KEYS]);
}

/** Versiona el perfil de cobro. Configurar cómo se cobra NO registra ningún cobro. */
export function useSetCollectionProfile() {
  return useRpc('set_subscription_collection_profile', COLLECTION_KEYS);
}

const DOCUMENT_KEYS = ['commercial-documents', 'subscription-document-status', 'billing-alerts'];

export function useRequestDocument() {
  return useRpc('request_commercial_document', DOCUMENT_KEYS);
}

export function useReceiveDocument() {
  return useRpc('receive_commercial_document', DOCUMENT_KEYS);
}

/** Aprobar una OS/OC habilita la continuidad administrativa; no crea un payment. */
export function useApproveDocument() {
  return useRpc('approve_commercial_document', DOCUMENT_KEYS);
}

export function useRejectDocument() {
  return useRpc('reject_commercial_document', DOCUMENT_KEYS);
}

export function useCancelDocument() {
  return useRpc('cancel_commercial_document', DOCUMENT_KEYS);
}

export function useExpireDocuments() {
  return useRpc('expire_commercial_documents', DOCUMENT_KEYS);
}

/* ==========================================================================
   Renovaciones y finanzas (Fases 11-13)
   ========================================================================== */

const ALERT_KEYS = ['billing-alerts', 'renewal-dashboard', 'finance-reconciliation'];

/** Recalcula el trabajo pendiente. Determinista e idempotente; no suspende nada. */
export function useRefreshBillingAlerts() {
  return useRpc('refresh_billing_alerts', ALERT_KEYS);
}

/** ÚNICA vía que suspende por impago, y solo donde la política lo autoriza. */
export function useApplyDueSuspensions() {
  return useRpc('apply_due_suspensions', [
    ...ALERT_KEYS, 'tenant-overview', 'tenant', 'provisioning-requests',
  ]);
}

export function useSetAlertStatus() {
  return useRpc('set_billing_alert_status', ALERT_KEYS);
}

/** Revierte un cobro con contra-eventos de comisión. No borra historia. */
export function useReversePayment() {
  return useRpc('reverse_payment', [
    'invoices', 'commission-events', 'commission-detail', 'settlements',
    'finance-reconciliation', 'product-finance', 'partner-finance',
  ]);
}

/**
 * Factura gerencial del PERIODO en la moneda del contrato, solo con las líneas que
 * tocan según su billing cadence (la decide la base). Idempotente por periodo.
 */
export function useIssueSubscriptionInvoice() {
  return useRpc('issue_subscription_invoice', [
    'invoices', 'subscription', 'subscriptions', 'subscription-billing-status',
    'finance-reconciliation', 'finance-consolidated', ...ALERT_KEYS,
  ]);
}

/** Cobro por transferencia o acuerdo manual. Devenga comisión como cualquier cobro. */
export function useConfirmManualPayment() {
  return useRpc('confirm_manual_payment', [
    'invoices', 'commission-events', 'commission-detail', 'finance-consolidated',
    'finance-reconciliation', 'product-finance', 'partner-finance', ...ALERT_KEYS,
  ]);
}

/* ==========================================================================
   Monedas, FX y moneda de reporte (V3)
   ========================================================================== */

/** Publica 1 base = tasa cotizada para una fecha. Si ya había una, queda SUSTITUIDA. */
export function usePublishExchangeRate() {
  return useRpc('set_exchange_rate', ['exchange-rates', 'finance-consolidated']);
}

/** Anula una tasa con motivo. No se edita ni se borra. */
export function useVoidExchangeRate() {
  return useRpc('void_exchange_rate', ['exchange-rates', 'finance-consolidated']);
}

/** Cambia la LENTE del consolidado. No toca ningún importe nativo. */
export function useSetReportingSettings() {
  return useRpc('set_reporting_settings', ['reporting-settings', 'finance-consolidated']);
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

/* ==========================================================================
   V4 · Plano de provisioning SaaS
   --------------------------------------------------------------------------
   Dos caminos, y la diferencia importa:

     · CONFIGURACIÓN (integraciones, credenciales, destinos, propietarios) →
       RPC directa, igual que el resto del Control Plane.

     · EJECUCIÓN (provisionar, verificar conexión) → Edge Function. React NUNCA
       llama a EWM, TMS ni a ningún producto. Llama al orquestador, que
       comprueba el permiso contra la base ANTES de asumir el rol de servidor y
       resuelve él mismo base_url, issuer, audience, scopes y credencial.
       Lo único que viaja desde aquí es el identificador de la solicitud.
   ========================================================================== */

const PROVISIONING_KEYS = [
  'saas-provisioning',
  'saas-provisioning-events',
  'provisioning-preconditions',
  'tenant-product-mappings',
  'provisioning-targets',
];

export function useUpsertProductIntegration() {
  return useRpc('upsert_product_integration', [
    'product-integrations',
    'product-integration',
    'provisioning-targets',
    'provisioning-audit',
  ]);
}

export function useUpsertCredentialProfile() {
  return useRpc('upsert_credential_profile', [
    'credential-profiles',
    'provisioning-targets',
    'provisioning-audit',
  ]);
}

export function useConfigureDeploymentProvisioning() {
  return useRpc('configure_deployment_provisioning', [
    'provisioning-targets',
    'deployment-targets',
    'provisioning-audit',
    ...PROVISIONING_KEYS,
  ]);
}

export function useUpsertProductOwner() {
  return useRpc('upsert_product_owner', ['product-owners', 'provisioning-permissions']);
}

export function useDeactivateProductOwner() {
  return useRpc('deactivate_product_owner', ['product-owners', 'provisioning-permissions']);
}

export function useGrantProvisioningRole() {
  return useRpc('grant_provisioning_role', ['provisioning-permissions']);
}

export function useCreateSaasProvisioningRequest() {
  return useRpc('create_saas_provisioning_request', PROVISIONING_KEYS);
}

/** Reintenta la MISMA solicitud, con la MISMA clave de idempotencia. */
export function useRetrySaasProvisioning() {
  return useRpc('retry_saas_provisioning_request', PROVISIONING_KEYS);
}

export function useCancelSaasProvisioning() {
  return useRpc('cancel_saas_provisioning_request', PROVISIONING_KEYS);
}

/** Alta hecha a mano en el producto, registrada con auditoría. */
export function useRegisterManualProvisioning() {
  return useRpc('register_manual_provisioning', PROVISIONING_KEYS);
}

/* --------------------------------------------------------------------------
   Ejecución vía Edge Function
   -------------------------------------------------------------------------- */

export interface OrchestratorResult {
  request_id?: string;
  status?: string;
  error?: string;
  error_code?: string;
  message?: string;
  blockers?: string[];
  attempts?: number;
  external_tenant_id?: string;
  health?: string;
  detail?: string;
  provider_http_status?: number | null;
  retryable?: boolean;
}

/**
 * Invoca el orquestador.
 *
 * El cuerpo lleva la ACCIÓN y un identificador, y nada más. No lleva base_url,
 * ni scope, ni issuer, ni audience, ni el tipo de adaptador: todo eso lo
 * resuelve el servidor (fase 39). Si el cliente pudiera elegirlo, podría
 * reapuntar la llamada a cualquier sitio y ampliar el alcance del token.
 */
async function invokeOrchestrator(body: {
  action: 'PROVISION' | 'CHECK_HEALTH';
  request_id?: string;
  deployment_target_id?: string;
}): Promise<OrchestratorResult> {
  const { data, error } = await supabase.functions.invoke<OrchestratorResult>(
    'provisioning-orchestrator',
    { body },
  );

  if (error) {
    // `FunctionsHttpError` trae el cuerpo real; sin esto, un 403 llegaría como
    // «Edge Function returned a non-2xx status code» y el operador no sabría
    // si le falta permiso o si el destino está caído.
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const payload = (await context.json()) as OrchestratorResult;
        throw new Error(payload.message ?? payload.error ?? error.message);
      } catch (parsed) {
        if (parsed instanceof Error && parsed.message !== error.message) throw parsed;
      }
    }
    throw new Error(error.message);
  }

  return data ?? {};
}

export function useProvisionTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) =>
      invokeOrchestrator({ action: 'PROVISION', request_id: requestId }),
    onSuccess: () => invalidate(qc, [...PROVISIONING_KEYS, ...AGGREGATE_KEYS]),
  });
}

export function useCheckDeploymentHealth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deploymentTargetId: string) =>
      invokeOrchestrator({ action: 'CHECK_HEALTH', deployment_target_id: deploymentTargetId }),
    onSuccess: () =>
      invalidate(qc, ['provisioning-targets', 'deployment-targets', ...PROVISIONING_KEYS]),
  });
}
