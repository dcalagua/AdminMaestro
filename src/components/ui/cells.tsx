import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatCompactAmount, formatMoney } from '@/lib/format';
import { autoTitle } from './autoTitle';

/* ==========================================================================
   V6 · T4 · Celdas tipadas de los listados.

   Una fila gerencial mide 44–48 px: una línea principal y, como mucho, una
   secundaria. Estas piezas fijan esa anatomía para que todas las tablas se lean
   igual. Ninguna calcula negocio: reciben los datos ya resueltos.

   - `CellTitle`   nombre (enlace) + línea secundaria (razón social · país · código).
   - `MoneyCell`   importe en su moneda nativa, compacto, con el completo en `title`.
   - `AppChip(s)`  app de la suite con el punto de su estado, y «+N».
   - `StatusCell`  insignia de estado + antigüedad («hace 3 días»).
   - `StatusDot`   punto de color (decorativo: el texto va al lado o en sr-only).

   Colores siempre por token. El color nunca es la única señal: cada punto
   lleva su texto (visible, en `title` o `sr-only`).
   ========================================================================== */

export type CellTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';

const DOT: Record<CellTone, string> = {
  neutral: 'bg-muted',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent',
};

/** Punto de estado de 8 px. `hollow` = sin dato / no evaluado (anillo vacío). */
export function StatusDot({ tone = 'neutral', hollow = false }: { tone?: CellTone; hollow?: boolean }) {
  return (
    <span
      aria-hidden
      data-dot={tone}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${hollow ? 'border-[1.5px] border-muted bg-transparent' : DOT[tone]}`}
    />
  );
}

/* ---- CellTitle --------------------------------------------------------------- */

export interface CellTitleProps {
  /** Línea principal (nombre de la cuenta, del tenant, de la integración). */
  title: string;
  /** Enlace a la ficha. Sin `to`, texto en negrita. */
  to?: string;
  /**
   * Línea secundaria en `text-caption`: razón social · país · código. Se corta
   * en una línea con el texto completo en `title`. Las partes vacías se omiten.
   */
  secondary?: ReactNode | Array<string | null | undefined | false>;
  /** Partes de `secondary` en `font-mono` (códigos, RUC). Con un array, índices a monoespaciar. */
  monoParts?: number[];
  /** Avatar o icono delante (p. ej. `<Avatar>`). */
  leading?: ReactNode;
  /** Insignias tras el nombre (estado no activo, «Plataforma EBIM»). */
  aside?: ReactNode;
  /** El título puede ocupar 2 líneas (`line-clamp-2`) en lugar de cortarse en 1. */
  wrap?: boolean;
  /** Tooltip del nombre (por defecto, el propio nombre). Útil para el código técnico: «Código: ewm-provisioning-v1». */
  tooltip?: string;
  /**
   * `title` de la segunda línea cuando `secondary` es un nodo. Sin él, se toma
   * el texto que pinta el nodo (V6 · F5: una línea cortada siempre se puede leer).
   */
  secondaryTitle?: string;
}

/**
 * Nombre + segunda línea. El nombre nunca se trunca sin `title`; con `wrap`
 * ocupa hasta 2 líneas (títulos largos de integración).
 *
 * @example
 * <CellTitle title="GRUPASA" to="/organizations/1" leading={<Avatar name="GRUPASA" />}
 *   secondary={['Grupasa S.A.C.', 'Perú', '20500000001']} monoParts={[2]} />
 */
export function CellTitle({
  title,
  to,
  secondary,
  monoParts = [],
  leading,
  aside,
  wrap = false,
  tooltip,
  secondaryTitle,
}: CellTitleProps) {
  // Partes no vacías con su índice original (para `monoParts`).
  const parts = Array.isArray(secondary)
    ? secondary.flatMap((p, index) => (p ? [{ text: p, index }] : []))
    : null;
  const secondaryText = parts ? parts.map((p) => p.text).join(' · ') : typeof secondary === 'string' ? secondary : undefined;
  const nameCls = `${wrap ? 'line-clamp-2' : 'truncate'} font-semibold text-fg`;
  return (
    <div className="flex min-w-0 items-center gap-3" data-cell-title>
      {leading}
      <div className="min-w-0">
        {/* Con insignias: si no caben junto al nombre, bajan de línea (V6 · F5) en vez de dejarlo en «C…». */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          {to ? (
            <Link to={to} className={`${nameCls} min-w-0 hover:text-accent-deep hover:underline`} title={tooltip ?? title}>
              {title}
            </Link>
          ) : (
            <span className={`${nameCls} min-w-0`} title={tooltip ?? title}>
              {title}
            </span>
          )}
          {aside ? <span className="flex shrink-0 items-center gap-1">{aside}</span> : null}
        </div>
        {parts && parts.length > 0 ? (
          <div className="truncate text-caption text-muted" title={secondaryText}>
            {parts.map((p, i) => (
              <span key={p.index}>
                {i > 0 ? ' · ' : null}
                <span className={monoParts.includes(p.index) ? 'font-mono' : undefined}>{p.text}</span>
              </span>
            ))}
          </div>
        ) : secondary && !parts ? (
          <div
            className="truncate text-caption text-muted"
            title={secondaryTitle ?? secondaryText}
            // Nodo sin `secondaryTitle`: el `title` es el texto que pinta.
            ref={secondaryTitle || secondaryText ? undefined : autoTitle}
          >
            {secondary}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---- MoneyCell --------------------------------------------------------------- */

export interface MoneyCellProps {
  /** Importes por moneda (multimoneda: una moneda por línea corta, nunca sumadas). */
  amounts?: Record<string, number | string> | null;
  /** Alternativa de una sola moneda. */
  amount?: number | string | null;
  currency?: string | null;
  /** `danger` para deuda vencida; `muted` para importes informativos. */
  tone?: 'default' | 'danger' | 'muted';
  /** Texto sin importe (por defecto «—»). */
  empty?: string;
  /** Segunda línea (`text-caption`): «2 facturas · 45 días». También se muestra sin importe (V6 · F5). */
  context?: ReactNode;
}

/**
 * Importe compacto en su moneda nativa (`USD 22.7 K`), con el monto completo
 * en el `title`. Va en una columna `align: 'right'` (la celda ya es `ebim-num`).
 */
export function MoneyCell({ amounts, amount, currency, tone = 'default', empty = '—', context }: MoneyCellProps) {
  const map: Record<string, number | string> =
    amounts ?? (currency && amount !== null && amount !== undefined ? { [currency]: amount } : {});
  const entries = Object.entries(map)
    .map(([code, v]) => [code, Number(v)] as [string, number])
    .filter(([, v]) => Number.isFinite(v) && v !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return (
      <span className="inline-flex flex-col items-end leading-tight" data-money-empty>
        <span className="text-muted">{empty}</span>
        {context ? <span className="whitespace-nowrap text-caption font-normal text-muted">{context}</span> : null}
      </span>
    );
  }
  const color = tone === 'danger' ? 'text-danger' : tone === 'muted' ? 'text-fg-2' : 'text-fg';
  return (
    <span className="inline-flex flex-col items-end leading-tight" data-money>
      <span className={`whitespace-nowrap font-semibold tabular-nums ${color}`}>
        {entries.map(([code, v], i) => (
          <span key={code} title={formatMoney(v, code)}>
            {i > 0 ? <span className="font-normal text-muted"> · </span> : null}
            <span className="text-caption font-semibold text-muted">{code}</span> {formatCompactAmount(v)}
          </span>
        ))}
      </span>
      {context ? <span className="whitespace-nowrap text-caption font-normal text-muted">{context}</span> : null}
    </span>
  );
}

/* ---- AppChip / AppChips -------------------------------------------------------- */

export interface AppChipItem {
  /** Clave estable (id del producto). */
  key: string;
  /** Nombre de la app en su caja real («eChange», no «ECHANGE»). */
  name: string;
  /** Tono del estado (punto). Sin tono: solo el nombre. */
  tone?: CellTone;
  /** Estado en texto corto («Activo», «Sin alta»): `sr-only` y `title`. */
  status?: string;
  /** Explicación del estado para el `title`. */
  help?: string;
  /** Enlace (ficha de la app o pestaña «Apps» de la cuenta). */
  to?: string;
}

/**
 * Una app de la suite como píldora compacta: punto de estado + nombre.
 * El estado se lee sin color (texto en `sr-only` y en el `title`).
 */
export function AppChip({ name, tone, status, help, to }: Omit<AppChipItem, 'key'>) {
  const tip = [status ? `${name}: ${status}` : name, help].filter(Boolean).join('\n');
  const body = (
    <span
      title={tip}
      className="inline-flex h-[22px] max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2 text-caption font-semibold text-fg-2"
    >
      {tone ? <StatusDot tone={tone} /> : null}
      <span className="truncate">{name}</span>
      {status ? <span className="sr-only">: {status}</span> : null}
    </span>
  );
  return to ? (
    <Link to={to} className="inline-flex max-w-full rounded-full hover:[&>span]:border-border-strong">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Las apps de una cuenta (o de un plan) en una línea: hasta `max` píldoras y
 * «+N» con el resto en el `title`. Sin apps, `empty` atenuado.
 *
 * @example
 * <AppChips label="Apps de GRUPASA" items={[{ key: 'p1', name: 'eChange', tone: 'ok', status: 'Activo' }]} />
 */
export function AppChips({
  items,
  max = 3,
  label = 'Apps',
  empty = 'Sin apps',
}: {
  items: AppChipItem[];
  max?: number;
  /** Nombre accesible de la lista. */
  label?: string;
  empty?: string;
}) {
  if (items.length === 0) return <span className="text-compact text-muted">{empty}</span>;
  const shown = items.slice(0, max);
  const rest = items.slice(max);
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label={label} data-app-chips>
      {shown.map(({ key, ...item }) => (
        <li key={key} className="min-w-0" data-app-chip={item.name}>
          <AppChip {...item} />
        </li>
      ))}
      {rest.length > 0 ? (
        <li>
          <span
            className="inline-flex h-[22px] items-center rounded-full bg-sunken px-1.5 text-caption font-semibold text-fg-2"
            title={rest.map((r) => (r.status ? `${r.name}: ${r.status}` : r.name)).join('\n')}
          >
            +{rest.length}
            <span className="sr-only"> más: {rest.map((r) => (r.status ? `${r.name} (${r.status})` : r.name)).join(', ')}</span>
          </span>
        </li>
      ) : null}
    </ul>
  );
}

/* ---- StatusCell ---------------------------------------------------------------- */

/**
 * Estado de negocio en una celda: insignia con punto y, debajo, la antigüedad
 * o el detalle corto («hace 3 días», «vence en 5 días»).
 */
export function StatusCell({
  label,
  tone = 'neutral',
  detail,
  help,
}: {
  label: string;
  tone?: CellTone;
  /** Segunda línea corta (antigüedad, fecha). */
  detail?: ReactNode;
  /** Explicación en el `title` de la insignia. */
  help?: string;
}) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5" data-status-cell={label}>
      <span
        title={help}
        className={`inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-caption font-semibold ${STATUS_PILL[tone]}`}
      >
        <StatusDot tone={tone} />
        {label}
      </span>
      {detail ? <span className="whitespace-nowrap text-caption text-muted">{detail}</span> : null}
    </span>
  );
}

const STATUS_PILL: Record<CellTone, string> = {
  neutral: 'border border-border bg-sunken text-fg-2',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent-deep',
};
