/**
 * Lectores de la sincronización: estado operativo (`GET lifecycle.v1`) e
 * inventario (`GET tenant-inventory.v1`). Ambos son SOLO LECTURA en la app.
 *
 * Clasificación conservadora: solo es «no existe» lo que la app dice con su
 * código de contrato. Un 404 sin código (ruta no implementada, proxy) es
 * «no se pudo verificar», nunca un vínculo roto inventado.
 */
import { bodyErrorCode, m2mGet, type M2mGetDeps } from './m2m-get.ts';
import type {
  AppState,
  InventoryItem,
  InventoryObservation,
  LinkExistence,
  SyncActor,
  SyncPlanLink,
  SyncPlanTarget,
} from './types.ts';

export const INVENTORY_CONTRACT = 'tenant-inventory.v1';
export const INVENTORY_PAGE_SIZE = 200;
/** Tope de páginas por app y corrida (10.000 clientes). Más = inventario incompleto. */
export const INVENTORY_MAX_PAGES = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES: readonly AppState[] = ['ACTIVE', 'SUSPENDED'];
const ITEM_STATES: readonly InventoryItem['status'][] = ['ACTIVE', 'SUSPENDED', 'INACTIVE'];

export function hasLifecycleRead(target: SyncPlanTarget): boolean {
  const i = target.integration;
  return i.type === 'HTTP_M2M' && Boolean(i.lifecycle_path) && Boolean(i.lifecycle_read_scope);
}

export function hasInventory(target: SyncPlanTarget): boolean {
  const i = target.integration;
  return i.type === 'HTTP_M2M' && Boolean(i.inventory_path) && Boolean(i.inventory_read_scope);
}

export interface LifecycleRead {
  exists: LinkExistence;
  state: AppState | null;
  httpStatus: number | null;
  errorCode: string | null;
}

/** GET /tenants/{controlPlaneTenantId}/lifecycle (LIFECYCLE_CONTRACT.md §4). */
export async function readLifecycleState(
  target: SyncPlanTarget,
  link: SyncPlanLink,
  actor: SyncActor,
  deps: M2mGetDeps,
): Promise<LifecycleRead> {
  const i = target.integration;
  if (!hasLifecycleRead(target)) {
    return { exists: 'UNKNOWN', state: null, httpStatus: null, errorCode: 'LIFECYCLE_NOT_CONFIGURED' };
  }
  const r = await m2mGet(
    target,
    {
      pathTemplate: i.lifecycle_path!,
      params: { controlPlaneTenantId: link.tenant_id },
      scope: i.lifecycle_read_scope!,
      contract: 'lifecycle.v1',
    },
    actor,
    deps,
  );
  if (r.errorCode) return { exists: 'UNKNOWN', state: null, httpStatus: r.status, errorCode: r.errorCode };

  const status = r.status ?? 0;
  const body = (r.body ?? {}) as Record<string, unknown>;
  if (status >= 200 && status < 300) {
    const state = STATES.includes(body.state as AppState) ? (body.state as AppState) : null;
    if (body.controlPlaneTenantId !== link.tenant_id || !state) {
      // Un 200 que no habla de este tenant no confirma nada.
      return { exists: 'UNKNOWN', state: null, httpStatus: status, errorCode: 'RESPONSE_INVALID' };
    }
    return { exists: 'FOUND', state, httpStatus: status, errorCode: null };
  }
  const code = bodyErrorCode(r.body);
  if (status === 404 && code === 'TENANT_NOT_PROVISIONED') {
    return { exists: 'NOT_FOUND', state: null, httpStatus: 404, errorCode: code };
  }
  return { exists: 'UNKNOWN', state: null, httpStatus: status, errorCode: code ?? `HTTP_${status}` };
}

function optText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  if (t.length > max) return undefined;
  return t === '' ? null : t;
}

/** Valida un ítem del inventario (contrato §4). `null` = inválido. */
export function parseInventoryItem(raw: unknown): InventoryItem | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const ext = optText(r.externalTenantId, 200);
  if (!ext) return null;
  const org = optText(r.externalOrganizationId, 200);
  const company = optText(r.externalCompanyId, 200);
  const cp = optText(r.controlPlaneTenantId, 36);
  const code = optText(r.code, 200);
  const name = optText(r.name, 300);
  if (org === undefined || company === undefined || cp === undefined || code === undefined || name === undefined) {
    return null;
  }
  if (cp !== null && !UUID_RE.test(cp)) return null;
  if (!ITEM_STATES.includes(r.status as InventoryItem['status'])) return null;
  return {
    externalTenantId: ext,
    externalOrganizationId: org,
    externalCompanyId: company,
    controlPlaneTenantId: cp ? cp.toLowerCase() : null,
    code,
    name,
    status: r.status as InventoryItem['status'],
  };
}

const NOT_AVAILABLE: InventoryObservation = { status: 'NOT_AVAILABLE', complete: false, error_code: null, items: [] };

/**
 * GET {inventory_path}?limit=200&cursor=… hasta `nextCursor: null`.
 * Si la app no anuncia el canal: NOT_AVAILABLE (la consola lo dice, no lo inventa).
 */
export async function fetchInventory(
  target: SyncPlanTarget,
  actor: SyncActor,
  deps: M2mGetDeps,
): Promise<InventoryObservation> {
  if (!hasInventory(target)) return NOT_AVAILABLE;
  const i = target.integration;
  const items: InventoryItem[] = [];
  const seen = new Set<string>();
  let invalid = false;
  let cursor: string | null = null;

  for (let page = 0; page < INVENTORY_MAX_PAGES; page += 1) {
    const query: Record<string, string> = { limit: String(INVENTORY_PAGE_SIZE) };
    if (cursor) query.cursor = cursor;
    const r = await m2mGet(
      target,
      { pathTemplate: i.inventory_path!, scope: i.inventory_read_scope!, contract: INVENTORY_CONTRACT, query },
      actor,
      deps,
    );
    const failed = (code: string): InventoryObservation =>
      // Lo leído hasta aquí sirve para AVISAR de clientes nuevos, nunca para cerrar ni dar por roto nada.
      items.length > 0
        ? { status: 'AVAILABLE', complete: false, error_code: code, items }
        : { status: 'FAILED', complete: false, error_code: code, items: [] };

    if (r.errorCode) return failed(r.errorCode);
    const status = r.status ?? 0;
    if (status < 200 || status >= 300) return failed(bodyErrorCode(r.body) ?? `HTTP_${status}`);

    const body = (r.body ?? {}) as Record<string, unknown>;
    if (body.contract !== INVENTORY_CONTRACT || !Array.isArray(body.items)) return failed('RESPONSE_INVALID');
    if (body.productCode !== target.product.code) return failed('PRODUCT_MISMATCH');
    if (body.environment !== target.deployment.environment) return failed('WRONG_ENVIRONMENT');

    for (const raw of body.items) {
      const item = parseInventoryItem(raw);
      if (!item) {
        invalid = true;
        continue;
      }
      const key = item.externalTenantId.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }

    const next = body.nextCursor;
    if (next === null || next === undefined) {
      return invalid
        ? { status: 'AVAILABLE', complete: false, error_code: 'INVENTORY_ITEM_INVALID', items }
        : { status: 'AVAILABLE', complete: true, error_code: null, items };
    }
    if (typeof next !== 'string' || next === '' || next.length > 500 || next === cursor) {
      return failed('RESPONSE_INVALID');
    }
    cursor = next;
  }
  return { status: 'AVAILABLE', complete: false, error_code: 'INVENTORY_TOO_LARGE', items };
}
