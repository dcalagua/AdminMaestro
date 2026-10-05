import type { ReactNode } from 'react';
import { KpiTile } from '@/components/ui/primitives';
import { ChartLegend, ChartPanel } from '@/features/executive/components/ChartPanel';
import { fromQuery } from '@/features/executive/dataState';
import { PeriodArea, PeriodBars } from '@/features/billing/lazyFinanceCharts';
import { longMonthName, relChange } from '@/features/billing/financeModel';
import { formatCompactAmount, formatMoney } from '@/lib/format';
import type { AccountSeriesPoint } from '@/services/queries';
import { HEALTH_TEXT, accountSeriesView, type AccountHealth, type AccountSeriesView } from './accountSeriesModel';

/**
 * Piezas de las fichas 360 (organización y tenant; VISUAL_SYSTEM_V2 §8 PT-360):
 * el tile de MRR con su tendencia de 12 meses, el tile de salud de cobranza y
 * los dos mini-gráficos del resumen. Todo sale de S11
 * (`executive_account_series`): la UI elige moneda y presenta, no calcula.
 */

interface SeriesQuery {
  data?: AccountSeriesPoint[];
  error?: unknown;
  isLoading?: boolean;
  isFetching?: boolean;
  dataUpdatedAt?: number;
  refetch: () => unknown;
}

const BILLING_SERIES = [
  { key: 'invoiced', label: 'Facturado', color: 'var(--chart-billed)' },
  { key: 'collected', label: 'Cobrado', color: 'var(--chart-collected-2)' },
];

function currencyNote(view: AccountSeriesView): string {
  return view.native ? `en ${view.currency}, la moneda de la cuenta` : `en ${view.currency} (moneda de reporte)`;
}

/** MRR vigente (último punto de S11 = hoy) con tendencia de 12 meses y variación vs el mes anterior. */
export function AccountMrrTile({ query, label = 'MRR vigente', to, info }: { query: SeriesQuery; label?: string; to?: string; info?: string }) {
  if (query.isLoading) return <KpiTile label={label} value={null} loading />;
  if (query.error) return <KpiTile label={label} value={null} error="No disponible" onRetry={() => void query.refetch()} />;
  const view = accountSeriesView(query.data);
  const last = view?.points[view.points.length - 1];
  const prev = view?.points[view.points.length - 2];
  if (!view || !last || !view.hasMrr) {
    return <KpiTile label={label} value={null} info={info} footer="Sin contratos recurrentes vigentes" to={to} />;
  }
  return (
    <KpiTile
      label={label}
      info={info}
      to={to}
      currency={last.mrr == null ? undefined : view.currency}
      value={last.mrr == null ? null : <span title={formatMoney(last.mrr, view.currency)}>{formatCompactAmount(last.mrr)}</span>}
      delta={
        prev
          ? {
              value: relChange(last.mrr, prev.mrr),
              kind: 'percent',
              comparison: `vs ${longMonthName(prev.month.slice(0, 7))}`,
              goodWhen: 'up',
            }
          : undefined
      }
      trend={view.points.map((p) => p.mrr)}
      trendPartial={last.partial}
      trendDescription={`MRR de los últimos ${view.points.length} meses ${currencyNote(view)}`}
      footer={
        last.mrr == null
          ? `Falta tipo de cambio: ${view.missing.join(', ')}`
          : `${formatCompactAmount((last.mrr ?? 0) * 12)} ARR · ${view.native ? 'moneda de la cuenta' : 'moneda de reporte'}`
      }
    />
  );
}

/** Salud de cobranza: texto + icono del rol (nunca solo color). */
export function HealthTile({
  health,
  loading,
  error,
  onRetry,
  footer,
  to,
}: {
  health: AccountHealth;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  footer?: ReactNode;
  to?: string;
}) {
  const label = 'Salud de cobranza';
  if (loading) return <KpiTile label={label} value={null} loading />;
  if (error) return <KpiTile label={label} value={null} error="No disponible" onRetry={onRetry} />;
  const h = HEALTH_TEXT[health];
  return (
    <KpiTile
      label={label}
      value={<span className="block text-h2 leading-tight">{h.label}</span>}
      tone={h.tone}
      footer={footer ?? h.detail}
      to={to}
    />
  );
}

