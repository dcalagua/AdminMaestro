import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type useExecutiveMrrMovementCustomers,
  type useExecutiveMrrMovementsSeries,
  type useExecutiveMrrSeries,
  type ExecutiveMrrBridge,
} from '@/services/queries';
import { DataTable } from '@/components/ui/primitives';
import { fromQuery, type DataState } from '@/features/executive/dataState';
import { ChartPanel } from '@/features/executive/components/ChartPanel';
import { StateMessage } from '@/features/executive/components/StateView';
import {
  BridgeWaterfall,
  MrrEvolutionChart,
  type MrrPointDatum,
} from '@/features/executive/components/executiveCharts';
import { formatCompactAmount, formatDelta, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { monthShortLabel } from '../executiveData';
import {
  bridgeSteps,
  changeSteps,
  customersFor,
  monthLongLabel,
  pctChange,
  stepLabel,
  type BridgeStep,
  type Horizon,
} from '../executiveModel';
import { usePresentationView } from '../presentation/presentationContext';
import { PRESENTATION_CHART_HEIGHT } from './presentationSizes';

/** Paneles de MRR del resumen ejecutivo: evolución, puente del mes y clientes de cada movimiento. */
export function MrrEvolutionPanel({
  query,
  currency,
  horizon,
  month,
  onSelect,
  notice,
}: {
  query: ReturnType<typeof useExecutiveMrrSeries>;
  currency: string;
  horizon: Horizon;
  month: string;
  onSelect: (month: string) => void;
  /** Aviso extra en la línea de cobertura (el puente plegado). */
  notice?: string;
}) {
  const view = usePresentationView();
  const points = (query.data ?? []).slice(-horizon);
  const data: MrrPointDatum[] = points.map((p) => ({
    month: p.month.slice(0, 7),
    label: monthShortLabel(p.month.slice(0, 7)),
    mrr: p.mrr,
    customers: p.activeCustomers,
    partial: p.isPartial,
  }));
  const first = data.find((d) => d.mrr != null);
  const closed = [...data].reverse().find((d) => !d.partial && d.mrr != null);
  const growth = first && closed ? pctChange(closed.mrr, first.mrr) : null;
  const state = fromQuery(query, { isEmpty: (rows) => rows.every((r) => r.mrr === 0) });
  const missing = [...new Set(points.flatMap((p) => p.missingCurrencies))];
  return (
    <ChartPanel
      id="evolucion-mrr"
      className="h-full"
      title="¿Cómo crece el ingreso recurrente?"
      unit={`MRR contratado en ${currency}`}
      period={
        first && closed && growth != null
          ? `Últimos ${horizon} meses · ${first.label} → ${closed.label}: ${growth >= 0 ? '+' : '−'}${formatPercent(Math.abs(growth), 0)}`
          : `Últimos ${horizon} meses`
      }
      source="executive_mrr_series"
      coverage={[
        missing.length ? `Meses sin tasa para ${missing.join(', ')} quedan sin dibujar` : 'Clic en un mes para analizarlo; el punto hueco es el mes en curso',
        notice,
      ]
        .filter(Boolean)
        .join(' · ')}
      state={state.status === 'ready' && missing.length ? { status: 'partial', data: points, reasons: [`falta tasa ${missing.join(', ')}`] } : state}
      onRetry={() => void query.refetch()}
      emptyText="Aún no hay contratos con MRR en el período"
      refreshing={query.isPlaceholderData}
      detailHref="/subscriptions"
      detailLabel="Ver contratos"
      chart={() => (
        <MrrEvolutionChart
          data={data}
          currency={currency}
          analyzed={month}
          onSelect={onSelect}
          // Proyectando: el gráfico ocupa el alto disponible de la diapositiva y el texto sube un escalón.
          height={view.printing ? 380 : view.active ? PRESENTATION_CHART_HEIGHT : 340}
          fontSize={view.active ? 14 : 12}
          ariaLabel={`MRR en ${currency} de ${data[0]?.label ?? ''} a ${data[data.length - 1]?.label ?? ''}${
            growth != null ? `, crecimiento de ${formatPercent(growth, 0)} en meses cerrados` : ''
          }. Use la vista Tabla para leer cada mes.`}
        />
      )}
      table={() => (
        <DataTable
          paginate={false}
          caption="MRR por mes"
          columns={[
            'Mes',
            { label: `MRR (${currency})`, align: 'right' },
            { label: `ARR (${currency})`, align: 'right' },
            { label: 'Clientes', align: 'right' },
            { label: 'Contratos', align: 'right' },
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
              <td className="ebim-td text-right tabular-nums">{p.mrr == null ? 'Sin tasa' : formatMoney(p.mrr, currency)}</td>
              <td className="ebim-td text-right tabular-nums">{p.arr == null ? 'Sin tasa' : formatMoney(p.arr, currency)}</td>
              <td className="ebim-td text-right tabular-nums">{formatNumber(p.activeCustomers)}</td>
              <td className="ebim-td text-right tabular-nums">{formatNumber(p.activeSubscriptions)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    />
  );
}

/* ---- Puente de MRR ------------------------------------------------------------------ */

export function BridgePanel({
  query,
  bridge,
  customers,
  currency,
  month,
}: {
  query: ReturnType<typeof useExecutiveMrrMovementsSeries>;
  bridge: ExecutiveMrrBridge | null;
  customers: ReturnType<typeof useExecutiveMrrMovementCustomers>;
  currency: string;
  month: string;
}) {
  const view = usePresentationView();
  const [selected, setSelected] = useState<BridgeStep | null>(null); // se reinicia con el mes (key)
  const steps = bridgeSteps(bridge);
  const base = fromQuery(query, { isEmpty: () => bridge === null });
  const state: DataState<unknown> =
    base.status === 'ready' && !steps ? { status: 'unavailable', reason: 'Falta un tipo de cambio para consolidar el puente de este mes.' } : base;
  const active = steps?.find((s) => s.key === selected?.key) ?? null;
  const pick = (s: BridgeStep) => setSelected((cur) => (cur?.key === s.key ? null : s));
  const movers = steps?.filter((s) => s.movement) ?? [];
  const cascade = changeSteps(steps);
  const net = cascade?.find((s) => s.key === 'NET');

  return (
    <ChartPanel
      id="puente"
      className="h-full"
      title="¿De dónde viene el cambio del MRR?"
      unit={`Puente de MRR en ${currency}`}
      period={monthLongLabel(month)}
      source="executive_mrr_movements_series"
      coverage={
        bridge?.fxRevaluation
          ? `Inicio a la tasa del mes; el tipo de cambio movió ${bridge.fxRevaluation > 0 ? '+' : '−'}${currency} ${formatCompactAmount(Math.abs(bridge.fxRevaluation))} aparte`
          : 'Clic en un movimiento para ver sus clientes'
      }
      state={state}
      onRetry={() => void query.refetch()}
      emptyText="Sin puente para este mes"
      refreshing={query.isPlaceholderData}
      chart={() =>
        steps && cascade ? (
          <div key={month}>
            <p className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-compact text-muted">
              <span>Inicio</span>
              <span className="font-semibold text-fg">{currency} {formatCompactAmount(bridge?.opening)}</span>
              <span aria-hidden>→</span>
              <span>cierre</span>
              <span className="text-h3 text-fg">{currency} {formatCompactAmount(bridge?.closing)}</span>
              {net && bridge?.opening ? (
                <span className={`font-semibold tabular-nums ${net.value >= 0 ? 'text-ok' : 'text-danger'}`}>
                  {formatDelta(net.value / bridge.opening)}
                </span>
              ) : null}
            </p>
            <BridgeWaterfall
              steps={cascade}
              currency={currency}
              selected={active?.key ?? null}
              onSelect={pick}
              rowHeight={view.active ? 60 : 44}
              fontSize={view.active ? 14 : 12}
              ariaLabel={`Puente de MRR de ${monthLongLabel(month)}: ${steps.concat(net ? [net] : []).map((s) => `${s.label} ${stepLabel(s, currency)}`).join(', ')}`}
            />
            <div role="group" aria-label="Ver clientes por movimiento" className="mt-2 flex flex-wrap gap-1.5">
              {movers.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={active?.key === s.key}
                  disabled={(s.customers ?? 0) === 0}
                  onClick={() => pick(s)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption font-semibold transition-colors duration-fast disabled:cursor-default disabled:opacity-50 ${
                    active?.key === s.key ? 'border-focus bg-accent-soft text-accent-deep' : 'border-border text-fg-2 hover:bg-hover'
                  }`}
                >
                  <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: s.kind === 'pos' ? 'var(--chart-pos)' : 'var(--chart-neg)' }} />
                  {s.label} <span className="tabular-nums text-muted">{formatNumber(s.customers ?? 0)}</span>
                </button>
              ))}
            </div>
            {active?.movement ? <MovementCustomers step={active} query={customers} currency={currency} /> : null}
          </div>
        ) : null
      }
      table={() =>
        steps ? (
          <DataTable
            paginate={false}
            caption="Puente de MRR"
            columns={[
              'Paso',
              { label: `Importe (${currency})`, align: 'right' },
              { label: 'Clientes', align: 'right' },
            ]}
          >
            {steps.map((s) => (
              <tr key={s.key}>
                <th scope="row" className="ebim-td text-left">
                  {s.movement && (s.customers ?? 0) > 0 ? (
                    <button type="button" className="ebim-link" onClick={() => pick(s)}>
                      {s.label}
                    </button>
                  ) : (
                    s.label
                  )}
                </th>
                <td className="ebim-td text-right tabular-nums">
                  {s.kind === 'neg' ? '−' : s.kind === 'pos' ? '+' : ''}
                  {formatMoney(s.value, currency)}
                </td>
                <td className="ebim-td text-right tabular-nums">{s.customers === undefined ? '—' : formatNumber(s.customers)}</td>
              </tr>
            ))}
          </DataTable>
        ) : null
      }
    />
  );
}

function MovementCustomers({
  step,
  query,
  currency,
}: {
  step: BridgeStep;
  query: ReturnType<typeof useExecutiveMrrMovementCustomers>;
  currency: string;
}) {
  const view = usePresentationView();
  const state = fromQuery(query, { isEmpty: () => false });
  const rows = step.movement ? customersFor(query.data, step.movement) : [];
  return (
    <div className="mt-3 rounded-md border border-border bg-sunken px-3 py-2" aria-live="polite" data-testid="bridge-customers">
      <p className="text-micro text-muted">
        {step.label}: {formatNumber(rows.length)} {rows.length === 1 ? 'cliente' : 'clientes'}
      </p>
      {state.status === 'ready' ? (
        <ul className="mt-1 max-h-48 divide-y divide-border overflow-auto">
          {rows.map((r) => (
            <li key={r.organizationId} className="flex items-center justify-between gap-3 py-1.5">
              {view.masked ? (
                // Nombres ocultos: alias sin enlace (la ficha mostraría el nombre real).
                <span className="truncate text-compact text-fg">{view.customerName(r.organizationId, r.organizationName ?? '')}</span>
              ) : (
                <Link className="ebim-link truncate text-compact" to={`/organizations/${r.organizationId}`} title={r.organizationName ?? undefined}>
                  {r.organizationName ?? 'Organización sin nombre'}
                </Link>
              )}
              <span className="whitespace-nowrap text-compact font-semibold tabular-nums text-fg">
                {r.delta == null ? 'Sin tasa' : `${r.delta >= 0 ? '+' : '−'}${formatMoney(Math.abs(r.delta), currency)}`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <StateMessage state={state} compact onRetry={() => void query.refetch()} />
      )}
    </div>
  );
}
