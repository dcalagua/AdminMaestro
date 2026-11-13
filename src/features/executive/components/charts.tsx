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
import { useId } from 'react';
import { formatMoney, formatMoneyCompact } from '@/lib/format';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { axisInterval, summarizeSeries } from './chartSummary';

/**
 * Gráficos de la consola (Recharts 3.10.1, MIT). Reglas (spec §7.4 / dataviz):
 *  - una moneda por eje, nunca dos escalas;
 *  - sin animación (no se usa movimiento para ocultar cambios de datos);
 *  - colores desde tokens (`--chart-*`), texto con tokens de texto;
 *  - tooltip por marca y clic → detalle; la tabla alternativa del ChartPanel
 *    ofrece los mismos enlaces por teclado;
 *  - etiquetas directas sólo en conjuntos pequeños;
 *  - V5 · F7: descripción en texto (`aria-describedby`) y, en móvil, menos
 *    etiquetas en el eje X para que no se superpongan a 390 px.
 */

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Rotulado en el eje/tooltip (p. ej. «septiembre (parcial)»). */
  note?: string;
}

const AXIS = { fill: 'var(--chart-axis)', fontSize: 12 };

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
    <div className="rounded-md border border-border bg-elevated px-3 py-2 text-caption shadow-pop">
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
  const mobile = useIsMobile();
  const descId = useId();
  // En móvil las etiquetas directas de 8 barras verticales chocan entre sí.
  const labelled = data.length <= (mobile && !horizontal ? 4 : 8);
  const summary = summarizeSeries(ariaLabel, data, (v) => formatMoney(v, currency));
  return (
    <>
    <div
      role="img"
      aria-label={ariaLabel}
      aria-describedby={descId}
      style={{ height: horizontal ? Math.max(160, data.length * 40 + 40) : height }}
    >
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
                axisLine={{ stroke: 'var(--chart-baseline)' }}
                // En móvil, como mucho seis etiquetas a ritmo regular; en escritorio,
                // Recharts omite las que chocarían.
                interval={mobile ? axisInterval(data.length, true) : 'preserveStartEnd'}
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
          <Tooltip cursor={{ fill: 'var(--hover)' }} content={<MoneyTooltip currency={currency} />} />
          <Bar
            dataKey="value"
            name={currency}
            fill="var(--chart-single)"
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={horizontal ? 22 : 24}
            isAnimationActive={false}
            cursor={onSelect ? 'pointer' : undefined}
            onClick={(entry) => onSelect?.(entry as unknown as BarDatum)}
          >
            {labelled ? (
              <LabelList
                dataKey="value"
                position={horizontal ? 'right' : 'top'}
                formatter={(v: unknown) => formatMoneyCompact(Number(v), currency)}
                style={{ fill: 'var(--text)', fontSize: 12 }}
              />
            ) : null}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <p id={descId} className="sr-only" data-chart-summary>
      {summary}
    </p>
    </>
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
  const mobile = useIsMobile();
  const descId = useId();
  const money = (v: number) => formatMoney(v, currency);
  const summary = [
    summarizeSeries('Cobrado', data.map((d) => ({ label: d.label, value: d.collected })), money),
    summarizeSeries('Costo directo', data.map((d) => ({ label: d.label, value: d.cost })), money),
    summarizeSeries('Comisión', data.map((d) => ({ label: d.label, value: d.commission })), money),
  ].join(' ');
  return (
    <>
    <div role="img" aria-label={ariaLabel} aria-describedby={descId} style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barGap={2} accessibilityLayer>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-baseline)' }}
            interval={mobile ? axisInterval(data.length, true) : 'preserveStartEnd'}
            minTickGap={6}
          />
          <YAxis tick={AXIS} tickFormatter={(v: number) => formatMoneyCompact(v, currency)} width={84} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: 'var(--hover)' }} content={<MoneyTooltip currency={currency} />} />
          <Legend verticalAlign="top" align="left" wrapperStyle={{ fontSize: 13, color: 'var(--text-2)', paddingBottom: 8 }} iconType="square" iconSize={10} />
          <Bar dataKey="collected" name="Cobrado" fill="var(--chart-collected)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} onClick={click} cursor={onSelect ? 'pointer' : undefined} />
          <Bar dataKey="cost" name="Costo directo" fill="var(--chart-cost)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} onClick={click} cursor={onSelect ? 'pointer' : undefined} />
          <Bar dataKey="commission" name="Comisión" fill="var(--chart-commission)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} onClick={click} cursor={onSelect ? 'pointer' : undefined} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <p id={descId} className="sr-only" data-chart-summary>
      {summary}
    </p>
    </>
  );
}
