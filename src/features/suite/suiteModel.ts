import type { Database } from '@/types/database.types';
import {
  SAAS_PROVISIONING_STATUS_LABEL,
  canRetry,
  type SaasProvisioningStatus,
  type Tone,
} from '@/lib/provisioning';
import { TENANT_STATUS_LABEL } from '@/types/domain';
import {
  ENVIRONMENT_ORDER,
  isEvaluable,
  observedHealth,
  type ObservedHealth,
} from '@/features/platform/targetHealth';

/**
 * Modelo del Centro de la suite (V5 · F2).
 *
 * Todo sale de tablas y vistas que YA existen en la base: destinos
 * (`v_provisioning_targets`), integraciones (`product_integrations`), altas en
 * las apps (`v_saas_provisioning`), tenants (`v_tenant_overview`), contratos
 * (`subscriptions`) y sincronización de módulos (`v_entitlement_sync_status`).
 * Aquí sólo se combinan y se traducen; ninguna función decide nada que la base
 * no haya decidido ya.
 *
 * Honestidad ante todo: un canal apagado se ve como «no activo», nunca como
 * «al día»; una salud no comprobada es «sin verificar», nunca «sana».
 */

type Views = Database['platform']['Views'];
type Tables = Database['platform']['Tables'];

export type TargetRow = Views['v_provisioning_targets']['Row'];
export type IntegrationRow = Tables['product_integrations']['Row'];
export type ProvisioningRow = Views['v_saas_provisioning']['Row'];
export type TenantRow = Views['v_tenant_overview']['Row'];
export type ModuleSyncRow = Views['v_entitlement_sync_status']['Row'];
export type ProductRow = Tables['saas_products']['Row'];

/**
 * La base todavía no tiene canal de suspensión por app (contrato de ciclo de
 * vida). Suspender un tenant cambia su estado en el Admin Maestro y encola la
 * orden de infraestructura, pero la app no recibe el corte. Cuando exista el
 * canal, este interruptor pasa a leerse de la integración.
 */
export const SUSPENSION_CHANNEL_AVAILABLE = false;

/** Una observación de salud con más de 24 h ya no describe el presente. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Apps de la suite
// ---------------------------------------------------------------------------

export interface SuiteApp {
  id: string;
  code: string;
  name: string;
  accent: string | null;
  sort: number;
}

/**
 * Las apps de la suite: productos vivos con integración, destino o tenants.
 * Si nada de eso es visible (RLS), todos los productos activos.
 */
export function suiteApps(
  products: readonly Pick<ProductRow, 'id' | 'code' | 'short_name' | 'accent_color' | 'sort_order' | 'status'>[],
  related: { integrations?: readonly { saas_product_id: string | null }[]; targets?: readonly { saas_product_id: string | null }[]; tenants?: readonly { saas_product_id: string | null }[] },
): SuiteApp[] {
  const live = products.filter((p) => p.status !== 'ARCHIVED');
  const used = new Set(
    [...(related.integrations ?? []), ...(related.targets ?? []), ...(related.tenants ?? [])]
      .map((r) => r.saas_product_id)
      .filter((id): id is string => Boolean(id)),
  );
  const chosen = used.size > 0 ? live.filter((p) => used.has(p.id)) : live.filter((p) => p.status === 'ACTIVE');
  return [...chosen]
    .sort((a, b) => a.sort_order - b.sort_order || a.short_name.localeCompare(b.short_name))
    .map((p) => ({ id: p.id, code: p.code, name: p.short_name, accent: p.accent_color, sort: p.sort_order }));
}

// ---------------------------------------------------------------------------
// Tiempo relativo
// ---------------------------------------------------------------------------

const DAY = 24 * 3600;
/** Unidad, tamaño en segundos y desde cuándo se usa: 7 semanas se dice en semanas, no «el mes pasado». */
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number, number]> = [
  ['year', 365 * DAY, 365 * DAY],
  ['month', 30 * DAY, 90 * DAY],
  ['week', 7 * DAY, 14 * DAY],
  ['day', DAY, DAY],
  ['hour', 3600, 3600],
  ['minute', 60, 60],
];

