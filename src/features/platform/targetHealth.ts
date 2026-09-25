import {
  DEPLOYMENT_HEALTH_LABEL,
  PROVISIONING_ENVIRONMENT_LABEL,
  healthTone,
  type DeploymentHealth,
  type ProvisioningEnvironment,
  type Tone,
} from '@/lib/provisioning';

/**
 * Salud OBSERVADA de los destinos de provisioning, resumida sin mezclar
 * entornos (spec §7.3 y §12).
 *
 * Reglas que protegen al lector:
 *  - Un destino deshabilitado, en borrador o dado de baja NO se evalúa: queda
 *    «No evaluado» y no contamina el resumen de los destinos operativos.
 *  - Nunca se resume a través de entornos: PRD caído no pinta de rojo a QAS, ni
 *    QAS sano pinta de verde a PRD.
 *  - `enabled` no significa `HEALTHY`: la salud sale sólo de `health_status`, y
 *    cada resumen lleva la fecha de la observación persistida (no es «tiempo
 *    real» ni «uptime»).
 *  - Nada de esto llama a ningún producto: sólo lee lo que el control plane ya
 *    guardó. «Verificar conexión» sigue siendo una acción explícita.
 */
export interface TargetHealthInput {
  provisioning_environment?: string | null;
  provisioning_enabled?: boolean | null;
  provisioning_status?: string | null;
  health_status?: string | null;
  health_checked_at?: string | null;
}

export type ObservedHealth = DeploymentHealth | 'NOT_EVALUATED';

export const ENVIRONMENT_ORDER: ProvisioningEnvironment[] = ['DEV', 'QAS', 'DEMO', 'PRD'];

/** ¿Este destino participa en un resumen de salud operativa? */
export function isEvaluable(target: TargetHealthInput): boolean {
  if (!target.provisioning_enabled) return false;
  const status = target.provisioning_status ?? 'DRAFT';
  return status !== 'DRAFT' && status !== 'DISABLED';
}

/** Motivo legible por el que un destino no se evalúa (o null si se evalúa). */
export function notEvaluatedReason(target: TargetHealthInput): string | null {
  if (isEvaluable(target)) return null;
  if (target.provisioning_status === 'DRAFT' || !target.provisioning_status) return 'destino en borrador';
  if (target.provisioning_status === 'DISABLED') return 'destino dado de baja';
  return 'provisioning deshabilitado';
}

export function observedHealth(target: TargetHealthInput): ObservedHealth {
  if (!isEvaluable(target)) return 'NOT_EVALUATED';
  return (target.health_status ?? 'UNKNOWN') as DeploymentHealth;
}

export function observedHealthLabel(health: ObservedHealth): string {
  return health === 'NOT_EVALUATED' ? 'No evaluado' : DEPLOYMENT_HEALTH_LABEL[health];
}

export function observedHealthTone(health: ObservedHealth): Tone {
  return health === 'NOT_EVALUATED' ? 'neutral' : healthTone(health);
}

export function environmentLabel(environment: string | null | undefined): string {
  if (!environment) return 'Sin entorno';
  return PROVISIONING_ENVIRONMENT_LABEL[environment as ProvisioningEnvironment] ?? environment;
}

/**
 * Peor salud entre destinos EVALUADOS del mismo entorno. Sin ninguno sano
 * comprobado, UNKNOWN: «nadie lo ha comprobado» no es «sano».
 */
function worst(values: DeploymentHealth[]): DeploymentHealth {
  if (values.includes('UNHEALTHY')) return 'UNHEALTHY';
  if (values.includes('DEGRADED')) return 'DEGRADED';
  if (values.length > 0 && values.every((v) => v === 'HEALTHY')) return 'HEALTHY';
  return 'UNKNOWN';
}

export interface EnvironmentHealthSummary {
  environment: string | null;
  label: string;
  /** Destinos del entorno (todos). */
  total: number;
  /** Destinos habilitados y operativos: los únicos que entran en `health`. */
  evaluated: number;
  notEvaluated: number;
  health: ObservedHealth;
  /** Observación más reciente entre los evaluados (ISO) o null si nunca se comprobó. */
  latestCheckedAt: string | null;
  /** Observación más antigua entre los evaluados: el resumen no es más reciente que esto. */
  oldestCheckedAt: string | null;
  /** Evaluados que nunca se comprobaron. */
  neverChecked: number;
}

export function summarizeByEnvironment(targets: readonly TargetHealthInput[]): EnvironmentHealthSummary[] {
  const groups = new Map<string, TargetHealthInput[]>();
  for (const t of targets) {
    const key = t.provisioning_environment ?? '';
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const rank = (env: string) => {
    const i = ENVIRONMENT_ORDER.indexOf(env as ProvisioningEnvironment);
    return i === -1 ? ENVIRONMENT_ORDER.length : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([env, rows]) => {
      const evaluable = rows.filter(isEvaluable);
      const checked = evaluable
        .map((t) => t.health_checked_at)
        .filter((d): d is string => Boolean(d))
        .sort();
      return {
        environment: env || null,
        label: environmentLabel(env || null),
        total: rows.length,
        evaluated: evaluable.length,
        notEvaluated: rows.length - evaluable.length,
        health:
          evaluable.length === 0
            ? 'NOT_EVALUATED'
            : worst(evaluable.map((t) => (t.health_status ?? 'UNKNOWN') as DeploymentHealth)),
        latestCheckedAt: checked[checked.length - 1] ?? null,
        oldestCheckedAt: checked[0] ?? null,
        neverChecked: evaluable.filter((t) => !t.health_checked_at).length,
      };
    });
}
