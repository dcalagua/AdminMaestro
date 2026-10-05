import { CheckCircleIcon, MinusCircleIcon, QuestionIcon, WarningIcon, XCircleIcon } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import {
  observedHealthLabel,
  observedHealthTone,
  type EnvironmentHealthSummary,
  type ObservedHealth,
} from './targetHealth';

/** Icono + texto: el color nunca es la única señal (spec §6.4). */
export function HealthIcon({ health }: { health: ObservedHealth }) {
  const props = { size: 12, 'aria-hidden': true, className: 'mr-1 shrink-0' } as const;
  switch (health) {
    case 'HEALTHY':
      return <CheckCircleIcon {...props} />;
    case 'DEGRADED':
      return <WarningIcon {...props} />;
    case 'UNHEALTHY':
      return <XCircleIcon {...props} />;
    case 'NOT_EVALUATED':
      return <MinusCircleIcon {...props} />;
    default:
      return <QuestionIcon {...props} />;
  }
}

export function HealthBadge({ health }: { health: ObservedHealth }) {
  return (
    <Badge tone={observedHealthTone(health)}>
      <HealthIcon health={health} />
      {observedHealthLabel(health)}
    </Badge>
  );
}

/** Fecha de la observación persistida; nunca se presenta como «en tiempo real». */
export function ObservationDate({ at, empty = 'Nunca comprobado' }: { at: string | null | undefined; empty?: string }) {
  if (!at) return <span className="text-muted">{empty}</span>;
  return (
    <span className="text-muted">
      Observado el <time dateTime={at}>{formatDateTime(at)}</time>
    </span>
  );
}

const TONE_TEXT: Record<string, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  accent: 'text-accent-deep',
  neutral: 'text-fg-2',
};
const TONE_DOT: Record<string, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent',
  neutral: 'bg-muted',
};

/** Semáforo: punto del color del estado. Decorativo: el texto del estado va al lado. */
export function HealthDot({ health }: { health: ObservedHealth }) {
  const tone = observedHealthTone(health);
  const hollow = health === 'NOT_EVALUATED' || health === 'UNKNOWN';
  return (
    <span
      aria-hidden
      data-health-dot={health}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
        hollow ? 'border-2 border-muted bg-transparent' : TONE_DOT[tone]
      }`}
    />
  );
}

/** Estado de salud en texto con icono, del color del semáforo (sin fondo). */
export function HealthText({ health }: { health: ObservedHealth }) {
  return (
    <span className={`inline-flex items-center font-semibold ${TONE_TEXT[observedHealthTone(health)]}`}>
      <HealthIcon health={health} />
      {observedHealthLabel(health)}
    </span>
  );
}

/**
 * Semáforo por entorno: una fila por entorno con punto de color, estado en
 * texto y, debajo, la fecha de la última observación. Cada entorno se resume por
 * separado y sólo con sus destinos habilitados; los demás cuentan como «No
 * evaluado».
 */
export function EnvironmentHealthList({ summaries }: { summaries: EnvironmentHealthSummary[] }) {
  if (summaries.length === 0) {
    return <p className="text-compact text-muted">Sin destinos configurados: no hay salud que observar.</p>;
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Salud observada por entorno">
      {summaries.map((s) => (
        <li
          key={s.environment ?? 'none'}
          className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2.5 text-compact"
          data-environment={s.environment ?? ''}
        >
          <span className="translate-y-px self-center">
            <HealthDot health={s.health} />
          </span>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold text-fg">{s.label}</span>
            <HealthText health={s.health} />
          </span>
          <span className="col-start-2 text-caption text-muted">
            {s.health === 'NOT_EVALUATED' ? (
              <>
                {s.total === 1 ? '1 destino' : `${s.total} destinos`} sin provisioning habilitado
              </>
            ) : (
              <>
                <ObservationDate at={s.latestCheckedAt} />
                {' · '}
                {s.evaluated} de {s.total} {s.total === 1 ? 'destino evaluado' : 'destinos evaluados'}
                {s.neverChecked > 0 ? ` · ${s.neverChecked} sin comprobar` : ''}
                {s.notEvaluated > 0 ? ` · ${s.notEvaluated} no evaluado${s.notEvaluated === 1 ? '' : 's'}` : ''}
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
