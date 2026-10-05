import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ClockCountdownIcon, FlaskIcon, PresentationChartIcon } from '@phosphor-icons/react';
import {
  useCurrencies,
  type useExecutiveBillingSeries,
  type useExecutiveMrrMovementCustomers,
  type useExecutiveMrrMovementsSeries,
  type useExecutiveMrrSeries,
  type ExecutiveBillingPoint,
  type ExecutiveMrrBridge,
  type ExecutiveMrrPoint,
} from '@/services/queries';
import { KpiTile } from '@/components/ui/primitives';
import { fromQuery, type DataState } from '@/features/executive/dataState';
import { ChartLegend, ChartPanel, CurrencyPicker } from '@/features/executive/components/ChartPanel';
import { StateMessage } from '@/features/executive/components/StateView';
import {
  BilledCollectedChart,
  BridgeWaterfall,
  MrrEvolutionChart,
  type BilledCollectedDatum,
  type MrrPointDatum,
} from '@/features/executive/components/executiveCharts';
import { longMonthName } from '@/features/billing/financeModel';
import { formatCompactAmount, formatDate, formatDelta, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { monthShortLabel } from './executiveData';
import {
  bridgeSteps,
  changeSteps,
  customersFor,
  HORIZONS,
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
import { usePresentationView } from './presentation/presentationContext';
import { useExecutiveDashboard, type ExecutiveDashboardData, type useExecutiveFilters } from './executiveDashboardData';

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
 * Cada panel lee su propia fuente y falla solo. El modo presentación (fase 14)
 * proyecta estos mismos paneles, uno o dos por diapositiva.
 */
export function ExecutivePerspective({ today = new Date(), canPresent = false }: { today?: Date; canPresent?: boolean }) {
  const d = useExecutiveDashboard(today);

  return (
    <div className="space-y-6">
      <FilterRow
        {...d.filters}
        currency={d.rc}
        missing={d.missing}
        fxIsDemo={d.fxIsDemo}
        isCurrent={d.isCurrent}
        canPresent={canPresent}
      />

      <HeroKpis d={d} />

      {/* Cada fila es una sección: al imprimir, una por página (A4 apaisado). */}
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-12 print:break-before-page print:grid-cols-12" data-print-section="evolucion">
          <div className="min-w-0 xl:col-span-8 print:col-span-8">
            <ExecutivePanel d={d} panel="evolucion-mrr" />
          </div>
          <div className="min-w-0 xl:col-span-4 print:col-span-4">
            <ExecutivePanel d={d} panel="puente" />
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-12 print:break-before-page print:grid-cols-12" data-print-section="cobranza">
          <div className="min-w-0 xl:col-span-7 print:col-span-7">
            <ExecutivePanel d={d} panel="facturado-cobrado" />
          </div>
          <div className="min-w-0 xl:col-span-5 print:col-span-5">
            <ExecutivePanel d={d} panel="antiguedad" />
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-12 print:break-before-page print:grid-cols-12" data-print-section="mix">
          <div className="min-w-0 xl:col-span-6 print:col-span-6">
            <ExecutivePanel d={d} panel="mix-producto" />
          </div>
          <div className="min-w-0 xl:col-span-6 print:col-span-6">
            <ExecutivePanel d={d} panel="mix-mercado" />
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-12 print:break-before-page print:grid-cols-12" data-print-section="tops">
          <div className="min-w-0 xl:col-span-4 print:col-span-4">
            <ExecutivePanel d={d} panel="top-clientes" />
          </div>
          <div className="min-w-0 xl:col-span-4 print:col-span-4">
            <ExecutivePanel d={d} panel="top-partners" />
          </div>
          <div className="min-w-0 xl:col-span-4 print:col-span-4">
            <ExecutivePanel d={d} panel="atencion" />
          </div>
        </div>
      </div>
    </div>
  );
}

export type ExecutivePanelId =
  | 'evolucion-mrr'
  | 'puente'
  | 'facturado-cobrado'
  | 'antiguedad'
  | 'mix-producto'
  | 'mix-mercado'
  | 'top-clientes'
  | 'top-partners'
  | 'atencion';

const PANEL_TITLE: Record<ExecutivePanelId, string> = {
  'evolucion-mrr': 'Evolución del MRR',
  puente: 'Puente de MRR',
  'facturado-cobrado': 'Facturado vs cobrado',
  antiguedad: 'Cartera por antigüedad',
  'mix-producto': 'Mix por producto',
  'mix-mercado': 'Mix por mercado',
  'top-clientes': 'Top clientes',
  'top-partners': 'Top partners',
  atencion: 'Requiere atención',
};

/** Un panel del tablero, aislado: si falla al dibujarse, solo él muestra su aviso. */
export function ExecutivePanel({ d, panel }: { d: ExecutiveDashboardData; panel: ExecutivePanelId }) {
  const navigate = useNavigate();
  const view = usePresentationView();
  const { month, horizon, rc } = d;
  return <PanelBoundary title={PANEL_TITLE[panel]}>{renderPanel()}</PanelBoundary>;

  function renderPanel() {
    switch (panel) {
      case 'evolucion-mrr':
        return <MrrEvolutionPanel query={d.series} currency={rc} horizon={horizon} month={month} onSelect={(m) => d.filters.setMonth(m)} />;
      case 'puente':
        return <BridgePanel key={month} query={d.movements} bridge={d.bridge} customers={d.customers} currency={rc} month={month} />;
      case 'facturado-cobrado':
        return (
          <BilledCollectedPanel
            query={d.billing}
            currency={rc}
            horizon={horizon}
            month={month}
            // Proyectando, un clic analiza ese mes (no saca de la presentación hacia Facturación).
            onSelect={(m) => {
              if (view.active) return d.filters.setMonth(m);
              const r = monthBounds(m);
              navigate(`/billing?desde=${r.from}&hasta=${r.to}#cobros`);
            }}
          />
        );
      case 'antiguedad':
        return (
          <AgingPanel
            query={d.aging}
            currency={rc}
            asOfLabel={d.isCurrent ? `A hoy, ${formatDate(d.asOf)}` : `Al cierre de ${d.monthLabel}`}
            refreshing={d.aging.isPlaceholderData}
          />
        );
      case 'mix-producto':
        return <MixPanel dimension="PRODUCT" query={d.mixProduct} currency={rc} monthLabel={d.monthLabel} refreshing={d.mixProduct.isPlaceholderData} />;
      case 'mix-mercado':
        return <MixPanel dimension="MARKET" query={d.mixMarket} currency={rc} monthLabel={d.monthLabel} refreshing={d.mixMarket.isPlaceholderData} />;
      case 'top-clientes':
        return (
          <TopCustomersPanel
            rows={d.customers.data}
            state={fromQuery(d.customers)}
            currency={rc}
            monthLabel={d.monthLabel}
            onRetry={() => void d.customers.refetch()}
          />
        );
      case 'top-partners':
        return <TopPartnersPanel current={d.mixPartner} previous={d.mixPartnerPrev} currency={rc} monthLabel={d.monthLabel} />;
      case 'atencion':
        return <AttentionPanel />;
    }
  }
}

/** Alto de los gráficos al proyectar: lo que deja libre la diapositiva (al imprimir, alturas fijas que caben en A4). */
const PRESENTATION_CHART_HEIGHT = 'clamp(260px, calc(100vh - 400px), 520px)';
const PRESENTATION_BARS_HEIGHT = 'clamp(240px, calc(100vh - 490px), 420px)';

/* ---- Filtros (URL) ------------------------------------------------------------------ */

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
  present,
  canPresent,
}: ReturnType<typeof useExecutiveFilters> & {
  currency: string;
  missing: string[];
  fxIsDemo: boolean;
  isCurrent: boolean;
  canPresent: boolean;
}) {
  const currencies = useCurrencies();
  const codes = [...new Set([...(currencies.data ?? []).filter((c) => c.status === 'ACTIVE').map((c) => c.code), currency].filter(Boolean))].sort();
  const presentRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const backFromPresentation = (location.state as { fromPresentation?: boolean } | null)?.fromPresentation === true;
  // Al salir del modo presentación el foco vuelve al botón que lo abrió.
  useEffect(() => {
    if (backFromPresentation) presentRef.current?.focus();
  }, [backFromPresentation]);
  return (
    <section aria-label="Filtros del resumen" className="flex flex-wrap items-end gap-x-6 gap-y-3">
      {/* Al imprimir, los controles se reemplazan por la línea de contexto. */}
      <p className="hidden text-compact text-fg-2 print:block">
        Moneda de reporte <strong className="text-fg">{currency}</strong> · Mes analizado{' '}
        <strong className="text-fg">{monthLongLabel(month)}</strong> · Horizonte {horizon} meses
      </p>
      <div className="print:hidden">
        <CurrencyPicker currencies={codes} value={currency} onChange={setCurrency} label="Moneda de reporte" showLabel />
      </div>
      <label className="flex flex-col gap-1.5 print:hidden">
        <span className="text-micro text-muted">Mes analizado</span>
        <select className="ebim-input h-9 min-w-[210px]" value={month} onChange={(e) => setMonth(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-1.5 print:hidden">
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
      {canPresent ? (
        <button
          ref={presentRef}
          type="button"
          className="ebim-btn ebim-btn-secondary ml-auto print:hidden"
          onClick={present}
          aria-keyshortcuts="Escape"
          title="Proyectar el resumen a pantalla completa, sin menús (Esc para salir)"
        >
          <PresentationChartIcon size={18} aria-hidden /> Presentar
        </button>
      ) : null}
    </section>
  );
}

/* ---- Franja hero -------------------------------------------------------------------- */

export function HeroKpis({ d }: { d: ExecutiveDashboardData }) {
  const { month, isCurrent, rc: currency, series, billing, movements } = d;
  const view = usePresentationView();
  const prev = d.prev;
  // Mes completo («vs agosto»): «vs ago» se leería como inglés.
  const vs = `vs ${longMonthName(prev)}`;
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
    <section
      aria-label="Indicadores clave"
      className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 ${view.active ? 'xl:gap-6' : '2xl:grid-cols-6'}`}
      data-hero
    >
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
          // Proyectando: el gráfico ocupa el alto disponible de la diapositiva y el texto sube un escalón.
          height={view.printing ? 380 : view.active ? PRESENTATION_CHART_HEIGHT : 340}
          fontSize={view.active ? 14 : 12}
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
          height={view.printing ? 280 : view.active ? PRESENTATION_BARS_HEIGHT : 292}
          fontSize={view.active ? 14 : 12}
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
