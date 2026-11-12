import { type useExecutiveBillingSeries } from '@/services/queries';
import { DataTable } from '@/components/ui/primitives';
import { fromQuery } from '@/features/executive/dataState';
import { ChartLegend, ChartPanel } from '@/features/executive/components/ChartPanel';
import {
  BilledCollectedChart,
  type BilledCollectedDatum,
} from '@/features/executive/components/executiveCharts';
import { formatMoney, formatPercent } from '@/lib/format';
import { monthShortLabel } from '../executiveData';
import { type Horizon } from '../executiveModel';
import { usePresentationView } from '../presentation/presentationContext';
import { PRESENTATION_BARS_HEIGHT } from './presentationSizes';

/** Panel «Facturado vs cobrado» del resumen ejecutivo. */
export function BilledCollectedPanel({
  query,
  currency,
  horizon,
  month,
  onSelect,
}: {
  query: ReturnType<typeof useExecutiveBillingSeries>;
  currency: string;
  horizon: Horizon;
  month: string;
  onSelect: (month: string) => void;
}) {
  const view = usePresentationView();
  // Barras legibles: como máximo 12 meses, terminando en el mes analizado (o el actual si el horizonte lo incluye).
  const all = query.data ?? [];
  const end = all.findIndex((p) => p.month.slice(0, 7) === month);
  const points = (end >= 0 ? all.slice(0, end + 1) : all).slice(-Math.min(horizon, 12));
  const data: BilledCollectedDatum[] = points.map((p) => ({
    month: p.month.slice(0, 7),
    label: monthShortLabel(p.month.slice(0, 7)),
    invoiced: p.invoiced,
    collected: p.collected,
    rate: p.collectionRate,
    invoices: p.invoiceCount,
    payments: p.paymentCount,
    partial: p.isPartial,
  }));
  const closed = points.filter((p) => !p.isPartial && p.invoiced != null && p.collected != null);
  const inv = closed.reduce((t, p) => t + (p.invoiced ?? 0), 0);
  const col = closed.reduce((t, p) => t + (p.collected ?? 0), 0);
  const rate = inv > 0 ? col / inv : null;
  const state = fromQuery(query, { isEmpty: (rows) => rows.every((r) => r.invoiceCount === 0 && r.paymentCount === 0) });
  return (
    <ChartPanel
      id="facturado-cobrado"
      className="h-full"
      title="¿Cobramos lo que facturamos?"
      unit={`Facturado y cobrado por mes en ${currency}`}
      period={`${data[0]?.label ?? ''} – ${data[data.length - 1]?.label ?? ''}${rate != null ? ` · ${formatPercent(rate)} cobrado en meses cerrados` : ''}`}
      source="executive_billing_series"
      coverage="Bajo cada mes: % cobrado de lo facturado ese mes (caja; puede superar 100 % si se cobró atraso)"
      state={state}
      onRetry={() => void query.refetch()}
      emptyText="Sin facturas ni cobros en el período"
      refreshing={query.isPlaceholderData}
      detailHref="/cobranza?tab=facturacion#cobros"
      detailLabel="Ver cobros"
      legend={
        <ChartLegend
          items={[
            { label: 'Facturado', color: 'var(--chart-billed)' },
            { label: 'Cobrado', color: 'var(--chart-collected-2)' },
          ]}
        />
      }
      chart={() => (
        <BilledCollectedChart
          data={data}
          currency={currency}
          onSelect={onSelect}
          height={view.printing ? 280 : view.active ? PRESENTATION_BARS_HEIGHT : 292}
          fontSize={view.active ? 14 : 12}
          ariaLabel={`Facturado y cobrado por mes en ${currency}${rate != null ? `; en meses cerrados se cobró ${formatPercent(rate)} de lo facturado` : ''}. Use la vista Tabla para leer cada mes.`}
        />
      )}
      table={() => (
        <DataTable
          paginate={false}
          caption="Facturado vs cobrado por mes"
          columns={[
            'Mes',
            { label: `Facturado (${currency})`, align: 'right' },
            { label: `Cobrado (${currency})`, align: 'right' },
            { label: '% cobrado', align: 'right' },
            { label: 'Vencida al cierre', align: 'right' },
          ]}
        >
          {[...points].reverse().map((p) => (
            <tr key={p.month}>
              <th scope="row" className="ebim-td text-left font-medium">
                <button type="button" className="ebim-link" onClick={() => onSelect(p.month.slice(0, 7))}>
                  {monthShortLabel(p.month.slice(0, 7))}
                </button>
                {p.isPartial ? <span className="ml-1 text-caption text-muted">(parcial)</span> : null}
              </th>
              <td className="ebim-td text-right tabular-nums">{p.invoiced == null ? 'Sin tasa' : formatMoney(p.invoiced, currency)}</td>
              <td className="ebim-td text-right tabular-nums">{p.collected == null ? 'Sin tasa' : formatMoney(p.collected, currency)}</td>
              <td className="ebim-td text-right tabular-nums">{p.collectionRate == null ? '—' : formatPercent(p.collectionRate)}</td>
              <td className="ebim-td text-right tabular-nums">{p.overdue == null ? 'Sin tasa' : formatMoney(p.overdue, currency)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    />
  );
}
