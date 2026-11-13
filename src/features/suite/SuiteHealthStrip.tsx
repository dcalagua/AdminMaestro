import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { WarningIcon } from '@phosphor-icons/react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import { HealthDot, HealthText } from '@/features/platform/EnvironmentHealth';
import { environmentLabel, notEvaluatedReason, observedHealthLabel } from '@/features/platform/targetHealth';
import { CHANNEL_LABEL, relativeAge, type AppHealth, type ChannelKey, type ChannelState } from './suiteModel';

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

/**
 * «Canales activos: Alta en 8 de 8 · Módulos 0 · Uso 0 · Suspensión 0».
 * Lo que es igual para todas las apps se dice UNA vez (antes, 32 insignias).
 */
export function channelSummary(items: readonly AppHealth[]): Array<{ key: ChannelKey; label: string; active: number }> {
  const keys: ChannelKey[] = ['alta', 'modulos', 'uso', 'suspension'];
  return keys.map((key) => ({
    key,
    label: CHANNEL_LABEL[key],
    active: items.filter((i) => i.channels.find((c) => c.key === key)?.active).length,
  }));
}

/** Detalle de una app (antes, una tarjeta de 300 px por app; ahora, al abrir su insignia). */
function AppHealthDetail({
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
    <article className="flex min-w-0 flex-col gap-3" data-app={app.code} aria-labelledby={`app-${app.code}`}>
      <header className="flex items-start gap-3">
        <Avatar name={app.name} ringColor={app.accent} />
        <div className="min-w-0 flex-1">
          <h3 id={`app-${app.code}`} className="truncate text-body font-semibold text-fg">
            {app.name}
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
          <span className="text-caption text-muted">{item.targets.length} entornos: el resto, en la ficha</span>
        ) : null}
      </div>
      <ChannelGrid channels={item.channels} />
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
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

/**
 * Una app en la franja: punto de salud, nombre y hace cuánto se comprobó. Al
 * pulsarla se abre su detalle (salud, canales, «Ver ficha», «Verificar ahora»)
 * en un globo; Escape o un clic fuera lo cierran y el foco vuelve a la app.
 */
function AppHealthChip({
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
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { app, primary } = item;
  const label = observedHealthLabel(item.health);
  const when = !primary ? 'Sin destino' : item.checkedAt ? relativeAge(item.checkedAt, now) : 'Nunca comprobado';

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative min-w-0" data-app-health={app.code}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${app.name}: ${label}. ${when}. Ver detalle`}
        onClick={() => {
          const rect = button.current?.getBoundingClientRect();
          const width = typeof window !== 'undefined' ? window.innerWidth : 1440;
          // El globo se fija a la ventana en móvil y, en escritorio, no se sale por la derecha.
          setStyle(
            rect && width < 640
              ? { position: 'fixed', top: rect.bottom + 6, left: 16, right: 16, width: 'auto' }
              : rect && rect.left + 340 > width
                ? { right: 0 }
                : { left: 0 },
          );
          setOpen((v) => !v);
        }}
        className={`flex h-full w-full min-w-0 flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors duration-fast ease-out hover:bg-hover focus-visible:relative focus-visible:z-[1] ${
          open ? 'bg-accent-soft hover:bg-accent-soft' : ''
        }`}
      >
        <span className="flex min-w-0 max-w-full items-center gap-1.5">
          <HealthDot health={item.health} />
          <span className="truncate text-compact font-semibold text-fg">{app.name}</span>
        </span>
        <span
          className={`flex min-w-0 max-w-full items-center gap-1 text-caption ${primary && item.stale ? 'text-warn' : 'text-muted'}`}
          data-stale={primary ? (item.stale ? 'true' : 'false') : undefined}
        >
          {primary && item.stale ? <WarningIcon size={11} aria-hidden className="shrink-0" /> : null}
          <span className="truncate">
            {item.health === 'HEALTHY' || !primary ? when : `${label} · ${when}`}
          </span>
        </span>
      </button>
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label={`Salud de ${app.name}`}
          style={style}
          className="absolute top-full z-30 mt-1.5 w-[min(340px,calc(100vw-32px))] rounded-field border border-border bg-elevated p-4 shadow-pop"
        >
          <AppHealthDetail item={item} canCheck={canCheck} checking={checking} onCheck={onCheck} now={now} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Franja de salud de las apps (V6 · F2, plan §3.3): una fila compacta con las
 * 8 apps (punto de salud y «hace 2 h»), la línea de canales una sola vez y el
 * detalle por app en un globo. Antes eran 8 tarjetas idénticas de unos 600 px
 * con 8 botones «Verificar ahora» y la matriz quedaba bajo el pliegue.
 */
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
  const channels = channelSummary(items);
  return (
    <section aria-labelledby="suite-health-title" className="ebim-card mb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2.5">
        <h2 id="suite-health-title" className="text-compact font-semibold text-fg">
          Salud de las apps
          <span className="ml-2 text-caption font-normal text-muted max-sm:hidden">
            Última comprobación guardada, no monitoreo en tiempo real
            {stale > 0 ? ` · ${stale} de ${items.length} con más de 24 h` : ''}
          </span>
        </h2>
        {items.length > 0 ? (
          <p className="text-caption text-muted" data-channel-summary>
            Canales activos:{' '}
            {channels.map((c, i) => (
              <span key={c.key} data-channel-count={c.key}>
                {i > 0 ? ' · ' : null}
                <span className={c.active > 0 ? 'font-semibold text-fg-2' : undefined}>
                  {c.key === 'alta' ? `${c.label} en ${c.active} de ${items.length}` : `${c.label} ${c.active}`}
                </span>
              </span>
            ))}
          </p>
        ) : null}
      </div>
      {loading ? (
        <div className="-ml-px -mt-px grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 [&>*]:border-l [&>*]:border-t [&>*]:border-border" aria-busy="true">
          <span className="sr-only" role="status">
            Leyendo la salud de las apps…
          </span>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="px-3 py-2.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-1.5 h-3 w-14" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : items.length === 0 ? (
        <EmptyState title="Sin apps visibles" description="Tu perfil no ve ninguna app de la suite." illustration="none" />
      ) : (
        <div
          // Separadores con bordes (no `gap` sobre fondo): el globo de detalle no queda recortado.
          className="-ml-px -mt-px grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1 [&>*]:border-l [&>*]:border-t [&>*]:border-border"
          data-health-strip
        >
          {items.map((item) => (
            <AppHealthChip
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
