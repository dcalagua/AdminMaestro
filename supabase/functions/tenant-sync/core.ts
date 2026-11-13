/**
 * Sincronización de tenants con las apps (migración 20261021000100).
 *
 * Recorre los destinos que devuelve `tenant_sync_plan` y, por cada uno, OBSERVA
 * con GET firmados M2M (nunca escribe en la app):
 *
 *   · existencia de cada vínculo: GET_STATUS del adaptador si la integración
 *     lo declara (EWM_V1 hoy); si no, `GET lifecycle.v1` (404
 *     TENANT_NOT_PROVISIONED = no existe);
 *   · estado operativo: `GET lifecycle.v1` (ACTIVE / SUSPENDED);
 *   · inventario: `GET tenant-inventory.v1` SOLO si la app lo anuncia.
 *
 * La base decide qué es un hallazgo (`record_tenant_sync_target_result`). Aquí
 * no hay reglas de negocio: solo transporte, clasificación prudente y un fallo
 * por destino que no detiene a los demás.
 */
import {
  buildExecutionContext,
  normalizeThrownFailure,
  resolveAdapter,
  summarizeStatus,
  type AdapterType,
  type ProvisioningAdapter,
  type ProvisioningContext,
  type ProvisioningEnvironment,
  type SecretResolver,
} from '../_shared/provisioning/index.ts';
import type { RpcClient } from '../_shared/entitlements/sync-store.ts';
import { SyncStoreError } from '../_shared/entitlements/sync-store.ts';
import type { M2mGetDeps } from '../_shared/sync/m2m-get.ts';
import { fetchInventory, hasInventory, hasLifecycleRead, readLifecycleState } from '../_shared/sync/readers.ts';
import {
  codeOf,
  type InventoryObservation,
  type LinkObservation,
  type SyncActor,
  type SyncPlanLink,
  type SyncPlanTarget,
  type TargetObservation,
  type VerifyMethod,
} from '../_shared/sync/types.ts';

export type SyncTrigger = 'SCHEDULED' | 'MANUAL';

export interface TargetRecordResult {
  deployment_target_id: string;
  outcome: string;
  links_total: number;
  links_broken: number;
  links_state_mismatch: number;
  inventory_status: string;
  inventory_unknown: number;
  findings_opened: number;
  findings_closed: number;
}

export interface RunFinish {
  run_id: string;
  status: string;
  targets_checked: number;
  findings_opened: number;
  findings_closed: number;
}

/** Puerto hacia MasterAdmin, con los nombres de parámetro EXACTOS de las RPC. */
export interface TenantSyncStore {
  begin(trigger: SyncTrigger, requestedBy: string | null): Promise<string>;
  plan(): Promise<SyncPlanTarget[]>;
  executionContext(requestId: string): Promise<Omit<ProvisioningContext, 'actor'>>;
  recordTarget(runId: string, targetId: string, observation: TargetObservation): Promise<TargetRecordResult>;
  finish(runId: string, errorCode: string | null, targetsTotal: number): Promise<RunFinish>;
}

export function createRpcTenantSyncStore(client: RpcClient): TenantSyncStore {
  async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new SyncStoreError(fn, error.message);
    return data as T;
  }
  return {
    begin: (trigger, requestedBy) =>
      call<string>('begin_tenant_sync_run', { p_trigger: trigger, p_requested_by: requestedBy }),
    plan: async () => (await call<SyncPlanTarget[] | null>('tenant_sync_plan')) ?? [],
    executionContext: (requestId) =>
      call<Omit<ProvisioningContext, 'actor'>>('provisioning_execution_context', { p_request_id: requestId }),
    recordTarget: (runId, targetId, observation) =>
      call<TargetRecordResult>('record_tenant_sync_target_result', {
        p_run_id: runId,
        p_deployment_target_id: targetId,
        p_result: observation,
      }),
    finish: (runId, errorCode, targetsTotal) =>
      call<RunFinish>('finish_tenant_sync_run', {
        p_run_id: runId,
        p_error_code: errorCode,
        p_targets_total: targetsTotal,
      }),
  };
}

export interface TenantSyncDeps {
  store: TenantSyncStore;
  secretResolver: SecretResolver;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Inyectable en pruebas; por defecto el registro compilado de adaptadores. */
  adapterFor?: (ctx: Omit<ProvisioningContext, 'actor'>) => ProvisioningAdapter;
}

/** Destinos en paralelo y vínculos en paralelo dentro de cada destino. */
export const TARGET_CONCURRENCY = 3;
export const LINK_CONCURRENCY = 4;

