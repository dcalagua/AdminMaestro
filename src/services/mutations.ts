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

/*
 * CCP fase 07 · catálogo comercial. Importar un manifiesto es de producto
 * (EBIM_PRODUCT_ADMIN); cambiar el ciclo de vida de un add-on, también; fijar
 * su tarifa es de finanzas. La base decide y audita; la UI solo ofrece.
 */
export function useImportCapabilityManifest() {
  return useRpc('import_capability_manifest', ['capabilities', 'tenant-entitlements']);
}

export function useSetCatalogItemLifecycle() {
  return useRpc('set_catalog_item_lifecycle', ['catalog-items', 'catalog-item-prices']);
}

/** Versiona la tarifa del add-on en un mercado: cierra la vigente y abre otra. */
export function useSetCatalogItemPrice() {
  return useRpc('set_catalog_item_price', ['catalog-item-prices']);
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

/*
 * Ciclo de vida de add-ons de tenant (CCP fase 07, spec §6.2). `tenant_addons`
 * no admite escritura directa: solicitar nunca activa, aprobar/cancelar es
 * comercial y suspender/reanudar/baja inmediata es de finanzas. El backend
 * decide la autoridad y audita cada transición; la UI solo muestra.
 */
const TENANT_ADDON_KEYS = [
  'tenant-addons', 'tenant-entitlements', 'tenant-features', 'feature-flags', 'subscription-items',
];

export function useRequestTenantAddon() {
  return useRpc('request_tenant_addon', TENANT_ADDON_KEYS);
}

export function useApproveTenantAddon() {
  return useRpc('approve_tenant_addon', TENANT_ADDON_KEYS);
}

export function useRejectTenantAddon() {
  return useRpc('reject_tenant_addon', TENANT_ADDON_KEYS);
}

export function useScheduleCancelTenantAddon() {
  return useRpc('schedule_cancel_tenant_addon', TENANT_ADDON_KEYS);
}

export function useReactivateTenantAddon() {
  return useRpc('reactivate_tenant_addon', TENANT_ADDON_KEYS);
}

export function useSuspendTenantAddon() {
  return useRpc('suspend_tenant_addon', TENANT_ADDON_KEYS);
}

export function useResumeTenantAddon() {
  return useRpc('resume_tenant_addon', TENANT_ADDON_KEYS);
}

export function useCancelTenantAddon() {
  return useRpc('cancel_tenant_addon', TENANT_ADDON_KEYS);
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

/**
 * Datos propios del alta en el producto (p. ej. almacén inicial). Sólo antes
 * del primer envío: después la base los congela para que un reintento mande
 * exactamente el mismo cuerpo.
 */
export function useSetProvisioningConfiguration() {
  return useRpc('set_saas_provisioning_configuration', PROVISIONING_KEYS);
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
  /** GET_STATUS: resultado de la consulta remota, de sólo lectura. */
  found?: boolean;
  remote?: {
    status: string;
    externalTenantId: string;
    externalOrganizationId: string | null;
    externalCompanyId: string | null;
    resources: Record<string, unknown>;
  } | null;
  mapping_consistent?: boolean;
  provider_code?: string | null;
}

/**
 * Invoca el orquestador.
 *
 * El cuerpo lleva la ACCIÓN y un identificador, y nada más. No lleva base_url,
 * ni scope, ni issuer, ni audience, ni el tipo de adaptador: todo eso lo
 * resuelve el servidor (fase 39). Si el cliente pudiera elegirlo, podría
 * reapuntar la llamada a cualquier sitio y ampliar el alcance del token.
 */
async function invokeOrchestrator<T = OrchestratorResult>(body: {
  action: 'PROVISION' | 'CHECK_HEALTH' | 'GET_STATUS' | 'SYNC_ENTITLEMENTS' | 'GET_ENTITLEMENTS';
  request_id?: string;
  deployment_target_id?: string;
  tenant_id?: string;
}): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(
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
        const base = payload.message ?? payload.error ?? error.message;
        // Los bloqueos son códigos accionables: sin ellos, «no cumple las
        // condiciones» no dice qué falta.
        const blockers = payload.blockers?.length ? ` (${payload.blockers.join(', ')})` : '';
        throw new Error(`${base}${blockers}`);
      } catch (parsed) {
        if (parsed instanceof Error && parsed.message !== error.message) throw parsed;
      }
    }
    throw new Error(error.message);
  }

  return (data ?? {}) as T;
}

/**
 * Resumen que devuelve el orquestador para SYNC_ENTITLEMENTS / GET_ENTITLEMENTS
 * (CCP fase 08): estado que decidió la base, y códigos del push y del GET.
 * Nunca incluye el snapshot ni cuerpos del SaaS.
 */
export interface EntitlementSyncSummary {
  tenant_id: string;
  saas_product_id: string;
  state: string;
  skipped?: string;
  issued?: boolean;
  desired_version?: number;
  push?: { result: string; errorCode: string | null; httpStatus: number | null };
  verify?: { result: string; errorCode: string | null; httpStatus: number | null; appliedVersion: number | null; status: string | null };
}