/** «hace 7 semanas», «hace 3 horas», «ayer», «hace un momento». */
export function relativeAge(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  const abs = Math.abs(seconds);
  for (const [unit, size, from] of UNITS) {
    if (abs >= from) return rtf.format(-Math.trunc(seconds / size), unit);
  }
  return 'hace un momento';
}

export function isStale(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return true;
  return now.getTime() - new Date(iso).getTime() > STALE_AFTER_MS;
}

// ---------------------------------------------------------------------------
// Canales de cada app
// ---------------------------------------------------------------------------

export type ChannelKey = 'alta' | 'modulos' | 'uso' | 'suspension';

export interface ChannelState {
  key: ChannelKey;
  label: string;
  active: boolean;
  /** Estado en texto: «Activo», «No activo», «Manual», «No disponible». */
  status: string;
  tone: Tone;
  detail: string;
}

export const CHANNEL_LABEL: Record<ChannelKey, string> = {
  alta: 'Alta',
  modulos: 'Módulos',
  uso: 'Uso',
  suspension: 'Suspensión',
};

function off(key: ChannelKey, detail: string, status = 'No activo'): ChannelState {
  return { key, label: CHANNEL_LABEL[key], active: false, status, tone: 'neutral', detail };
}

function on(key: ChannelKey, detail: string, status = 'Activo'): ChannelState {
  return { key, label: CHANNEL_LABEL[key], active: true, status, tone: 'ok', detail };
}

/** Estado de los cuatro canales de una app, con su porqué. */
export function appChannels(
  integration: Pick<IntegrationRow, 'enabled' | 'status' | 'integration_type' | 'entitlements_push_enabled' | 'usage_ingest_enabled'> | null | undefined,
  targets: readonly Pick<TargetRow, 'provisioning_enabled' | 'provisioning_status'>[],
): ChannelState[] {
  let alta: ChannelState;
  if (!integration) {
    alta = off('alta', 'La app no tiene conexión configurada con el Admin Maestro.', 'Sin conexión');
  } else if (!integration.enabled || integration.status === 'DISABLED') {
    alta = off('alta', 'La conexión con la app está deshabilitada.');
  } else if (integration.integration_type === 'MANUAL') {
    alta = { ...on('alta', 'La app no expone API de altas: una persona registra cada alta, con auditoría.', 'Manual'), tone: 'info' };
  } else if (!targets.some(isEvaluable)) {
    alta = off('alta', 'Ningún entorno de la app tiene las altas habilitadas.');
  } else if (integration.status !== 'READY') {
    alta = { ...off('alta', 'La conexión existe pero todavía no está lista.', 'En preparación'), tone: 'warn' };
  } else {
    alta = on('alta', 'El Admin Maestro crea los tenants en la app por la conexión segura.');
  }

  const modulos = integration?.entitlements_push_enabled
    ? on('modulos', 'El Admin Maestro envía a la app los módulos que habilita el plan y los add-ons.')
    : off('modulos', 'El envío de módulos habilitados a la app está apagado: la app decide por su cuenta qué módulos ofrece.');

  const uso = integration?.usage_ingest_enabled
    ? on('uso', 'La app reporta su consumo al Admin Maestro.')
    : off('uso', 'La app no reporta consumo al Admin Maestro: no hay uso que mostrar ni que cobrar.');

  const suspension = SUSPENSION_CHANNEL_AVAILABLE
    ? on('suspension', 'La app recibe la suspensión y la reactivación de cada tenant.')
    : off(
        'suspension',
        'Todavía no existe el canal de suspensión por app: suspender cambia el estado en el Admin Maestro, pero la app sigue operando.',
        'No disponible',
      );

  return [alta, modulos, uso, suspension];
}

// ---------------------------------------------------------------------------
// Franja de salud
// ---------------------------------------------------------------------------

export interface AppHealth {
  app: SuiteApp;
  /** Destino que representa a la app (el entorno más productivo con altas habilitadas). */
  primary: TargetRow | null;
  /** Todos los destinos de la app, en orden de entorno. */
  targets: TargetRow[];
  health: ObservedHealth;
  environment: string | null;
  checkedAt: string | null;
  stale: boolean;
  contractVersion: string | null;
  channels: ChannelState[];
}

