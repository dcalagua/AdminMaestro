import type { Database } from '@/types/database.types';

/**
 * Modelo del Centro de la suite: cada tenant de cada app con su etapa de ciclo
 * de vida (cobranza → suspensión → reactivación) y lo que la app sabe de él.
 *
 * La etapa la calcula la base (`v_tenant_lifecycle.lifecycle_stage`); aquí solo
 * se traduce y se agrupa. Lo que SÍ se deriva aquí es la «entrega a la app»:
 * un tenant suspendido en MasterAdmin solo está cortado en la app cuando el
 * snapshot con `appActive=false` llegó (IN_SYNC) y la app ya aplica los
 * entitlements de MasterAdmin (cohorte DUAL_READ o superior). En LEGACY_ONLY o
 * SHADOW el corte es solo un registro: decirlo es parte de no mentirle a nadie.
 */

export type TenantLifecycleRow = Database['platform']['Views']['v_tenant_lifecycle']['Row'];

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'accent';

export type LifecycleStage =
  | 'CURRENT'
  | 'IN_GRACE'
  | 'SUSPENSION_SUGGESTED'
  | 'SUSPENSION_SCHEDULED'
  | 'SUSPENDED_NON_PAYMENT'
  | 'SUSPENDED_MANUAL'
  | 'INACTIVE';

export const STAGE: Record<LifecycleStage, { label: string; short: string; tone: Tone; help: string }> = {
  CURRENT: { label: 'Al día', short: 'Al día', tone: 'ok', help: 'Sin deuda vencida.' },
  IN_GRACE: {
    label: 'Vencido, en gracia',
    short: 'En gracia',
    tone: 'info',
    help: 'Tiene facturas vencidas, pero todavía dentro del periodo de gracia.',
  },
  SUSPENSION_SUGGESTED: {
    label: 'Suspensión sugerida',
    short: 'Sugerida',
    tone: 'warn',
    help: 'La gracia terminó y su política no suspende sola: decide una persona.',
  },
  SUSPENSION_SCHEDULED: {
    label: 'Suspensión programada',
    short: 'Programada',
    tone: 'danger',
    help: 'La gracia terminó y su política suspende sola en el próximo ciclo (si el corte automático está habilitado).',
  },
  SUSPENDED_NON_PAYMENT: {
    label: 'Suspendido por impago',
    short: 'Impago',
    tone: 'danger',
    help: 'Se reactiva solo cuando se confirme el pago de la deuda fuera de gracia.',
  },
  SUSPENDED_MANUAL: {
    label: 'Suspendido manualmente',
    short: 'Manual',
    tone: 'warn',
    help: 'Lo suspendió una persona: solo una persona lo reactiva.',
  },
  INACTIVE: { label: 'Fuera de servicio', short: 'Inactivo', tone: 'neutral', help: 'Pendiente, de baja o archivado.' },
};

export function stageOf(row: Pick<TenantLifecycleRow, 'lifecycle_stage'>): LifecycleStage {
  const s = row.lifecycle_stage as LifecycleStage | null;
  return s && s in STAGE ? s : 'INACTIVE';
}

/** Etapas que piden atención de cobranza u operación. */
export const ATTENTION_STAGES: LifecycleStage[] = [
  'SUSPENSION_SCHEDULED',
  'SUSPENSION_SUGGESTED',
  'SUSPENDED_NON_PAYMENT',
  'SUSPENDED_MANUAL',
  'IN_GRACE',
];

export type DeliveryKind = 'NO_CHANNEL' | 'PENDING' | 'INCIDENT' | 'SHADOW' | 'ENFORCED';

export interface Delivery {
  kind: DeliveryKind;
  label: string;
  tone: Tone;
  detail: string;
}

const ENFORCING_COHORTS = new Set(['DUAL_READ', 'MASTERADMIN_PRIMARY', 'LEGACY_RETIRED']);
const PENDING_STATES = new Set(['PENDING_PUSH', 'PUSHING', 'AWAITING_VERIFY', 'DRIFT_BEHIND']);
const INCIDENT_STATES = new Set(['REJECTED', 'UNREACHABLE', 'DRIFT_CHECKSUM', 'DRIFT_AHEAD', 'REGISTRY_DRIFT']);

