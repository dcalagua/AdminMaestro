import type { Database } from '@/types/database.types';

/**
 * Sincronización con las apps: textos de negocio y reglas de presentación.
 *
 * Puro y probado aparte: la pantalla solo pinta. La base decide qué es un
 * hallazgo y quién puede cerrarlo; aquí se decide cómo contarlo en español
 * de negocio, sin códigos ni jerga técnica.
 */
type Views = Database['platform']['Views'];
export type SyncTargetRow = Views['v_tenant_sync_targets']['Row'];
export type SyncFindingRow = Views['v_tenant_sync_findings']['Row'];
export type SyncRunRow = Views['v_tenant_sync_runs']['Row'];

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'accent';
export type FindingKind = 'BROKEN_LINK' | 'STATE_MISMATCH' | 'APP_ONLY';
export type FindingStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

export const KIND: Record<FindingKind, { label: string; tone: Tone; help: string }> = {
  BROKEN_LINK: {
    label: 'Vínculo roto',
    tone: 'danger',
    help: 'El Admin Maestro tiene dado de alta este cliente en la app, pero la app ya no lo tiene.',
  },
  STATE_MISMATCH: {
    label: 'Estado distinto',
    tone: 'warn',
    help: 'El cliente está en un estado en el Admin Maestro y en otro en la app.',
  },
  APP_ONLY: {
    label: 'Existe solo en la app',
    tone: 'info',
    help: 'La app tiene este cliente y el Admin Maestro no lo conoce: no se le factura ni se le puede suspender.',
  },
};

export const STATE_LABEL: Record<string, string> = {
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  INACTIVE: 'Dado de baja',
  PENDING: 'Pendiente',
  CHURNED: 'Baja',
  ARCHIVED: 'Archivado',
  UNKNOWN: 'Sin dato',
};

export const stateLabel = (s: string | null | undefined) => (s ? (STATE_LABEL[s] ?? s) : '—');

export const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  OK: { label: 'Todo coincide', tone: 'ok' },
  WITH_FINDINGS: { label: 'Con diferencias', tone: 'warn' },
  PARTIAL: { label: 'Revisión parcial', tone: 'info' },
  FAILED: { label: 'No se pudo revisar', tone: 'danger' },
  NOT_VERIFIABLE: { label: 'Sin forma de comprobar', tone: 'neutral' },
};

export function outcomeOf(t: Pick<SyncTargetRow, 'last_outcome' | 'last_checked_at'>): { label: string; tone: Tone } {
  if (!t.last_checked_at) return { label: 'Aún sin revisar', tone: 'neutral' };
  return OUTCOME[t.last_outcome ?? ''] ?? { label: 'Sin dato', tone: 'neutral' };
}

export const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  RUNNING: { label: 'En curso', tone: 'info' },
  COMPLETED: { label: 'Completa', tone: 'ok' },
  PARTIAL: { label: 'Parcial', tone: 'warn' },
  FAILED: { label: 'Fallida', tone: 'danger' },
};

export const RESOLUTION: Record<string, string> = {
  REGISTERED: 'Registrado en el Admin Maestro',
  MARKED_RESOLVED: 'Marcado como resuelto',
  DISMISSED: 'Descartado',
  NO_LONGER_DETECTED: 'Se resolvió solo: ya no se detecta',
};

/** Causas técnicas frecuentes, en palabras de negocio. */
const ERROR_TEXT: Record<string, string> = {
  DEPLOYMENT_WITHOUT_URL: 'El entorno no tiene dirección configurada.',
  CREDENTIAL_NOT_USABLE: 'La credencial de conexión con la app está apagada o falta.',
  SECRET_NOT_AVAILABLE: 'Falta cargar la clave de conexión con la app.',
  INTEGRATION_DISABLED: 'La integración con la app está deshabilitada.',
  PROVIDER_TIMEOUT: 'La app no respondió a tiempo.',
  PROVIDER_UNREACHABLE: 'No se pudo conectar con la app.',
  INVENTORY_TOO_LARGE: 'La app tiene demasiados clientes para leerlos en una sola revisión.',
  INVENTORY_ITEM_INVALID: 'La app devolvió algún cliente con datos incompletos.',
  INTERRUMPIDA: 'La revisión se cortó antes de terminar.',
};