const PRIORITY = [...ENVIRONMENT_ORDER].reverse();
const envRank = (env: string | null | undefined) => {
  const i = PRIORITY.indexOf(env as (typeof PRIORITY)[number]);
  return i === -1 ? PRIORITY.length : i;
};

export function appHealth(
  app: SuiteApp,
  allTargets: readonly TargetRow[],
  integrations: readonly IntegrationRow[],
  now: Date = new Date(),
): AppHealth {
  const targets = allTargets
    .filter((t) => t.saas_product_id === app.id)
    .sort((a, b) => envRank(a.provisioning_environment) - envRank(b.provisioning_environment));
  const primary = targets.find(isEvaluable) ?? targets[0] ?? null;
  const integration =
    integrations.find((i) => primary?.product_integration_id && i.id === primary.product_integration_id) ??
    integrations.find((i) => i.saas_product_id === app.id) ??
    null;
  const checkedAt = primary?.health_checked_at ?? null;
  return {
    app,
    primary,
    targets,
    health: primary ? observedHealth(primary) : 'NOT_EVALUATED',
    environment: primary?.provisioning_environment ?? null,
    checkedAt,
    stale: isStale(checkedAt, now),
    contractVersion: primary?.contract_version ?? integration?.contract_version ?? null,
    channels: appChannels(integration, targets),
  };
}

// ---------------------------------------------------------------------------
// Matriz cuenta × app
// ---------------------------------------------------------------------------

export type CellKind =
  | 'FAILED'
  | 'PENDING_CONFIRM'
  | 'ACTIVE_NO_APP'
  | 'SUSPENDED'
  | 'IN_PROGRESS'
  | 'NOT_REQUESTED'
  | 'ACTIVE'
  | 'CANCELLED'
  | 'INACTIVE';

export const CELL: Record<CellKind, { label: string; short: string; tone: Tone; help: string }> = {
  FAILED: {
    label: 'Alta fallida',
    short: 'Alta fallida',
    tone: 'danger',
    help: 'El último intento de crear el tenant en la app falló.',
  },
  PENDING_CONFIRM: {
    label: 'Activo en la app · pendiente de confirmar en MasterAdmin',
    short: 'Por confirmar',
    tone: 'warn',
    help: 'La app ya creó el tenant (alta activa), pero en el Admin Maestro sigue «Pendiente»: el estado no se actualizó solo al confirmarse el alta.',
  },
  ACTIVE_NO_APP: {
    label: 'Activo sin alta registrada',
    short: 'Sin alta',
    tone: 'warn',
    help: 'El tenant está activo en el Admin Maestro, pero no hay alta registrada en la app.',
  },
  SUSPENDED: {
    label: 'Suspendido',
    short: 'Suspendido',
    tone: 'danger',
    help: 'Suspendido en el Admin Maestro. Sin canal de suspensión, la app puede seguir operando.',
  },
  IN_PROGRESS: {
    label: 'Alta en curso',
    short: 'En curso',
    tone: 'info',
    help: 'El alta en la app está solicitada y todavía no termina.',
  },
  NOT_REQUESTED: {
    label: 'Pendiente, sin alta',
    short: 'Sin alta',
    tone: 'neutral',
    help: 'El tenant está pendiente y aún no se pidió su alta en la app.',
  },
  ACTIVE: { label: 'Activo', short: 'Activo', tone: 'ok', help: 'Activo en la app y en el Admin Maestro.' },
  CANCELLED: {
    label: 'Alta cancelada',
    short: 'Cancelada',
    tone: 'neutral',
    help: 'El alta en la app se canceló antes de completarse.',
  },
  INACTIVE: { label: 'De baja', short: 'De baja', tone: 'neutral', help: 'Dado de baja o archivado.' },
};

