import type { ReactNode } from 'react';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { KpiTile, Skeleton, type KpiDelta } from '@/components/ui/primitives';
import type { DataState } from '@/features/executive/dataState';
import type { CurrencyAmounts } from '@/features/executive/reportContext';
import { formatCompactAmount, formatMoney } from '@/lib/format';
import { nativeInline, sortedEntries } from './financeModel';

/**
 * Piezas de presentación de las pantallas de Finanzas (fase 10, PT-LIST /
 * PT-LIST-CHART de VISUAL_SYSTEM_V2 §8). No calculan negocio: muestran lo que la
 * base ya agregó, nunca suman monedas distintas y nunca pintan un 0 donde no hay
 * dato.
 */

/* ---- Franja de KPIs ---------------------------------------------------------------- */

/** Rejilla de la franja de 3–4 KpiTile bajo el encabezado. */
export function KpiStrip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-kpi-strip>
      {children}
    </section>
  );
}

/** Cifras compactas por moneda, una por línea, con el código como prefijo pequeño (§5.6). */
function NativeLines({ amounts }: { amounts: CurrencyAmounts }) {
  return (
    <span className="flex flex-col gap-0.5">
      {sortedEntries(amounts).map(([currency, amount]) => (
        <span key={currency} className="flex items-baseline gap-1.5 text-h2" title={formatMoney(amount, currency)}>
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
  if (state.status === 'loading') return <KpiTile label={label} value={null} loading />;
  if (state.status === 'error') return <KpiTile label={label} value={null} error={state.message} onRetry={onRetry} info={info} />;
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
}: {
  items: FilterTotal[];
  state: DataState<unknown>;
  onRetry?: () => void;
  /** Nota de consistencia resumen ↔ tabla. */
  note?: ReactNode;
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
            const text = nativeInline(i.amounts);
            return (
              <div key={i.label} className="min-w-0" data-total={i.label}>
                <dt className="text-micro text-muted" title={i.hint}>
                  {i.label}
                </dt>
                <dd
                  className={`mt-0.5 text-compact font-semibold tabular-nums ${text ? 'text-fg' : 'text-muted'}`}
                  title={sortedEntries(i.amounts).map(([c, a]) => formatMoney(a, c)).join(' · ') || undefined}
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

