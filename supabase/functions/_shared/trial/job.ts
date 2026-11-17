/**
 * Job `trial` (migración 20261024000100): reclama las entregas trial.v1
 * pendientes, hace el PUT y registra el resultado. Corre dentro de
 * entitlement-sync (cada 5 minutos con `job: "all"`, igual que `lifecycle`).
 *
 * Puerto mínimo hacia la base (`TrialStore`) con los nombres de parámetro
 * EXACTOS de las firmas SQL; todas las RPCs exigen service_role.
 */
import type { RpcClient } from '../entitlements/sync-store.ts';
import { SyncStoreError } from '../entitlements/sync-store.ts';
import type { Actor, TrialClient, TrialDeliveryContext, TrialReason, TrialResult, TrialState } from './client.ts';

export interface ClaimedTrial {
  tenant_id: string;
  saas_product_id: string;
  desired_version: number;
  desired_ends_at: string | null;
  desired_reason: TrialReason;
  desired_at: string;
}

export interface TrialRecord {
  version: number;
  result: TrialResult;
  httpStatus: number | null;
  errorCode: string | null;
  state: TrialState | null;
}

export interface TrialStore {
  claim(worker: string, limit: number, leaseSeconds: number): Promise<ClaimedTrial[]>;
  context(tenantId: string): Promise<TrialDeliveryContext>;
  record(tenantId: string, worker: string, outcome: TrialRecord): Promise<string>;
}

export function createRpcTrialStore(client: RpcClient): TrialStore {
  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new SyncStoreError(fn, error.message);
    return data as T;
  }
  return {
    claim: async (worker, limit, leaseSeconds) =>
      (await call<ClaimedTrial[] | null>('claim_trial_deliveries', {
        p_worker: worker,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      })) ?? [],
    context: (tenantId) => call<TrialDeliveryContext>('trial_delivery_context', { p_tenant_id: tenantId }),
    record: (tenantId, worker, o) =>
      call<string>('record_trial_delivery_result', {
        p_tenant_id: tenantId,
        p_worker: worker,
        p_version: o.version,
        p_result: o.result,
        p_http_status: o.httpStatus,
        p_error_code: o.errorCode,
        p_applied_state: o.state,
      }),
  };
}

export const TRIAL_LEASE_SECONDS = 120;
const SERVER_ACTOR: Actor = { id: null, role: 'SERVER' };
const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export interface TrialJobDeps {
  store: TrialStore;
  client: TrialClient;
  worker: string;
  actor?: Actor;
}

export interface TrialTenantResult {
  tenant_id: string;
  version: number;
  reason: TrialReason;
  result: TrialResult | 'ERROR';
  errorCode: string | null;
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CODE_RE.test(code) ? code : 'ERROR';
}

export async function runTrial(deps: TrialJobDeps, opts: { limit: number; leaseSeconds?: number }) {
  const claimed = await deps.store.claim(deps.worker, opts.limit, opts.leaseSeconds ?? TRIAL_LEASE_SECONDS);
  const results: TrialTenantResult[] = [];
  for (const c of claimed) {
    try {
      const ctx = await deps.store.context(c.tenant_id);
      const outcome = await deps.client.putTrial(
        ctx,
        { endsAt: c.desired_ends_at, reason: c.desired_reason },
        deps.actor ?? SERVER_ACTOR,
      );
      await deps.store.record(c.tenant_id, deps.worker, {
        version: c.desired_version,
        result: outcome.result,
        httpStatus: outcome.httpStatus,
        errorCode: outcome.errorCode,
        state: outcome.state,
      });
      results.push({ tenant_id: c.tenant_id, version: c.desired_version, reason: c.desired_reason, result: outcome.result, errorCode: outcome.errorCode });
    } catch (error) {
      // El lease vence solo y el siguiente claim lo retoma.
      results.push({ tenant_id: c.tenant_id, version: c.desired_version, reason: c.desired_reason, result: 'ERROR', errorCode: codeOf(error) });
    }
  }
  return { claimed: claimed.length, results };
}