/** Orden de atención: lo primero que hay que mirar va primero. */
const ATTENTION_ORDER: CellKind[] = [
  'FAILED', 'PENDING_CONFIRM', 'ACTIVE_NO_APP', 'SUSPENDED', 'IN_PROGRESS', 'NOT_REQUESTED', 'ACTIVE', 'CANCELLED', 'INACTIVE',
];

/** Estados que piden una acción de una persona. */
export const ATTENTION_KINDS: ReadonlySet<CellKind> = new Set(['FAILED', 'PENDING_CONFIRM', 'ACTIVE_NO_APP']);

const IN_FLIGHT: ReadonlySet<string> = new Set(['PENDING', 'WAITING_INFRA', 'READY_TO_PROVISION', 'PROVISIONING']);

/** Estado combinado de un tenant en su app. */
export function cellKind(
  tenantStatus: string | null | undefined,
  provisioningStatus: string | null | undefined,
): CellKind {
  if (tenantStatus === 'CHURNED' || tenantStatus === 'ARCHIVED') return 'INACTIVE';
  if (tenantStatus === 'SUSPENDED') return 'SUSPENDED';
  if (provisioningStatus === 'FAILED') return 'FAILED';
  if (provisioningStatus === 'ACTIVE') return tenantStatus === 'PENDING' ? 'PENDING_CONFIRM' : 'ACTIVE';
  if (provisioningStatus && IN_FLIGHT.has(provisioningStatus)) return 'IN_PROGRESS';
  if (provisioningStatus === 'CANCELLED') return tenantStatus === 'ACTIVE' ? 'ACTIVE_NO_APP' : 'CANCELLED';
  return tenantStatus === 'ACTIVE' ? 'ACTIVE_NO_APP' : 'NOT_REQUESTED';
}

export interface MatrixTenant {
  tenantId: string;
  tenantName: string;
  tenantSlug: string | null;
  tenantStatus: string;
  tenantStatusLabel: string;
  productId: string;
  subscriptionId: string | null;
  /** `null` si no hay contrato o no se ve (perfil sin finanzas). */
  subscriptionStatus: string | null;
  request: ProvisioningRow | null;
  requestStatusLabel: string | null;
  canRetry: boolean;
  moduleSync: ModuleSyncRow | null;
  kind: CellKind;
}

export interface MatrixCell {
  productId: string;
  tenants: MatrixTenant[];
  /** El tenant que más atención pide: el que resume la celda. */
  primary: MatrixTenant | null;
}

export interface MatrixRow {
  organizationId: string;
  organizationName: string;
  cells: Record<string, MatrixCell>;
  /** Estados presentes en la fila (para filtrar). */
  kinds: Set<CellKind>;
}

/** Última solicitud de alta por tenant × app (la vista viene ordenada o no: se decide aquí). */
export function latestRequestByTenant(requests: readonly ProvisioningRow[]): Map<string, ProvisioningRow> {
  const map = new Map<string, ProvisioningRow>();
  for (const r of requests) {
    if (!r.tenant_id || !r.saas_product_id) continue;
    const key = `${r.tenant_id}:${r.saas_product_id}`;
    const prev = map.get(key);
    if (!prev || (r.requested_at ?? '') > (prev.requested_at ?? '')) map.set(key, r);
  }
  return map;
}

