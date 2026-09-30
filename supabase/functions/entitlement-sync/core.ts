/**
 * Jobs de sincronización de entitlements (spec §9):
 *
 *   issue           → emite snapshots de los tenants enrolados dirty (o todos en
 *                     un barrido: cambios por paso del tiempo). En el barrido
 *                     cierra antes las bajas de add-on programadas vencidas.
 *   push            → entitlement-push: claim (FOR UPDATE SKIP LOCKED en la
 *                     base) → PUT → record.
 *   verify          → entitlement-verify: claim → GET → record. Única vía a
 *                     IN_SYNC.
 *   registry-verify → manifiesto del SaaS frente al registro, por integración.
 *
 * Sin E/S propia: todo pasa por el puerto SyncStore (RPCs de MasterAdmin) y por
 * el cliente M2M (PUT/GET del contrato). No existe ninguna vía para escribir en
 * la base de un SaaS (DB_DIRECT está prohibido, ADAPTERS.md).
 */
import { pushClaimed, verifyClaimed } from '../_shared/entitlements/sync-flow.ts';
import type { Actor, EntitlementSyncClient } from '../_shared/entitlements/sync-client.ts';
import type { SyncStore } from '../_shared/entitlements/sync-store.ts';

export interface JobDeps {
  store: SyncStore;
  client: EntitlementSyncClient;
  worker: string;
  actor?: Actor;
}

export type JobName = 'issue' | 'push' | 'verify' | 'registry-verify' | 'all';
export interface JobRequest {
  job: JobName;
  sweep: boolean;
  limit: number;
}

const JOBS: JobName[] = ['issue', 'push', 'verify', 'registry-verify', 'all'];
const SERVER_ACTOR: Actor = { id: null, role: 'SERVER' };
const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export const PUSH_LEASE_SECONDS = 120;
export const VERIFY_LEASE_SECONDS = 60;
export const RESAMPLE_AFTER = '6 hours';

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CODE_RE.test(code) ? code : 'ERROR';
}

export function parseJobRequest(raw: unknown): JobRequest {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('PETICION_INVALIDA: se esperaba un objeto JSON');
  }
  const body = raw as Record<string, unknown>;
  const job = body.job ?? 'all';
  const sweep = body.sweep ?? false;
  const limit = body.limit ?? 20;
  if (typeof job !== 'string' || !JOBS.includes(job as JobName)) throw new Error('PETICION_INVALIDA: job');
  if (typeof sweep !== 'boolean') throw new Error('PETICION_INVALIDA: sweep');
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('PETICION_INVALIDA: limit 1..100');
  }
  return { job: job as JobName, sweep, limit };
}

/** Comparación en tiempo constante de la clave del canal servidor. */
export function isServerCall(presented: string | null, serviceKey: string): boolean {
  if (!presented || !serviceKey) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(serviceKey);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export interface TenantResult {
  tenant_id: string;
  saas_product_id: string;
  state: string;
  result: string | null;
  errorCode: string | null;
}

export async function runIssue(deps: JobDeps, opts: { limit: number; sweep: boolean }) {
  const cancellationsClosed = opts.sweep ? await deps.store.completeScheduledCancellations() : 0;
  const candidates = await deps.store.issueCandidates(opts.limit, opts.sweep);
  let issued = 0;
  let unchanged = 0;
  const errors: { tenant_id: string; saas_product_id: string; errorCode: string }[] = [];
  for (const c of candidates) {
    try {
      const r = await deps.store.issue(c.tenant_id, c.saas_product_id);
      if (r.issued) issued += 1;
      else unchanged += 1;
    } catch (error) {
      errors.push({ tenant_id: c.tenant_id, saas_product_id: c.saas_product_id, errorCode: codeOf(error) });
    }
  }
  return { cancellationsClosed, candidates: candidates.length, issued, unchanged, errors };
}

export async function runPush(deps: JobDeps, opts: { limit: number; leaseSeconds: number }) {
  const claimed = await deps.store.claimPushes(deps.worker, opts.limit, opts.leaseSeconds);
  const results: TenantResult[] = [];
  for (const c of claimed) {
    try {
      const { state, push } = await pushClaimed(deps.store, deps.client, c, deps.worker, deps.actor ?? SERVER_ACTOR);
      results.push({ tenant_id: c.tenant_id, saas_product_id: c.saas_product_id, state, result: push.result, errorCode: push.errorCode });
    } catch (error) {
      // El lease vence solo y el siguiente claim lo retoma contando el fallo.
      results.push({ tenant_id: c.tenant_id, saas_product_id: c.saas_product_id, state: 'ERROR', result: null, errorCode: codeOf(error) });
    }
  }
  return { claimed: claimed.length, results };
}

export async function runVerify(deps: JobDeps, opts: { limit: number; leaseSeconds: number; resampleAfter: string }) {
  const claimed = await deps.store.claimVerifications(deps.worker, opts.limit, opts.leaseSeconds, opts.resampleAfter);
  const results: TenantResult[] = [];
  for (const c of claimed) {
    try {
      const { state, verify } = await verifyClaimed(deps.store, deps.client, c.tenant_id, c.saas_product_id, deps.worker, deps.actor ?? SERVER_ACTOR);
      results.push({ tenant_id: c.tenant_id, saas_product_id: c.saas_product_id, state, result: verify.result, errorCode: verify.errorCode });
    } catch (error) {
      results.push({ tenant_id: c.tenant_id, saas_product_id: c.saas_product_id, state: 'ERROR', result: null, errorCode: codeOf(error) });
    }
  }
  return { claimed: claimed.length, results };
}

export async function runRegistryVerify(deps: JobDeps) {
  const targets = await deps.store.registryTargets();
  const results: { saas_product_id: string; product_integration_id: string; drift: boolean | null; errorCode: string | null }[] = [];
  for (const t of targets) {
    try {
      const ctx = await deps.store.deliveryContext(t.tenant_id, t.saas_product_id);
      const manifest = await deps.client.getManifest(ctx, deps.actor ?? SERVER_ACTOR);
      if (!manifest.ok) {
        // Sin manifiesto no hay comparación: no se registra ni drift ni ausencia de drift.
        results.push({ saas_product_id: t.saas_product_id, product_integration_id: t.product_integration_id, drift: null, errorCode: manifest.errorCode });
        continue;
      }
      const drift = await deps.store.recordRegistryCheck(t.saas_product_id, manifest.manifestVersion, manifest.activeCodes);
      results.push({ saas_product_id: t.saas_product_id, product_integration_id: t.product_integration_id, drift, errorCode: null });
    } catch (error) {
      results.push({ saas_product_id: t.saas_product_id, product_integration_id: t.product_integration_id, drift: null, errorCode: codeOf(error) });
    }
  }
  return { targets: targets.length, results };
}

export async function runJob(deps: JobDeps, request: JobRequest) {
  const out: Record<string, unknown> = { job: request.job, worker: deps.worker };
  if (request.job === 'issue' || request.job === 'all') {
    out.issue = await runIssue(deps, { limit: request.limit, sweep: request.sweep });
  }
  if (request.job === 'push' || request.job === 'all') {
    out.push = await runPush(deps, { limit: request.limit, leaseSeconds: PUSH_LEASE_SECONDS });
  }
  if (request.job === 'verify' || request.job === 'all') {
    out.verify = await runVerify(deps, { limit: request.limit, leaseSeconds: VERIFY_LEASE_SECONDS, resampleAfter: RESAMPLE_AFTER });
  }
  if (request.job === 'registry-verify' || request.job === 'all') {
    out.registry = await runRegistryVerify(deps);
  }
  return out;
}