/** «Sincronizar ahora»: emite si hace falta, empuja y verifica por GET. */
export function useSyncEntitlements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) =>
      invokeOrchestrator<EntitlementSyncSummary>({ action: 'SYNC_ENTITLEMENTS', tenant_id: tenantId }),
    onSettled: () => invalidate(qc, ['entitlement-sync-status']),
  });
}

/** «Verificar»: solo el GET aplicado; no emite ni empuja. */
export function useVerifyEntitlements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) =>
      invokeOrchestrator<EntitlementSyncSummary>({ action: 'GET_ENTITLEMENTS', tenant_id: tenantId }),
    onSettled: () => invalidate(qc, ['entitlement-sync-status']),
  });
}

export function useProvisionTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) =>
      invokeOrchestrator({ action: 'PROVISION', request_id: requestId }),
    onSuccess: () => invalidate(qc, [...PROVISIONING_KEYS, ...AGGREGATE_KEYS]),
  });
}

/**
 * Consulta de estado remoto (GET_STATUS). Sólo lectura: no cambia la solicitud
 * ni el mapping; el historial gana un evento STATUS_CHECKED.
 */
export function useGetProvisioningStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) =>
      invokeOrchestrator({ action: 'GET_STATUS', request_id: requestId }),
    onSuccess: () => invalidate(qc, ['saas-provisioning-events']),
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

/* ==========================================================================
   M1 · Portal de pago por enlace · M2 · Tarjeta guardada
   ========================================================================== */

const PAYMENT_LINK_KEYS = ['payment-links', 'payment-link-events'];

/** Devuelve el token en claro UNA sola vez: la base solo guarda su hash. */
export function useCreatePaymentLink() {
  return useRpc('create_payment_link', PAYMENT_LINK_KEYS);
}

export function useRevokePaymentLink() {
  return useRpc('revoke_payment_link', PAYMENT_LINK_KEYS);
}

const CARD_ON_FILE_KEYS = [
  'card-on-file', 'provider-payment-methods', 'charge-attempts', ...COLLECTION_KEYS,
];

/** Revoca la autorización: la tarjeta queda inactiva y el perfil pasa a cobro manual. */
export function useRevokeCardOnFile() {
  return useRpc('revoke_card_on_file_authorization', CARD_ON_FILE_KEYS);
}

export interface AutochargeResult {
  invoice_number?: string | null;
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'REVIEW';
  error_code?: string | null;
  amount?: number | null;
  currency?: string | null;
}

export interface AutochargeSummary {
  mode?: string;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Cobrado en la pasarela pero sin confirmar, o fallo ambiguo: queda en revisión. */
  review?: number;
  results: AutochargeResult[];
}

/**
 * Cobro con tarjeta guardada (Edge Function `payment-autocharge`, JWT de
 * finanzas). `{ invoiceId }` = «Cobrar ahora»; `{ run: true }` = «Ejecutar
 * cobros pendientes» según la política de reintentos.
 */
export function useAutocharge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invoiceId: string } | { run: true }): Promise<AutochargeSummary> => {
      const body = 'invoiceId' in input ? { invoice_id: input.invoiceId } : { run: true };
      const { data, error } = await supabase.functions.invoke<AutochargeSummary>('payment-autocharge', { body });
      if (error) {
        const context = (error as { context?: Response }).context;
        if (context && typeof context.json === 'function') {
          try {
            const payload = (await context.json()) as { error?: string; message?: string };
            throw new Error(payload.message ?? payload.error ?? error.message);
          } catch (parsed) {
            if (parsed instanceof Error && parsed.message !== error.message) throw parsed;
          }
        }
        throw new Error(error.message);
      }
      return data ?? { processed: 0, succeeded: 0, failed: 0, skipped: 0, results: [] };
    },
    onSettled: () =>
      invalidate(qc, [
        'invoices', 'charge-attempts', 'billing-alerts', 'renewal-dashboard', 'finance-reconciliation',
        'commission-events', ...AGGREGATE_KEYS,
      ]),
  });
}

/* ==========================================================================
   CCP M4 · Uso, créditos IA y billing shadow (fases 17–18)

   Toda escritura es una RPC `SECURITY DEFINER` con motivo y auditoría. La UI
   ofrece cada acción según `usePermissions`, pero la RPC es la autoridad:
   medidores → EBIM_PRODUCT_ADMIN; facturable, finalizar, créditos y shadow →
   EBIM_FINANCE; eje BILLING → `can_manage_commercial`.
   ========================================================================== */

const USAGE_AGGREGATE_KEYS = ['usage-aggregates', 'usage-alerts', 'ai-credit-ledger', 'ai-credit-balances'];
const AI_CREDIT_KEYS = ['ai-credit-ledger', 'ai-credit-balances', 'usage-alerts'];

export function useUpsertUsageMeter() {
  return useRpc('upsert_usage_meter', ['usage-meters']);
}