export function buildMatrix(input: {
  apps: readonly SuiteApp[];
  tenants: readonly TenantRow[];
  requests: readonly ProvisioningRow[];
  subscriptions?: ReadonlyMap<string, string> | null;
  moduleSync?: readonly ModuleSyncRow[];
}): MatrixRow[] {
  const latest = latestRequestByTenant(input.requests);
  const sync = new Map<string, ModuleSyncRow>();
  for (const s of input.moduleSync ?? []) {
    if (s.tenant_id && s.saas_product_id) sync.set(`${s.tenant_id}:${s.saas_product_id}`, s);
  }
  const rows = new Map<string, MatrixRow>();

  for (const t of input.tenants) {
    if (!t.tenant_id || !t.customer_organization_id || !t.saas_product_id) continue;
    const key = `${t.tenant_id}:${t.saas_product_id}`;
    const request = latest.get(key) ?? null;
    const status = request?.status as SaasProvisioningStatus | null | undefined;
    const tenant: MatrixTenant = {
      tenantId: t.tenant_id,
      tenantName: t.name ?? '—',
      tenantSlug: t.slug,
      tenantStatus: t.status ?? 'PENDING',
      tenantStatusLabel: t.status ? TENANT_STATUS_LABEL[t.status] : '—',
      productId: t.saas_product_id,
      subscriptionId: t.subscription_id,
      subscriptionStatus: (t.subscription_id && input.subscriptions?.get(t.subscription_id)) || null,
      request,
      requestStatusLabel: status ? SAAS_PROVISIONING_STATUS_LABEL[status] : null,
      canRetry: Boolean(status && canRetry(status, request?.attempt_count ?? 0, request?.max_attempts ?? 0)),
      moduleSync: sync.get(key) ?? null,
      kind: cellKind(t.status, status),
    };

    let row = rows.get(t.customer_organization_id);
    if (!row) {
      row = {
        organizationId: t.customer_organization_id,
        organizationName: t.customer_name ?? '—',
        cells: {},
        kinds: new Set(),
      };
      rows.set(t.customer_organization_id, row);
    }
    const cell = row.cells[t.saas_product_id] ?? { productId: t.saas_product_id, tenants: [], primary: null };
    cell.tenants.push(tenant);
    row.cells[t.saas_product_id] = cell;
    row.kinds.add(tenant.kind);
  }

  for (const row of rows.values()) {
    for (const cell of Object.values(row.cells)) {
      cell.tenants.sort((a, b) => ATTENTION_ORDER.indexOf(a.kind) - ATTENTION_ORDER.indexOf(b.kind));
      cell.primary = cell.tenants[0] ?? null;
    }
  }
  return [...rows.values()].sort((a, b) => a.organizationName.localeCompare(b.organizationName, 'es'));
}

/** Compara por urgencia: lo que pide una acción va primero. */
export function byAttention(a: { kind: CellKind }, b: { kind: CellKind }): number {
  return ATTENTION_ORDER.indexOf(a.kind) - ATTENTION_ORDER.indexOf(b.kind);
}

// ---------------------------------------------------------------------------
// Apps de una cuenta (ficha 360, V5 · F3)
// ---------------------------------------------------------------------------

export interface AccountAppTenant extends MatrixTenant {
  productName: string;
  productCode: string | null;
  /** OWN: la cuenta es la cliente; MANAGED: la administra como canal. */
  relation: 'OWN' | 'MANAGED';
}

export interface AccountApp {
  productId: string;
  productName: string;
  productCode: string | null;
  tenants: AccountAppTenant[];
  /** El tenant que más atención pide: resume la app en la cabecera. */
  primary: AccountAppTenant;
}

/**
 * Los tenants de UNA cuenta agrupados por app, con el MISMO estado combinado
 * (alta en la app × estado aquí) que la matriz del Centro de la suite.
 */
export function accountApps(
  organizationId: string,
  tenants: readonly TenantRow[],
  requests: readonly ProvisioningRow[],
  subscriptions?: ReadonlyMap<string, string> | null,
): AccountApp[] {
  const byId = new Map(tenants.filter((t) => t.tenant_id).map((t) => [t.tenant_id as string, t]));
  const rows = buildMatrix({ apps: [], tenants, requests, subscriptions });
  const groups = new Map<string, AccountAppTenant[]>();
  for (const row of rows) {
    for (const cell of Object.values(row.cells)) {
      for (const m of cell.tenants) {
        const t = byId.get(m.tenantId);
        const enriched: AccountAppTenant = {
          ...m,
          productName: t?.product_short_name ?? '—',
          productCode: t?.product_code ?? null,
          relation: t?.customer_organization_id === organizationId ? 'OWN' : 'MANAGED',
        };
        const list = groups.get(m.productId) ?? [];
        list.push(enriched);
        groups.set(m.productId, list);
      }
    }
  }
  return [...groups.entries()]
    .map(([productId, list]) => {
      const sorted = [...list].sort((a, b) => byAttention(a, b) || a.tenantName.localeCompare(b.tenantName, 'es'));
      return {
        productId,
        productName: sorted[0]!.productName,
        productCode: sorted[0]!.productCode,
        tenants: sorted,
        primary: sorted[0]!,
      };
    })
    .sort((a, b) => a.productName.localeCompare(b.productName, 'es'));
}

