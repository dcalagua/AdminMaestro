import { Badge } from '@/components/ui/primitives';
import { SummaryBar, SummaryItem } from '@/components/ui/SummaryBar';
import { nativeInline } from '@/features/billing/financeModel';
import type { CurrencyAmounts } from '@/features/executive/reportContext';
import { formatCountNoun, formatNumber } from '@/lib/format';

type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'info' | 'accent';

export interface DistributionSlice {
  key: string;
  label: string;
  count: number;
}

const SLICE_COLOR = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];

/**
 * Distribución de tenants por modelo en una barra apilada de una línea (V6 · 3.4):
 * reemplaza la tarjeta «Distribución de tenants», que dejaba 200 px vacíos. Las
 * cifras se leen sin color en la leyenda y en el texto accesible.
 */
export function DistributionBar({ slices }: { slices: DistributionSlice[] }) {
  const total = slices.reduce((a, s) => a + s.count, 0);
  if (total === 0) return <span className="font-normal text-muted">Sin tenants</span>;
  const text = slices.map((s) => `${s.label} ${formatNumber(s.count)}`).join(' · ');
  return (
    <span className="flex min-w-[220px] flex-1 flex-col gap-1" data-distribution>
      <span className="flex h-2 w-full overflow-hidden rounded-full bg-sunken" aria-hidden title={text}>
        {slices.map((s, i) =>
          s.count > 0 ? (
            <span key={s.key} style={{ width: `${(s.count / total) * 100}%`, background: SLICE_COLOR[i % SLICE_COLOR.length] }} />
          ) : null,
        )}
      </span>
      <span className="flex flex-wrap gap-x-3 text-caption font-normal text-fg-2">
        {slices.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: SLICE_COLOR[i % SLICE_COLOR.length] }} />
            {s.label} <span className="font-semibold tabular-nums text-fg">{formatNumber(s.count)}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * Cabecera fija de la ficha de producto (V6 · T8): estado, integración, MRR por
 * moneda, tenants, contratos activos y distribución por modelo. Antes eran 4 KPI
 * de conteo y una tarjeta aparte para la distribución.
 */
export function ProductSummaryBar({
  status,
  integration,
  mrr,
  tenants,
  activeContracts,
  distribution,
}: {
  status: { label: string; tone: Tone };
  integration: { label: string; tone: Tone } | null;
  /** `null` = sin vista financiera o cargando (`'…'`). */
  mrr: CurrencyAmounts | 'loading' | 'error' | null;
  tenants: { total: string; production: number | null };
  activeContracts: string;
  distribution: DistributionSlice[] | null;
}) {
  return (
    <SummaryBar label="Resumen del producto">
      <SummaryItem label="Estado">
        <Badge tone={status.tone} dot>{status.label}</Badge>
      </SummaryItem>
      <SummaryItem label="Integración" hint="Estado de la conexión técnica del Admin Maestro con esta app">
        {integration ? <Badge tone={integration.tone}>{integration.label}</Badge> : '…'}
      </SummaryItem>
      {mrr !== null ? (
        <SummaryItem label="MRR vigente" hint="MRR de los tenants del producto por moneda (foto actual); nunca se suman monedas">
          {mrr === 'loading' ? '…' : mrr === 'error' ? (
            <span className="font-normal text-muted">No disponible</span>
          ) : Object.keys(mrr).length > 0 ? (
            <span className="tabular-nums" data-mrr>{nativeInline(mrr)}</span>
          ) : (
            <span className="font-normal text-muted">Sin recurrente vigente</span>
          )}
        </SummaryItem>
      ) : null}
      <SummaryItem label="Tenants">
        <span className="tabular-nums">
          {tenants.total}
          {tenants.production !== null ? (
            <span className="font-normal text-muted"> · {formatCountNoun(tenants.production, 'productivo')}</span>
          ) : null}
        </span>
      </SummaryItem>
      <SummaryItem label="Contratos activos">
        <span className="tabular-nums">{activeContracts}</span>
      </SummaryItem>
      <SummaryItem label="Distribución por modelo" hint="Los tres modelos conviven sin ramas de código" grow>
        {distribution ? <DistributionBar slices={distribution} /> : '…'}
      </SummaryItem>
    </SummaryBar>
  );
}