/** ¿Qué sabe la app de este tenant? */
export function deliveryOf(
  row: Pick<TenantLifecycleRow, 'sync_state' | 'cohort_state' | 'desired_dirty' | 'push_enabled'>,
): Delivery {
  const state = row.sync_state ?? '';
  if (!state || state === 'NOT_PROVISIONED' || state === 'NOT_ENROLLED') {
    return {
      kind: 'NO_CHANNEL',
      label: 'Sin canal',
      tone: 'neutral',
      detail: 'El tenant no está enrolado en la sincronización de entitlements: la app no recibe su estado.',
    };
  }
  if (INCIDENT_STATES.has(state)) {
    return {
      kind: 'INCIDENT',
      label: 'Incidente de entrega',
      tone: 'danger',
      detail: 'La app rechazó, no respondió o difiere de lo emitido: requiere a una persona.',
    };
  }
  if (row.desired_dirty || PENDING_STATES.has(state)) {
    return {
      kind: 'PENDING',
      label: row.push_enabled === false ? 'Pendiente · envío apagado' : 'Entrega pendiente',
      tone: row.push_enabled === false ? 'warn' : 'info',
      detail:
        row.push_enabled === false
          ? 'Hay cambios por entregar, pero el envío de esta integración está apagado.'
          : 'El próximo ciclo de sincronización entrega el estado a la app.',
    };
  }
  if (ENFORCING_COHORTS.has(row.cohort_state ?? '')) {
    return {
      kind: 'ENFORCED',
      label: 'Aplicado en la app',
      tone: 'ok',
      detail: 'La app confirmó el estado y aplica los entitlements de MasterAdmin.',
    };
  }
  return {
    kind: 'SHADOW',
    label: 'Entregado, en sombra',
    tone: 'warn',
    detail: 'La app recibió el estado pero todavía no lo aplica (cohorte LEGACY_ONLY o SHADOW).',
  };
}

export interface SuiteProduct {
  code: string;
  name: string;
  accent: string | null;
  sort: number;
}

export interface SuiteMatrixRow {
  organizationId: string;
  organizationName: string;
  managingOrganizationName: string | null;
  /** Tenants por código de producto. */
  cells: Record<string, TenantLifecycleRow[]>;
  /** La etapa más grave de la cuenta (para ordenar y resaltar). */
  worst: LifecycleStage;
}

const SEVERITY: Record<LifecycleStage, number> = {
  SUSPENDED_NON_PAYMENT: 6,
  SUSPENSION_SCHEDULED: 5,
  SUSPENDED_MANUAL: 4,
  SUSPENSION_SUGGESTED: 3,
  IN_GRACE: 2,
  CURRENT: 1,
  INACTIVE: 0,
};

export function worstStage(stages: LifecycleStage[]): LifecycleStage {
  return stages.reduce<LifecycleStage>((w, s) => (SEVERITY[s] > SEVERITY[w] ? s : w), 'INACTIVE');
}

