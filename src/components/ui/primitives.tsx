import { Children, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  ArrowClockwiseIcon,
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CaretDownIcon,
  CaretRightIcon,
  CaretUpDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  InfoIcon,
  MinusIcon,
  WarningCircleIcon,
  WarningIcon,
  WarningOctagonIcon,
} from '@phosphor-icons/react';
import { SearchField } from './fields';
import { Sparkline } from './Sparkline';
import { TablePager } from './TablePager';
import { PAGE_SIZES } from '@/lib/paging';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { MobileCardList } from './MobileCards';
import { StatCell } from './StatStrip';
import { useStatStripVariant } from './statStripContext';
import type { DataTableSort } from './tableSort';

export type { DataTableSort } from './tableSort';
import { rowsToCards } from './tableCards';
import { useEmbeddedSlots, usePageTrail } from './pageTrail';
import { InfoHint } from './InfoHint';
import { formatDelta } from '@/lib/format';
import { businessErrorMessage } from '@/lib/pgError';

/* ==========================================================================
   Primitivos de UI del Control Plane.

   Deliberadamente pequeños: el objetivo es que las pantallas se lean igual
   entre sí, no construir una librería. Los colores salen SIEMPRE de tokens
   (`src/app/tokens.css`) para soportar theming/white-label — contrato §4.3.
   Anatomía y medidas: docs/design/VISUAL_SYSTEM_V2.md §5.
   ========================================================================== */

/* ---- Encabezado de página (§5.13) --------------------------------------- */

export interface Crumb {
  label: string;
  /** Sin `to` la miga es la página actual (sin enlace). */
  to?: string;
}

