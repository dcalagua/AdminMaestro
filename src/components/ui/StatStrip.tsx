import { Children, isValidElement, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircleIcon,
  InfoIcon,
  WarningCircleIcon,
  WarningIcon,
  WarningOctagonIcon,
} from '@phosphor-icons/react';
import { formatCompactAmount, formatMoney } from '@/lib/format';
import { StatStripContext, type StatStripVariant } from './statStripContext';
import { autoTitle } from './autoTitle';
import { useIsMobile } from '@/hooks/useMediaQuery';

export type { StatStripVariant } from './statStripContext';

/* ==========================================================================
   V6 · T2 · Franja de cifras compacta (`StatStrip` + `StatCell`).

   Una sola `ebim-card` de ~72 px con 3 a 6 celdas separadas por un hairline:
   etiqueta `text-micro`, cifra `text-h2` y una línea de contexto
   `text-caption`. En móvil, 2 columnas; desde `lg`, todas en una fila.
   Cada celda puede filtrar la tabla de abajo (`onSelect` + `selected`) o
   navegar (`to`).

   Sustituye a la rejilla de `KpiTile` de 120–148 px en los listados. Las
   tarjetas grandes con sparkline quedan para las pantallas donde la tendencia
   aporta (Resumen ejecutivo, Facturación, Costos, Comisiones):
   `<StatStrip variant="tiles">` (alias histórico: `KpiStrip`).

   Compatibilidad: un `KpiTile` (o `NativeAmountTile`) dentro de una franja
   `band` se pinta solo como `StatCell`, así las 28 pantallas que ya usaban
   `KpiStrip` se compactan sin tocarlas. Para una pantalla nueva se usa
   `StatCell` directamente.

   Este archivo no importa `primitives.tsx` (que sí lo importa a él).
   ========================================================================== */

export type StatTone = 'neutral' | 'ok' | 'warn' | 'danger';

export interface StatStripProps {
  /** Nombre accesible de la franja («Resumen de cuentas»). */
  label: string;
  /** `StatCell` (o `KpiTile`): de 3 a 6. Los `null`/`false` no cuentan. */
  children: ReactNode;
  /**
   * `band` (por defecto): banda compacta de ~72 px.
   * `tiles`: rejilla de `KpiTile` grandes (con sparkline), para tendencias.
   */
  variant?: StatStripVariant;
  className?: string;
}

/**
 * Franja de cifras de negocio bajo la cabecera de un listado.
 *
 * @example
 * <StatStrip label="Resumen de cuentas">
 *   <StatCell label="Clientes activos" value="21" onSelect={() => setTab('ACTIVE')} selected={tab === 'ACTIVE'} />
 *   <StatCell label="MRR vigente" amounts={{ USD: 22700, PEN: 3200 }} />
 *   <StatCell label="Saldo vencido" amounts={overdue} context="7 facturas" tone="warn" />
 * </StatStrip>
 */
export function StatStrip({ label, children, variant = 'band', className = '' }: StatStripProps) {
  // V6 · F5: en móvil las tarjetas con sparkline (≈170 px cada una, en una
  // columna) empujaban la tabla dos pantallas abajo: ahí se pintan como banda.
  const mobile = useIsMobile();
  if (variant === 'tiles' && !mobile) {
    return (
      <StatStripContext.Provider value="tiles">
        <section
          aria-label={label}
          className={`mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4 ${className}`}
          data-kpi-strip
          data-stat-strip="tiles"
        >
          {children}
        </section>
      </StatStripContext.Provider>
    );
  }
  const count = Math.min(6, Math.max(1, Children.toArray(children).filter(isValidElement).length));
  return (
    <StatStripContext.Provider value="band">
      <section
        aria-label={label}
        className={`ebim-card mb-5 overflow-hidden ${className}`}
        data-kpi-strip
        data-stat-strip="band"
      >
        {/* El hairline entre celdas es el fondo `--border` asomando por `gap-px`.
            En móvil (2 columnas) la última celda impar ocupa la fila entera. */}
        <div
          className="grid grid-cols-2 gap-px bg-border lg:[grid-template-columns:repeat(var(--stat-cols),minmax(0,1fr))] [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1"
          style={{ '--stat-cols': count } as CSSProperties}
        >
          {children}
        </div>
      </section>
    </StatStripContext.Provider>
  );
}

