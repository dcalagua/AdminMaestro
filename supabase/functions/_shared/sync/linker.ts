/**
 * Vínculo en la app de un alta MANUAL (TENANT_INVENTORY_CONTRACT.md §8).
 *
 * Un cliente que ya existía en la app y se registró en el Admin Maestro a mano
 * no tiene registro de alta en la app: el estado, entitlements.v1 y lifecycle.v1
 * no lo resuelven. El PUT …/{controlPlaneTenantId}/link le pide a la app que
 * cree SOLO ese registro de vínculo (nunca toca el cliente, sus usuarios ni sus
 * datos). Es idempotente: LINKED la primera vez, ALREADY_LINKED después.
 *
 * Clasificación:
 *   · 200 con el mismo tenant y LINKED / ALREADY_LINKED → LINKED;
 *   · cualquier otra respuesta → FAILED con un código estable. Un FAILED se
 *     reintenta en la próxima corrida (salvo que la app diga LINK_CONFLICT o
 *     EXTERNAL_TENANT_NOT_FOUND, que exigen una persona: se reintenta igual,
 *     pero el código queda a la vista en la consola).
 */
import { bodyErrorCode, m2mPut, type M2mGetDeps } from './m2m-get.ts';
import { INVENTORY_CONTRACT } from './readers.ts';
import type { SyncActor, SyncPlanLink, SyncPlanTarget } from './types.ts';

export interface AppLinkResult {
  outcome: 'LINKED' | 'FAILED';
  httpStatus: number | null;
  errorCode: string | null;
}

export function hasTenantLink(target: SyncPlanTarget): boolean {
  const i = target.integration;
  return i.type === 'HTTP_M2M' && Boolean(i.inventory_path) && Boolean(i.tenant_link_scope);
}

/** Solo las altas manuales con id externo que la app aún no confirmó. */
export function needsAppLink(link: SyncPlanLink): boolean {
  return link.registered_manually === true && link.app_link_status !== 'LINKED' && Boolean(link.external_tenant_id);
}

/** `/tenants` → `/tenants/{controlPlaneTenantId}/link`. */
export function linkPathTemplate(inventoryPath: string): string {
  return `${inventoryPath.replace(/\/+$/, '')}/{controlPlaneTenantId}/link`;
}

export async function requestAppLink(
  target: SyncPlanTarget,
  link: SyncPlanLink,
  actor: SyncActor,
  deps: M2mGetDeps & { uuid?: () => string },
): Promise<AppLinkResult> {
  const i = target.integration;
  if (!hasTenantLink(target)) return { outcome: 'FAILED', httpStatus: null, errorCode: 'TENANT_LINK_NOT_CONFIGURED' };
  if (!link.external_tenant_id) return { outcome: 'FAILED', httpStatus: null, errorCode: 'EXTERNAL_ID_MISSING' };

  const r = await m2mPut(
    target,
    {
      pathTemplate: linkPathTemplate(i.inventory_path!),
      params: { controlPlaneTenantId: link.tenant_id },
      scope: i.tenant_link_scope!,
      contract: INVENTORY_CONTRACT,
      body: {
        externalTenantId: link.external_tenant_id,
        requestId: (deps.uuid ?? (() => crypto.randomUUID()))(),
      },
    },
    actor,
    deps,
  );
  if (r.errorCode) return { outcome: 'FAILED', httpStatus: r.status, errorCode: r.errorCode };

  const status = r.status ?? 0;
  const body = (r.body ?? {}) as Record<string, unknown>;
  if (status >= 200 && status < 300) {
    const sameTenant =
      body.contract === INVENTORY_CONTRACT &&
      body.controlPlaneTenantId === link.tenant_id &&
      String(body.externalTenantId ?? '').toLowerCase() === link.external_tenant_id.toLowerCase() &&
      (body.status === 'LINKED' || body.status === 'ALREADY_LINKED');
    return sameTenant
      ? { outcome: 'LINKED', httpStatus: status, errorCode: null }
      : { outcome: 'FAILED', httpStatus: status, errorCode: 'RESPONSE_INVALID' };
  }
  return { outcome: 'FAILED', httpStatus: status, errorCode: bodyErrorCode(r.body) ?? `HTTP_${status}` };
}
