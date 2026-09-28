import { formatNumber } from '@/lib/format';
import { errorMessage } from '@/features/executive/dataState';

/**
 * Etiquetas de negocio del catálogo y la relación comercial (T21).
 *
 * Los códigos técnicos (`ACTIVE`, `ONE_TIME`, `PARTNER_BASE_LICENSE`…) se
 * traducen aquí para que la pantalla hable de negocio; el código crudo sólo
 * aparece como dato secundario. Un valor desconocido se muestra tal cual en
 * vez de inventarle un significado.
 */

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';

/** `entity_status` de catálogo, planes, organizaciones, comerciales y reglas. */
export const ENTITY_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  SUSPENDED: 'Suspendido',
  ARCHIVED: 'Archivado',
};

export function entityStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Sin estado';
  return ENTITY_STATUS_LABEL[status] ?? status;
}

export function entityStatusTone(status: string | null | undefined): BadgeTone {
  if (status === 'ACTIVE') return 'ok';
  if (status === 'SUSPENDED') return 'warn';
  return 'neutral';
}

/** Tabs de estado comunes a los listados (U-06: un buscador + tabs de estado). */
export type EntityStatusTab = 'ALL' | 'ACTIVE' | 'INACTIVE';

export function matchesEntityStatusTab(status: string | null | undefined, tab: EntityStatusTab): boolean {
  if (tab === 'ALL') return true;
  if (tab === 'ACTIVE') return status === 'ACTIVE';
  return status !== 'ACTIVE';
}

export function entityStatusTabs(
  items: Array<{ status?: string | null }>,
  labels: { all?: string; active?: string; inactive?: string } = {},
): Array<{ id: EntityStatusTab; label: string; count: number }> {
  const active = items.filter((i) => i.status === 'ACTIVE').length;
  return [
    { id: 'ALL', label: labels.all ?? 'Todos', count: items.length },
    { id: 'ACTIVE', label: labels.active ?? 'Activos', count: active },
    { id: 'INACTIVE', label: labels.inactive ?? 'Inactivos o archivados', count: items.length - active },
  ];
}

export const CHARGE_KIND_LABEL: Record<string, string> = {
  LICENSE: 'Licencia',
  PARTNER_BASE_LICENSE: 'Licencia base partner',
  TENANT_LICENSE: 'Licencia por tenant',
  IMPLEMENTATION_FEE: 'Implementación',
  INFRASTRUCTURE_FEE: 'Infraestructura',
  SUPPORT_FEE: 'Soporte',
  ADDON: 'Addon',
  PROFESSIONAL_SERVICES: 'Servicios profesionales',
  DISCOUNT: 'Descuento',
  USAGE_OVERAGE: 'Exceso de uso',
};

export function chargeKindLabel(kind: string | null | undefined): string {
  if (!kind) return 'Cargo';
  return CHARGE_KIND_LABEL[kind] ?? kind;
}

/** Periodicidad legible tras el importe: «USD 120.00 / mes». */
export const BILLING_INTERVAL_SUFFIX: Record<string, string> = {
  MONTHLY: 'mes',
  QUARTERLY: 'trimestre',
  YEARLY: 'año',
  ONE_TIME: 'pago único',
};

export function billingIntervalSuffix(interval: string | null | undefined): string {
  if (!interval) return 'periodicidad no definida';
  return BILLING_INTERVAL_SUFFIX[interval] ?? interval;
}

export type PriceRow = Record<string, unknown>;

/** Tarifas abiertas (sin `valid_to`): las únicas que se usan para vender. */
export function openPrices(prices: PriceRow[] | null | undefined): PriceRow[] {
  return (prices ?? []).filter((pr) => !pr.valid_to);
}

/**
 * Cargo único vs. recurrente. La fuente es la periodicidad de la tarifa
 * (`ONE_TIME`), no el tipo de cargo: una implementación cobrada en cuotas
 * sigue siendo recurrente para la factura.
 */
export function isOneTimePrice(price: PriceRow): boolean {
  return price.billing_interval === 'ONE_TIME';
}

export function splitPrices(prices: PriceRow[] | null | undefined): {
  recurring: PriceRow[];
  oneTime: PriceRow[];
} {
  const open = openPrices(prices);
  return {
    recurring: open.filter((pr) => !isOneTimePrice(pr)),
    oneTime: open.filter(isOneTimePrice),
  };
}

/* ---- CCP fase 07 · add-ons del catálogo y su ciclo de vida por tenant ---- */

/** Ciclo de vida COMERCIAL de un add-on del catálogo (no es el de un tenant). */
export const LIFECYCLE_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  AVAILABLE: 'Disponible',
  COMING_SOON: 'Próximamente',
  RETIRED: 'Retirado',
};

