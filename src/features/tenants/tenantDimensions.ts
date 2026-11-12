import { formatDateTime, formatMoney } from '@/lib/format';

/**
 * Cuatro dimensiones de un tenant (spec §11.2, AC12). NO hay semáforo global:
 * cada una responde a una pregunta distinta y ninguna se deduce de otra.
 *
 *  Comercial      · estado del registro/contrato, tipo y recurrente. No prueba acceso.
 *  Alta técnica   · solicitud SaaS y mapping. No activa Auth ni cobra.
 *  Salud          · última observación persistida del destino. No es uptime.
 *  Administrador  · lo que el producto informó del admin (p. ej. PREPROVISIONED).
 *                   No implica un usuario que ya pueda iniciar sesión.
 */
export type DimTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

export interface Dimension {
  label: string;
  detail: string;
  tone: DimTone;
}

export interface TenantDimensions {
  commercial: Dimension & { mrr: string };
  technical: Dimension;
  health: Dimension;
  admin: Dimension;
}

export interface TenantLike {
  status?: string | null;
  tenant_type?: string | null;
  mrr?: number | string | null;
  currency?: string | null;
  environment?: string | null;
}

export interface SaasRowLike {
  status?: string | null;
  mapping_status?: string | null;
  requested_at?: string | null;
  product_short_name?: string | null;
  provisioning_environment?: string | null;
  deployment_target_id?: string | null;
  mapping_metadata?: unknown;
  last_error_message?: string | null;
}

export interface TargetLike {
  deployment_target_id?: string | null;
  health_status?: string | null;
  health_checked_at?: string | null;
  provisioning_enabled?: boolean | null;
  provisioning_status?: string | null;
}

const COMMERCIAL: Record<string, { label: string; tone: DimTone }> = {
  PENDING: { label: 'Pendiente de activación comercial', tone: 'warn' },
  ACTIVE: { label: 'Activo comercialmente', tone: 'ok' },
  SUSPENDED: { label: 'Suspendido comercialmente', tone: 'danger' },
  CHURNED: { label: 'Baja comercial', tone: 'neutral' },
  ARCHIVED: { label: 'Archivado', tone: 'neutral' },
};

const TYPE: Record<string, string> = {
  PRODUCTION: 'Producción',
  DEMO: 'Demo (no genera recurrente)',
  TRIAL: 'Prueba',
  SANDBOX: 'Sandbox',
};

const REQUEST: Record<string, { label: string; tone: DimTone }> = {
  PENDING: { label: 'Alta solicitada', tone: 'info' },
  WAITING_INFRA: { label: 'Alta esperando infraestructura', tone: 'warn' },
  READY_TO_PROVISION: { label: 'Alta lista para ejecutar', tone: 'info' },
  PROVISIONING: { label: 'Alta en ejecución', tone: 'info' },
  ACTIVE: { label: 'Alta registrada', tone: 'ok' },
  FAILED: { label: 'Alta fallida', tone: 'danger' },
  CANCELLED: { label: 'Alta cancelada', tone: 'neutral' },
};

function adminStatusOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const resources = (m.resources ?? {}) as Record<string, unknown>;
  const value = resources.adminProvisioningStatus ?? m.adminProvisioningStatus;
  return typeof value === 'string' && value ? value : null;
}

export function tenantDimensions(
  tenant: TenantLike,
  saas: readonly SaasRowLike[],
  targets: readonly TargetLike[],
): TenantDimensions {
  const c = COMMERCIAL[tenant.status ?? ''] ?? { label: tenant.status ?? 'Sin estado', tone: 'neutral' as DimTone };
  const mrrValue = tenant.mrr === null || tenant.mrr === undefined ? null : Number(tenant.mrr);
  const mrr =
    mrrValue === null || mrrValue === 0 || !tenant.currency ? 'Sin recurrente vigente' : formatMoney(mrrValue, tenant.currency);
  const commercial = {
    ...c,
    mrr,
    detail: `${TYPE[tenant.tenant_type ?? ''] ?? tenant.tenant_type ?? 'Tipo sin definir'} · registro del control plane; no refleja el acceso remoto.`,
  };

  const latest = [...saas].sort((a, b) => String(b.requested_at ?? '').localeCompare(String(a.requested_at ?? '')))[0];
  let technical: Dimension;
  if (!latest) {
    technical = { label: 'Sin alta SaaS registrada', detail: 'No hay solicitud de alta en ningún producto.', tone: 'neutral' };
  } else {
    const r = REQUEST[latest.status ?? ''] ?? { label: latest.status ?? 'Sin estado', tone: 'neutral' as DimTone };
    const mapping = latest.mapping_status === 'ACTIVE' ? ' · mapping activo' : latest.mapping_status ? ` · mapping ${latest.mapping_status}` : '';
    technical = {
      label: `${r.label}${mapping}`,
      tone: r.tone,
      detail: `${latest.product_short_name ?? 'Producto'}${latest.provisioning_environment ? ` · ${latest.provisioning_environment}` : ''}${
        latest.last_error_message ? ` · último error: ${latest.last_error_message}` : ''
      }. No activa Auth ni cobra.`,
    };
  }

  const target = latest?.deployment_target_id
    ? targets.find((t) => t.deployment_target_id === latest.deployment_target_id)
    : undefined;
  let health: Dimension;
  if (!target) {
    health = { label: 'Sin observación de salud', detail: 'No hay un destino asociado con observación registrada.', tone: 'neutral' };
  } else if (!target.provisioning_enabled || target.provisioning_status !== 'READY') {
    health = { label: 'Destino no evaluado', detail: 'El destino está deshabilitado o en borrador.', tone: 'neutral' };
  } else {
    const when = target.health_checked_at ? `Observado ${formatDateTime(target.health_checked_at)}` : 'Sin fecha de observación';
    const map: Record<string, Dimension> = {
      HEALTHY: { label: 'Última observación: respondió sano', tone: 'ok', detail: `${when}. Es una comprobación puntual, no disponibilidad garantizada.` },
      UNHEALTHY: { label: 'Última observación: no respondió', tone: 'danger', detail: `${when}.` },
      DEGRADED: { label: 'Última observación: degradado', tone: 'warn', detail: `${when}.` },
    };
    health = map[target.health_status ?? ''] ?? { label: 'Sin dato de salud', tone: 'neutral', detail: `${when}.` };
  }

  const adminStatus = adminStatusOf(latest?.mapping_metadata);
  const admin: Dimension = !adminStatus
    ? { label: 'Sin dato del producto', detail: 'El producto no informó el estado del administrador.', tone: 'neutral' }
    : adminStatus === 'PREPROVISIONED'
      ? {
          label: 'Administrador preaprovisionado',
          detail: 'El producto creó la cuenta del administrador; no implica que ya pueda iniciar sesión (activación pendiente).',
          tone: 'info',
        }
      : { label: `Administrador: ${adminStatus}`, detail: 'Estado informado por el producto.', tone: 'info' };

  return { commercial, technical, health, admin };
}
