import { Link } from 'react-router-dom';
import { WarningIcon } from '@phosphor-icons/react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import { HealthDot, HealthText } from '@/features/platform/EnvironmentHealth';
import { environmentLabel, notEvaluatedReason } from '@/features/platform/targetHealth';
import { relativeAge, type AppHealth, type ChannelState } from './suiteModel';

/**
 * Cuándo se observó la salud por última vez, en tiempo relativo y con la fecha
 * exacta al lado. Más de 24 h: aviso visible (icono + texto, no sólo color).
 */
export function LastCheck({ at, stale, now }: { at: string | null; stale: boolean; now?: Date }) {
  if (!at) {
    return (
      <span className="inline-flex items-center gap-1 text-caption text-warn" data-stale="true">
        <WarningIcon size={12} aria-hidden />
        Nunca comprobado
      </span>
    );
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1 text-caption ${stale ? 'text-warn' : 'text-muted'}`} data-stale={stale ? 'true' : 'false'}>
      {stale ? <WarningIcon size={12} aria-hidden /> : null}
      <span>
        Comprobado <time dateTime={at} title={formatDateTime(at)}>{relativeAge(at, now)}</time>
      </span>
      {stale ? <span>· observación de hace más de 24 h</span> : null}
    </span>
  );
}

/** Los cuatro canales de una app, con el estado en texto; el porqué va al pasar el puntero y en la ficha. */
export function ChannelGrid({ channels }: { channels: ChannelState[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-2" aria-label="Canales con la app">
      {channels.map((c) => (
        <li key={c.key} className="flex min-w-0 flex-col items-start gap-0.5 text-caption" data-channel={c.key} data-active={c.active ? 'true' : 'false'}>
          <span className="text-muted">{c.label}</span>
          <span title={c.detail}>
            <Badge tone={c.tone}>{c.status}</Badge>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AppHealthCard({
  item,
  canCheck,
  checking,
  onCheck,
  now,
}: {
  item: AppHealth;
  canCheck: boolean;
  checking: boolean;
  onCheck: () => void;
  now?: Date;
}) {
  const { app, primary } = item;
  const reason = primary ? notEvaluatedReason(primary) : null;
  return (
    <article className="ebim-card flex min-w-0 flex-col gap-3 p-4" data-app={app.code} aria-labelledby={`app-${app.code}`}>
      <header className="flex items-start gap-3">
        <Avatar name={app.name} ringColor={app.accent} />
        <div className="min-w-0 flex-1">
          <h3 id={`app-${app.code}`} className="truncate text-body font-semibold text-fg">
            <Link to={`/apps/${app.code}`} className="hover:text-accent-deep hover:underline">
              {app.name}
            </Link>
          </h3>
          <p className="flex flex-wrap gap-x-1.5 text-caption text-muted">
            <span>{primary ? environmentLabel(item.environment) : 'Sin destino'}</span>
            {item.contractVersion ? <span>· contrato de alta {item.contractVersion}</span> : null}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1.5 text-compact">
          <HealthDot health={item.health} />
          <HealthText health={item.health} />
          {reason ? <span className="text-caption font-normal text-muted">· {reason}</span> : null}
        </span>
        {primary ? <LastCheck at={item.checkedAt} stale={item.stale} now={now} /> : null}
        {item.targets.length > 1 ? (
          <span className="text-caption text-muted">
            {item.targets.length} entornos: el resto, en la ficha
          </span>
        ) : null}
      </div>

      <ChannelGrid channels={item.channels} />

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <Link to={`/apps/${app.code}`} className="ebim-link text-compact">
          Ver ficha
        </Link>
        {canCheck && primary?.deployment_target_id ? (
          <button
            type="button"
            className="ebim-btn-secondary ebim-btn-sm"
            disabled={checking}
            aria-busy={checking || undefined}
            aria-label={`Verificar ahora ${app.name}`}
            onClick={onCheck}
          >
            {checking ? 'Verificando…' : 'Verificar ahora'}
          </button>
        ) : null}
      </footer>
    </article>
  );
}

export function SuiteHealthStrip({
  items,
  loading,
  error,
  onRetry,
  canCheck,
  isChecking,
  onCheck,
  now,
}: {
  items: AppHealth[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  canCheck: (productId: string) => boolean;
  /** ¿Hay una verificación en curso para este destino? */
  isChecking: (targetId: string | null | undefined) => boolean;
  onCheck: (item: AppHealth) => void;
  now?: Date;
}) {
  const stale = items.filter((i) => i.primary && i.stale).length;
  return (
    <section aria-labelledby="suite-health-title" className="mb-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="suite-health-title" className="text-h3 text-fg">
          Salud de las apps
        </h2>
        <p className="text-caption text-muted">
          Última comprobación guardada, no monitoreo en tiempo real.
          {stale > 0 ? ` ${stale} de ${items.length} con observación de hace más de 24 h.` : ''}
        </p>
      </div>
      {loading ? (
        <LoadingState variant="kpis" label="Leyendo la salud de las apps…" />
      ) : error ? (
        <div className="ebim-card">
          <ErrorState error={error} onRetry={onRetry} />
        </div>
      ) : items.length === 0 ? (
        <div className="ebim-card">
          <EmptyState title="Sin apps visibles" description="Tu perfil no ve ninguna app de la suite." illustration="none" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-health-strip>
          {items.map((item) => (
            <AppHealthCard
              key={item.app.id}
              item={item}
              canCheck={canCheck(item.app.id)}
              checking={isChecking(item.primary?.deployment_target_id)}
              onCheck={() => onCheck(item)}
              now={now}
            />
          ))}
        </div>
      )}
    </section>
  );
}
