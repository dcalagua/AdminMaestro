/**
 * Puerto hacia las RPCs de sincronización de la base (migraciones
 * 20260930000100…0400). Una función por RPC, con los nombres de parámetro
 * EXACTOS de la firma SQL: `sync-store.test.ts` los fija para que un cambio de
 * firma no se descubra en producción.
 *
 * Depende solo de un `rpc(fn, args)` mínimo (lo cumple supabase-js), así que se
 * prueba sin Deno ni red. Todas estas RPCs exigen service_role.
 */
import type { EntitlementDeliveryContext } from './sync-client.ts';
import type { EntitlementSnapshot } from './types.ts';

export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/** Error de la base con el código estable del `raise` (p. ej. TENANT_NO_APROVISIONADO). */
export class SyncStoreError extends Error {
  readonly code: string;
  constructor(readonly rpc: string, message: string) {
    super(message);
    this.name = 'SyncStoreError';
    const prefix = message.split(':')[0]?.trim() ?? '';
    this.code = /^[A-Z][A-Z0-9_]{1,63}$/.test(prefix) ? prefix : 'DB_ERROR';
  }
}

export interface ClaimedPush {
  tenant_id: string;
  saas_product_id: string;
  snapshot_version: number;
  checksum: string;
  document: EntitlementSnapshot;
  attempt: number;
}

export interface IssueResult {
  issued: boolean;
  version: number;
  checksum: string;
}

export interface TenantProduct {
  tenant_id: string;
  saas_product_id: string;
}

export interface SyncStore {
  refresh(tenantId: string, productId: string): Promise<string>;
  issue(tenantId: string, productId: string): Promise<IssueResult>;
  issueCandidates(limit: number, sweep: boolean): Promise<TenantProduct[]>;
  claimPushes(worker: string, limit: number, leaseSeconds: number): Promise<ClaimedPush[]>;
  claimPushFor(tenantId: string, productId: string, worker: string, leaseSeconds: number): Promise<ClaimedPush | null>;
  recordPush(tenantId: string, productId: string, worker: string, version: number, outcome: Record<string, unknown>): Promise<string>;
  claimVerifications(worker: string, limit: number, leaseSeconds: number, resampleAfter: string): Promise<(TenantProduct & { state: string })[]>;
  claimVerifyFor(tenantId: string, productId: string, worker: string, leaseSeconds: number): Promise<boolean>;
  recordVerify(tenantId: string, productId: string, worker: string, observed: Record<string, unknown>): Promise<string>;
  deliveryContext(tenantId: string, productId: string): Promise<EntitlementDeliveryContext>;
  registryTargets(): Promise<(TenantProduct & { product_integration_id: string })[]>;
  recordRegistryCheck(productId: string, manifestVersion: string, codes: string[]): Promise<boolean>;
  completeScheduledCancellations(): Promise<number>;
}

export function createRpcSyncStore(client: RpcClient): SyncStore {
  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new SyncStoreError(fn, error.message);
    return data as T;
  }

  return {
    refresh: (tenantId, productId) =>
      call<string>('refresh_entitlement_sync_state', { p_tenant_id: tenantId, p_product_id: productId }),
    issue: (tenantId, productId) =>
      call<IssueResult>('issue_entitlement_snapshot', { p_tenant_id: tenantId, p_product_id: productId }),
    issueCandidates: async (limit, sweep) =>
      (await call<TenantProduct[] | null>('entitlement_issue_candidates', { p_limit: limit, p_sweep: sweep })) ?? [],
    claimPushes: async (worker, limit, leaseSeconds) =>
      (await call<ClaimedPush[] | null>('claim_entitlement_pushes', {
        p_worker: worker,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      })) ?? [],
    claimPushFor: async (tenantId, productId, worker, leaseSeconds) => {
      const rows = await call<ClaimedPush[] | null>('claim_entitlement_push_for', {
        p_tenant_id: tenantId,
        p_product_id: productId,
        p_worker: worker,
        p_lease_seconds: leaseSeconds,
      });
      return rows?.[0] ?? null;
    },
    recordPush: (tenantId, productId, worker, version, outcome) =>
      call<string>('record_entitlement_push_result', {
        p_tenant_id: tenantId,
        p_product_id: productId,
        p_worker: worker,
        p_version: version,
        p_outcome: outcome,
      }),
    claimVerifications: async (worker, limit, leaseSeconds, resampleAfter) =>
      (await call<(TenantProduct & { state: string })[] | null>('claim_entitlement_verifications', {
        p_worker: worker,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
        p_resample_after: resampleAfter,
      })) ?? [],
    claimVerifyFor: (tenantId, productId, worker, leaseSeconds) =>
      call<boolean>('claim_entitlement_verification_for', {
        p_tenant_id: tenantId,
        p_product_id: productId,
        p_worker: worker,
        p_lease_seconds: leaseSeconds,
      }),
    recordVerify: (tenantId, productId, worker, observed) =>
      call<string>('record_entitlement_verify_result', {
        p_tenant_id: tenantId,
        p_product_id: productId,
        p_worker: worker,
        p_observed: observed,
      }),
    deliveryContext: (tenantId, productId) =>
      call<EntitlementDeliveryContext>('entitlement_delivery_context', { p_tenant_id: tenantId, p_product_id: productId }),
    registryTargets: async () =>
      (await call<(TenantProduct & { product_integration_id: string })[] | null>('entitlement_registry_targets', {})) ?? [],
    recordRegistryCheck: (productId, manifestVersion, codes) =>
      call<boolean>('record_entitlement_registry_check', {
        p_product_id: productId,
        p_manifest_version: manifestVersion,
        p_codes: codes,
      }),
    completeScheduledCancellations: () =>
      call<number>('complete_scheduled_addon_cancellations', {}),
  };
}
