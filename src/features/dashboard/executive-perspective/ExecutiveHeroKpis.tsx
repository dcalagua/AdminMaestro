import {
  type ExecutiveBillingPoint,
  type ExecutiveMrrBridge,
  type ExecutiveMrrPoint,
} from '@/services/queries';
import { KpiTile } from '@/components/ui/primitives';
import { longMonthName } from '@/features/billing/financeModel';
import { formatCompactAmount, formatNumber, formatPercent } from '@/lib/format';
import {
  monthBounds,
  mrrChurnRate,
  netRevenueRetention,
  pctChange,
  pointAt,
  trailing,
} from '../executiveModel';
import { usePresentationView } from '../presentation/presentationContext';
import { type ExecutiveDashboardData } from '../executiveDashboardData';

/** Franja hero del resumen ejecutivo: seis KPI con tendencia de 12 meses. */
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
        to={`/cobranza?tab=facturacion&desde=${bounds.from}&hasta=${bounds.to}#cobros`}
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
        to="/cobranza?tab=facturacion&estado=OPEN&antiguedad=VENCIDA"
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
        to="/cuentas?tab=clientes"
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
