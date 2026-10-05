import { useId } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompactAmount, formatMoney, formatNumber } from '@/lib/format';

/**
 * Barras por período de las pantallas de Finanzas (fase 10; VISUAL_SYSTEM_V2 §6,
 * skill `dataviz`). Se carga perezosamente (`lazyFinanceCharts.tsx`): Recharts
 * no entra en el bundle de los listados.
 *  - una sola escala (nunca doble eje), sin animación, eje Y desde 0;
 *  - colores por token, en el orden fijo de la paleta; texto con tokens de texto;
 *  - ejes 12 px; grid hairline solo en el eje de valor;
 *  - apiladas con 2 px de superficie entre segmentos y extremo redondeado solo
 *    arriba; agrupadas con 2 px entre barras;
 *  - período en curso más tenue (parcial) y rotulado en el tooltip;
 *  - tooltip por barra con el valor completo. La tabla alternativa la da `ChartPanel`.
 */

export interface PeriodSeries {
  key: string;
  label: string;
  /** Color por token (`var(--chart-1)`). */
  color: string;
}

export interface PeriodDatum {
  key: string;
  /** Etiqueta del eje (`sep`, `ene 26`, `15 sep`). */
  label: string;
  /** Título del tooltip (`septiembre 2026`, `semana del 15 sep`). */
  title: string;
  partial?: boolean;
  values: Record<string, number | null>;
}

const AXIS = { fill: 'var(--chart-axis)', fontSize: 12 };

type Unit = { currency: string } | { quantity: string };

function formatValue(value: number | null | undefined, unit: Unit): string {
  if (value == null) return 'Sin tasa';
  return 'currency' in unit ? formatMoney(value, unit.currency) : `${formatNumber(Math.round(value))} ${unit.quantity}`;
}

function PeriodTooltip({
  active,
  payload,
  series,
  unit,
  stacked,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, unknown> }>;
  series: PeriodSeries[];
  unit: Unit;
  stacked: boolean;
}) {
  const row = payload?.[0]?.payload as (Record<string, unknown> & { __datum: PeriodDatum }) | undefined;
  if (!active || !row) return null;
  const d = row.__datum;
  const total = stacked ? series.reduce((t, s) => t + (d.values[s.key] ?? 0), 0) : null;
  return (
    <div className="rounded-md border border-border bg-elevated px-3 py-2 text-caption shadow-pop">
      <p className="font-semibold text-fg">
        {d.title}
        {d.partial ? <span className="ml-1 font-normal text-muted">· en curso, a hoy</span> : null}
      </p>
      {series.map((s) => (
        <p key={s.key} className="mt-1 flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
          <span className="font-semibold tabular-nums text-fg">{formatValue(d.values[s.key], unit)}</span>
          <span className="text-muted">{s.label.toLowerCase()}</span>
        </p>
      ))}
      {stacked && series.length > 1 ? (
        <p className="mt-1 border-t border-border pt-1 text-muted">
          Total <span className="font-semibold tabular-nums text-fg">{formatValue(total, unit)}</span>
        </p>
      ) : null}
    </div>
  );
}

export function PeriodBars({
  data,
  series,
  unit,
  stacked = false,
  height = 240,
  ariaLabel,
}: {
  data: PeriodDatum[];
  series: PeriodSeries[];
  unit: Unit;
  stacked?: boolean;
  height?: number;
  ariaLabel: string;
}) {
  const rows = data.map((d) => ({ label: d.label, __datum: d, ...d.values }));
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
          barGap={2}
          barCategoryGap={stacked ? '28%' : '22%'}
          accessibilityLayer
        >
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-baseline)' }}
            interval="preserveStartEnd"
            minTickGap={4}
          />
          <YAxis tick={AXIS} tickFormatter={(v: number) => formatCompactAmount(v)} width={52} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            content={<PeriodTooltip series={series} unit={unit} stacked={stacked} />}
          />
          {series.map((s, i) => {
            const top = !stacked || i === series.length - 1;
            return (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                stackId={stacked ? 'total' : undefined}
                radius={top ? [4, 4, 0, 0] : 0}
                // 2 px de superficie entre segmentos apilados (§ marks-and-anatomy).
                stroke={stacked ? 'var(--card)' : undefined}
                strokeWidth={stacked ? 2 : 0}
                maxBarSize={stacked ? 28 : 18}
                isAnimationActive={false}
              >
                {data.map((d) => (
                  <Cell key={d.key} fillOpacity={d.partial ? 0.45 : 1} />
                ))}
              </Bar>
            );
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Área de una sola serie por período (fichas 360: «MRR del cliente, 12 meses»).
 * Línea 2 px + relleno tenue del mismo token, eje Y desde 0, sin animación,
 * crosshair con tooltip; el período en curso (parcial) se marca con un punto
 * hueco. Un solo color: el título de la tarjeta nombra la serie (sin leyenda).
 */
export function PeriodArea({
  data,
  series,
  unit,
  height = 240,
  ariaLabel,
}: {
  data: PeriodDatum[];
  series: PeriodSeries;
  unit: Unit;
  height?: number;
  ariaLabel: string;
}) {
  const gradientId = `period-area-${useId().replace(/:/g, '')}`;
  const rows = data.map((d) => ({ label: d.label, __datum: d, ...d.values }));
  const last = data[data.length - 1];
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 12, right: 12, bottom: 4, left: 0 }} accessibilityLayer>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: series.color, stopOpacity: 'calc(var(--chart-area-opacity) * 2.2)' }} />
              <stop offset="100%" style={{ stopColor: series.color, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-baseline)' }}
            interval="preserveStartEnd"
            minTickGap={4}
          />
          <YAxis
            tick={AXIS}
            tickFormatter={(v: number) => formatCompactAmount(v)}
            width={52}
            tickLine={false}
            axisLine={false}
            domain={[0, 'auto']}
          />
          <Tooltip
            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
            content={<PeriodTooltip series={[series]} unit={unit} stacked={false} />}
          />
          <Area
            type="monotone"
            dataKey={series.key}
            name={series.label}
            stroke={series.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            connectNulls={false}
            dot={(props: { cx?: number; cy?: number; index?: number }) =>
              props.index === data.length - 1 && last?.partial && props.cx != null && props.cy != null ? (
                <circle key="partial" cx={props.cx} cy={props.cy} r={4} fill="var(--card)" stroke={series.color} strokeWidth={2} />
              ) : (
                <g key={`d${props.index}`} />
              )
            }
            activeDot={{ r: 5, fill: series.color, stroke: 'var(--card)', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