/** D-06: solo finanzas decide si un medidor es facturable, con motivo. */
export function useSetUsageMeterBillable() {
  return useRpc('set_usage_meter_billable', ['usage-meters']);
}

export function useConfigureUsageIngestCredential() {
  return useRpc('configure_usage_ingest_credential', ['usage-ingest-credentials']);
}

/** Kill-switch por producto (`product_integrations.usage_ingest_enabled`). */
export function useSetUsageIngestEnabled() {
  return useRpc('set_usage_ingest_enabled', ['product-integrations', 'product-integration']);
}

/** CLOSING → FINALIZED. Recalcula desde los eventos y, si es IA, consume créditos. */
export function useFinalizeUsageAggregate() {
  return useRpc('finalize_usage_aggregate', USAGE_AGGREGATE_KEYS);
}

export function useReverseAiCreditEntry() {
  return useRpc('reverse_ai_credit_entry', AI_CREDIT_KEYS);
}

/** Versiona el peso: cierra el vigente y abre uno nuevo. Re-emite snapshots del producto. */
export function useSetAiCreditWeight() {
  return useRpc('set_ai_credit_weight', ['ai-credit-weights', 'entitlement-sync-status']);
}

/**
 * Los campos comerciales de la política admiten NULL = «no decidido» (D-03).
 * El tipo generado no lo refleja (los argumentos sin default salen no nulos),
 * así que se declara aquí explícitamente.
 */
export type CreateAiCreditPolicyArgs = Omit<
  Args<'create_ai_credit_policy'>,
  'p_pool_scope' | 'p_included_credits' | 'p_overage_mode'
> & {
  p_pool_scope: string | null;
  p_included_credits: number | null;
  p_overage_mode: string | null;
};

export function useCreateAiCreditPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateAiCreditPolicyArgs) =>
      callRpc('create_ai_credit_policy', args as unknown as Args<'create_ai_credit_policy'>),
    onSuccess: () => invalidate(qc, ['ai-credit-policies', ...AGGREGATE_KEYS]),
  });
}

/** GRANT_PERIOD de los incluidos. Idempotente por política × período. */
export function useOpenAiCreditPeriod() {
  return useRpc('open_ai_credit_period', AI_CREDIT_KEYS);
}

/** Movimiento manual de finanzas. La UI lo limita a GRANT_BONUS / ADJUST. */
export function useRecordAiCreditEntry() {
  return useRpc('record_ai_credit_entry', AI_CREDIT_KEYS);
}

/** CREDIT_PURCHASE (ítem ONE_TIME en el contrato) + GRANT_PURCHASE en el ledger. */
export function usePurchaseAiCredits() {
  return useRpc('purchase_ai_credits', [...AI_CREDIT_KEYS, 'subscriptions', 'subscription']);
}

export function useSetCatalogItemCreditPack() {
  return useRpc('set_catalog_item_credit_pack', ['catalog-items']);
}

/** Para `AI_CREDIT` el medidor DEBE ir nulo; el tipo generado no lo admite. */
export type SetCatalogItemUsageBindingArgs = Omit<Args<'set_catalog_item_usage_binding'>, 'p_meter_code'> & {
  p_meter_code: string | null;
};

export function useSetCatalogItemUsageBinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: SetCatalogItemUsageBindingArgs) =>
      callRpc('set_catalog_item_usage_binding', args as unknown as Args<'set_catalog_item_usage_binding'>),
    onSuccess: () => invalidate(qc, ['catalog-items', ...AGGREGATE_KEYS]),
  });
}

/** Mueve un eje de cutover un paso (adelante o atrás), con motivo. */
export function useSetCommercialCutoverState() {
  return useRpc('set_commercial_cutover_state', ['product-integrations', 'product-integration']);
}

/** Compara el biller local con lo que MasterAdmin facturaría y guarda el reporte. */
export function useRecordBillingShadowComparison() {
  return useRpc('record_billing_shadow_comparison', ['billing-shadow-comparisons']);
}

/*
 * TODO(M4-DB) · RPCs que añade el stream de base de datos (spec §5). No existen
 * aún en `database.types.ts`, así que NO se declaran hooks que no compilarían ni
 * botones muertos. Cuando la migración `20261012000100_usage_credits_console.sql`
 * llegue y se regeneren los tipos:
 *
 *   export function useCloseUsageAggregate() {
 *     return useRpc('close_usage_aggregate', USAGE_AGGREGATE_KEYS);       // (p_aggregate_id, p_reason)
 *   }
 *   export function useAcknowledgeUsageAlert() {
 *     return useRpc('acknowledge_usage_alert', ['usage-alerts', 'usage-alert-acks']); // (p_alert_id, p_note)
 *   }
 *   export function useEndAiCreditPolicy() {
 *     return useRpc('end_ai_credit_policy', ['ai-credit-policies']);       // (p_policy_id, p_valid_to, p_reason)
 *   }
 *
 * Puntos de enganche en la UI: `AggregatesTab` (fila OPEN con período vencido),
 * `AlertsTab` (columna de acuse) y `PoliciesTab` (fila vigente).
 */
