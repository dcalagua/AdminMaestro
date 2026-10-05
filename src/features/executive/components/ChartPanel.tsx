import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChartBarIcon, TableIcon } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/primitives';
import type { DataState } from '../dataState';
import { PartialNote, StateMessage } from './StateView';

/**
 * Contenedor común de gráficos (spec §6.5 / §7.4, AC14; VISUAL_SYSTEM_V2 §5.5 y §6).
 *
 * Obliga a declarar: título-pregunta, unidad, período o foto, fuente y cobertura;
 * ofrece SIEMPRE la tabla alternativa (con los mismos datos y enlaces) y el
 * enlace al detalle que compone la cifra. Los estados no listos se explican; un
 * gráfico vacío por error nunca aparece como «cero». Al cargar muestra un
 * skeleton con la forma del gráfico; al refrescar (`refreshing`) conserva el
 * dibujo anterior atenuado, sin saltos.
 */
export function ChartPanel({
  title,
  unit,
  period,
  source,
  coverage,
  state,
  chart,
  table,
  detailHref,
  detailLabel = 'Abrir detalle',
  controls,
  legend,
  onRetry,
  emptyText,
  refreshing = false,
  className = '',
  id,
}: {
  title: string;
  unit: string;
  period: string;
  source: string;
  coverage?: string;
  state: DataState<unknown>;
  chart: () => ReactNode;
  table: () => ReactNode;
  detailHref?: string;
  detailLabel?: string;
  controls?: ReactNode;
  /** Leyenda (≥ 2 series), arriba a la izquierda bajo el título (§6.3). */
  legend?: ReactNode;
  onRetry?: () => void;
  emptyText?: string;
  refreshing?: boolean;
  className?: string;
  id?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const headingId = useId();
  const ready = state.status === 'ready' || state.status === 'partial';

  return (
    <section id={id} className={`ebim-card flex h-full min-w-0 flex-col ${className}`} aria-labelledby={headingId} data-panel={id}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pb-2 pt-4">
        <div className="min-w-0">
          <h3 id={headingId} className="text-h3 text-fg">
            {title}
          </h3>
          <p className="mt-0.5 text-caption text-muted">
            {unit} · {period}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          {ready ? (
            <div role="group" aria-label="Vista" className="inline-flex rounded-field border border-border p-0.5">
              <button
                type="button"
                aria-pressed={view === 'chart'}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption font-semibold transition-colors duration-fast ${
                  view === 'chart' ? 'bg-accent-soft text-accent-deep' : 'text-muted hover:text-fg'
                }`}
                onClick={() => setView('chart')}
              >
                <ChartBarIcon size={14} aria-hidden /> Gráfico
              </button>
              <button
                type="button"
                aria-pressed={view === 'table'}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption font-semibold transition-colors duration-fast ${
                  view === 'table' ? 'bg-accent-soft text-accent-deep' : 'text-muted hover:text-fg'
                }`}
                onClick={() => setView('table')}
              >
                <TableIcon size={14} aria-hidden /> Tabla
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <div className="min-w-0 flex-1 px-5 pb-4 pt-2">
        {ready ? (
          <div className={`transition-opacity duration-fast ${refreshing ? 'opacity-50' : ''}`} aria-busy={refreshing || undefined}>
            {state.status === 'partial' ? <PartialNote reasons={state.reasons} /> : null}
            {legend && view === 'chart' ? <div className="mb-2">{legend}</div> : null}
            {view === 'chart' ? chart() : <div className="relative max-h-[420px] overflow-auto">{table()}</div>}
          </div>
        ) : state.status === 'loading' ? (
          <div aria-busy="true">
            <span role="status" className="sr-only">
              Cargando gráfico…
            </span>
            <ChartSkeleton />
          </div>
        ) : (
          <StateMessage state={state} onRetry={onRetry} emptyText={emptyText} />
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 rounded-b-card border-t border-border bg-sunken px-5 py-2.5 text-caption text-muted">
        <span>
          Fuente: <span className="font-mono">{source}</span>
          {coverage ? ` · ${coverage}` : ''}
        </span>
        {detailHref ? (
          <Link className="ebim-link text-caption font-semibold" to={detailHref}>
            {detailLabel} <span aria-hidden>→</span>
          </Link>
        ) : null}
      </footer>
    </section>
  );
}

/** Forma de un gráfico de barras mientras carga (§5.12). */
export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div aria-hidden data-chart-skeleton>
      <div className="flex items-end gap-3 border-b border-border" style={{ height }}>
        {[45, 60, 52, 70, 64, 82, 76, 90].map((h, i) => (
          <Skeleton key={i} className="flex-1 rounded-b-none" style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="mt-2 flex justify-between">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-2.5 w-8" />
        ))}
      </div>
    </div>
  );
}

/** Leyenda de series: muestra 10×10 `rounded-sm` + nombre en `--text-2` (§6.3). */
export function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-compact text-fg-2">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Selector de moneda para gráficos: nunca se mezclan monedas en un eje. */
export function CurrencyPicker({
  currencies,
  value,
  onChange,
  label = 'Moneda del gráfico',
  showLabel = false,
}: {
  currencies: string[];
  value: string;
  onChange: (c: string) => void;
  label?: string;
  /** Etiqueta visible (fila de filtros de la página) en vez de solo para lector de pantalla. */
  showLabel?: boolean;
}) {
  if (currencies.length <= 1 && !showLabel) {
    return currencies[0] ? <span className="text-caption font-semibold text-muted">{currencies[0]}</span> : null;
  }
  return (
    <label className={showLabel ? 'flex flex-col gap-1.5' : 'flex items-center gap-1 text-caption text-muted'}>
      <span className={showLabel ? 'text-micro text-muted' : 'sr-only'}>{label}</span>
      <select
        className={
          showLabel
            ? 'ebim-input h-9 min-w-[112px]'
            : 'rounded-field border border-border-strong bg-card px-2 py-1 text-caption text-fg'
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {currencies.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}