export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export function hasGetStatus(target: SyncPlanTarget): boolean {
  return target.integration.type === 'HTTP_M2M' && (target.integration.capabilities ?? []).includes('GET_STATUS');
}

/** Por qué un destino no se puede consultar (o null si se puede). */
export function targetBlocker(target: SyncPlanTarget): string | null {
  const { integration, deployment, credential } = target;
  if (integration.type !== 'HTTP_M2M') return null; // MANUAL/MOCK: nada que consultar, no es un fallo.
  if (!integration.enabled) return 'INTEGRATION_DISABLED';
  if (!deployment.base_url || !deployment.environment) return 'DEPLOYMENT_WITHOUT_URL';
  if (!credential || credential.type !== 'M2M_ASYMMETRIC_JWT' || !credential.enabled) return 'CREDENTIAL_NOT_USABLE';
  return null;
}

function defaultAdapterFor(secretResolver: SecretResolver, deps: Pick<TenantSyncDeps, 'fetchImpl' | 'sleep' | 'now'>) {
  return (ctx: Omit<ProvisioningContext, 'actor'>) =>
    resolveAdapter(
      (ctx.integration?.type ?? 'MANUAL') as AdapterType,
      ctx.request.environment as ProvisioningEnvironment,
      { secretResolver, fetchImpl: deps.fetchImpl, sleep: deps.sleep, now: deps.now },
      ctx.adapter?.key ?? 'GENERIC',
    );
}

async function checkWithGetStatus(
  link: SyncPlanLink,
  deps: TenantSyncDeps,
  actor: SyncActor,
): Promise<Pick<LinkObservation, 'exists' | 'ids_match' | 'http_status' | 'error_code'>> {
  if (!link.request_id) return { exists: 'UNKNOWN', ids_match: null, http_status: null, error_code: 'REQUEST_MISSING' };
  try {
    const ctx = await deps.store.executionContext(link.request_id);
    // Capacidad efectiva: la declara la base Y el codec compilado.
    const adapter = (deps.adapterFor ?? defaultAdapterFor(deps.secretResolver, deps))(ctx);
    if (!ctx.adapter?.capabilities?.includes('GET_STATUS') || !adapter.capabilities.includes('GET_STATUS')) {
      return { exists: 'UNKNOWN', ids_match: null, http_status: null, error_code: 'CAPACIDAD_NO_SOPORTADA' };
    }
    let outcome;
    try {
      outcome = await adapter.getStatus(buildExecutionContext(ctx, actor));
    } catch (error) {
      outcome = { ok: false as const, attempts: 0, failure: normalizeThrownFailure(error) };
    }
    const summary = summarizeStatus(outcome, ctx.source?.mapping ?? null);
    if (summary.found) {
      return { exists: 'FOUND', ids_match: summary.mapping_consistent, http_status: summary.provider_http_status, error_code: null };
    }
    if (summary.provider_http_status === 404 && !summary.error) {
      return { exists: 'NOT_FOUND', ids_match: null, http_status: 404, error_code: summary.provider_code };
    }
    return {
      exists: 'UNKNOWN',
      ids_match: null,
      http_status: summary.provider_http_status,
      error_code: summary.provider_code ?? 'CONSULTA_FALLIDA',
    };
  } catch (error) {
    return { exists: 'UNKNOWN', ids_match: null, http_status: null, error_code: codeOf(error) };
  }
}

export async function observeLink(
  target: SyncPlanTarget,
  link: SyncPlanLink,
  deps: TenantSyncDeps,
  actor: SyncActor,
): Promise<LinkObservation> {
  const obs: LinkObservation = {
    mapping_id: link.mapping_id,
    exists: 'UNKNOWN',
    app_state: null,
    ids_match: null,
    http_status: null,
    error_code: null,
  };
  if (hasGetStatus(target)) Object.assign(obs, await checkWithGetStatus(link, deps, actor));
  // Un vínculo que la app ya dijo que no existe no tiene estado que leer.
  if (hasLifecycleRead(target) && obs.exists !== 'NOT_FOUND') {
    const read = await readLifecycleState(target, link, actor, m2mDeps(deps));
    if (read.exists === 'FOUND') obs.app_state = read.state;
    if (obs.exists === 'UNKNOWN') {
      obs.exists = read.exists;
      obs.http_status = read.httpStatus;
      obs.error_code = read.exists === 'NOT_FOUND' ? read.errorCode : read.errorCode ?? obs.error_code;
    }
  }
  if (obs.exists === 'FOUND') obs.error_code = null;
  return obs;
}

function m2mDeps(deps: TenantSyncDeps): M2mGetDeps {
  return { secretResolver: deps.secretResolver, fetchImpl: deps.fetchImpl, sleep: deps.sleep, now: deps.now };
}

