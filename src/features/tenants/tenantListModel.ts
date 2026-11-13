import type { CellTone } from '@/components/ui/cells';
import { DEPLOYMENT_MODE_LABEL, TENANT_STATUS_LABEL, TENANT_TYPE_LABEL } from '@/types/domain';

/* ==========================================================================
   Listado de Tenants (V6 · F2, plan §3.3): modelo puro de la tabla densa.

   Antes, cada fila dedicaba 3 líneas a «Comercial · Alta · Admin» y la columna
   «Tipo y modelo» se partía en 3. Aquí se resuelve, por tenant, una sola
   etiqueta corta por dimensión (con su tono) para pintarla en una línea, y el
   filtro «Sin alta en la app» de la franja.
   ========================================================================== */

export type TenantFilter = 'ALL' | 'PRODUCTION' | 'DEMO_TRIAL' | 'SHARED' | 'DEDICATED' | 'NO_ALTA';

export const TENANT_FILTER_LABEL: Record<TenantFilter, string> = {
  ALL: 'Todos',
  PRODUCTION: 'Productivos',
  DEMO_TRIAL: 'Demo / Trial',
  SHARED: 'Compartidos',
  DEDICATED: 'Dedicados',
  NO_ALTA: 'Sin alta en la app',
};

export interface TenantListLike {
  tenant_id?: string | null;
  name?: string | null;
  status?: string | null;
  tenant_type?: string | null;
  deployment_mode?: string | null;
  mrr?: number | string | null;
  currency?: string | null;
}

export interface RequestLike {
  tenant_id?: string | null;
  status?: string | null;
  requested_at?: string | null;
}

/** Estado del alta en la app, en corto (una línea). */
export interface AltaState {
  key: 'ACTIVE' | 'NONE' | 'FAILED' | 'IN_FLIGHT' | 'CANCELLED';
  short: string;
  tone: CellTone;
}

const IN_FLIGHT = new Set(['PENDING', 'WAITING_INFRA', 'READY_TO_PROVISION', 'PROVISIONING']);

/** Última solicitud de alta por tenant (la más reciente por `requested_at`). */
export function latestRequestByTenant<R extends RequestLike>(requests: readonly R[]): Map<string, R> {
  const map = new Map<string, R>();
  for (const r of requests) {
    if (!r.tenant_id) continue;
    const current = map.get(r.tenant_id);
    if (!current || String(r.requested_at ?? '') > String(current.requested_at ?? '')) map.set(r.tenant_id, r);
  }
  return map;
}

export function altaState(request: RequestLike | undefined): AltaState {
  const status = request?.status ?? null;
  if (!status) return { key: 'NONE', short: 'Sin alta', tone: 'neutral' };
  if (status === 'ACTIVE') return { key: 'ACTIVE', short: 'Alta registrada', tone: 'ok' };
  if (status === 'FAILED') return { key: 'FAILED', short: 'Alta fallida', tone: 'danger' };
  if (status === 'CANCELLED') return { key: 'CANCELLED', short: 'Alta cancelada', tone: 'neutral' };
  if (IN_FLIGHT.has(status)) return { key: 'IN_FLIGHT', short: 'Alta en curso', tone: 'info' };
  return { key: 'NONE', short: status, tone: 'neutral' };
}

const COMMERCIAL_TONE: Record<string, CellTone> = {
  ACTIVE: 'ok',
  PENDING: 'warn',
  SUSPENDED: 'danger',
  CHURNED: 'neutral',
  ARCHIVED: 'neutral',
};

/** Estado comercial del tenant (registro del Admin Maestro) en corto. */
export function commercialState(status: string | null | undefined): { short: string; tone: CellTone } {
  return {
    short: TENANT_STATUS_LABEL[status as keyof typeof TENANT_STATUS_LABEL] ?? status ?? 'Sin estado',
    tone: COMMERCIAL_TONE[status ?? ''] ?? 'neutral',
  };
}

/** «Compartido · Producción» en una línea (antes, 3 renglones). */
export function modelLabel(t: Pick<TenantListLike, 'deployment_mode' | 'tenant_type'>): string {
  const mode = DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL] ?? t.deployment_mode ?? null;
  const type = TENANT_TYPE_LABEL[t.tenant_type as keyof typeof TENANT_TYPE_LABEL] ?? t.tenant_type ?? null;
  return [mode, type].filter(Boolean).join(' · ') || '—';
}

/** ¿Pertenece el tenant a la pestaña? `alta` = estado de su última alta. */
export function matchesTenantFilter(t: TenantListLike, filter: TenantFilter, alta: AltaState): boolean {
  switch (filter) {
    case 'PRODUCTION':
      return t.tenant_type === 'PRODUCTION';
    case 'DEMO_TRIAL':
      return t.tenant_type === 'DEMO' || t.tenant_type === 'TRIAL';
    case 'SHARED':
      return t.deployment_mode === 'SHARED';
    case 'DEDICATED':
      return Boolean(t.deployment_mode) && t.deployment_mode !== 'SHARED';
    case 'NO_ALTA':
      // Lo que falta registrar en la app: sin alta, fallida o cancelada. Los de baja no cuentan.
      return alta.key !== 'ACTIVE' && alta.key !== 'IN_FLIGHT' && t.status !== 'CHURNED' && t.status !== 'ARCHIVED';
    default:
      return true;
  }
}

export type TenantSortKey = 'name' | 'mrr';

/** Orden de la tabla: nombre (es) o MRR (importe nativo; sin MRR, al final). */
export function sortTenants<T extends TenantListLike>(rows: readonly T[], key: TenantSortKey, dir: 'asc' | 'desc'): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'mrr') {
      const am = Number(a.mrr ?? 0);
      const bm = Number(b.mrr ?? 0);
      if (am === 0 && bm !== 0) return 1;
      if (bm === 0 && am !== 0) return -1;
      return sign * (am - bm) || (a.name ?? '').localeCompare(b.name ?? '', 'es');
    }
    return sign * (a.name ?? '').localeCompare(b.name ?? '', 'es');
  });
}
