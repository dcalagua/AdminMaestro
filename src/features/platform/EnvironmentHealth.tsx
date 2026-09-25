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

/**
 * Una línea por entorno. Cada entorno se resume por separado y sólo con sus
 * destinos habilitados; los demás cuentan como «No evaluado».
 */
export function EnvironmentHealthList({ summaries }: { summaries: EnvironmentHealthSummary[] }) {
  if (summaries.length === 0) {
    return <p className="text-xs text-muted">Sin destinos configurados: no hay salud que observar.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Salud observada por entorno">
      {summaries.map((s) => (
        <li
          key={s.environment ?? 'none'}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          data-environment={s.environment ?? ''}
        >
          <span className="min-w-[88px] font-semibold text-fg">{s.label}</span>
          <HealthBadge health={s.health} />
          {s.health === 'NOT_EVALUATED' ? (
            <span className="text-muted">
              {s.total === 1 ? '1 destino' : `${s.total} destinos`} sin provisioning habilitado
            </span>
          ) : (
            <>
              <ObservationDate at={s.latestCheckedAt} />
              <span className="text-muted">
                · {s.evaluated} de {s.total} {s.total === 1 ? 'destino evaluado' : 'destinos evaluados'}
                {s.neverChecked > 0 ? ` · ${s.neverChecked} sin comprobar` : ''}
                {s.notEvaluated > 0 ? ` · ${s.notEvaluated} no evaluado${s.notEvaluated === 1 ? '' : 's'}` : ''}
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
