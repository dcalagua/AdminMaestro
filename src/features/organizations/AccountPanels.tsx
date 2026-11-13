import { DataTable } from '@/components/ui/primitives';
import { ChartLegend, ChartPanel } from '@/features/executive/components/ChartPanel';
import { fromQuery } from '@/features/executive/dataState';
import { PeriodArea, PeriodBars } from '@/features/billing/lazyFinanceCharts';
import { formatMoney } from '@/lib/format';
import type { AccountSeriesPoint } from '@/services/queries';
import { accountSeriesView, type AccountSeriesView } from './accountSeriesModel';

/**
 * Piezas de las fichas 360 (organización y tenant; VISUAL_SYSTEM_V2 §8 PT-360):
 * los dos mini-gráficos del resumen. El MRR vigente y la salud de cobranza van
 * en la `SummaryBar` de cada ficha (V6 · T8). Todo sale de S11
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
    <DataTable
      paginate={false}
      caption={caption}
      columns={['Mes', ...columns.map((c) => ({ label: `${c.label} (${view.currency})`, align: 'right' as const }))]}
    >
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
    </DataTable>
  );
}