export type MatrixFilter = 'ALL' | 'ATTENTION' | 'PENDING_CONFIRM' | 'FAILED' | 'IN_PROGRESS' | 'SUSPENDED' | 'ACTIVE';

export const MATRIX_FILTERS: MatrixFilter[] = ['ALL', 'ATTENTION', 'PENDING_CONFIRM', 'FAILED', 'IN_PROGRESS', 'SUSPENDED', 'ACTIVE'];

export const MATRIX_FILTER_LABEL: Record<MatrixFilter, string> = {
  ALL: 'Todas',
  ATTENTION: 'Requieren atención',
  PENDING_CONFIRM: 'Por confirmar',
  FAILED: 'Alta fallida',
  IN_PROGRESS: 'En curso',
  SUSPENDED: 'Suspendidas',
  ACTIVE: 'Activas',
};

function kindMatches(kind: CellKind, filter: MatrixFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'ATTENTION') return ATTENTION_KINDS.has(kind);
  return kind === filter;
}

/** ¿La fila tiene, en la app elegida (o en cualquiera), un tenant en ese estado? */
export function rowMatches(row: MatrixRow, filter: MatrixFilter, appId: string | null, search: string): boolean {
  const q = search.trim().toLocaleLowerCase('es');
  if (q) {
    const names = [row.organizationName, ...Object.values(row.cells).flatMap((c) => c.tenants.map((t) => t.tenantName))];
    if (!names.some((n) => n.toLocaleLowerCase('es').includes(q))) return false;
  }
  const cells = appId ? [row.cells[appId]].filter((c): c is MatrixCell => Boolean(c)) : Object.values(row.cells);
  if (cells.length === 0) return false;
  return cells.some((c) => c.tenants.some((t) => kindMatches(t.kind, filter)));
}

export function filterCount(rows: readonly MatrixRow[], filter: MatrixFilter, appId: string | null, search: string): number {
  return rows.filter((r) => rowMatches(r, filter, appId, search)).length;
}

// ---------------------------------------------------------------------------
// Módulos habilitados de un tenant
// ---------------------------------------------------------------------------

const MODULE_STATE: Record<string, { label: string; tone: Tone }> = {
  NOT_PROVISIONED: { label: 'Sin alta', tone: 'neutral' },
  NOT_ENROLLED: { label: 'No inscrito', tone: 'neutral' },
  PENDING_PUSH: { label: 'Pendiente de envío', tone: 'info' },
  PUSHING: { label: 'Enviando', tone: 'info' },
  AWAITING_VERIFY: { label: 'Esperando verificación', tone: 'info' },
  IN_SYNC: { label: 'Al día', tone: 'ok' },
  IN_SYNC_WITH_WARNINGS: { label: 'Al día con avisos', tone: 'warn' },
  DRIFT_BEHIND: { label: 'Atrasado', tone: 'warn' },
  DRIFT_CHECKSUM: { label: 'Distinto en la app', tone: 'danger' },
  DRIFT_AHEAD: { label: 'La app va por delante', tone: 'danger' },
  REJECTED: { label: 'Rechazado por la app', tone: 'danger' },
  UNREACHABLE: { label: 'App inalcanzable', tone: 'warn' },
  REGISTRY_DRIFT: { label: 'Registro desalineado', tone: 'warn' },
};

/** Estado de los módulos habilitados de un tenant; «No activo» si el canal está apagado. */
export function moduleState(
  channelActive: boolean,
  sync: Pick<ModuleSyncRow, 'state'> | null | undefined,
): { label: string; tone: Tone } {
  if (!channelActive) return { label: 'No activo', tone: 'neutral' };
  if (!sync?.state) return { label: 'Sin sincronizar', tone: 'neutral' };
  return MODULE_STATE[sync.state] ?? { label: sync.state, tone: 'neutral' };
}
