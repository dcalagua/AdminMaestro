import { Badge } from '@/components/ui/primitives';
import type { Tone } from '@/lib/provisioning';
import { appChipText, type UserAppAccess } from './userAppAccess';

/** Tono del chip: normal en `info`; el estado del tenant solo colorea si pide atención. */
function chipTone(app: UserAppAccess): 'info' | 'warn' | 'danger' {
  const t: Tone | undefined = app.attention?.tone;
  return t === 'danger' ? 'danger' : t === 'warn' ? 'warn' : 'info';
}

/**
 * V5 · F6 · Chips «App · rol» de las apps a las que entra una persona (listado
 * de usuarios). El texto lleva el significado (rol y, si pide atención, el
 * estado del tenant); el color solo lo refuerza.
 */
export function AppAccessChips({ apps, max = 4 }: { apps: UserAppAccess[]; max?: number }) {
  const active = apps.filter((a) => a.active);
  if (active.length === 0) return <span className="text-caption text-muted">Sin apps</span>;
  const shown = active.slice(0, max);
  const rest = active.length - shown.length;
  return (
    <ul className="flex max-w-[360px] flex-wrap gap-1" aria-label="Apps a las que entra" data-app-chips>
      {shown.map((a) => (
        <li key={a.key}>
          <Badge tone={chipTone(a)} title={a.attention?.help}>
            {appChipText(a)}
          </Badge>
        </li>
      ))}
      {rest > 0 ? (
        <li>
          <Badge tone="neutral" title={active.slice(max).map(appChipText).join(', ')}>
            +{rest}
          </Badge>
        </li>
      ) : null}
    </ul>
  );
}
