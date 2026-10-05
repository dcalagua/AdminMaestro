import { useId } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Rectangle,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type RectangleProps,
} from 'recharts';
import { formatCompactAmount, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import type { BridgeStep } from '@/features/dashboard/executiveModel';
import { axisMonth, stepLabel, stepSign } from '@/features/dashboard/executiveModel';

/**
 * Gráficos del Resumen Ejecutivo (fase 09, VISUAL_SYSTEM_V2 §6, skill `dataviz`).
 *  - una sola escala por gráfico (nunca doble eje); sin animación;
 *  - colores por token (`--chart-*`), texto con tokens de texto;
 *  - ejes 12 px `tabular-nums`, grid hairline sólido solo en el eje de valor;
 *  - etiquetas directas selectivas (último valor, extremos del puente);
 *  - tooltip con el valor completo y clic → detalle. La tabla alternativa la da
 *    `ChartPanel` (mismos datos y enlaces por teclado).
 */

const AXIS = { fill: 'var(--chart-axis)', fontSize: 12 };
const TOOLTIP_CLASS = 'rounded-md border border-border bg-elevated px-3 py-2 text-caption shadow-pop';

function TooltipRow({ color, label, value, line = false }: { color?: string; label: string; value: string; line?: boolean }) {
  return (
    <p className="mt-1 flex items-center gap-2">
      {color ? (
        <span
          aria-hidden
          className={line ? 'inline-block h-0.5 w-3 rounded-full' : 'inline-block h-2 w-2 rounded-sm'}
          style={{ background: color }}
        />
      ) : null}
      <span className="font-semibold tabular-nums text-fg">{value}</span>
      <span className="text-muted">{label}</span>
    </p>
  );
}

/* ---- Evolución de MRR (área, protagonista) ------------------------------------------ */

export interface MrrPointDatum {
  month: string;
  label: string;
  mrr: number | null;
  customers: number;
  partial: boolean;
}

function MrrTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload?: MrrPointDatum }>;
  currency: string;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className={TOOLTIP_CLASS}>
      <p className="font-semibold text-fg">
        {p.label}
        {p.partial ? <span className="ml-1 font-normal text-muted">· parcial, a hoy</span> : null}
      </p>
      <TooltipRow color="var(--chart-1)" line label="MRR" value={p.mrr == null ? 'Sin tasa' : formatMoney(p.mrr, currency)} />
      <TooltipRow label="clientes activos" value={formatNumber(p.customers)} />
    </div>
  );
}

/**
 * Área de MRR en moneda de reporte: línea 2 px `--chart-1` + degradado de marca,
 * eje Y desde 0, etiqueta directa del último valor y del mes analizado. El mes en
 * curso (parcial) termina en un marcador hueco. Clic en un mes → `onSelect`.
 */
