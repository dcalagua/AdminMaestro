import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ClockCountdownIcon, FlaskIcon } from '@phosphor-icons/react';
import {
  useCurrencies,
  useExecutiveAging,
  useExecutiveBillingSeries,
  useExecutiveMrrMix,
  useExecutiveMrrMovementCustomers,
  useExecutiveMrrMovementsSeries,
  useExecutiveMrrSeries,
  type ExecutiveBillingPoint,
  type ExecutiveMrrBridge,
  type ExecutiveMrrPoint,
} from '@/services/queries';
import { KpiTile } from '@/components/ui/primitives';
import { fromQuery, type DataState } from '@/features/executive/dataState';
import { currentMonth, isoDate, lastMonths, previousMonth } from '@/features/executive/reportContext';
import { ChartLegend, ChartPanel, CurrencyPicker } from '@/features/executive/components/ChartPanel';
import { StateMessage } from '@/features/executive/components/StateView';
import {
  BilledCollectedChart,
  BridgeWaterfall,
  MrrEvolutionChart,
  type BilledCollectedDatum,
  type MrrPointDatum,
} from '@/features/executive/components/executiveCharts';
import { formatCompactAmount, formatDate, formatDelta, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { monthShortLabel } from './executiveData';
import {
  analyzedMonthOptions,
  bridgeSteps,
  changeSteps,
  customersFor,
  HORIZONS,
  lastClosedMonth,
  monthBounds,
  monthLongLabel,
  mrrChurnRate,
  netRevenueRetention,
  pctChange,
  pointAt,
  stepLabel,
  trailing,
  type BridgeStep,
  type Horizon,
} from './executiveModel';
import { AgingPanel, AttentionPanel, MixPanel, PanelBoundary, TopCustomersPanel, TopPartnersPanel } from './executivePanels';

/**
 * Perspectiva EJECUTIVA — Resumen Ejecutivo V4 (fase 09, D-V05).
 *
 * Orden de lectura: (1) franja hero de 6 KPI con tendencia de 12 meses,
 * (2) evolución del MRR y su puente del mes, (3) facturado vs cobrado y
 * cartera vencida, (4) mix por producto y mercado, (5) tops y lo que requiere
 * atención. Todo en UNA moneda de reporte convertida en la base (S01–S08):
 * si falta una tasa, la cifra se rotula «sin tasa», nunca se rellena.
 *
 * Una sola fila de filtros (moneda, horizonte, mes analizado) acota todo lo de
 * abajo y vive en la URL (`?moneda=USD&horizonte=18&cierre=2026-09`). El mes
 * analizado por defecto es el último CERRADO: el mes en curso es parcial.
 * Cada panel lee su propia fuente y falla solo.
 */
export function ExecutivePerspective({ today = new Date() }: { today?: Date }) {
  const navigate = useNavigate();
  const filters = useExecutiveFilters(today);
  const { month, horizon, reportingCurrency } = filters;
  const now = currentMonth(today);
  const isCurrent = month === now;
  const prev = previousMonth(month);
  const monthLabel = monthLongLabel(month);
  const prevShort = monthShortLabel(prev).split(' ')[0];

  // 24 meses de serie: el horizonte (12/18) más la tendencia de 12 de cualquier mes analizado.
  const seriesFrom = `${lastMonths(now, 24)[0]}-01`;
  const series = useExecutiveMrrSeries({ from: seriesFrom, reportingCurrency });
  const billing = useExecutiveBillingSeries({ from: seriesFrom, reportingCurrency });
  const movements = useExecutiveMrrMovementsSeries({ from: `${lastMonths(month, 12)[0]}-01`, to: `${month}-01`, reportingCurrency });
  const customers = useExecutiveMrrMovementCustomers(`${month}-01`, reportingCurrency);
  const asOf = isCurrent ? isoDate(today) : monthBounds(month).to;
  const aging = useExecutiveAging(asOf, reportingCurrency);
  const mixProduct = useExecutiveMrrMix('PRODUCT', `${month}-01`, reportingCurrency);
  const mixMarket = useExecutiveMrrMix('MARKET', `${month}-01`, reportingCurrency);
  const mixPartner = useExecutiveMrrMix('PARTNER', `${month}-01`, reportingCurrency);
  const mixPartnerPrev = useExecutiveMrrMix('PARTNER', `${prev}-01`, reportingCurrency);

  const rc = series.data?.[0]?.reportingCurrency ?? billing.data?.[0]?.reportingCurrency ?? reportingCurrency ?? '';
  const missing = [...new Set([...(series.data ?? []), ...(billing.data ?? [])].flatMap((p) => p.missingCurrencies))].sort();
  const fxIsDemo = [...(series.data ?? []), ...(billing.data ?? [])].some((p) => p.fxIsDemo);
  const bridge = movements.data?.find((b) => b.month.slice(0, 7) === month) ?? null;

  return (
    <div className="space-y-6">
      <FilterRow
        {...filters}
        currency={rc}
        missing={missing}
        fxIsDemo={fxIsDemo}
        isCurrent={isCurrent}
        today={today}
      />

      <HeroKpis
        month={month}
        prevShort={prevShort}
        isCurrent={isCurrent}
        currency={rc}
        series={series}
        billing={billing}
        movements={movements}
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8">
          <PanelBoundary title="Evolución del MRR">
            <MrrEvolutionPanel query={series} currency={rc} horizon={horizon} month={month} onSelect={(m) => filters.setMonth(m)} />
          </PanelBoundary>
        </div>
        <div className="min-w-0 xl:col-span-4">
          <PanelBoundary title="Puente de MRR">
            <BridgePanel key={month} query={movements} bridge={bridge} customers={customers} currency={rc} month={month} />
          </PanelBoundary>
        </div>

        <div className="min-w-0 xl:col-span-7">
          <PanelBoundary title="Facturado vs cobrado">
            <BilledCollectedPanel
              query={billing}
              currency={rc}
              horizon={horizon}
              month={month}
              onSelect={(m) => {
                const r = monthBounds(m);
                navigate(`/billing?desde=${r.from}&hasta=${r.to}#cobros`);
              }}
            />
          </PanelBoundary>
        </div>
        <div className="min-w-0 xl:col-span-5">
          <PanelBoundary title="Cartera por antigüedad">
            <AgingPanel
              query={aging}
              currency={rc}
              asOfLabel={isCurrent ? `A hoy, ${formatDate(asOf)}` : `Al cierre de ${monthLabel}`}
              refreshing={aging.isPlaceholderData}
            />
          </PanelBoundary>
        </div>

        <div className="min-w-0 xl:col-span-6">
          <PanelBoundary title="Mix por producto">
            <MixPanel dimension="PRODUCT" query={mixProduct} currency={rc} monthLabel={monthLabel} refreshing={mixProduct.isPlaceholderData} />
          </PanelBoundary>
        </div>
        <div className="min-w-0 xl:col-span-6">
          <PanelBoundary title="Mix por mercado">
            <MixPanel dimension="MARKET" query={mixMarket} currency={rc} monthLabel={monthLabel} refreshing={mixMarket.isPlaceholderData} />
          </PanelBoundary>
        </div>

        <div className="min-w-0 xl:col-span-4">
          <PanelBoundary title="Top clientes">
            <TopCustomersPanel
              rows={customers.data}
              state={fromQuery(customers)}
              currency={rc}
              monthLabel={monthLabel}
              onRetry={() => void customers.refetch()}
            />
          </PanelBoundary>
        </div>
        <div className="min-w-0 xl:col-span-4">
          <PanelBoundary title="Top partners">
            <TopPartnersPanel current={mixPartner} previous={mixPartnerPrev} currency={rc} monthLabel={monthLabel} />
          </PanelBoundary>
        </div>
        <div className="min-w-0 xl:col-span-4">
          <PanelBoundary title="Requiere atención">
            <AttentionPanel />
          </PanelBoundary>
        </div>
      </div>
    </div>
  );
}

/* ---- Filtros (URL) ------------------------------------------------------------------ */

function useExecutiveFilters(today: Date) {
  const [params, setParams] = useSearchParams();
  const options = analyzedMonthOptions(today, 12);
  const rawMonth = params.get('cierre') ?? '';
  const month = options.some((o) => o.value === rawMonth) ? rawMonth : lastClosedMonth(today);
  const rawHorizon = Number(params.get('horizonte'));
  const horizon: Horizon = (HORIZONS as readonly number[]).includes(rawHorizon) ? (rawHorizon as Horizon) : 18;
  const rawCurrency = (params.get('moneda') ?? '').toUpperCase();
  const reportingCurrency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : undefined;
  const set = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(key, value);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  return {
    month,
    horizon,
    reportingCurrency,
    options,
    setMonth: (m: string) => set('cierre', m),
    setHorizon: (h: Horizon) => set('horizonte', String(h)),
    setCurrency: (c: string) => set('moneda', c),
  };
}

function FilterRow({
  month,
  horizon,
  options,
  setMonth,
  setHorizon,
  setCurrency,
  currency,
  missing,
  fxIsDemo,
  isCurrent,
}: ReturnType<typeof useExecutiveFilters> & {
  currency: string;
  missing: string[];
  fxIsDemo: boolean;
  isCurrent: boolean;
  today: Date;
}) {
  const currencies = useCurrencies();
  const codes = [...new Set([...(currencies.data ?? []).filter((c) => c.status === 'ACTIVE').map((c) => c.code), currency].filter(Boolean))].sort();
  return (
    <section aria-label="Filtros del resumen" className="flex flex-wrap items-end gap-x-6 gap-y-3">
      <CurrencyPicker currencies={codes} value={currency} onChange={setCurrency} label="Moneda de reporte" showLabel />
      <label className="flex flex-col gap-1.5">
        <span className="text-micro text-muted">Mes analizado</span>
        <select className="ebim-input h-9 min-w-[210px]" value={month} onChange={(e) => setMonth(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-micro text-muted" id="horizonte-label">
          Horizonte
        </span>
        <div role="group" aria-labelledby="horizonte-label" className="inline-flex h-9 items-center rounded-field border border-border-strong p-0.5">
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={horizon === h}
              className={`h-full rounded-md px-3 text-compact font-semibold transition-colors duration-fast ${
                horizon === h ? 'bg-accent-soft text-accent-deep' : 'text-muted hover:text-fg'
              }`}
              onClick={() => setHorizon(h)}
            >
              {h} meses
            </button>
          ))}
        </div>
      </div>
      <ul className="flex flex-wrap items-center gap-2 pb-1 text-caption" aria-label="Notas del reporte">
        {isCurrent ? (
          <li className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-1 font-semibold text-warn">
            <ClockCountdownIcon size={14} aria-hidden /> Mes en curso: cifras parciales
          </li>
        ) : null}
        {missing.length ? (
          <li className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-1 font-semibold text-warn">
            Parcial: falta tasa {missing.join(', ')} → {currency}
          </li>
        ) : null}
        {fxIsDemo ? (
          <li className="inline-flex items-center gap-1 rounded-full border border-border bg-sunken px-2.5 py-1 text-fg-2">
            <FlaskIcon size={14} aria-hidden /> Tipos de cambio de demostración
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/* ---- Franja hero -------------------------------------------------------------------- */

function HeroKpis({
  month,
  prevShort,
  isCurrent,
  currency,
  series,
  billing,
  movements,
}: {
  month: string;
  prevShort: string;
  isCurrent: boolean;
  currency: string;
  series: ReturnType<typeof useExecutiveMrrSeries>;
  billing: ReturnType<typeof useExecutiveBillingSeries>;
  movements: ReturnType<typeof useExecutiveMrrMovementsSeries>;
}) {
  const prev = previousMonth(month);
  const vs = `vs ${prevShort}`;
  const s = pointAt<ExecutiveMrrPoint>(series.data, month);
  const sp = pointAt<ExecutiveMrrPoint>(series.data, prev);
  const b = pointAt<ExecutiveBillingPoint>(billing.data, month);
  const bp = pointAt<ExecutiveBillingPoint>(billing.data, prev);
  const sTrend = trailing(series.data, month, 12);
  const bTrend = trailing(billing.data, month, 12);
  const mTrend = trailing<ExecutiveMrrBridge>(movements.data, month, 12);
  const bridge = pointAt<ExecutiveMrrBridge>(movements.data, month);
  const bridgePrev = pointAt<ExecutiveMrrBridge>(movements.data, prev);
  const nrr = netRevenueRetention(bridge);
  const nrrPrev = netRevenueRetention(bridgePrev);
  const churn = mrrChurnRate(bridge);
  const bounds = monthBounds(month);
  const range = (v: number | null | undefined, fmt: (n: number) => string) => (v == null ? '—' : fmt(v));
  const money = (v: number) => `${currency} ${formatCompactAmount(v)}`;
  const describe = (values: Array<number | null>, fmt: (n: number) => string) => {
    const valid = values.filter((v): v is number => v != null);
    return valid.length >= 2 ? `Tendencia ${valid.length} meses: de ${fmt(valid[0]!)} a ${fmt(valid[valid.length - 1]!)}` : undefined;
  };
  const native = s ? Object.entries(s.native).map(([c, v]) => `${c} ${formatCompactAmount(v)}`).join(' · ') : '';
  const missingNote = (p?: { complete: boolean; missingCurrencies: string[] }) =>
    p && !p.complete ? `Sin tasa para ${p.missingCurrencies.join(', ')}: no se consolida` : null;
  const partialNote = isCurrent ? 'Mes en curso, a hoy' : null;

  return (
    <section aria-label="Indicadores clave" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" data-hero>
      <KpiTile
        size="display"
        label="MRR"
        info="Ingreso recurrente mensual contratado al cierre del mes, en moneda de reporte (S01)."
        currency={s?.mrr != null ? currency : undefined}
        value={s?.mrr == null ? null : formatCompactAmount(s.mrr)}
        delta={{ value: pctChange(s?.mrr, sp?.mrr), comparison: vs, goodWhen: 'up' }}
        trend={sTrend.map((p) => p.mrr)}
        trendPartial={isCurrent}
        trendDescription={describe(sTrend.map((p) => p.mrr), money)}
        footer={missingNote(s) ?? partialNote ?? native}
        loading={series.isLoading}
        error={series.error}
        onRetry={() => void series.refetch()}
        to="/subscriptions"
      />
      <KpiTile
        size="display"
        label="ARR"
        info="MRR × 12: proyección anual del recurrente vigente, no contratos anuales firmados."
        currency={s?.arr != null ? currency : undefined}
        value={s?.arr == null ? null : formatCompactAmount(s.arr)}
        delta={{ value: pctChange(s?.arr, sp?.arr), comparison: vs, goodWhen: 'up' }}
        trend={sTrend.map((p) => p.arr)}
        trendPartial={isCurrent}
        trendDescription={describe(sTrend.map((p) => p.arr), money)}
        footer={missingNote(s) ?? 'MRR × 12 · proyección'}
        loading={series.isLoading}
        error={series.error}
        onRetry={() => void series.refetch()}
        to="/subscriptions"
      />
      <KpiTile
        size="display"
        label={isCurrent ? 'Cobrado en el mes' : 'Cobrado del mes'}
        info="Pagos confirmados en el mes (fórmula de K02), convertidos a la moneda de reporte (S06)."
        currency={b?.collected != null ? currency : undefined}
        value={b?.collected == null ? null : formatCompactAmount(b.collected)}
        // Un mes parcial contra uno completo no es comparación: sin variación.
        delta={isCurrent ? undefined : { value: pctChange(b?.collected, bp?.collected), comparison: vs, goodWhen: 'up' }}
        trend={bTrend.map((p) => p.collected)}
        trendPartial={isCurrent}
        trendDescription={describe(bTrend.map((p) => p.collected), money)}
        footer={
          missingNote(b) ??
          (b
            ? `${b.collectionRate == null ? '—' : formatPercent(b.collectionRate, 0)} de lo facturado · ${formatNumber(b.paymentCount)} pagos${isCurrent ? ' · parcial' : ''}`
            : null)
        }
        loading={billing.isLoading}
        error={billing.error}
        onRetry={() => void billing.refetch()}
        to={`/billing?desde=${bounds.from}&hasta=${bounds.to}#cobros`}
      />
      <KpiTile
        size="display"
        label="Cartera vencida"
        info="Saldo con 1 día o más de atraso al cierre del mes (bandas 1–30 a más de 90 días, S05/S06)."
        currency={b?.overdue != null ? currency : undefined}
        value={b?.overdue == null ? null : formatCompactAmount(b.overdue)}
        delta={{ value: pctChange(b?.overdue, bp?.overdue), comparison: vs, goodWhen: 'down' }}
        trend={bTrend.map((p) => p.overdue)}
        trendPartial={isCurrent}
        trendDescription={describe(bTrend.map((p) => p.overdue), money)}
        footer={missingNote(b) ?? (b ? `${formatNumber(b.overdueInvoiceCount)} facturas vencidas${isCurrent ? ' a hoy' : ' al cierre'}` : null)}
        loading={billing.isLoading}
        error={billing.error}
        onRetry={() => void billing.refetch()}
        to="/billing?estado=OPEN&antiguedad=VENCIDA"
      />
      <KpiTile
        size="display"
        label="Clientes activos"
        info="Organizaciones facturadas con MRR al cierre del mes (S01)."
        value={s ? formatNumber(s.activeCustomers) : null}
        delta={{ value: s && sp ? s.activeCustomers - sp.activeCustomers : null, kind: 'number', comparison: vs, goodWhen: 'up' }}
        trend={sTrend.map((p) => p.activeCustomers)}
        trendPartial={isCurrent}
        trendDescription={describe(sTrend.map((p) => p.activeCustomers), (n) => formatNumber(n))}
        footer={s ? `${formatNumber(s.activeSubscriptions)} contratos con MRR` : null}
        loading={series.isLoading}
        error={series.error}
        onRetry={() => void series.refetch()}
        to="/customers"
      />
      <KpiTile
        size="display"
        label="Retención neta (NRR)"
        info="(Inicio + expansión − contracción − churn) / inicio del mes, sobre el MRR de los clientes que ya estaban (S02/S07)."
        value={nrr == null ? null : formatPercent(nrr)}
        delta={{ value: nrr != null && nrrPrev != null ? (nrr - nrrPrev) * 100 : null, kind: 'pp', comparison: vs, goodWhen: 'up' }}
        trend={mTrend.map((m) => netRevenueRetention(m))}
        trendPartial={isCurrent}
        trendDescription={describe(mTrend.map((m) => netRevenueRetention(m)), (n) => formatPercent(n))}
        footer={
          bridge && !bridge.complete
            ? 'Sin tasa para alguna moneda: no se calcula'
            : bridge
              ? `Churn de MRR ${range(churn, (n) => formatPercent(n))} · ${formatNumber(bridge.churnedCustomers)} ${bridge.churnedCustomers === 1 ? 'baja' : 'bajas'}`
              : null
        }
        loading={movements.isLoading}
        error={movements.error}
        onRetry={() => void movements.refetch()}
      />
    </section>
  );
}

/* ---- Evolución del MRR -------------------------------------------------------------- */

function MrrEvolutionPanel({
  query,
  currency,
  horizon,
  month,
  onSelect,
}: {
  query: ReturnType<typeof useExecutiveMrrSeries>;
  currency: string;
  horizon: Horizon;
  month: string;
  onSelect: (month: string) => void;
}) {
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
      coverage={missing.length ? `Meses sin tasa para ${missing.join(', ')} quedan sin dibujar` : 'Clic en un mes para analizarlo; el punto hueco es el mes en curso'}
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
          ariaLabel={`MRR en ${currency} de ${data[0]?.label ?? ''} a ${data[data.length - 1]?.label ?? ''}${
            growth != null ? `, crecimiento de ${formatPercent(growth, 0)} en meses cerrados` : ''
          }. Use la vista Tabla para leer cada mes.`}
        />
      )}
      table={() => (
        <table className="w-full text-compact">
          <caption className="sr-only">MRR por mes</caption>
          <thead>
            <tr>
              <th scope="col" className="ebim-th">Mes</th>
              <th scope="col" className="ebim-th text-right">MRR ({currency})</th>
              <th scope="col" className="ebim-th text-right">ARR ({currency})</th>
              <th scope="col" className="ebim-th text-right">Clientes</th>
              <th scope="col" className="ebim-th text-right">Contratos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
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
          </tbody>
        </table>
      )}
    />
  );
}

/* ---- Puente de MRR ------------------------------------------------------------------ */

function BridgePanel({
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
          <table className="w-full text-compact">
            <caption className="sr-only">Puente de MRR</caption>
            <thead>
              <tr>
                <th scope="col" className="ebim-th">Paso</th>
                <th scope="col" className="ebim-th text-right">Importe ({currency})</th>
                <th scope="col" className="ebim-th text-right">Clientes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
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
            </tbody>
          </table>
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
              <Link className="ebim-link truncate text-compact" to={`/organizations/${r.organizationId}`} title={r.organizationName ?? undefined}>
                {r.organizationName ?? 'Organización sin nombre'}
              </Link>
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

/* ---- Facturado vs cobrado ----------------------------------------------------------- */

function BilledCollectedPanel({
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
      detailHref="/billing#cobros"
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
          ariaLabel={`Facturado y cobrado por mes en ${currency}${rate != null ? `; en meses cerrados se cobró ${formatPercent(rate)} de lo facturado` : ''}. Use la vista Tabla para leer cada mes.`}
        />
      )}
      table={() => (
        <table className="w-full text-compact">
          <caption className="sr-only">Facturado vs cobrado por mes</caption>
          <thead>
            <tr>
              <th scope="col" className="ebim-th">Mes</th>
              <th scope="col" className="ebim-th text-right">Facturado ({currency})</th>
              <th scope="col" className="ebim-th text-right">Cobrado ({currency})</th>
              <th scope="col" className="ebim-th text-right">% cobrado</th>
              <th scope="col" className="ebim-th text-right">Vencida al cierre</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
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
          </tbody>
        </table>
      )}
    />
  );
}