export function lifecycleStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Sin estado';
  return LIFECYCLE_STATUS_LABEL[status] ?? status;
}

export function lifecycleStatusTone(status: string | null | undefined): BadgeTone {
  if (status === 'AVAILABLE') return 'ok';
  if (status === 'COMING_SOON') return 'info';
  if (status === 'RETIRED') return 'warn';
  return 'neutral';
}

export const BILLING_MODEL_LABEL: Record<string, string> = {
  FLAT: 'Tarifa plana',
  PER_COMPANY: 'Por sociedad',
  PER_UNIT: 'Por unidad',
};

export function billingModelLabel(model: string | null | undefined): string {
  if (!model) return 'Sin modelo de cobro';
  return BILLING_MODEL_LABEL[model] ?? model;
}

/** Estado de un add-on EN un tenant (`tenant_addons.status`). */
export const TENANT_ADDON_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Solicitado',
  ACTIVE: 'Activo',
  CANCEL_SCHEDULED: 'Baja programada',
  CANCELLED: 'Dado de baja',
  SUSPENDED: 'Suspendido',
  REJECTED: 'Rechazado',
};

export function tenantAddonStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Sin estado';
  return TENANT_ADDON_STATUS_LABEL[status] ?? status;
}

export function tenantAddonStatusTone(status: string | null | undefined): BadgeTone {
  if (status === 'ACTIVE') return 'ok';
  if (status === 'REQUESTED') return 'info';
  if (status === 'CANCEL_SCHEDULED') return 'warn';
  if (status === 'SUSPENDED') return 'danger';
  return 'neutral';
}

export const REQUEST_SOURCE_LABEL: Record<string, string> = {
  CONSOLE: 'Consola',
  TENANT: 'Tenant',
  PARTNER: 'Partner',
  SAAS_M2M: 'Integración SaaS',
  LEAD: 'Lead',
  LEGACY_BACKFILL: 'Histórico migrado',
};

export function requestSourceLabel(source: string | null | undefined): string {
  if (!source) return '—';
  return REQUEST_SOURCE_LABEL[source] ?? source;
}

/* ---- Integración técnica: dimensión DISTINTA del estado comercial ---- */

export const INTEGRATION_STATE_LABEL: Record<string, string> = {
  DRAFT: 'En borrador',
  READY: 'Lista',
  DEGRADED: 'Degradada',
  DISABLED: 'Deshabilitada',
};

export interface IntegrationSummary {
  label: string;
  tone: BadgeTone;
  /** Detalle secundario (código técnico de la integración). */
  detail?: string;
}

/**
 * Resume la integración técnica de un producto a partir de las filas que RLS
 * devuelve. «Lista y habilitada» describe la configuración registrada: no es
 * una certificación ni una medición de salud.
 */
export function summarizeIntegration(
  rows: Array<Record<string, unknown>> | undefined,
): IntegrationSummary {
  const list = rows ?? [];
  if (list.length === 0) return { label: 'Sin integración registrada', tone: 'neutral' };
  const ready = list.find((r) => r.status === 'READY' && r.enabled);
  const pick = ready ?? list[0]!;
  const status = String(pick.status ?? '');
  const base = INTEGRATION_STATE_LABEL[status] ?? status;
  const detail = list.map((r) => String(r.code ?? '')).filter(Boolean).join(', ') || undefined;
  if (ready) return { label: 'Lista y habilitada', tone: 'ok', detail };
  if (!pick.enabled) return { label: `${base} · no habilitada`, tone: 'neutral', detail };
  return { label: base, tone: status === 'DEGRADED' ? 'warn' : 'info', detail };
}

/* ---- Conteos que dependen de una lectura: nunca «0» si la lectura falló ---- */

interface QueryLikeCount {
  data?: unknown;
  error?: unknown;
  isLoading?: boolean;
}

const FORBIDDEN_HINTS = ['permission denied', '42501', 'PGRST301', 'not authorized'];

/** ¿El error significa «no te corresponde» y no «falló»? */
export function isForbiddenError(error: unknown): boolean {
  const message = errorMessage(error);
  return FORBIDDEN_HINTS.some((h) => message.includes(h));
}

/**
 * Texto de un conteo derivado de una consulta. Si la consulta falla o no se
 * tiene acceso, se dice así; si está cargando, se indica. Sólo con datos se
 * devuelve el número (incluido el cero real).
 */
export function countText(query: QueryLikeCount, count: number): string {
  if (query.error) return isForbiddenError(query.error) ? 'Sin acceso' : 'No se pudo leer';
  if (query.isLoading || query.data === undefined) return '…';
  return formatNumber(count);
}
