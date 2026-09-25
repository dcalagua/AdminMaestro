import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChartBarIcon, TableIcon } from '@phosphor-icons/react';
import type { DataState } from '../dataState';
import { PartialNote, StateMessage } from './StateView';

/**
 * Contenedor común de gráficos (spec §6.5 / §7.4, AC14).
 *
 * Obliga a declarar: título-pregunta, unidad, período o foto, fuente y cobertura;
 * ofrece SIEMPRE la tabla alternativa (con los mismos datos y enlaces) y el
 * enlace al detalle que compone la cifra. Los estados no listos se explican; un
 * gráfico vacío por error nunca aparece como «cero».
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
  onRetry,
  emptyText,
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
  onRetry?: () => void;
  emptyText?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const headingId = useId();
  const ready = state.status === 'ready' || state.status === 'partial';

  return (
    <section className="ebim-card flex min-w-0 flex-col" aria-labelledby={headingId}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-sm font-bold text-fg">
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
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
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${
                  view === 'chart' ? 'bg-accent-soft text-accent-deep' : 'text-muted'
                }`}
                onClick={() => setView('chart')}
              >
                <ChartBarIcon size={14} aria-hidden /> Gráfico
              </button>
              <button
                type="button"
                aria-pressed={view === 'table'}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${
                  view === 'table' ? 'bg-accent-soft text-accent-deep' : 'text-muted'
                }`}
                onClick={() => setView('table')}
              >
                <TableIcon size={14} aria-hidden /> Tabla
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <div className="min-w-0 flex-1 px-4 py-3">
        {ready ? (
          <>
            {state.status === 'partial' ? <PartialNote reasons={state.reasons} /> : null}
            {view === 'chart' ? chart() : <div className="relative overflow-x-auto">{table()}</div>}
          </>
        ) : (
          <StateMessage state={state} onRetry={onRetry} emptyText={emptyText} />
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-[11px] text-muted">
        <span>
          Fuente: <span className="font-mono">{source}</span>
          {coverage ? ` · ${coverage}` : ''}
        </span>
        {detailHref ? (
          <Link className="ebim-link text-xs" to={detailHref}>
            {detailLabel} <span aria-hidden>→</span>
          </Link>
        ) : null}
      </footer>
    </section>
  );
}

/** Selector de moneda para gráficos: nunca se mezclan monedas en un eje. */
export function CurrencyPicker({
  currencies,
  value,
  onChange,
}: {
  currencies: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  if (currencies.length <= 1) {
    return currencies[0] ? <span className="text-xs font-semibold text-muted">{currencies[0]}</span> : null;
  }
  return (
    <label className="flex items-center gap-1 text-xs text-muted">
      <span className="sr-only">Moneda del gráfico</span>
      <select
        className="rounded-field border border-border bg-card px-2 py-1 text-xs text-fg"
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