/** Alias histórico (V5): `KpiStrip` = `StatStrip`. Las pantallas con tendencia pasan `variant="tiles"`. */
export const KpiStrip = StatStrip;

const TONE_ICON: Record<Exclude<StatTone, 'neutral'>, { Icon: typeof CheckCircleIcon; cls: string; sr: string }> = {
  ok: { Icon: CheckCircleIcon, cls: 'text-ok', sr: 'En buen estado' },
  warn: { Icon: WarningIcon, cls: 'text-warn', sr: 'Requiere atención' },
  danger: { Icon: WarningOctagonIcon, cls: 'text-danger', sr: 'Crítico' },
};

export interface StatCellProps {
  /** Etiqueta corta («Saldo vencido»). Se pinta en `text-micro`. */
  label: string;
  /**
   * Cifra YA formateada («21», «10 de 16»). `null`/`undefined`/`''`/`'—'` =
   * sin dato: se dice «Sin datos» atenuado, nunca un 0.
   */
  value?: ReactNode;
  /**
   * Alternativa a `value` para dinero multimoneda: importes compactos seguidos
   * (`PEN 3.2 K  USD 22.7 K`), cada uno con su monto completo en el `title`;
   * si no caben, el siguiente baja entero de línea (nunca se corta).
   * Nunca se suman monedas. Un mapa vacío = `emptyLabel`.
   */
  amounts?: Record<string, number | string> | null;
  /** Código ISO como prefijo pequeño de `value` (`USD` **50.1 K**). */
  currency?: string;
  /** Línea de contexto bajo la cifra («7 facturas · la más antigua 45 días»). Una línea. */
  context?: ReactNode;
  /** Texto cuando no hay dato (por defecto «Sin datos»; p. ej. «Nada vencido»). */
  emptyLabel?: string;
  /** Estado semántico: icono junto a la etiqueta; la cifra NO se colorea (A09). */
  tone?: StatTone;
  /** Definición de la cifra (tooltip nativo + texto para lector de pantalla). */
  info?: string;
  /** La celda filtra la tabla: se pinta como botón con `aria-pressed`. */
  onSelect?: () => void;
  /** Filtro activo (con `onSelect`). */
  selected?: boolean;
  /** La celda navega (alternativa a `onSelect`). */
  to?: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

/** Importes por moneda en orden alfabético, sin ceros ni valores no numéricos. */
function moneyEntries(map: Record<string, number | string> | null): Array<[string, number]> {
  return Object.entries(map ?? {})
    .map(([code, amount]) => [code, Number(amount)] as [string, number])
    .filter(([, amount]) => Number.isFinite(amount) && amount !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

function isEmptyValue(value: ReactNode): boolean {
  return value === null || value === undefined || value === '' || value === '—';
}

/**
 * Celda de `StatStrip`: etiqueta → cifra → contexto, en ~72 px.
 * Accesible sin color: el tono va como icono con texto oculto.
 */
export function StatCell({
  label,
  value,
  amounts,
  currency,
  context,
  emptyLabel = 'Sin datos',
  tone = 'neutral',
  info,
  onSelect,
  selected = false,
  to,
  loading,
  error,
  onRetry,
  className = '',
}: StatCellProps) {
  const interactive = Boolean((onSelect || to) && !loading && !error);
  const base = `flex min-w-0 flex-col justify-start bg-card px-4 py-3 text-left ${className}`;
  const status = tone !== 'neutral' ? TONE_ICON[tone] : null;

  const head = (
    <span className="flex min-w-0 items-center gap-1.5 text-micro text-muted">
      {/* V6 · F5: en móvil (2 columnas) la etiqueta ocupa hasta 2 líneas en vez de «ALERTAS CRÍTIC…». */}
      <span className="min-w-0 line-clamp-2 break-words lg:block lg:truncate" title={label}>
        {label}
      </span>
      {info ? (
        <span className="inline-flex shrink-0 cursor-help" title={info}>
          <InfoIcon size={13} aria-hidden />
          <span className="sr-only">{info}</span>
        </span>
      ) : null}
      {status ? (
        <span className={`ml-auto inline-flex shrink-0 ${status.cls}`}>
          <status.Icon size={14} weight="fill" aria-hidden />
          <span className="sr-only">{status.sr}</span>
        </span>
      ) : null}
    </span>
  );

  let body: ReactNode;
  if (loading) {
    body = (
      <span className="mt-1.5 block" aria-busy="true">
        <span className="sr-only" role="status">
          Cargando {label}…
        </span>
        <span className="ebim-skeleton block h-5 w-2/3" aria-hidden />
        <span className="ebim-skeleton mt-1.5 block h-3 w-1/3 opacity-70" aria-hidden />
      </span>
    );
  } else if (error) {
    body = (
      <span className="mt-1 flex flex-wrap items-baseline gap-x-2 text-compact" role="alert">
        <span className="inline-flex items-center gap-1 font-semibold text-fg">
          <WarningCircleIcon size={15} className="text-danger" aria-hidden />
          No disponible
        </span>
        {onRetry ? (
          <button type="button" className="ebim-link text-caption" onClick={onRetry}>
            Reintentar
          </button>
        ) : null}
      </span>
    );
  } else {
    const money = amounts !== undefined ? moneyEntries(amounts) : null;
    const empty = money !== null ? money.length === 0 : isEmptyValue(value);
    const long = money !== null && money.length > 2;
    body = (
      <>
        {empty ? (
          <span className="mt-0.5 flex items-baseline gap-1.5 text-body text-muted" data-kpi-empty>
            <span aria-hidden>—</span>
            <span>{emptyLabel}</span>
          </span>
        ) : money ? (
          // Todas las monedas seguidas; si no caben, cada importe pasa entero a la línea
          // siguiente (nunca «USD …» cortado). Cada uno con su monto completo en el `title`.
          <span
            className={`mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-3 tabular-nums text-fg ${long ? 'text-h3' : 'text-h2'}`}
            data-stat-value
          >
            {money.map(([code, amount]) => (
              <span key={code} className="whitespace-nowrap" title={formatMoney(amount, code)}>
                <span className="text-caption font-semibold text-muted">{code}</span> {formatCompactAmount(amount)}
              </span>
            ))}
          </span>
        ) : (
          <span
            className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-fg"
            title={typeof value === 'string' ? value : undefined}
            data-stat-value
          >
            {currency ? <span className="text-caption font-semibold text-muted">{currency}</span> : null}
            <span className="min-w-0 truncate text-h2 tabular-nums">{value}</span>
          </span>
        )}
        {context ? (
          <span
            className="mt-0.5 min-w-0 line-clamp-2 text-caption text-muted lg:block lg:truncate"
            title={typeof context === 'string' ? context : undefined}
            ref={typeof context === 'string' ? undefined : autoTitle}
          >
            {context}
          </span>
        ) : null}
      </>
    );
  }

  const content = (
    <>
      {head}
      {body}
    </>
  );

  if (interactive && onSelect) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        data-stat-cell={label}
        className={`${base} transition-colors duration-fast ease-out hover:bg-hover focus-visible:relative focus-visible:z-[1] ${
          selected ? 'bg-accent-soft [box-shadow:inset_0_-2px_0_var(--accent-deep)] hover:bg-accent-soft' : ''
        }`}
      >
        {content}
      </button>
    );
  }
  if (interactive && to) {
    return (
      <Link
        to={to}
        data-stat-cell={label}
        className={`${base} transition-colors duration-fast ease-out hover:bg-hover focus-visible:relative focus-visible:z-[1]`}
      >
        {content}
      </Link>
    );
  }
  return (
    <div className={base} data-stat-cell={label}>
      {content}
    </div>
  );
}
