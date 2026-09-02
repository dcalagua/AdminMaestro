import type { ReactNode } from 'react';

/* ==========================================================================
   Primitivos de UI del Control Plane.

   Deliberadamente pequeños: el objetivo es que las pantallas se lean igual
   entre sí, no construir una librería. Los colores salen SIEMPRE de tokens
   (`src/app/tokens.css`) para soportar theming/white-label — contrato §4.3.
   ========================================================================== */

export function PageContainer({
  title,
  description,
  actions,
  breadcrumbs,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 py-6">
      {breadcrumbs ? <div className="mb-3">{breadcrumbs}</div> : null}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-fg">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ebim-card ${className}`}>
      {title ? (
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-fg">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Tarjeta de KPI. `value` siempre es un dato ya formateado. */
export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'danger';
}) {
  const toneClass = {
    neutral: 'text-fg',
    ok: 'text-ok',
    warn: 'text-warn',
    danger: 'text-danger',
  }[tone];

  return (
    <div className="ebim-card p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'bg-[color:var(--border)] text-fg',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
    // `accent-deep` y no `accent`: regla AA del contrato §4.4 para TEXTO.
    accent: 'bg-accent-soft text-accent-deep',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/* ---- Estados de pantalla (contrato/DESIGN-BRIEF: vacío, carga, error) ---- */

export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-14 text-sm text-muted">
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent"
        aria-hidden
      />
      <span role="status">{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-14 text-center">
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
  return (
    <div className="px-4 py-12 text-center" role="alert">
      <p className="text-sm font-semibold text-danger">No se pudo cargar la información</p>
      <p className="mx-auto mt-1 max-w-lg text-sm text-muted">{message}</p>
      {onRetry ? (
        <button type="button" className="ebim-btn-ghost mt-4" onClick={onRetry}>
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

/**
 * Buscador único de listados — contrato §8 / regla `esupplier-022`.
 *
 * DELIBERADAMENTE no acepta filtros multi-campo: un solo campo de búsqueda
 * general cubre ~90% de los casos y evita fragmentar la pantalla. Los tabs de
 * estado sí están permitidos y viven en `SectionTabs`.
 */
export function SearchBar({
  value,
  onChange,
  placeholder = 'Buscar…',
  right,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <div className="relative min-w-[240px] flex-1">
        <input
          type="search"
          className="ebim-input pl-9"
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden
        >
          <circle cx="9" cy="9" r="6" />
          <path d="m17 17-3.6-3.6" strokeLinecap="round" />
        </svg>
      </div>
      {right}
    </div>
  );
}

export function DataTable({
  columns,
  children,
}: {
  columns: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead className="border-b border-border bg-[color:var(--bg)]">
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className="ebim-th">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