export function errorText(code: string | null | undefined): string | null {
  if (!code) return null;
  return ERROR_TEXT[code] ?? 'La app respondió con un error; el detalle técnico está en la auditoría.';
}

/** Cómo se comprueba cada app HOY, en una frase. */
export function capabilityText(t: Pick<SyncTargetRow, 'can_check_existence' | 'can_check_state'>): string {
  if (t.can_check_existence && t.can_check_state) return 'Comprueba que cada cliente existe y su estado.';
  if (t.can_check_existence) return 'Comprueba que cada cliente existe (no su estado).';
  if (t.can_check_state) return 'Comprueba que cada cliente existe y su estado.';
  return 'Esta app todavía no permite comprobar a sus clientes.';
}

export const INVENTORY_NOT_AVAILABLE = 'Inventario no disponible en esta app';

export function inventoryText(
  t: Pick<SyncTargetRow, 'inventory_available' | 'last_inventory_status' | 'last_inventory_items' | 'last_inventory_unknown'>,
): { text: string; tone: Tone } {
  if (!t.inventory_available) return { text: INVENTORY_NOT_AVAILABLE, tone: 'neutral' };
  if (t.last_inventory_status === 'FAILED') return { text: 'No se pudo leer el inventario', tone: 'danger' };
  if (t.last_inventory_status !== 'AVAILABLE') return { text: 'Inventario disponible, aún sin leer', tone: 'neutral' };
  const n = t.last_inventory_items ?? 0;
  const unknown = t.last_inventory_unknown ?? 0;
  const base = `${n} ${n === 1 ? 'cliente' : 'clientes'} en la app`;
  return unknown > 0
    ? { text: `${base} · ${unknown} sin registrar aquí`, tone: 'warn' }
    : { text: base, tone: 'ok' };
}

/** «12 de 14 coinciden» · roto · estado distinto · sin verificar. */
export function linksText(t: Pick<SyncTargetRow, 'last_checked_at' | 'last_links_total' | 'last_links_ok' | 'last_links_broken' | 'last_links_state_mismatch' | 'last_links_unverified' | 'active_links'>): string {
  if (!t.last_checked_at) return `${t.active_links ?? 0} vinculados`;
  const total = t.last_links_total ?? 0;
  if (total === 0) return 'Sin clientes vinculados';
  const parts = [`${t.last_links_ok ?? 0} de ${total} coinciden`];
  if ((t.last_links_broken ?? 0) > 0) parts.push(`${t.last_links_broken} rotos`);
  if ((t.last_links_state_mismatch ?? 0) > 0) parts.push(`${t.last_links_state_mismatch} con estado distinto`);
  if ((t.last_links_unverified ?? 0) > 0) parts.push(`${t.last_links_unverified} sin verificar`);
  return parts.join(' · ');
}

/** Qué cliente es, en una línea: nombre de la app, tenant o id externo. */
export function findingSubject(f: Pick<SyncFindingRow, 'kind' | 'app_name' | 'app_code' | 'tenant_name' | 'external_tenant_id'>): string {
  if (f.kind === 'APP_ONLY') return f.app_name ?? f.app_code ?? `Cliente ${f.external_tenant_id ?? ''}`.trim();
  return f.tenant_name ?? f.external_tenant_id ?? '—';
}

export function findingDetail(f: Pick<SyncFindingRow, 'kind' | 'masteradmin_state' | 'app_state' | 'app_status'>): string {
  if (f.kind === 'STATE_MISMATCH') {
    return `Admin Maestro: ${stateLabel(f.masteradmin_state)} · App: ${stateLabel(f.app_state)}`;
  }
  if (f.kind === 'APP_ONLY') return `En la app: ${stateLabel(f.app_status)}`;
  return 'La app ya no lo tiene';
}

/** Sugerencia de slug a partir del código o nombre de la app (el usuario la puede cambiar). */
export function suggestSlug(text: string | null | undefined, suffix?: string): string {
  const base = (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (!base) return '';
  return suffix && !base.endsWith(`-${suffix}`) ? `${base}-${suffix}` : base;
}

export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