const NO_INVENTORY: InventoryObservation = { status: 'NOT_AVAILABLE', complete: false, error_code: null, items: [] };

export async function observeTarget(target: SyncPlanTarget, deps: TenantSyncDeps, actor: SyncActor): Promise<TargetObservation> {
  const blocker = targetBlocker(target);
  const unchecked = (code: string | null): LinkObservation[] =>
    target.links.map((l) => ({
      mapping_id: l.mapping_id, exists: 'UNKNOWN', app_state: null, ids_match: null, http_status: null, error_code: code,
    }));

  const methods: VerifyMethod[] = [];
  if (hasGetStatus(target)) methods.push('GET_STATUS');
  if (hasLifecycleRead(target)) methods.push('LIFECYCLE');
  if (hasInventory(target)) methods.push('INVENTORY');

  if (blocker) {
    // Configurado para leer pero no se puede: es un fallo visible, no «sin capacidad».
    return {
      verify_methods: [],
      error_code: methods.length > 0 ? blocker : null,
      links: unchecked(blocker),
      inventory: hasInventory(target) ? { ...NO_INVENTORY, status: 'FAILED', error_code: blocker } : NO_INVENTORY,
    };
  }

  const linkCheck = hasGetStatus(target) || hasLifecycleRead(target);
  const [links, inventory] = await Promise.all([
    linkCheck ? mapLimit(target.links, LINK_CONCURRENCY, (l) => observeLink(target, l, deps, actor)) : Promise.resolve(unchecked(null)),
    fetchInventory(target, actor, m2mDeps(deps)),
  ]);

  // Si TODOS los vínculos fallaron por lo mismo, ese es el error del destino.
  const failures = links.filter((l) => l.exists === 'UNKNOWN' && l.error_code).map((l) => l.error_code!);
  const error = links.length > 0 && failures.length === links.length && new Set(failures).size === 1 ? failures[0]! : null;

  return { verify_methods: methods, error_code: error, links, inventory };
}

export interface RunSummary {
  run_id: string;
  status: string;
  trigger: SyncTrigger;
  targets: Array<{
    deployment_target_id: string;
    deployment_code: string;
    product_code: string;
    outcome: string;
    findings_opened: number;
    findings_closed: number;
    error_code: string | null;
  }>;
  findings_opened: number;
  findings_closed: number;
}

/**
 * Una corrida completa. Un destino que falla no detiene a los demás; la corrida
 * siempre se cierra (si no, la siguiente la encuentra «en curso»).
 */
export async function runTenantSync(
  deps: TenantSyncDeps,
  opts: { trigger: SyncTrigger; actor: SyncActor },
): Promise<RunSummary> {
  const runId = await deps.store.begin(opts.trigger, opts.trigger === 'MANUAL' ? opts.actor.id : null);
  let plan: SyncPlanTarget[];
  try {
    plan = await deps.store.plan();
  } catch (error) {
    await deps.store.finish(runId, codeOf(error, 'PLAN_FAILED'), 0).catch(() => undefined);
    throw error;
  }

  const targets = await mapLimit(plan, TARGET_CONCURRENCY, async (target) => {
    const base = {
      deployment_target_id: target.deployment.id,
      deployment_code: target.deployment.code,
      product_code: target.product.code,
    };
    let observation: TargetObservation;
    try {
      observation = await observeTarget(target, deps, opts.actor);
    } catch (error) {
      observation = {
        verify_methods: [],
        error_code: codeOf(error, 'OBSERVE_FAILED'),
        links: [],
        inventory: NO_INVENTORY,
      };
    }
    try {
      const recorded = await deps.store.recordTarget(runId, target.deployment.id, observation);
      return {
        ...base,
        outcome: recorded.outcome,
        findings_opened: recorded.findings_opened,
        findings_closed: recorded.findings_closed,
        error_code: observation.error_code,
      };
    } catch (error) {
      return { ...base, outcome: 'NOT_RECORDED', findings_opened: 0, findings_closed: 0, error_code: codeOf(error, 'RECORD_FAILED') };
    }
  });

  const finished = await deps.store.finish(runId, null, plan.length);
  return {
    run_id: runId,
    status: finished.status,
    trigger: opts.trigger,
    targets,
    findings_opened: finished.findings_opened,
    findings_closed: finished.findings_closed,
  };
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

/** Errores de la base que el operador debe ver tal cual (con su HTTP). */
export function httpStatusFor(code: string): number {
  if (code === 'SINCRONIZACION_EN_CURSO') return 409;
  if (code === 'SOLO_SERVIDOR' || code === 'NO_AUTORIZADO') return 403;
  return 500;
}
