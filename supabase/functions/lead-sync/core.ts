/**
 * Solicitudes de la web (leads.v1, migración 20261025000100).
 *
 * Recorre los destinos que devuelve `lead_sync_plan` (los que anuncian
 * `leads_path`) y, por cada uno, pide con GET firmado M2M las solicitudes
 * desde el último cursor. La base registra (`record_lead_sync`): idempotente
 * por (destino, id externo), y una nueva lectura nunca pisa el seguimiento.
 *
 * Solo lee en la app. Un destino que falla no detiene a los demás y deja su
 * código en `lead_sync_state`, que es lo que la pantalla muestra.
 */
import type { SecretResolver } from '../_shared/provisioning/index.ts';
import type { RpcClient } from '../_shared/entitlements/sync-store.ts';
import { SyncStoreError } from '../_shared/entitlements/sync-store.ts';
import { bodyErrorCode, m2mGet, type M2mGetDeps } from '../_shared/sync/m2m-get.ts';
import { codeOf, type SyncActor, type SyncPlanTarget } from '../_shared/sync/types.ts';

export const LEADS_CONTRACT = 'leads.v1';
/** Páginas por destino y corrida: 10 × 100. Lo que quede se lee en la próxima vuelta. */
export const MAX_PAGES = 10;
export const PAGE_SIZE = 100;

export type LeadSyncTarget = SyncPlanTarget & {
  integration: SyncPlanTarget['integration'] & { leads_path: string | null; leads_read_scope: string | null };
  cursor: string | null;
};

export interface LeadSyncStore {
  plan(): Promise<LeadSyncTarget[]>;
  record(targetId: string, items: unknown[], cursor: string | null, errorCode: string | null): Promise<{ received: number; new: number }>;
}

export function createRpcLeadSyncStore(client: RpcClient): LeadSyncStore {
  async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new SyncStoreError(fn, error.message);
    return data as T;
  }
  return {
    plan: async () => (await call<LeadSyncTarget[] | null>('lead_sync_plan')) ?? [],
    record: (targetId, items, cursor, errorCode) =>
      call('record_lead_sync', { p_target_id: targetId, p_items: items, p_cursor: cursor, p_error_code: errorCode }),
  };
}

export interface LeadSyncDeps {
  store: LeadSyncStore;
  secretResolver: SecretResolver;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface TargetSummary {
  target: string;
  product: string;
  received: number;
  new: number;
  errorCode: string | null;
}

interface Page { items: unknown[]; nextCursor: string | null; resumeCursor: string | null }

function readPage(body: unknown): Page | null {
  const b = body as Record<string, unknown> | null;
  if (!b || b.contractVersion !== LEADS_CONTRACT || !Array.isArray(b.items)) return null;
  const cursor = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 500 ? v : null);
  return { items: b.items, nextCursor: cursor(b.nextCursor), resumeCursor: cursor(b.resumeCursor) };
}

/** Lee todas las páginas de un destino (hasta MAX_PAGES). Nunca lanza. */
export async function readLeads(
  target: LeadSyncTarget,
  actor: SyncActor,
  deps: M2mGetDeps,
): Promise<{ items: unknown[]; cursor: string | null; errorCode: string | null }> {
  const i = target.integration;
  if (!i.leads_path || !i.leads_read_scope) return { items: [], cursor: target.cursor, errorCode: 'LEADS_NOT_CONFIGURED' };
  const items: unknown[] = [];
  let cursor = target.cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query: Record<string, string> = { limit: String(PAGE_SIZE) };
    if (cursor) query.after = cursor;
    const res = await m2mGet(target, { pathTemplate: i.leads_path, scope: i.leads_read_scope, contract: LEADS_CONTRACT, query }, actor, deps);
    if (res.errorCode) return { items, cursor, errorCode: items.length ? null : res.errorCode };
    if (res.status !== 200) {
      const code = bodyErrorCode(res.body) ?? `HTTP_${res.status ?? 0}`;
      return { items, cursor, errorCode: items.length ? null : code };
    }
    const p = readPage(res.body);
    if (!p) return { items, cursor, errorCode: items.length ? null : 'INVALID_RESPONSE' };
    items.push(...p.items);
    cursor = p.resumeCursor ?? cursor;
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return { items, cursor, errorCode: null };
}

export async function runLeadSync(deps: LeadSyncDeps, actor: SyncActor): Promise<{ targets: TargetSummary[] }> {
  const plan = await deps.store.plan();
  const m2m: M2mGetDeps = { secretResolver: deps.secretResolver, fetchImpl: deps.fetchImpl, sleep: deps.sleep, now: deps.now };
  const targets: TargetSummary[] = [];
  for (const target of plan) {
    let summary: TargetSummary = { target: target.deployment.code, product: target.product.code, received: 0, new: 0, errorCode: null };
    try {
      const read = await readLeads(target, actor, m2m);
      const rec = await deps.store.record(target.deployment.id, read.items, read.cursor, read.errorCode);
      summary = { ...summary, received: rec.received, new: rec.new, errorCode: read.errorCode };
    } catch (error) {
      summary = { ...summary, errorCode: codeOf(error, 'LEAD_SYNC_FAILED') };
    }
    targets.push(summary);
  }
  return { targets };
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
