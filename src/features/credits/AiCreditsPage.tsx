import { SectionTabs } from '@/components/ui/SectionTabs';
import { KpiTile, PageContainer } from '@/components/ui/primitives';
import { useAiCreditBalances } from '@/services/queries';
import { fromQuery } from '@/features/executive/dataState';
import { ChartLegend, ChartPanel } from '@/features/executive/components/ChartPanel';
import { monthShortLabel } from '@/features/dashboard/executiveData';
import { monthLongLabel } from '@/features/dashboard/executiveModel';
import { KpiStrip } from '@/features/billing/financeUi';
import { analyzedMonth, closedWindow, longMonthName, relChange, shortMonthName } from '@/features/billing/financeModel';
import { PeriodBars } from '@/features/billing/lazyFinanceCharts';
import { formatNumber, formatPercent } from '@/lib/format';
import { BalancesTab } from './BalancesTab';
import { LedgerTab } from './LedgerTab';
import { WeightsTab } from './WeightsTab';
import { PoliciesTab } from './PoliciesTab';
import { OperationsTab } from './OperationsTab';
import { CreditCatalogTab } from './CreditCatalogTab';

/**
 * «Créditos IA» (CCP M4, spec §5.2). Saldos y ledger append-only; pesos,
 * políticas, operaciones y catálogo son decisiones de finanzas (D-02…D-04).
 * Nada se siembra: lo no decidido se muestra «No decidido (D-xx)».
 *
 * La franja y el gráfico (fase 10) agregan los saldos ya leídos por la pestaña
 * «Saldos» (`v_ai_credit_balances`, misma consulta y caché): son créditos EBIM,
 * no dinero, así que sumarlos entre tenants no mezcla monedas.
 */
export function AiCreditsPage() {
  return (
    <PageContainer
      title="Créditos IA"
      description="La unidad comercial de la IA es el crédito EBIM. Se consume al finalizar los agregados de uso de cada capacidad, según su peso vigente y la política del plan o add-on."
    >
      <CreditsOverview />
      <SectionTabs
        tabs={[
          { id: 'balances', label: 'Saldos', content: <BalancesTab /> },
          { id: 'ledger', label: 'Movimientos', content: <LedgerTab /> },
          { id: 'weights', label: 'Pesos', content: <WeightsTab /> },
          { id: 'policies', label: 'Políticas', content: <PoliciesTab /> },
          { id: 'operations', label: 'Operaciones', content: <OperationsTab /> },
          { id: 'catalog', label: 'Catálogo', content: <CreditCatalogTab /> },
        ]}
      />
    </PageContainer>
  );
}

interface PeriodTotals {
  month: string;
  included: number;
  used: number;
  balance: number;
  tenants: number;
  overIncluded: number;
}

