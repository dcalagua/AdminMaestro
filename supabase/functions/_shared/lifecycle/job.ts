/**
 * Job `lifecycle` (migración 20261020000200): reclama las entregas pendientes,
 * hace el PUT lifecycle.v1 y registra el resultado. Corre dentro de
 * entitlement-sync (cada 5 minutos con `job: "all"`).
 *
 * Puerto mínimo hacia la base (`LifecycleStore`) con los nombres de parámetro
 * EXACTOS de las firmas SQL; todas las RPCs exigen service_role.
 */
import type { RpcClient } from '../entitlements/sync-store.ts';
import { SyncStoreError } from '../entitlements/sync-store.ts';
import type {
  Actor,
  LifecycleClient,
  LifecycleDeliveryContext,
  LifecycleReason,
  LifecycleResult,
  LifecycleState,
} from './client.ts';

export interface ClaimedLifecycle {
  tenant_id: string;
  saas_product_id: string;
  desired_version: number;
  desired_state: LifecycleState;
  desired_reason: LifecycleReason | null;
  desired_at: string;
}

export interface LifecycleRecord {
  version: number;
  state: LifecycleState;
  result: LifecycleResult;
  httpStatus: number | null;
  errorCode: string | null;
  appliedVersion: number | null;
}

export interface LifecycleStore {
  claim(worker: string, limit: number, leaseSeconds: number): Promise<ClaimedLifecycle[]>;
  context(tenantId: string): Promise<LifecycleDeliveryContext>;
  record(tenantId: string, worker: string, outcome: LifecycleRecord): Promise<string>;
}

export function createRpcLifecycleStore(client: RpcClient): LifecycleStore {
  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new SyncStoreError(fn, error.message);
    return data as T;
  }
  return {
    claim: async (worker, limit, leaseSeconds) =>
      (await call<ClaimedLifecycle[] | null>('claim_lifecycle_deliveries', {
        p_worker: worker,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      })) ?? [],
    context: (tenantId) => call<LifecycleDeliveryContext>('lifecycle_delivery_context', { p_tenant_id: tenantId }),
    record: (tenantId, worker, o) =>
      call<string>('record_lifecycle_delivery_result', {
        p_tenant_id: tenantId,
        p_worker: worker,
        p_version: o.version,
        p_state: o.state,
        p_result: o.result,
        p_http_status: o.httpStatus,
        p_error_code: o.errorCode,
        p_applied_version: o.appliedVersion,
      }),
  };
}

export const LIFECYCLE_LEASE_SECONDS = 120;
const SERVER_ACTOR: Actor = { id: null, role: 'SERVER' };
const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export interface LifecycleJobDeps {
  store: LifecycleStore;
  client: LifecycleClient;
  worker: string;
  actor?: Actor;
}

export interface LifecycleTenantResult {
  tenant_id: string;
  version: number;
  state: LifecycleState;
  result: LifecycleResult | 'ERROR';
  errorCode: string | null;
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CODE_RE.test(code) ? code : 'ERROR';
}

export async function runLifecycle(deps: LifecycleJobDeps, opts: { limit: number; leaseSeconds?: number }) {
  const claimed = await deps.store.claim(deps.worker, opts.limit, opts.leaseSeconds ?? LIFECYCLE_LEASE_SECONDS);
  const results: LifecycleTenantResult[] = [];
  for (const c of claimed) {
    try {
      const ctx = await deps.store.context(c.tenant_id);
      const outcome = await deps.client.putState(
        ctx,
        { version: c.desired_version, state: c.desired_state, reason: c.desired_reason, effectiveAt: c.desired_at },
        deps.actor ?? SERVER_ACTOR,
      );
      await deps.store.record(c.tenant_id, deps.worker, {
        version: c.desired_version,
        state: c.desired_state,
        result: outcome.result,
        httpStatus: outcome.httpStatus,
        errorCode: outcome.errorCode,
        appliedVersion: outcome.appliedVersion,
      });
      results.push({ tenant_id: c.tenant_id, version: c.desired_version, state: c.desired_state, result: outcome.result, errorCode: outcome.errorCode });
    } catch (error) {
      // El lease vence solo y el siguiente claim lo retoma.
      results.push({ tenant_id: c.tenant_id, version: c.desired_version, state: c.desired_state, result: 'ERROR', errorCode: codeOf(error) });
    }
  }
  return { claimed: claimed.length, results };
}
