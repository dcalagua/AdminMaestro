import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ProhibitIcon, WarningCircleIcon, InfoIcon, ClockCountdownIcon } from '@phosphor-icons/react';
import type { DataState } from '../dataState';
import { formatCurrencyMap, formatDateTime } from '@/lib/format';
import type { CurrencyAmounts } from '../reportContext';

/**
 * Presentación de `DataState` (spec §9.2, AC11). Cada estado tiene texto + icono
 * propios: el color nunca es la única señal y un error jamás se ve como «0».
 */
export function StateMessage({
  state,
  compact = false,
  onRetry,
  emptyText = 'Sin actividad en este alcance',
}: {
  state: DataState<unknown>;
  compact?: boolean;
  onRetry?: () => void;
  emptyText?: string;
}) {
  const pad = compact ? 'py-2' : 'py-6';
  switch (state.status) {
    case 'loading':
      return (
        <div className={`${pad} animate-pulse`} role="status" aria-label="Cargando">
          <div className="h-5 w-2/3 rounded bg-border" />
          {compact ? null : <div className="mt-2 h-3 w-1/2 rounded bg-border" />}
        </div>
      );
    case 'error':
      return (
        <div className={`${pad} flex items-start gap-2 text-sm text-danger`} role="alert">
          <WarningCircleIcon size={18} aria-hidden className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">No se pudo leer este dato</p>
            <p className="text-xs text-muted">{state.message}</p>
            {onRetry ? (
              <button type="button" className="ebim-link mt-1 text-xs" onClick={onRetry}>
                Reintentar lectura
              </button>
            ) : null}
          </div>
        </div>
      );
    case 'forbidden':
      return (
        <p className={`${pad} flex items-center gap-2 text-sm text-muted`}>
          <ProhibitIcon size={18} aria-hidden /> Sin acceso con tu perfil
        </p>
      );
    case 'unavailable':
      return (
        <p className={`${pad} flex items-start gap-2 text-sm text-muted`}>
          <InfoIcon size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold text-fg">No disponible.</span> {state.reason}
          </span>
        </p>
      );
    case 'empty':
      return <p className={`${pad} text-sm text-muted`}>{emptyText}</p>;
    default:
      return null;
  }
}

/** Aviso de cobertura parcial: se muestra JUNTO al dato, nunca en su lugar. */
export function PartialNote({ reasons }: { reasons: string[] }) {
  return (
    <p className="mt-1 flex items-start gap-1.5 text-[11px] font-semibold text-warn">
      <ClockCountdownIcon size={14} aria-hidden className="mt-px shrink-0" />
      <span>Parcial: {reasons.join(' · ')}</span>
    </p>
  );
}

/** Importes por moneda nativa, una línea por moneda (sin sumar monedas). */
export function CurrencyLines({ amounts, emptyLabel = 'Sin movimientos' }: { amounts: CurrencyAmounts; emptyLabel?: string }) {
  const entries = Object.entries(amounts).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return <span className="text-base font-semibold text-muted">{emptyLabel}</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {entries.map(([currency, amount]) => (
        <span key={currency} className={`tabular-nums ${amount < 0 ? 'text-danger' : ''}`}>
          {formatCurrencyMap({ [currency]: amount })}
        </span>
      ))}
    </span>
  );
}

/**
 * Tarjeta KPI (spec §6.5): nombre, valor, temporalidad (foto/período),
 * calidad/cobertura y acceso al detalle que compone la cifra.
 */
export function KpiCard({
  id,
  label,
  temporality,
  state,
  render,
  hint,
  detailHref,
  detailLabel = 'Ver detalle',
  onRetry,
  footer,
}: {
  id: string;
  label: string;
  temporality: string;
  state: DataState<unknown>;
  render: () => ReactNode;
  hint?: string;
  detailHref?: string;
  detailLabel?: string;
  onRetry?: () => void;
  footer?: ReactNode;
}) {
  const observed = state.status === 'ready' ? state.observedAt : undefined;
  return (
    <section className="ebim-card flex min-w-0 flex-col p-4" aria-labelledby={`kpi-${id}`} data-kpi={id}>
      <div className="flex items-start justify-between gap-2">
        <h3 id={`kpi-${id}`} className="text-[11px] font-bold uppercase tracking-wider text-muted">
          {label}
        </h3>
        <span className="shrink-0 rounded-full bg-[color:var(--bg)] px-2 py-0.5 text-[10.5px] font-semibold text-muted">
          {temporality}
        </span>
      </div>
      <div className="mt-2 min-h-[56px] text-xl font-bold text-fg">
        {state.status === 'ready' || state.status === 'partial' ? (
          <>
            {render()}
            {state.status === 'partial' ? <PartialNote reasons={state.reasons} /> : null}
          </>
        ) : (
          <StateMessage state={state} compact onRetry={onRetry} />
        )}
      </div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {footer}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs">
        {observed ? <span className="text-muted">Leído {formatDateTime(observed)}</span> : <span />}
        {detailHref ? (
          <Link className="ebim-link" to={detailHref}>
            {detailLabel} <span aria-hidden>→</span>
          </Link>
        ) : null}
      </div>
    </section>
  );
}