/** Productos presentes, en el orden del catálogo. */
export function suiteProducts(rows: TenantLifecycleRow[]): SuiteProduct[] {
  const map = new Map<string, SuiteProduct>();
  for (const r of rows) {
    if (!r.product_code || map.has(r.product_code)) continue;
    map.set(r.product_code, {
      code: r.product_code,
      name: r.product_short_name ?? r.product_code,
      accent: r.product_accent_color,
      sort: r.product_sort_order ?? 999,
    });
  }
  return [...map.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es'));
}

/** Una fila por cuenta cliente, una columna por app. Lo más grave arriba. */
export function buildSuiteMatrix(rows: TenantLifecycleRow[]): SuiteMatrixRow[] {
  const byOrg = new Map<string, SuiteMatrixRow>();
  for (const r of rows) {
    const orgId = r.customer_organization_id ?? 'sin-organizacion';
    let entry = byOrg.get(orgId);
    if (!entry) {
      entry = {
        organizationId: orgId,
        organizationName: r.organization_name ?? '—',
        managingOrganizationName: r.managing_organization_name,
        cells: {},
        worst: 'INACTIVE',
      };
      byOrg.set(orgId, entry);
    }
    const code = r.product_code ?? '—';
    (entry.cells[code] ??= []).push(r);
    entry.worst = worstStage([entry.worst, stageOf(r)]);
  }
  return [...byOrg.values()].sort(
    (a, b) => SEVERITY[b.worst] - SEVERITY[a.worst] || a.organizationName.localeCompare(b.organizationName, 'es'),
  );
}

export interface SuiteKpis {
  tenants: number;
  active: number;
  inGrace: number;
  toSuspend: number;
  suspendedNonPayment: number;
  suspendedManual: number;
  pendingDelivery: number;
  apps: number;
  accounts: number;
}

export function suiteKpis(rows: TenantLifecycleRow[]): SuiteKpis {
  const count = (stage: LifecycleStage) => rows.filter((r) => stageOf(r) === stage).length;
  return {
    tenants: rows.length,
    active: rows.filter((r) => r.tenant_status === 'ACTIVE').length,
    inGrace: count('IN_GRACE'),
    toSuspend: count('SUSPENSION_SCHEDULED') + count('SUSPENSION_SUGGESTED'),
    suspendedNonPayment: count('SUSPENDED_NON_PAYMENT'),
    suspendedManual: count('SUSPENDED_MANUAL'),
    pendingDelivery: rows.filter((r) => {
      const k = deliveryOf(r).kind;
      return k === 'PENDING' || k === 'INCIDENT';
    }).length,
    apps: new Set(rows.map((r) => r.product_code).filter(Boolean)).size,
    accounts: new Set(rows.map((r) => r.customer_organization_id).filter(Boolean)).size,
  };
}

/** Resultado del ciclo (`run_tenant_lifecycle_cycle`), tal como lo devuelve la base. */
export interface LifecycleCycleItem {
  tenant_id: string;
  tenant: string;
  product: string;
  grace_ended_on?: string;
  invoices?: string[];
}

export interface LifecycleCycleResult {
  as_of: string;
  dry_run: boolean;
  auto_suspend_enabled: boolean;
  auto_resume_enabled: boolean;
  alerts_created: number;
  suspended: LifecycleCycleItem[];
  resumed: LifecycleCycleItem[];
  pending_suspensions: LifecycleCycleItem[];
  pending_resumes: LifecycleCycleItem[];
}

export function parseCycleResult(value: unknown): LifecycleCycleResult | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<LifecycleCycleResult>;
  const list = (x: unknown) => (Array.isArray(x) ? (x as LifecycleCycleItem[]) : []);
  return {
    as_of: String(v.as_of ?? ''),
    dry_run: Boolean(v.dry_run),
    auto_suspend_enabled: Boolean(v.auto_suspend_enabled),
    auto_resume_enabled: Boolean(v.auto_resume_enabled),
    alerts_created: Number(v.alerts_created ?? 0),
    suspended: list(v.suspended),
    resumed: list(v.resumed),
    pending_suspensions: list(v.pending_suspensions),
    pending_resumes: list(v.pending_resumes),
  };
}

/** Una frase por resultado de ciclo, para el aviso de la consola. */
export function cycleSummary(r: LifecycleCycleResult): string {
  if (r.dry_run) {
    const parts = [
      `${r.pending_suspensions.length} tenant(s) cumplen la regla de suspensión`,
      `${r.pending_resumes.length} reactivación(es) pendientes`,
    ];
    if (!r.auto_suspend_enabled) parts.push('el corte automático está apagado');
    return `Simulación: ${parts.join(' · ')}.`;
  }
  const parts = [`${r.suspended.length} suspendido(s)`, `${r.resumed.length} reactivado(s)`];
  if (r.alerts_created > 0) parts.push(`${r.alerts_created} alerta(s) nueva(s)`);
  if (!r.auto_suspend_enabled && r.pending_suspensions.length > 0) {
    parts.push(`${r.pending_suspensions.length} esperando que se habilite el corte automático`);
  }
  return `Ciclo ejecutado: ${parts.join(' · ')}.`;
}

export const SUSPENSION_CAUSE: Record<string, string> = {
  NON_PAYMENT: 'Impago',
  MANUAL: 'Manual',
};

export const RESUME_CAUSE: Record<string, string> = {
  PAYMENT: 'Pago confirmado',
  MANUAL: 'Reactivación manual',
  TERMINATED: 'Baja del tenant',
};

export const JOB_LABEL: Record<string, string> = {
  LIFECYCLE_CYCLE: 'Ciclo de vida',
  ENTITLEMENT_SYNC: 'Sincronización de entitlements',
  ENTITLEMENT_SWEEP: 'Barrido diario de entitlements',
  AUTOCHARGE: 'Cobro automático con tarjeta',
};

export const JOB_OUTCOME: Record<string, { label: string; tone: Tone }> = {
  OK: { label: 'Ejecutado', tone: 'ok' },
  DISPATCHED: { label: 'Enviado', tone: 'ok' },
  SKIPPED_DISABLED: { label: 'Apagado', tone: 'neutral' },
  SKIPPED_NOT_CONFIGURED: { label: 'Sin configurar', tone: 'warn' },
  FAILED: { label: 'Falló', tone: 'danger' },
};