/** «¿Cómo evoluciona su MRR?» + «¿Paga lo que se le factura?», 7·5 en escritorio. */
export function AccountTrendCharts({ query, subject }: { query: SeriesQuery; subject: string }) {
  const view = accountSeriesView(query.data);
  const months = view?.points.length ?? 12;
  const mrrState = fromQuery(query, { isEmpty: () => !view?.hasMrr });
  const billState = fromQuery(query, { isEmpty: () => !view?.hasBilling });
  const unit = view ? `Por mes ${currencyNote(view)}` : 'Por mes';
  const coverage = view?.missing.length ? `Falta tipo de cambio para ${view.missing.join(', ')}` : undefined;
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <ChartPanel
        id="account-mrr"
        className="lg:col-span-7"
        title={`¿Cómo evoluciona el MRR de ${subject}?`}
        unit={unit}
        period={`Últimos ${months} meses · el mes en curso a hoy`}
        source="executive_account_series"
        coverage={coverage ?? 'MRR contratado al cierre de cada mes (misma definición que el Resumen Ejecutivo)'}
        state={mrrState}
        onRetry={() => void query.refetch()}
        emptyText="Sin contratos recurrentes en los últimos 12 meses"
        chart={() => (
          <PeriodArea
            data={view!.points.map((p) => ({ key: p.month, label: p.label, title: p.title, partial: p.partial, values: { mrr: p.mrr } }))}
            series={{ key: 'mrr', label: 'MRR', color: 'var(--chart-1)' }}
            unit={{ currency: view!.currency }}
            height={220}
            ariaLabel={`MRR de ${subject} por mes en ${view!.currency}. Use la vista Tabla para leer cada mes.`}
          />
        )}
        table={() => (
          <SeriesTable view={view!} caption={`MRR de ${subject} por mes`} columns={[{ key: 'mrr', label: 'MRR' }]} />
        )}
      />
      <ChartPanel
        id="account-billing"
        className="lg:col-span-5"
        title="¿Paga lo que se le factura?"
        unit={unit}
        period={`Últimos ${months} meses`}
        source="executive_account_series"
        coverage={coverage ?? 'Facturas emitidas por fecha de emisión y pagos confirmados por fecha de cobro'}
        state={billState}
        onRetry={() => void query.refetch()}
        emptyText="Sin facturas ni cobros en los últimos 12 meses"
        legend={<ChartLegend items={BILLING_SERIES.map((s) => ({ label: s.label, color: s.color }))} />}
        chart={() => (
          <PeriodBars
            data={view!.points.map((p) => ({
              key: p.month,
              label: p.label.split(' ')[0]!,
              title: p.title,
              partial: p.partial,
              values: { invoiced: p.invoiced, collected: p.collected },
            }))}
            series={BILLING_SERIES}
            unit={{ currency: view!.currency }}
            height={220}
            ariaLabel={`Facturado y cobrado de ${subject} por mes en ${view!.currency}. Use la vista Tabla para leer cada mes.`}
          />
        )}
        table={() => (
          <SeriesTable
            view={view!}
            caption={`Facturado y cobrado de ${subject} por mes`}
            columns={[
              { key: 'invoiced', label: 'Facturado' },
              { key: 'collected', label: 'Cobrado' },
            ]}
          />
        )}
      />
    </div>
  );
}

function SeriesTable({
  view,
  caption,
  columns,
}: {
  view: AccountSeriesView;
  caption: string;
  columns: Array<{ key: 'mrr' | 'invoiced' | 'collected'; label: string }>;
}) {
  return (
    <table className="w-full text-compact">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="ebim-th">
            Mes
          </th>
          {columns.map((c) => (
            <th key={c.key} scope="col" className="ebim-th text-right">
              {c.label} ({view.currency})
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {[...view.points].reverse().map((p) => (
          <tr key={p.month}>
            <th scope="row" className="ebim-td text-left font-medium">
              {p.title}
              {p.partial ? <span className="ml-1 text-muted">(a hoy)</span> : null}
            </th>
            {columns.map((c) => (
              <td key={c.key} className="ebim-td ebim-num">
                {p[c.key] == null ? 'Sin tasa' : formatMoney(p[c.key]!, view.currency)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