/** Migas de pan: `text-caption --muted`, separador `CaretRight`, la última sin enlace. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Migas de pan">
      <ol className="flex flex-wrap items-center gap-1 text-caption text-muted">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              {c.to && !last ? (
                <Link to={c.to} className="rounded-sm hover:text-fg hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={last ? 'text-fg-2' : undefined}>
                  {c.label}
                </span>
              )}
              {!last ? <CaretRightIcon size={12} aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageContainer({
  title,
  description,
  actions,
  breadcrumbs,
  meta,
  leading,
  titleAside,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Avatar o logo delante del título (cabecera de perfil de las fichas 360). */
  leading?: ReactNode;
  /** Insignias de estado junto al título. */
  titleAside?: ReactNode;
  /**
   * Migas: lista declarativa o un nodo propio (compatibilidad). Sin migas, se
   * usan las del shell (grupo del menú → listado de origen) + el título.
   */
  breadcrumbs?: Crumb[] | ReactNode;
  /** Metadatos bajo el título (fecha de corte, moneda de reporte). */
  meta?: ReactNode;
  children: ReactNode;
}) {
  const trail = usePageTrail();
  const slots = useEmbeddedSlots();
  if (slots) {
    // Pestaña de otra pantalla (V6 · T1): sin migas ni `h1`; las acciones y la
    // descripción suben a la cabecera de la contenedora (portal). Aquí solo
    // queda, si lo hay, el estado o los metadatos de la pestaña en una línea.
    return (
      <section aria-label={title}>
        <h2 className="sr-only">{title}</h2>
        {actions && slots.actions ? createPortal(actions, slots.actions) : null}
        {description && slots.hint
          ? createPortal(
              <InfoHint label={`Qué es «${title}»`} title={title}>
                {description}
              </InfoHint>,
              slots.hint,
            )
          : null}
        {meta || titleAside ? (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-muted" data-embedded-meta>
            {titleAside ? <div className="flex flex-wrap items-center gap-1.5">{titleAside}</div> : null}
            {meta ? <div>{meta}</div> : null}
          </div>
        ) : null}
        {children}
      </section>
    );
  }
  const crumbs = breadcrumbs ?? (trail.length > 0 ? [...trail, { label: title }] : null);
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 2xl:px-8">
      {crumbs ? (
        <div className="mb-2">
          {Array.isArray(crumbs) ? <Breadcrumbs items={crumbs as Crumb[]} /> : crumbs}
        </div>
      ) : null}
      {/* V6 · T1: título y acciones en la MISMA fila mientras quepan (el título cede
          ancho y la descripción se parte); solo en pantallas estrechas bajan. */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-[min(100%,320px)] flex-1 items-start gap-4">
          {leading}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {/* tabIndex -1: el shell lleva el foco aquí al cambiar de ruta (§5.13). */}
              <h1 tabIndex={-1} className="text-h1 text-fg focus:outline-none">
                {title}
              </h1>
              {titleAside ? <div className="flex flex-wrap items-center gap-1.5">{titleAside}</div> : null}
            </div>
            {description ? <p className="mt-1 max-w-[72ch] text-body text-fg-2">{description}</p> : null}
            {meta ? <div className="mt-2 text-caption text-muted">{meta}</div> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center justify-end gap-2 max-sm:justify-start">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

/* ---- Tarjeta (§5.5) ------------------------------------------------------ */

export function Card({
  title,
  description,
  actions,
  footer,
  children,
  className = '',
  id,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  /** Pie opcional `text-caption --muted` sobre `--sunken` (conteos, fecha de corte). */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Ancla de sección (`#id`): deja sitio para la barra superior y la cabecera fija. */
  id?: string;
}) {
  return (
    <section id={id} className={`ebim-card ${id ? 'scroll-mt-40 ' : ''}${className}`}>
      {title ? (
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-h3 text-fg">{title}</h2>
            {description ? <p className="mt-0.5 text-compact text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
      {footer ? (
        <div className="rounded-b-card border-t border-border bg-sunken px-5 py-3 text-caption text-muted">{footer}</div>
      ) : null}
    </section>
  );
}

/* ---- KPI (§5.6) ------------------------------------------------------------ */

type StatusTone = 'neutral' | 'ok' | 'warn' | 'danger';

const STATUS_ICON: Record<Exclude<StatusTone, 'neutral'>, { Icon: typeof CheckCircleIcon; cls: string; sr: string }> = {
  ok: { Icon: CheckCircleIcon, cls: 'text-ok', sr: 'En buen estado' },
  warn: { Icon: WarningIcon, cls: 'text-warn', sr: 'Requiere atención' },
  danger: { Icon: WarningOctagonIcon, cls: 'text-danger', sr: 'Crítico' },
};

export interface KpiDelta {
  /** Razón para `percent` (0.041 = +4.1%), puntos para `pp`, unidades para `number`. */
  value: number | null | undefined;
  kind?: 'percent' | 'pp' | 'number';
  /** Contra qué se compara: «vs ago», «vs mes anterior». */
  comparison?: string;
  /** Si subir es bueno (`up`), malo (`down`, p. ej. cartera vencida) o neutro. */
  goodWhen?: 'up' | 'down' | 'none';
}

/** Valor largo (texto, varias monedas) baja de escala para no desbordar el tile. */
function valueSize(size: 'display' | 'kpi', value: ReactNode): string {
  const len = typeof value === 'string' ? value.length : 0;
  if (len > 24) return 'text-h2';
  if (len > 14) return 'text-h1';
  return size === 'display' ? 'text-display' : 'text-kpi';
}

function DeltaLine({ delta }: { delta: KpiDelta }) {
  const v = delta.value;
  const dir = v == null || !Number.isFinite(v) || v === 0 ? 0 : v > 0 ? 1 : -1;
  const good = delta.goodWhen ?? 'up';
  const tone =
    dir === 0 || good === 'none'
      ? 'text-muted'
      : (dir > 0) === (good === 'up')
        ? 'text-ok'
        : 'text-danger';
  const Icon = dir > 0 ? ArrowUpRightIcon : dir < 0 ? ArrowDownRightIcon : MinusIcon;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-compact">
      <span className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${tone}`}>
        <Icon size={14} weight="bold" aria-hidden />
        {formatDelta(v, delta.kind)}
      </span>
      {delta.comparison ? <span className="text-muted">{delta.comparison}</span> : null}
    </p>
  );
}

export interface KpiTileProps {
  label: string;
  /**
   * Valor YA formateado (cifra compacta). `null`/`undefined`/`''`/`'—'` = sin dato:
   * se pinta «— Sin datos» atenuado (V5 · F7), nunca un 0 ni con el peso de una cifra.
   */
  value: ReactNode;
  /** Código ISO como prefijo pequeño junto a la cifra: `USD` **50.1 K**. */
  currency?: string;
  /** `display` (40 px) solo en la franja hero del resumen; `kpi` (32 px) en el resto. */
  size?: 'display' | 'kpi';
  delta?: KpiDelta;
  /** Serie mensual (12 puntos) para la sparkline. */
  trend?: ReadonlyArray<number | null | undefined>;
  /** El último punto de la tendencia es un mes en curso. */
  trendPartial?: boolean;
  /** Texto accesible de la tendencia («de USD 41 K a USD 50 K»). */
  trendDescription?: string;
  /** Pie de contexto: desglose nativo, fecha de corte, «mes en curso parcial». */
  footer?: ReactNode;
  /** Definición del KPI (tooltip nativo + texto para lector de pantalla). */
  info?: string;
  icon?: ReactNode;
  /** Estado semántico: icono + texto oculto junto a la etiqueta; el valor NO se colorea (A09). */
  tone?: StatusTone;
  /** Todo el tile navega al detalle. */
  to?: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * Tarjeta de KPI (evoluciona `StatCard`): etiqueta micro → valor protagonista
 * (cifras proporcionales) → variación con flecha y tono → sparkline → pie.
 * El color va en la variación, nunca en el valor.
 */
export function KpiTile({
  label,
  value,
  currency,
  size = 'kpi',
  delta,
  trend,
  trendPartial,
  trendDescription,
  footer,
  info,
  icon,
  tone = 'neutral',
  to,
  loading,
  error,
  onRetry,
  className = '',
}: KpiTileProps) {
  // V6 · T2: dentro de una franja compacta, el tile se pinta como celda de ~72 px
  // (la sparkline se omite: la tendencia queda para `variant="tiles"`).
  const strip = useStatStripVariant();
  if (strip === 'band') {
    return (
      <StatCell
        label={label}
        value={value}
        currency={currency}
        tone={tone}
        info={info}
        to={to}
        loading={loading}
        error={error}
        onRetry={onRetry}
        className={className}
        context={
          !delta ? (
            footer
          ) : (
            <>
              {delta ? (
                <span className="mr-1.5 font-semibold tabular-nums text-fg-2">
                  {formatDelta(delta.value, delta.kind)}
                  {delta.comparison ? <span className="font-normal text-muted"> {delta.comparison}</span> : null}
                </span>
              ) : null}
              {footer}
            </>
          )
        }
      />
    );
  }
  const minH = size === 'display' ? 'min-h-[148px]' : 'min-h-[120px]';
  const empty = !loading && !error && (value === null || value === undefined || value === '' || value === '—');
  // Sin datos (V5 · F7): borde punteado y texto atenuado; no compite con las cifras reales.
  const shell = `ebim-card flex flex-col p-5 ${minH} ${empty ? 'border-dashed' : ''} ${className}`;

  if (loading) {
    return (
      <div className={shell} aria-busy="true">
        <span className="sr-only" role="status">
          Cargando {label}…
        </span>
        <SkeletonKpiBody />
      </div>
    );
  }

  const status = tone !== 'neutral' ? STATUS_ICON[tone] : null;

  const body = (
    <>
      <div className="flex items-center gap-1.5 text-micro text-muted">
        {icon ? (
          <span className="shrink-0" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 truncate" title={label}>
          {label}
        </span>
        {info ? (
          <span className="inline-flex shrink-0 cursor-help" title={info}>
            <InfoIcon size={14} aria-hidden />
            <span className="sr-only">{info}</span>
          </span>
        ) : null}
        {status ? (
          <span className={`ml-auto inline-flex shrink-0 ${status.cls}`}>
            <status.Icon size={16} weight="fill" aria-hidden />
            <span className="sr-only">{status.sr}</span>
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-2 flex flex-1 flex-col items-start gap-1" role="alert">
          <span className="inline-flex items-center gap-1.5 text-body font-semibold text-fg">
            <WarningCircleIcon size={18} className="text-danger" aria-hidden />
            No disponible
          </span>
          {onRetry ? (
            <button type="button" className="ebim-link text-compact" onClick={onRetry}>
              Reintentar
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {empty ? (
            <p className="mt-2 flex items-baseline gap-1.5 text-body text-muted" data-kpi-empty>
              <span aria-hidden>—</span>
              <span>Sin datos</span>
            </p>
          ) : (
            <p className="mt-2 flex min-w-0 items-baseline gap-1.5 break-words text-fg">
              {currency ? <span className="text-h3 font-semibold text-muted">{currency}</span> : null}
              <span className={`${valueSize(size, value)} min-w-0`}>{value}</span>
            </p>
          )}
          {delta ? <DeltaLine delta={delta} /> : null}
          {trend ? (
            <div className="mt-auto pt-3">
              <Sparkline data={trend} partialLast={trendPartial} description={trendDescription} />
            </div>
          ) : null}
        </>
      )}

      {footer ? <div className={`${trend ? 'mt-2' : 'mt-auto pt-2'} text-caption text-muted`}>{footer}</div> : null}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className={`${shell} transition-colors duration-fast ease-out hover:border-border-strong`}
      >
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}

/**
 * Tarjeta de KPI de V1, conservada por compatibilidad: delega en `KpiTile`.
 * `value` siempre es un dato ya formateado; `tone` ya no colorea la cifra (A09):
 * se muestra como icono de estado junto a la etiqueta.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: StatusTone;
}) {
  return <KpiTile label={label} value={value} footer={hint} tone={tone} />;
}

/* ---- Badge (§5.4) ------------------------------------------------------------ */

type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';

const BADGE_TONES: Record<BadgeTone, { cls: string; dot: string }> = {
  neutral: { cls: 'border border-border bg-sunken text-fg-2', dot: 'bg-muted' },
  ok: { cls: 'bg-ok-soft text-ok', dot: 'bg-ok' },
  warn: { cls: 'bg-warn-soft text-warn', dot: 'bg-warn' },
  danger: { cls: 'bg-danger-soft text-danger', dot: 'bg-danger' },
  info: { cls: 'bg-info-soft text-info', dot: 'bg-info' },
  // `accent-deep` y no `accent`: regla AA del contrato §4.4 para TEXTO.
  accent: { cls: 'bg-accent-soft text-accent-deep', dot: 'bg-accent' },
};

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  /** Punto de 6 px del color del rol delante del texto. */
  dot?: boolean;
  title?: string;
}) {
  const t = BADGE_TONES[tone];
  return (
    <span
      title={title}
      className={`inline-flex h-[22px] max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-caption font-semibold ${t.cls}`}
    >
      {dot ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} aria-hidden /> : null}
      {children}
    </span>
  );
}

/* ---- Skeleton y carga (§5.12) ------------------------------------------------- */

/** Bloque de skeleton. Ancho y alto por clase (`w-2/5 h-4`). */
export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <span className={`ebim-skeleton ${className}`} style={style} aria-hidden />;
}

function SkeletonKpiBody() {
  return (
    <div className="flex flex-1 flex-col" aria-hidden>
      <Skeleton className="h-3 w-2/5" />
      <Skeleton className="mt-3 h-8 w-3/5" />
      <Skeleton className="mt-3 h-3 w-1/3" />
      <Skeleton className="mt-auto h-6 w-full opacity-60" />
    </div>
  );
}

function SkeletonTable({ rows }: { rows: number }) {
  return (
    <div aria-hidden>
      <div className="flex h-10 items-center gap-6 border-b border-border bg-sunken px-pad-x">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className={`h-2.5 ${i === 0 ? 'w-24' : 'ml-auto w-16'}`} />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex h-row items-center gap-6 px-pad-x">
            <Skeleton className={`h-3 ${r % 2 ? 'w-1/3' : 'w-2/5'}`} />
            <Skeleton className="ml-auto h-3 w-1/4" />
            <Skeleton className="ml-auto h-3 w-1/6" />
            <Skeleton className="ml-auto h-3 w-[12%]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="p-5" aria-hidden>
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="mt-2 h-3 w-2/5" />
      <div className="mt-5 flex h-[200px] items-end gap-3 border-b border-border">
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

export type LoadingVariant = 'table' | 'card' | 'chart' | 'kpis' | 'page' | 'inline';

/**
 * Estado de carga: skeleton con la forma de lo que viene (tabla por defecto),
 * no un spinner (D-V04). `label` queda para lectores de pantalla en un
 * `role="status"`; el contenedor lleva `aria-busy`. `inline` es la única
 * variante con texto visible (paneles pequeños, comprobaciones puntuales).
 */
export function LoadingState({
  label = 'Cargando…',
  variant = 'table',
  rows = 6,
}: {
  label?: string;
  variant?: LoadingVariant;
  rows?: number;
}) {
  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2.5 px-4 py-6 text-compact text-muted" aria-busy="true">
        <span className="ebim-spinner text-accent-deep" aria-hidden />
        <span role="status">{label}</span>
      </div>
    );
  }
  return (
    <div aria-busy="true" data-loading={variant}>
      <span role="status" className="sr-only">
        {label}
      </span>
      {variant === 'table' ? <SkeletonTable rows={rows} /> : null}
      {variant === 'chart' ? <SkeletonChart /> : null}
      {variant === 'card' ? (
        <div className="space-y-3 p-5" aria-hidden>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : null}
      {variant === 'kpis' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="ebim-card flex min-h-[120px] flex-col p-5">
              <SkeletonKpiBody />
            </div>
          ))}
        </div>
      ) : null}
      {variant === 'page' ? (
        <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 sm:px-6" aria-hidden>
          <div>
            <Skeleton className="h-7 w-64" />
            <Skeleton className="mt-2 h-4 w-96 max-w-full" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="ebim-card flex min-h-[120px] flex-col p-5">
                <SkeletonKpiBody />
              </div>
            ))}
          </div>
          <div className="ebim-card overflow-hidden">
            <SkeletonTable rows={rows} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---- Vacío y error (§5.14) ----------------------------------------------------- */

/** Ilustración monocroma 96×96: trazo `--border-strong`, un detalle en `--accent`. */
function EmptyIllustration() {
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden className="mx-auto">
      <rect x="18" y="22" width="60" height="52" rx="8" stroke="var(--border-strong)" strokeWidth="1.5" />
      <path d="M18 36h60" stroke="var(--border-strong)" strokeWidth="1.5" />
      <path d="M30 48h24M30 58h16" stroke="var(--border-strong)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="26" cy="29" r="2" fill="var(--border-strong)" />
      <circle cx="33" cy="29" r="2" fill="var(--border-strong)" />
      <circle cx="68" cy="66" r="11" fill="var(--card)" stroke="var(--accent)" strokeWidth="1.5" />
      <path d="M63.5 66h9M68 61.5v9" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SearchIllustration() {
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden className="mx-auto">
      <circle cx="42" cy="42" r="20" stroke="var(--border-strong)" strokeWidth="1.5" />
      <path d="m57 57 15 15" stroke="var(--border-strong)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M34 42h16" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Estado vacío (§5.14). V6 · T5 distingue dos casos:
 *
 * - `variant="empty"` (por defecto): el conjunto no tiene nada todavía. Ilustración
 *   de la tarjeta y, si el rol puede, una `action` que crea algo («Nuevo cliente»).
 * - `variant="no-results"`: hay datos pero la búsqueda o el filtro no encontró
 *   nada. Lupa y, con `onClear`, el botón «Limpiar búsqueda».
 *
 * Con el conjunto vacío, el listado oculta además su buscador y sus pestañas de
 * estado (`SearchBar total={0}`): nada de «Todos 0 · Activos 0 · Borrador 0».
 */
export function EmptyState({
  title,
  description,
  action,
  illustration,
  variant = 'empty',
  onClear,
  clearLabel = 'Limpiar búsqueda',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Fuerza la ilustración: `search`, `empty` o `none` (paneles muy pequeños). Por defecto, la de la variante. */
  illustration?: 'empty' | 'search' | 'none';
  /** `empty`: no hay nada aún · `no-results`: la búsqueda o el filtro no encontró nada. */
  variant?: 'empty' | 'no-results';
  /** Solo con `no-results`: vacía la búsqueda y los filtros. */
  onClear?: () => void;
  clearLabel?: string;
}) {
  const art = illustration ?? (variant === 'no-results' ? 'search' : 'empty');
  const clear =
    variant === 'no-results' && onClear ? (
      <button type="button" className="ebim-btn-ghost ebim-btn-sm" onClick={onClear}>
        {clearLabel}
      </button>
    ) : null;
  return (
    <div className={`px-4 text-center ${art === 'none' ? 'py-10' : 'py-12'}`} data-empty-variant={variant}>
      {art === 'empty' ? <EmptyIllustration /> : null}
      {art === 'search' ? <SearchIllustration /> : null}
      <p className={`text-h3 text-fg ${art === 'none' ? '' : 'mt-4'}`}>{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-[48ch] text-body text-fg-2">{description}</p> : null}
      {action || clear ? (
        <div className="mt-5 flex justify-center gap-2">
          {clear}
          {action}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Error de carga en español (§5.14, A01). El mensaje pasa por `pgError`
 * (prefijos de negocio fuera, SQLSTATE y códigos PostgREST traducidos); el
 * texto técnico original, si es distinto, queda plegado en «Detalle técnico».
 */
export function ErrorState({
  error,
  onRetry,
  title = 'No se pudo cargar la información',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const rawMessage = (error as { message?: unknown } | null)?.message;
  const raw = typeof rawMessage === 'string' ? rawMessage : null;
  const message = error == null ? 'Ocurrió un error inesperado.' : businessErrorMessage(error);
  const technical = raw && raw.trim() !== message ? raw : null;
  return (
    <div className="px-4 py-12 text-center" role="alert">
      <WarningCircleIcon size={32} className="mx-auto text-danger" aria-hidden />
      <p className="mt-3 text-h3 text-fg">{title}</p>
      <p className="mx-auto mt-1 max-w-[56ch] text-body text-fg-2">{message}</p>
      {technical ? (
        <details className="mx-auto mt-3 max-w-[56ch] text-left text-caption text-muted">
          <summary className="cursor-pointer text-center">Detalle técnico</summary>
          <p className="mt-2 break-words rounded-md bg-sunken px-3 py-2 font-mono">{technical}</p>
        </details>
      ) : null}
      {onRetry ? (
        <button type="button" className="ebim-btn-ghost ebim-btn-sm mt-5" onClick={onRetry}>
          <ArrowClockwiseIcon size={16} aria-hidden />
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
  total,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  right?: ReactNode;
  /**
   * V6 · T5: cantidad de elementos del conjunto SIN filtrar. Con `0` y sin nada
   * escrito, ni el buscador ni las pestañas (`right`) se pintan: solo queda el
   * estado vacío. Sin la prop, la barra se pinta siempre (compatibilidad).
   */
  total?: number;
}) {
  if (total === 0 && value === '') return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
      <SearchField value={value} onChange={onChange} placeholder={placeholder} className="flex-1" />
      {right}
    </div>
  );
}

/* ---- Tabla (§5.7) ---------------------------------------------------------------- */

export type DataColumn =
  | string
  | {
      /**
       * Cabecera. V6 · F5: también un nodo (p. ej. texto + `InfoHint`); entonces
       * conviene `name` para la clave y la etiqueta de la tarjeta móvil.
       */
      label: ReactNode;
      /** Texto plano de la cabecera cuando `label` es un nodo (tarjeta móvil, clave). */
      name?: string;
      align?: 'left' | 'right';
      /** Cabecera solo para lector de pantalla (acciones): en móvil va al pie de la tarjeta. */
      srOnly?: boolean;
      /** V6 · T4: ancho de la columna (`180`, `'22%'`). El contenido largo lo recortan las celdas (`CellTitle`). */
      width?: number | string;
      /**
       * V6 · T4: SOLO la primera columna. Queda fija a la izquierda cuando la
       * tabla hace scroll horizontal (VISUAL_SYSTEM §5.7).
       */
      sticky?: boolean;
      /** V6 · T4: columna ordenable; la página ordena las filas y recibe `onSort(sortKey)`. */
      sortKey?: string;
      /** V6 · T4: `false` = la tarjeta móvil la omite (dato secundario; en escritorio sigue). */
      mobile?: boolean;
    };

/**
 * Tabla de listado: cabecera micro sobre `--sunken` (sticky dentro de su área de
 * scroll), filas con hairline y hover `--hover`. Las columnas pueden ser texto
 * o `{ label, align: 'right' }` para importes (la celda usa `ebim-num`).
 * Con `maxHeight` el cuerpo hace scroll y la cabecera queda fija.
 *
 * V5 · F0: también cubre las vistas «Tabla» de los gráficos y las matrices
 * (antes `<table>` sueltas): `caption` para lectores de pantalla, `minWidth`
 * para matrices anchas y `scrollRegion` para que el scroll horizontal sea una
 * región enfocable con teclado. Las filas pueden abrir con `<th scope="row">`.
 *
 * Paginación (V5 · F0): un listado con más de 25 filas se pagina en cliente
 * con el mismo pie que `PagedTable` («Mostrando a–b de N», filas por página,
 * anterior/siguiente), para que ninguna pantalla pinte miles de filas. Cada
 * fila hija (`<tr>`) cuenta como una; si cambia el número de filas (buscador,
 * pestaña) vuelve a la primera página. Las vistas «Tabla» de los gráficos y
 * las matrices con `rowSpan` lo desactivan con `paginate={false}`.
 *
 * Móvil (V5 · F7): con `mobileCards`, por debajo de `sm` cada fila se pinta como
 * tarjeta (primera columna = título, el resto «etiqueta: valor», acciones al
 * pie). Si las filas no son `<tr>` directos, se queda la tabla.
 *
 * V6 · T4: `mobileCards` está activo por defecto (las matrices y las vistas
 * «Tabla» de los gráficos pasan `mobileCards={false}`). Columnas con `width`,
 * primera columna fija (`sticky`) y cabeceras ordenables (`sortKey` + `sort` +
 * `onSort`, con `aria-sort`). Para las celdas: `src/components/ui/cells.tsx`.
 */
/** Primera columna fija: fondo opaco (también en hover) y por encima del resto al desplazar. */
const STICKY_FIRST =
  '[&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-[1] ' +
  '[&_tbody_tr>*:first-child]:bg-card [&_tbody_tr:hover>*:first-child]:bg-hover ' +
  '[&_tr>*:first-child]:shadow-[1px_0_0_var(--border)]';

export function DataTable({
  columns,
  children,
  label,
  caption,
  maxHeight,
  minWidth,
  scrollRegion = false,
  paginate = true,
  pageSize: initialPageSize = PAGE_SIZES[0],
  mobileCards = true,
  sort,
  onSort,
}: {
  columns: DataColumn[];
  children: ReactNode;
  /** Nombre accesible de la tabla. */
  label?: string;
  /** Título de la tabla solo para lectores de pantalla (`<caption>`). */
  caption?: string;
  maxHeight?: number;
  /** Ancho mínimo en px: por debajo, la tabla hace scroll horizontal. */
  minWidth?: number;
  /** El área de scroll es una región enfocable (teclado) con el nombre de la tabla. */
  scrollRegion?: boolean;
  /** Paginar en cliente cuando hay más de 25 filas (por defecto, sí). */
  paginate?: boolean;
  /** Filas por página iniciales. */
  pageSize?: number;
  /** Por debajo de `sm`, filas como tarjetas (V5 · F7). Por defecto, sí (V6). */
  mobileCards?: boolean;
  /** Orden activo (columnas con `sortKey`). */
  sort?: DataTableSort;
  /** Pulsar una cabecera ordenable: la página reordena (ver `nextSort`). */
  onSort?: (key: string) => void;
}) {
  const mobile = useIsMobile();
  const first = columns[0];
  const stickyFirst = typeof first === 'object' && Boolean(first.sticky);
  const rows = paginate ? Children.toArray(children) : null;
  const pager = useClientPagination(rows?.length ?? 0, initialPageSize);
  const paged = rows !== null && pager.active;
  const body = paged ? pager.slice(rows) : children;
  const cards = mobileCards && mobile ? rowsToCards(Children.toArray(body), columns) : null;
  const style: CSSProperties | undefined = maxHeight ? { maxHeight, overflowY: 'auto' } : undefined;
  const region = scrollRegion ? { role: 'region', 'aria-label': label ?? caption, tabIndex: 0 } : {};
  const table = cards ? (
    <MobileCardList label={label ?? caption} items={cards} />
  ) : (
    // `relative`: el scroll horizontal también recorta a los descendientes
    // posicionados (p. ej. etiquetas sr-only); sin él ensanchan la página.
    <div className="relative overflow-x-auto" style={style} {...region}>
      <table
        className={`w-full border-collapse ${stickyFirst ? STICKY_FIRST : ''}`}
        aria-label={label}
        style={minWidth ? { minWidth } : undefined}
      >
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="sticky top-0 z-[1] border-b border-border bg-sunken">
          <tr>
            {columns.map((c, i) => {
              const col = typeof c === 'string' ? { label: c } : c;
              const sortable = Boolean(col.sortKey && onSort);
              const active = sortable && sort?.key === col.sortKey;
              const ariaSort = sortable ? (active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined;
              return (
                <th
                  key={`${typeof col.label === 'string' ? col.label : (('name' in col && col.name) || 'col')}-${i}`}
                  scope="col"
                  aria-sort={ariaSort}
                  className={`ebim-th ${col.align === 'right' ? 'text-right' : ''}`}
                  style={col.width !== undefined ? { width: col.width } : undefined}
                >
                  {col.srOnly ? (
                    <span className="sr-only">{col.label}</span>
                  ) : sortable ? (
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1 rounded-sm uppercase hover:text-fg ${active ? 'text-fg' : ''}`}
                      onClick={() => onSort!(col.sortKey!)}
                    >
                      {col.label}
                      {active ? (
                        sort!.dir === 'asc' ? (
                          <CaretUpIcon size={12} weight="bold" aria-hidden />
                        ) : (
                          <CaretDownIcon size={12} weight="bold" aria-hidden />
                        )
                      ) : (
                        <CaretUpDownIcon size={12} className="opacity-60" aria-hidden />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border [&>tr]:transition-colors [&>tr]:duration-fast [&>tr:hover]:bg-hover">
          {body}
        </tbody>
      </table>
    </div>
  );
  if (!paged) return table;
  return (
    <div>
      {table}
      <TablePager
        page={pager.page}
        pageSize={pager.pageSize}
        total={pager.total}
        shown={(body as unknown[]).length}
        onPageChange={pager.onPageChange}
        onPageSizeChange={pager.onPageSizeChange}
      />
    </div>
  );
}