export function MrrEvolutionChart({
  data,
  currency,
  analyzed,
  onSelect,
  ariaLabel,
}: {
  data: MrrPointDatum[];
  currency: string;
  analyzed?: string;
  onSelect?: (month: string) => void;
  ariaLabel: string;
}) {
  const gradientId = `mrr-area-${useId().replace(/:/g, '')}`;
  const last = data[data.length - 1];
  const picked = data.find((d) => d.month === analyzed);
  return (
    <div role="img" aria-label={ariaLabel} style={{ height: 340 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 28, right: 112, bottom: 4, left: 0 }}
          onClick={(state) => {
            const i = Number(state?.activeTooltipIndex);
            const d = Number.isInteger(i) ? data[i] : undefined;
            if (d && onSelect) onSelect(d.month);
          }}
          style={onSelect ? { cursor: 'pointer' } : undefined}
          accessibilityLayer
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--chart-1)', stopOpacity: 'calc(var(--chart-area-opacity) * 2.2)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--chart-1)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-baseline)' }}
            interval="preserveStartEnd"
            minTickGap={12}
            tickFormatter={(label: string) => axisMonth(data, data.find((d) => d.label === label)?.month)}
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
            content={<MrrTooltip currency={currency} />}
          />
          <Area
            type="monotone"
            dataKey="mrr"
            stroke="var(--chart-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            connectNulls={false}
            dot={false}
            activeDot={{ r: 5, fill: 'var(--chart-1)', stroke: 'var(--card)', strokeWidth: 2 }}
          />
          {picked && picked.mrr != null && picked !== last ? (
            <ReferenceDot
              x={picked.label}
              y={picked.mrr}
              r={5}
              fill="var(--chart-1)"
              stroke="var(--card)"
              strokeWidth={2}
              label={{
                value: `${currency} ${formatCompactAmount(picked.mrr)}`,
                position: 'insideBottomRight',
                offset: 12,
                fill: 'var(--text)',
                fontSize: 12,
                fontWeight: 600,
              }}
            />
          ) : null}
          {last && last.mrr != null ? (
            <ReferenceDot
              x={last.label}
              y={last.mrr}
              r={5}
              fill={last.partial ? 'var(--card)' : 'var(--chart-1)'}
              stroke={last.partial ? 'var(--chart-1)' : 'var(--card)'}
              strokeWidth={2}
              label={{
                value: `${formatCompactAmount(last.mrr)}${last.partial ? ' (parcial)' : ''}`,
                position: 'right',
                offset: 8,
                fill: 'var(--text)',
                fontSize: 12,
                fontWeight: 600,
              }}
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---- Puente de MRR (waterfall horizontal) -------------------------------------------- */

const STEP_FILL: Record<BridgeStep['kind'], string> = {
  total: 'var(--chart-total)',
  pos: 'var(--chart-pos)',
  neg: 'var(--chart-neg)',
};

function BridgeTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload?: BridgeStep }>;
  currency: string;
}) {
  const s = payload?.[0]?.payload;
  if (!active || !s) return null;
  return (
    <div className={TOOLTIP_CLASS}>
      <p className="font-semibold text-fg">{s.label}</p>
      <TooltipRow
        color={STEP_FILL[s.kind]}
        label={s.key === 'NET' ? 'cierre − inicio' : s.kind === 'pos' ? 'suma al MRR' : 'resta al MRR'}
        value={`${stepSign(s)}${formatMoney(Math.abs(s.value), currency)}`}
      />
      {s.customers !== undefined ? (
        <p className="mt-1 text-muted">
          {formatNumber(s.customers)} {s.customers === 1 ? 'cliente' : 'clientes'}
          {s.customers > 0 ? ' · clic para ver' : ''}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Cascada de la variación del MRR en filas (nuevo → expansión → contracción →
 * churn → variación neta), desde la línea de 0 = MRR de inicio. En la columna
 * estrecha del tablero los nombres de paso se leen enteros a la izquierda y el
 * valor con signo al final de cada barra. Aumentos `--chart-pos`,
 * disminuciones `--chart-neg`, neto `--chart-total`.
 */
export function BridgeWaterfall({
  steps,
  currency,
  selected,
  onSelect,
  ariaLabel,
}: {
  steps: BridgeStep[];
  currency: string;
  selected?: BridgeStep['key'] | null;
  onSelect?: (step: BridgeStep) => void;
  ariaLabel: string;
}) {
  const clickable = (s: BridgeStep) => Boolean(onSelect && s.movement && (s.customers ?? 0) > 0);
  const negativeEnd = (s: BridgeStep) => s.kind === 'neg' || (s.key === 'NET' && s.value < 0);
  return (
    <div role="img" aria-label={ariaLabel} style={{ height: steps.length * 44 + 12 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={steps} layout="vertical" margin={{ top: 4, right: 92, bottom: 4, left: 0 }} barCategoryGap="30%" accessibilityLayer>
          <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
          <XAxis type="number" hide domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} />
          <YAxis type="category" dataKey="label" tick={AXIS} width={104} tickLine={false} axisLine={false} />
          <ReferenceLine x={0} stroke="var(--chart-baseline)" />
          <Tooltip cursor={{ fill: 'var(--hover)' }} content={<BridgeTooltip currency={currency} />} />
          <Bar
            dataKey="range"
            isAnimationActive={false}
            maxBarSize={20}
            minPointSize={2}
            shape={(props: RectangleProps & { payload?: BridgeStep }) => (
              <Rectangle {...props} radius={props.payload && negativeEnd(props.payload) ? [4, 0, 0, 4] : [0, 4, 4, 0]} />
            )}
            onClick={(entry) => {
              const step = (entry as unknown as { payload?: BridgeStep }).payload ?? (entry as unknown as BridgeStep);
              if (step && clickable(step)) onSelect?.(step);
            }}
          >
            {steps.map((s) => (
              <Cell
                key={s.key}
                fill={STEP_FILL[s.kind]}
                fillOpacity={selected && selected !== s.key ? 0.4 : 1}
                cursor={clickable(s) ? 'pointer' : undefined}
              />
            ))}
            <LabelList
              dataKey="value"
              content={(props) => {
                const { x, y, width, height, index } = props as { x: number; y: number; width: number; height: number; index: number };
                const s = steps[index];
                if (!s) return null;
                // Al final derecho de la barra (o del 0 si la barra queda a la izquierda).
                const right = Math.max(Number(x), Number(x) + Number(width));
                return (
                  <text
                    x={right + 8}
                    y={Number(y) + Number(height) / 2}
                    dominantBaseline="central"
                    fill="var(--text)"
                    fontSize={12}
                    fontWeight={s.kind === 'total' ? 700 : 600}
                    className="tabular-nums"
                  >
                    {s.value === 0 && s.kind !== 'total' ? '0' : stepLabel(s, currency)}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---- Facturado vs cobrado (barras agrupadas, un eje) ----------------------------------- */

export interface BilledCollectedDatum {
  month: string;
  label: string;
  invoiced: number | null;
  collected: number | null;
  rate: number | null;
  invoices: number;
  payments: number;
  partial: boolean;
}

function BilledTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload?: BilledCollectedDatum }>;
  currency: string;
}) {
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <div className={TOOLTIP_CLASS}>
      <p className="font-semibold text-fg">
        {d.label}
        {d.partial ? <span className="ml-1 font-normal text-muted">· parcial, a hoy</span> : null}
      </p>
      <TooltipRow color="var(--chart-billed)" label={`facturado · ${formatNumber(d.invoices)} facturas`} value={d.invoiced == null ? 'Sin tasa' : formatMoney(d.invoiced, currency)} />
      <TooltipRow color="var(--chart-collected-2)" label={`cobrado · ${formatNumber(d.payments)} pagos`} value={d.collected == null ? 'Sin tasa' : formatMoney(d.collected, currency)} />
      <p className="mt-1 text-muted">
        <span className="font-semibold tabular-nums text-fg">{d.rate == null ? '—' : formatPercent(d.rate, 0)}</span> cobrado de lo facturado
      </p>
    </div>
  );
}

/** Tick de dos líneas: mes y, debajo, % cobrado del mes (sin segundo eje Y, §6.6). */
function MonthRateTick({ x, y, payload, data }: { x?: number; y?: number; payload?: { value: string; index: number }; data: BilledCollectedDatum[] }) {
  const d = data.find((p) => p.label === payload?.value);
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text dy={12} textAnchor="middle" fill="var(--chart-axis)" fontSize={12}>
        {axisMonth(data, d?.month)}
      </text>
      <text dy={30} textAnchor="middle" fill="var(--text-2)" fontSize={12} fontWeight={600} className="tabular-nums">
        {d?.rate == null ? '—' : formatPercent(d.rate, 0)}
      </text>
    </g>
  );
}

export function BilledCollectedChart({
  data,
  currency,
  onSelect,
  ariaLabel,
}: {
  data: BilledCollectedDatum[];
  currency: string;
  onSelect?: (month: string) => void;
  ariaLabel: string;
}) {
  const click = (entry: unknown) => {
    const d = (entry as { payload?: BilledCollectedDatum }).payload ?? (entry as BilledCollectedDatum);
    if (d?.month) onSelect?.(d.month);
  };
  return (
    <div role="img" aria-label={ariaLabel} style={{ height: 292 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barGap={2} barCategoryGap="24%" accessibilityLayer>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-baseline)' }}
            interval={0}
            height={44}
            tick={<MonthRateTick data={data} />}
          />
          <YAxis tick={AXIS} tickFormatter={(v: number) => formatCompactAmount(v)} width={52} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: 'var(--hover)' }} content={<BilledTooltip currency={currency} />} />
          <Bar
            dataKey="invoiced"
            name="Facturado"
            fill="var(--chart-billed)"
            radius={[4, 4, 0, 0]}
            maxBarSize={16}
            isAnimationActive={false}
            onClick={click}
            cursor={onSelect ? 'pointer' : undefined}
          />
          <Bar
            dataKey="collected"
            name="Cobrado"
            fill="var(--chart-collected-2)"
            radius={[4, 4, 0, 0]}
            maxBarSize={16}
            isAnimationActive={false}
            onClick={click}
            cursor={onSelect ? 'pointer' : undefined}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
