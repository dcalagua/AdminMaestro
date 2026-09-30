/**
 * Flujo de sincronización de un tenant: push → registro → GET → registro.
 *
 * Lo comparten el orquestador (SYNC_ENTITLEMENTS / GET_ENTITLEMENTS, "sincronizar
 * ahora" desde la consola) y el job `entitlement-sync`. Reglas:
 *
 *   · todo lease reclamado se cierra con un record_*: si falta el contexto o el
 *     cliente falla de forma inesperada, se registra igualmente (REJECTED /
 *     RETRYABLE) en vez de dejar el tenant PUSHING hasta que venza el lease;
 *   · el estado lo decide la BASE (lo que devuelve record_*), nunca este módulo;
 *   · al SaaS solo se le habla por el PUT/GET del contrato.
 */
import type { Actor, EntitlementSyncClient, PushOutcome, VerifyOutcome } from './sync-client.ts';
import type { ClaimedPush, SyncStore } from './sync-store.ts';

export const PUSH_LEASE_SECONDS = 60;
export const VERIFY_LEASE_SECONDS = 60;

export interface SyncSummary {
  tenant_id: string;
  saas_product_id: string;
  state: string;
  skipped?: 'NOT_PROVISIONED' | 'NOT_ENROLLED' | 'VERIFY_NOT_AVAILABLE';
  issued?: boolean;
  desired_version?: number;
  push?: { result: string; errorCode: string | null; httpStatus: number | null };
  verify?: { result: string; errorCode: string | null; httpStatus: number | null; appliedVersion: number | null; status: string | null };
}

/** Lo que se registra en la base: sin intentos ni nada que no sea código/versión. */
function forStore(o: PushOutcome | VerifyOutcome): Record<string, unknown> {
  return {
    result: o.result,
    httpStatus: o.httpStatus,
    errorCode: o.errorCode,
    appliedVersion: o.appliedVersion,
    appliedChecksum: o.appliedChecksum,
    status: o.status,
    unknownCapabilities: o.unknownCapabilities,
  };
}

function localFailure(result: 'REJECTED' | 'RETRYABLE', errorCode: string) {
  return {
    result,
    httpStatus: null,
    errorCode,
    appliedVersion: null,
    appliedChecksum: null,
    status: null,
    unknownCapabilities: [] as string[],
    attempts: 0,
  };
}

export async function pushClaimed(
  store: SyncStore,
  client: EntitlementSyncClient,
  claimed: ClaimedPush,
  worker: string,
  actor: Actor,
): Promise<{ state: string; push: PushOutcome }> {
  let push: PushOutcome;
  let ctx;
  try {
    ctx = await store.deliveryContext(claimed.tenant_id, claimed.saas_product_id);
  } catch {
    ctx = null;
  }
  if (!ctx) {
    push = localFailure('REJECTED', 'CONTEXT_UNAVAILABLE');
  } else {
    try {
      push = await client.pushSnapshot(ctx, claimed.document, actor);
    } catch {
      push = localFailure('RETRYABLE', 'CLIENT_ERROR');
    }
  }
  const state = await store.recordPush(claimed.tenant_id, claimed.saas_product_id, worker, claimed.snapshot_version, forStore(push));
  return { state, push };
}

export async function verifyClaimed(
  store: SyncStore,
  client: EntitlementSyncClient,
  tenantId: string,
  productId: string,
  worker: string,
  actor: Actor,
): Promise<{ state: string; verify: VerifyOutcome }> {
  let verify: VerifyOutcome;
  let ctx;
  try {
    ctx = await store.deliveryContext(tenantId, productId);
  } catch {
    ctx = null;
  }
  if (!ctx) {
    verify = { ...localFailure('REJECTED', 'CONTEXT_UNAVAILABLE'), enforcementMode: null };
  } else {
    try {
      verify = await client.getApplied(ctx, actor);
    } catch {
      verify = { ...localFailure('RETRYABLE', 'CLIENT_ERROR'), enforcementMode: null };
    }
  }
  const state = await store.recordVerify(tenantId, productId, worker, forStore(verify));
  return { state, verify };
}

function pushSummary(p: PushOutcome): SyncSummary['push'] {
  return { result: p.result, errorCode: p.errorCode, httpStatus: p.httpStatus };
}

function verifySummary(v: VerifyOutcome): SyncSummary['verify'] {
  return { result: v.result, errorCode: v.errorCode, httpStatus: v.httpStatus, appliedVersion: v.appliedVersion, status: v.status };
}

/** SYNC_ENTITLEMENTS: puertas → emisión → push (si procede) → GET. */
export async function syncTenantNow(
  store: SyncStore,
  client: EntitlementSyncClient,
  tenantId: string,
  productId: string,
  actor: Actor,
  worker: string,
): Promise<SyncSummary> {
  const base = { tenant_id: tenantId, saas_product_id: productId };
  const gate = await store.refresh(tenantId, productId);
  if (gate === 'NOT_PROVISIONED') return { ...base, state: gate, skipped: gate };

  const issued = await store.issue(tenantId, productId);
  const summary: SyncSummary = { ...base, state: gate, issued: issued.issued, desired_version: issued.version };
  if (gate === 'NOT_ENROLLED') return { ...summary, skipped: gate };

  const claimed = await store.claimPushFor(tenantId, productId, worker, PUSH_LEASE_SECONDS);
  if (claimed) {
    const { state, push } = await pushClaimed(store, client, claimed, worker, actor);
    summary.state = state;
    summary.push = pushSummary(push);
  }

  if (await store.claimVerifyFor(tenantId, productId, worker, VERIFY_LEASE_SECONDS)) {
    const { state, verify } = await verifyClaimed(store, client, tenantId, productId, worker, actor);
    summary.state = state;
    summary.verify = verifySummary(verify);
  }
  return summary;
}

/** GET_ENTITLEMENTS: solo el GET aplicado; no emite ni empuja. */
export async function readTenantNow(
  store: SyncStore,
  client: EntitlementSyncClient,
  tenantId: string,
  productId: string,
  actor: Actor,
  worker: string,
): Promise<SyncSummary> {
  const base = { tenant_id: tenantId, saas_product_id: productId };
  const state = await store.refresh(tenantId, productId);
  if (state === 'NOT_PROVISIONED' || state === 'NOT_ENROLLED') return { ...base, state, skipped: state };
  if (!(await store.claimVerifyFor(tenantId, productId, worker, VERIFY_LEASE_SECONDS))) {
    return { ...base, state, skipped: 'VERIFY_NOT_AVAILABLE' };
  }
  const { state: after, verify } = await verifyClaimed(store, client, tenantId, productId, worker, actor);
  return { ...base, state: after, verify: verifySummary(verify) };
}