/** Totales por período (créditos, no dinero). */
function totalsByPeriod(rows: ReadonlyArray<{ period_start: string | null; tenant_id: string | null; included: number | null; used: number | null; balance: number | null }>): PeriodTotals[] {
  const map = new Map<string, PeriodTotals & { tenantSet: Set<string>; negSet: Set<string> }>();
  for (const r of rows) {
    if (!r.period_start) continue;
    const month = r.period_start.slice(0, 7);
    const t = map.get(month) ?? { month: `${month}-01`, included: 0, used: 0, balance: 0, tenants: 0, overIncluded: 0, tenantSet: new Set(), negSet: new Set() };
    t.included += Number(r.included ?? 0);
    t.used += Number(r.used ?? 0);
    t.balance += Number(r.balance ?? 0);
    if (r.tenant_id) t.tenantSet.add(r.tenant_id);
    if (r.tenant_id && Number(r.balance ?? 0) < 0) t.negSet.add(r.tenant_id);
    map.set(month, t);
  }
  return [...map.values()]
    .map(({ tenantSet, negSet, ...t }) => ({ ...t, tenants: tenantSet.size, overIncluded: negSet.size }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

const CREDIT_SERIES = [
  { key: 'included', label: 'Incluidos', color: 'var(--chart-1)' },
  { key: 'used', label: 'Consumidos', color: 'var(--chart-2)' },
];

function CreditsOverview() {
  const balances = useAiCreditBalances();
  const month = analyzedMonth();
  const periods = totalsByPeriod(balances.data ?? []);
  const { current, previous, trend } = closedWindow(periods, month);
  const usage = current && current.included > 0 ? current.used / current.included : null;
  const prevUsage = previous && previous.included > 0 ? previous.used / previous.included : null;
  const vs = previous ? `vs ${longMonthName(previous.month.slice(0, 7))}` : undefined;
  const name = shortMonthName(month);
  const common = { loading: balances.isLoading, error: balances.error, onRetry: () => void balances.refetch() };
  const state = fromQuery(balances, { isEmpty: (rows) => rows.length === 0 });
  const chart = trend.slice(-12);

  return (
    <>
      <KpiStrip label="Indicadores de créditos IA">
        <KpiTile
          label={`Consumidos · ${name}`}
          info="Créditos EBIM usados en el período por todos los tenants visibles."
          value={current ? formatNumber(Math.round(current.used)) : null}
          delta={{ value: relChange(current?.used, previous?.used), comparison: vs, goodWhen: 'none' }}
          trend={trend.map((p) => p.used)}
          trendDescription="Créditos consumidos por mes"
          footer={current ? `${formatNumber(current.tenants)} tenants con saldo en ${name}` : 'Sin movimientos en el período'}
          {...common}
        />
        <KpiTile
          label={`Incluidos · ${name}`}
          info="Créditos incluidos por las políticas de planes y add-ons en el período."
          value={current ? formatNumber(Math.round(current.included)) : null}
          footer="Según la política vigente de cada plan o add-on"
          {...common}
        />
        <KpiTile
          label={`Uso del incluido · ${name}`}
          info="Consumidos ÷ incluidos del período. Por encima de 100 % hay consumo excedente."
          value={usage == null ? null : formatPercent(usage)}
          delta={{
            value: usage != null && prevUsage != null ? (usage - prevUsage) * 100 : null,
            kind: 'pp',
            comparison: vs,
            goodWhen: 'none',
          }}
          trend={trend.map((p) => (p.included > 0 ? p.used / p.included : null))}
          trendDescription="Uso del incluido por mes"
          footer={current && current.included === 0 ? 'Sin créditos incluidos: no hay base' : 'Consumidos ÷ incluidos'}
          {...common}
        />
        <KpiTile
          label={`Sobre su incluido · ${name}`}
          info="Tenants con saldo negativo en algún pool del período: consumieron más de lo que tenían."
          value={current ? formatNumber(current.overIncluded) : null}
          tone={current && current.overIncluded > 0 ? 'warn' : 'neutral'}
          footer={current ? `tenants, de ${formatNumber(current.tenants)} con saldo` : undefined}
          {...common}
        />
      </KpiStrip>
      <div className="mb-6">
        <ChartPanel
          id="creditos-mes"
          title="¿Cuánto del crédito incluido se consume?"
          unit="Créditos EBIM incluidos y consumidos por mes (todos los tenants visibles)"
          period={`${chart[0] ? monthShortLabel(chart[0].month.slice(0, 7)) : ''} – ${monthShortLabel(month)} · meses cerrados`}
          source="v_ai_credit_balances"
          coverage="Créditos, no dinero; el saldo deriva del ledger"
          state={state}
          onRetry={() => void balances.refetch()}
          emptyText="Sin movimientos de créditos todavía: las políticas siguen sin decidir (D-03)"
          legend={<ChartLegend items={CREDIT_SERIES.map((c) => ({ label: c.label, color: c.color }))} />}
          chart={() => (
            <PeriodBars
              data={chart.map((p) => ({
                key: p.month,
                label: monthShortLabel(p.month.slice(0, 7)),
                title: monthLongLabel(p.month.slice(0, 7)),
                values: { included: p.included, used: p.used },
              }))}
              series={CREDIT_SERIES}
              unit={{ quantity: 'créditos' }}
              height={220}
              ariaLabel={`Créditos incluidos y consumidos por mes${usage != null ? `; en ${monthLongLabel(month)} se usó ${formatPercent(usage)} del incluido` : ''}. Use la vista Tabla para leer cada mes.`}
            />
          )}
          table={() => (
            <table className="w-full text-compact">
              <caption className="sr-only">Créditos incluidos y consumidos por mes</caption>
              <thead>
                <tr>
                  <th scope="col" className="ebim-th">Mes</th>
                  <th scope="col" className="ebim-th text-right">Incluidos</th>
                  <th scope="col" className="ebim-th text-right">Consumidos</th>
                  <th scope="col" className="ebim-th text-right">Uso</th>
                  <th scope="col" className="ebim-th text-right">Tenants sobre el incluido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...chart].reverse().map((p) => (
                  <tr key={p.month}>
                    <th scope="row" className="ebim-td text-left font-medium">{monthLongLabel(p.month.slice(0, 7))}</th>
                    <td className="ebim-td ebim-num">{formatNumber(Math.round(p.included))}</td>
                    <td className="ebim-td ebim-num">{formatNumber(Math.round(p.used))}</td>
                    <td className="ebim-td ebim-num">{p.included > 0 ? formatPercent(p.used / p.included) : '—'}</td>
                    <td className="ebim-td ebim-num">{formatNumber(p.overIncluded)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />
      </div>
    </>
  );
}
