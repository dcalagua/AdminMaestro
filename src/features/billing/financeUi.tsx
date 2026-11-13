import type { ReactNode } from 'react';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { KpiTile, Skeleton, type KpiDelta } from '@/components/ui/primitives';
import { StatCell } from '@/components/ui/StatStrip';
import { useStatStripVariant } from '@/components/ui/statStripContext';
import type { DataState } from '@/features/executive/dataState';
import type { CurrencyAmounts } from '@/features/executive/reportContext';
import { formatAmountsCompact, formatCompactAmount, formatMoney } from '@/lib/format';
import { nativeInline, sortedEntries } from './financeModel';

/**
 * Piezas de presentación de las pantallas de Finanzas (fase 10, PT-LIST /
 * PT-LIST-CHART de VISUAL_SYSTEM_V2 §8). No calculan negocio: muestran lo que la
 * base ya agregó, nunca suman monedas distintas y nunca pintan un 0 donde no hay
 * dato.
 */

/* ---- Franja de KPIs ---------------------------------------------------------------- */

/**
 * V6 · T2: la franja vive en `src/components/ui/StatStrip.tsx`. `KpiStrip` es
 * su alias: compacta (`band`) por defecto; las pantallas con tendencia pasan
 * `variant="tiles"`.
 */
export { KpiStrip } from '@/components/ui/StatStrip';

/** Cifras compactas por moneda, una por línea, con el código como prefijo pequeño (§5.6). */
function NativeLines({ amounts }: { amounts: CurrencyAmounts }) {
  return (
    <span className="flex flex-col gap-0.5">
      {sortedEntries(amounts).map(([currency, amount]) => (
        <span
          key={currency}
          className="flex items-baseline gap-1.5 text-h2"
          title={formatMoney(amount, currency)}
        >
          <span className="text-caption font-semibold text-muted">{currency}</span>
          <span>{formatCompactAmount(amount)}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * KpiTile de importes NATIVOS (sin tipo de cambio). Con una moneda es un KPI
 * normal (`USD` **50.1 K**); con varias, una línea por moneda en `text-h2`:
 * nunca se suman monedas ni se elige una «protagonista» que parezca el total.
 */
export function NativeAmountTile({
  label,
  info,
  amounts,
  state,
  onRetry,
  emptyLabel = 'Sin movimientos',
  footer,
  to,
  tone,
  delta,
}: {
  label: string;
  info?: string;
  amounts: CurrencyAmounts;
  state: DataState<unknown>;
  onRetry?: () => void;
  /** Pie cuando no hay importes («Nada pendiente»): el valor queda en «—». */
  emptyLabel?: string;
  footer?: ReactNode;
  to?: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'danger';
  delta?: KpiDelta;
}) {
  // V6 · T2: en una franja compacta, una sola línea por monedas (`PEN 3.2 K · USD 22.7 K`).
  const strip = useStatStripVariant();
  if (strip === 'band') {
    const blocked = state.status === 'forbidden' || state.status === 'unavailable';
    return (
      <StatCell
        label={label}
        info={info}
        to={to}
        tone={tone}
        loading={state.status === 'loading'}
        error={state.status === 'error' ? state.message : undefined}
        onRetry={onRetry}
        amounts={blocked ? {} : amounts}
        emptyLabel={blocked ? 'Sin datos' : emptyLabel}
        context={
          blocked
            ? state.status === 'forbidden'
              ? 'Sin acceso con tu perfil'
              : state.reason
            : footer
        }
      />
    );
  }
  if (state.status === 'loading') return <KpiTile label={label} value={null} loading />;
  if (state.status === 'error')
    return (
      <KpiTile label={label} value={null} error={state.message} onRetry={onRetry} info={info} />
    );
  if (state.status === 'forbidden' || state.status === 'unavailable') {
    return (
      <KpiTile
        label={label}
        value={null}
        info={info}
        footer={state.status === 'forbidden' ? 'Sin acceso con tu perfil' : state.reason}
      />
    );
  }
  const entries = sortedEntries(amounts).filter(([, v]) => v !== 0);
  const single = entries.length === 1 ? entries[0]! : null;
  return (
    <KpiTile
      label={label}
      info={info}
      to={to}
      tone={tone}
      delta={delta}
      currency={single?.[0]}
      value={
        entries.length === 0 ? null : single ? (
          <span title={formatMoney(single[1], single[0])}>{formatCompactAmount(single[1])}</span>
        ) : (
          <NativeLines amounts={Object.fromEntries(entries)} />
        )
      }
      footer={entries.length === 0 ? emptyLabel : footer}
    />
  );
}

/* ---- Totales del resultado filtrado -------------------------------------------------- */

export interface FilterTotal {
  label: string;
  amounts: CurrencyAmounts;
  emptyLabel?: string;
  /** Definición breve (tooltip nativo). */
  hint?: string;
}

/**
 * Totales del resultado de la tabla (mismos filtros, agregados en la base) en
 * una franja compacta dentro de la tarjeta: el KPI de página responde «cómo
 * vamos»; esta franja, «qué suma lo que estoy viendo».
 */
export function FilterTotals({
  items,
  state,
  onRetry,
  note,
  compact = false,
}: {
  items: FilterTotal[];
  state: DataState<unknown>;
  onRetry?: () => void;
  /** Nota de consistencia resumen ↔ tabla. */
  note?: ReactNode;
  /**
   * V6 · T9: montos compactos (`PEN 3.2 K · USD 22.7 K`) con el completo en el
   * `title`, como el resto de los listados. Opcional para no cambiar otras fichas.
   */
  compact?: boolean;
}) {
  return (
    <div className="border-b border-border px-5 py-3" data-filter-totals>
      {state.status === 'loading' ? (
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
          <span className="sr-only" role="status">
            Cargando totales…
          </span>
          {items.map((i) => (
            <div key={i.label}>
              <Skeleton className="block h-3 w-1/3" />
              <Skeleton className="mt-2 block h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : state.status === 'error' ? (
        <p className="flex items-center gap-2 text-compact text-fg-2" role="alert">
          <WarningCircleIcon size={16} className="text-danger" aria-hidden />
          No se pudieron leer los totales del resultado.
          {onRetry ? (
            <button type="button" className="ebim-link" onClick={onRetry}>
              Reintentar
            </button>
          ) : null}
        </p>
      ) : (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((i) => {
            const text = compact ? formatAmountsCompact(i.amounts) : nativeInline(i.amounts);
            return (
              <div key={i.label} className="min-w-0" data-total={i.label}>
                <dt className="text-micro text-muted" title={i.hint}>
                  {i.label}
                </dt>
                <dd
                  className={`mt-0.5 text-compact font-semibold tabular-nums ${text ? 'text-fg' : 'text-muted'}`}
                  title={
                    sortedEntries(i.amounts)
                      .map(([c, a]) => formatMoney(a, c))
                      .join(' · ') || undefined
                  }
                >
                  {text || (i.emptyLabel ?? 'Sin importes')}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {note ? <div className="mt-2">{note}</div> : null}
    </div>
  );
}
