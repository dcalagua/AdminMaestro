import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney, formatMoneyCompact } from '@/lib/format';

/**
 * Gráficos de la consola (Recharts 3.10.1, MIT). Reglas (spec §7.4 / dataviz):
 *  - una moneda por eje, nunca dos escalas;
 *  - sin animación (no se usa movimiento para ocultar cambios de datos);
 *  - colores desde tokens (`--chart-*`), texto con tokens de texto;
 *  - tooltip por marca y clic → detalle; la tabla alternativa del ChartPanel
 *    ofrece los mismos enlaces por teclado;
 *  - etiquetas directas sólo en conjuntos pequeños.
 */

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Rotulado en el eje/tooltip (p. ej. «septiembre (parcial)»). */
  note?: string;
}

const AXIS = { fill: 'var(--chart-axis)', fontSize: 11 };

function MoneyTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: BarDatum }>;
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const note = payload[0]?.payload?.note;
  return (
    <div className="rounded-field border border-border bg-card px-3 py-2 text-xs shadow-pop">
      <p className="font-semibold text-fg">
        {label}
        {note ? <span className="ml-1 font-normal text-muted">({note})</span> : null}
      </p>
      {payload.map((p) => (
        <p key={p.name} className="mt-0.5 flex items-center gap-1.5 text-fg">
          <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
          {payload.length > 1 ? `${p.name}: ` : ''}
          <span className="tabular-nums">{formatMoney(p.value ?? 0, currency)}</span>
        </p>
      ))}
    </div>
  );
}

/** Barras de una serie (G01 cobros por mes, G02 MRR por producto, G03 antigüedad, G05 partner). */
export function SingleBars({
  data,
  currency,
  layout = 'vertical-bars',
  height = 240,
  onSelect,
  ariaLabel,
}: {
  data: BarDatum[];
  currency: string;
  /** `vertical-bars`: categorías en X. `horizontal-bars`: categorías en Y (nombres largos). */
  layout?: 'vertical-bars' | 'horizontal-bars';
  height?: number;
  onSelect?: (d: BarDatum) => void;
  ariaLabel: string;
}) {
  const horizontal = layout === 'horizontal-bars';
  const labelled = data.length <= 8;
  return (
    <div role="img" aria-label={ariaLabel} style={{ height: horizontal ? Math.max(160, data.length * 40 + 40) : height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={horizontal ? 'vertical' : 'horizontal'}
          margin={{ top: 18, right: horizontal ? 72 : 8, bottom: 4, left: horizontal ? 8 : 0 }}
          accessibilityLayer
        >
          <CartesianGrid stroke="var(--chart-grid)" vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={AXIS} tickFormatter={(v: number) => formatMoneyCompact(v, currency)} hide />
              <YAxis type="category" dataKey="label" tick={AXIS} width={120} tickLine={false} axisLine={false} />
            </>
          ) : (
            <>
              <XAxis
                dataKey="label"
                tick={AXIS}
                tickLine={false}
                axisLine={{ stroke: 'var(--chart-grid)' }}
                // En pantallas estrechas Recharts omite etiquetas que chocarían.
                interval="preserveStartEnd"
                minTickGap={6}
              />
              <YAxis
                tick={AXIS}
                tickFormatter={(v: number) => formatMoneyCompact(v, currency)}
                width={84}
                tickLine={false}
                axisLine={false}
              />
            </>
          )}
          <Tooltip cursor={{ fill: 'var(--accent-soft)' }} content={<MoneyTooltip currency={currency} />} />
          <Bar
            dataKey="value"
            name={currency}
            fill="var(--chart-single)"
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={horizontal ? 22 : 36}
            isAnimationActive={false}
            cursor={onSelect ? 'pointer' : undefined}
            onClick={(entry) => onSelect?.(entry as unknown as BarDatum)}
          >
            {labelled ? (
              <LabelList
                dataKey="value"
                position={horizontal ? 'right' : 'top'}
                formatter={(v: unknown) => formatMoneyCompact(Number(v), currency)}
                style={{ fill: 'var(--text)', fontSize: 11 }}
              />
            ) : null}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface ComponentDatum {
  key: string;
  label: string;
  collected: number;
  cost: number;
  commission: number;
}

/** G04: cobrado, costo y comisión por SaaS en UNA moneda (barras agrupadas). */
export function ComponentBars({
  data,
  currency,
  onSelect,
  ariaLabel,
}: {
  data: ComponentDatum[];
  currency: string;
  onSelect?: (d: ComponentDatum) => void;
  ariaLabel: string;
}) {
  const click = (entry: unknown) => onSelect?.(entry as ComponentDatum);
  return (
    <div role="img" aria-label={ariaLabel} style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barGap={2} accessibilityLayer>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }} interval="preserveStartEnd" minTickGap={6} />
          <YAxis tick={AXIS} tickFormatter={(v: number) => formatMoneyCompact(v, currency)} width={84} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: 'var(--accent-soft)' }} content={<MoneyTooltip currency={currency} />} />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text)' }} iconType="square" />
          <Bar dataKey="collected" name="Cobrado" fill="var(--chart-collected)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} onClick={click} cursor={onSelect ? 'pointer' : undefined} />
          <Bar dataKey="cost" name="Costo directo" fill="var(--chart-cost)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} onClick={click} cursor={onSelect ? 'pointer' : undefined} />
          <Bar dataKey="commission" name="Comisión" fill="var(--chart-commission)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} onClick={click} cursor={onSelect ? 'pointer' : undefined} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
