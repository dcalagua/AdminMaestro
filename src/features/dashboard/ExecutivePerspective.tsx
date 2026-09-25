import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  BellRingingIcon,
  FileTextIcon,
  ReceiptIcon,
  StackIcon,
  HardDrivesIcon,
  CalendarCheckIcon,
} from '@phosphor-icons/react';
import {
  useBillingAlerts,
  useDashboardSummary,
  useFinanceConsolidated,
  useProducts,
  useSaasProvisioningRequests,
  useSubscriptionDocumentStatus,
} from '@/services/queries';
import {
  useCollectionsByMonth,
  useInvoiceSummary,
  useReceivablesAging,
  useRenewalPipeline,
} from '@/services/financeRead';
import { fromQuery, type DataState } from '@/features/executive/dataState';
import { compareToPrevious, lastMonths, previousMonth, toCurrencyAmounts, type CurrencyAmounts, type ReportContext } from '@/features/executive/reportContext';
import { KPI_DICTIONARY, RENEWAL_WINDOWS, AGING_BUCKETS, type RenewalWindow } from '@/features/executive/kpis';
import { KpiCard, CurrencyLines, StateMessage } from '@/features/executive/components/StateView';
import { ChartPanel, CurrencyPicker } from '@/features/executive/components/ChartPanel';
import { SingleBars, type BarDatum } from '@/features/executive/components/charts';
import { formatMoney, formatNumber, formatPercent } from '@/lib/format';
import {
  collectedInMonth,
  collectionsSeries,
  monthRange,
  monthShortLabel,
  nativeMetric,
  periodLabel,
  renewalsInWindow,
  totalGroup,
} from './executiveData';

/**
 * Perspectiva EJECUTIVA (spec §7.1): contexto → seis KPI → cobros por mes y MRR
 * vigente por producto → requiere atención → resumen SaaS.
 * Cada cifra abre el mismo detalle autorizado que la compone.
 */
export function ExecutivePerspective({ ctx, onOpenOperations }: { ctx: ReportContext; onOpenOperations: () => void }) {
  const navigate = useNavigate();
  const month = ctx.period.start.slice(0, 7);
  const seriesMonths = lastMonths(month, 12);
  const seriesFrom = `${seriesMonths[0]}-01`;

  const total = useFinanceConsolidated({
    asOf: ctx.fxDate,
    groupBy: 'TOTAL',
    periodStart: ctx.period.start,
    periodEnd: ctx.period.end,
  });
  const byProduct = useFinanceConsolidated({
    asOf: ctx.fxDate,
    groupBy: 'PRODUCT',
    periodStart: ctx.period.start,
    periodEnd: ctx.period.end,
  });
  const collections = useCollectionsByMonth(seriesFrom, ctx.period.end);
  const invoices = useInvoiceSummary({ search: '', filter: 'ALL' });
  const renewals = useRenewalPipeline();
  const [windowDays, setWindowDays] = useState<RenewalWindow>(30);

  const totalState = fromQuery(total, { isEmpty: (d) => d.groups.length === 0 });
  const group = totalGroup(total.data);
  const rc = total.data?.reporting_currency ?? null;

  // ---- K01 MRR vigente (foto actual) ----
  const mrrState: DataState<CurrencyAmounts> =
    totalState.status === 'ready' ? { status: 'ready', data: nativeMetric(group, 'MRR'), observedAt: totalState.observedAt } : (totalState as DataState<CurrencyAmounts>);

  // ---- K02 Cobrado del período (serie G01) ----
  const collectionsState = fromQuery(collections, { isEmpty: () => false });
  const collected = collections.data ? collectedInMonth(collections.data, month) : {};
  const previous = collections.data ? collectedInMonth(collections.data, previousMonth(month)) : {};

  // ---- K03/K04 (foto actual, universo completo) ----
  const invoiceState = fromQuery(invoices, { isEmpty: () => false });

  // ---- K05 margen gerencial del período ----
  const marginState: DataState<CurrencyAmounts> =
    totalState.status === 'ready'
      ? { status: 'ready', data: toCurrencyAmounts(group?.native_margin ?? {}), observedAt: totalState.observedAt }
      : totalState.status === 'empty'
        ? { status: 'empty' }
        : (totalState as DataState<CurrencyAmounts>);

  // ---- K06 renovaciones ----
  const renewalState = fromQuery(renewals, { isEmpty: () => false });
  const win = renewals.data ? renewalsInWindow(renewals.data, windowDays) : null;

  const consolidatedHint = (key: 'MRR' | 'COLLECTED') => {
    const m = group?.metrics[key];
    if (!m || !rc) return undefined;
    if (!m.complete || m.reporting_amount === null) {
      return `Consolidado no disponible: falta tipo de cambio para ${m.missing_currencies.join(', ') || 'una moneda'}`;
    }
    return `≈ ${formatMoney(Number(m.reporting_amount), rc)} al tipo del ${ctx.fxDate}`;
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          id="K01"
          label={KPI_DICTIONARY.K01.name}
          temporality="Foto actual"
          state={mrrState}
          onRetry={() => void total.refetch()}
          render={() => <CurrencyLines amounts={mrrState.status === 'ready' ? mrrState.data : {}} emptyLabel="Sin recurrente vigente" />}
          hint={
            mrrState.status === 'ready' && Object.keys(mrrState.data).length > 0
              ? `ARR estimado (proyección MRR × 12): ${Object.entries(nativeMetric(group, 'ARR')).map(([c, v]) => formatMoney(v, c)).join(' · ')}`
              : consolidatedHint('MRR')
          }
          detailHref={KPI_DICTIONARY.K01.detailHref}
          detailLabel="Ver contratos"
        />
        <KpiCard
          id="K02"
          label={KPI_DICTIONARY.K02.name}
          temporality={periodLabel(ctx)}
          state={collectionsState}
          onRetry={() => void collections.refetch()}
          render={() => (
            <div>
              <CurrencyLines amounts={collected} emptyLabel="Sin cobros confirmados" />
              <DeltaLine current={collected} previous={previous} partial={ctx.period.partial} />
            </div>
          )}
          hint={consolidatedHint('COLLECTED') ?? 'Pagos confirmados; excluye pendientes y revertidos'}
          detailHref={`/billing?desde=${monthRange(month).from}&hasta=${monthRange(month).to}#cobros`}
          detailLabel="Ver cobros del mes"
        />
        <KpiCard
          id="K03"
          label={KPI_DICTIONARY.K03.name}
          temporality="Foto actual"
          state={invoiceState}
          onRetry={() => void invoices.refetch()}
          render={() => <CurrencyLines amounts={toCurrencyAmounts(invoices.data?.receivable)} emptyLabel="Sin saldo pendiente" />}
          hint="Facturas emitidas menos pagos confirmados, por moneda"
          detailHref={KPI_DICTIONARY.K03.detailHref}
          detailLabel="Ver facturas por cobrar"
        />
        <KpiCard
          id="K04"
          label={KPI_DICTIONARY.K04.name}
          temporality="Foto actual"
          state={invoiceState}
          onRetry={() => void invoices.refetch()}
          render={() => <CurrencyLines amounts={toCurrencyAmounts(invoices.data?.overdue)} emptyLabel="Sin cartera vencida" />}
          hint="Vencida a hoy (1–30 a más de 90 días); «Sin fecha» no cuenta"
          detailHref="/billing?estado=OPEN&antiguedad=VENCIDA"
          detailLabel="Ver vencidas"
        />
        <KpiCard
          id="K05"
          label={KPI_DICTIONARY.K05.name}
          temporality={periodLabel(ctx)}
          state={marginState}
          onRetry={() => void total.refetch()}
          render={() => <CurrencyLines amounts={marginState.status === 'ready' ? marginState.data : {}} />}
          footer={
            marginState.status === 'ready' ? (
              <dl className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-2 text-[11px] text-muted">
                <div><dt>Cobrado</dt><dd className="font-semibold text-fg"><CurrencyLines amounts={nativeMetric(group, 'COLLECTED')} emptyLabel="—" /></dd></div>
                <div><dt>Costo directo</dt><dd className="font-semibold text-fg"><CurrencyLines amounts={nativeMetric(group, 'COST')} emptyLabel="—" /></dd></div>
                <div><dt>Comisión</dt><dd className="font-semibold text-fg"><CurrencyLines amounts={nativeMetric(group, 'COMMISSION')} emptyLabel="—" /></dd></div>
              </dl>
            ) : null
          }
          hint="Cobrado − costo − comisión. Gestión, no utilidad contable"
          detailHref={KPI_DICTIONARY.K05.detailHref}
          detailLabel="Ver componentes"
        />
        <KpiCard
          id="K06"
          label={KPI_DICTIONARY.K06.name}
          temporality={`Próximos ${windowDays} días`}
          state={renewalState}
          onRetry={() => void renewals.refetch()}
          render={() =>
            win ? (
              <div>
                <p className="tabular-nums">
                  {formatNumber(win.count)} {win.count === 1 ? 'contrato' : 'contratos'}
                </p>
                <div className="mt-1 text-sm font-semibold text-muted">
                  <CurrencyLines amounts={win.mrr} emptyLabel="Sin MRR vigente en la ventana" />
                </div>
              </div>
            ) : null
          }
          footer={
            <div role="group" aria-label="Ventana de renovación" className="mt-2 flex flex-wrap gap-1">
              {RENEWAL_WINDOWS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={windowDays === d}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                    windowDays === d ? 'bg-accent-soft text-accent-deep' : 'text-muted hover:text-fg'
                  }`}
                  onClick={() => setWindowDays(d)}
                >
                  {d} d
                </button>
              ))}
            </div>
          }
          hint="No es pronóstico de churn; nada se renueva ni suspende desde aquí"
          detailHref={KPI_DICTIONARY.K06.detailHref}
          detailLabel="Ver renovaciones"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <CollectionsChart ctx={ctx} months={seriesMonths} query={collections} onSelect={(m) => {
          const r = monthRange(m);
          navigate(`/billing?desde=${r.from}&hasta=${r.to}#cobros`);
        }} />
        <MrrByProductChart query={byProduct} onSelect={(id) => navigate(`/products/${id}`)} />
      </div>

      <AttentionList />
      <SaasSummary onOpen={onOpenOperations} />
    </div>
  );
}

function DeltaLine({ current, previous, partial }: { current: CurrencyAmounts; previous: CurrencyAmounts; partial: boolean }) {
  const currencies = Object.keys({ ...current, ...previous }).sort();
  if (currencies.length === 0) return null;
  if (partial) {
    return <p className="mt-1 text-[11px] font-semibold text-muted">Mes en curso: sin comparación con un mes completo.</p>;
  }
  return (
    <ul className="mt-1 space-y-0.5 text-[11px] font-semibold">
      {currencies.map((c) => {
        const cmp = compareToPrevious(current[c] ?? 0, previous[c] ?? 0, { currentPartial: partial });
        if (cmp.kind !== 'delta') {
          return (
            <li key={c} className="text-muted">
              {c}: {cmp.reason}
            </li>
          );
        }
        const up = cmp.ratio >= 0;
        return (
          <li key={c} className={up ? 'text-ok' : 'text-danger'}>
            {up ? <ArrowUpRightIcon size={12} className="inline" aria-hidden /> : <ArrowDownRightIcon size={12} className="inline" aria-hidden />}{' '}
            {c} {up ? '+' : ''}
            {formatPercent(cmp.ratio)} vs. mes anterior
          </li>
        );
      })}
    </ul>
  );
}

function CollectionsChart({
  ctx,
  months,
  query,
  onSelect,
}: {
  ctx: ReportContext;
  months: string[];
  query: ReturnType<typeof useCollectionsByMonth>;
  onSelect: (month: string) => void;
}) {
  const state = fromQuery(query, { isEmpty: (rows) => rows.length === 0 });
  const series = query.data ? collectionsSeries(query.data, months) : {};
  // Por defecto, la moneda con más volumen en la ventana (no la primera del abecedario).
  const currencies = Object.keys(series).sort(
    (a, b) => series[b]!.reduce((t, p) => t + p.amount, 0) - series[a]!.reduce((t, p) => t + p.amount, 0),
  );
  const [picked, setPicked] = useState('');
  const currency = currencies.includes(picked) ? picked : (currencies[0] ?? '');
  const currentMonthKey = ctx.snapshotDate.slice(0, 7);
  const data: BarDatum[] = (series[currency] ?? []).map((p) => ({
    key: p.month,
    label: monthShortLabel(p.month),
    value: p.amount,
    note: p.month === currentMonthKey ? 'mes en curso, parcial' : undefined,
  }));

  return (
    <ChartPanel
      title="¿Cuánto cobramos cada mes?"
      unit={`Cobros confirmados en ${currency || 'moneda nativa'}`}
      period={`Últimos 12 meses hasta ${ctx.period.label}`}
      source="collections_by_month"
      coverage="Una moneda por gráfico; el mes en curso es parcial"
      state={state}
      onRetry={() => void query.refetch()}
      emptyText="Sin cobros confirmados en los últimos 12 meses"
      controls={<CurrencyPicker currencies={currencies} value={currency} onChange={setPicked} />}
      detailHref="/billing#cobros"
      detailLabel="Ver cobros"
      chart={() => (
        <SingleBars
          data={data}
          currency={currency}
          ariaLabel={`Cobros confirmados por mes en ${currency}. Use la vista Tabla para leer cada valor.`}
          onSelect={(d) => onSelect(d.key)}
        />
      )}
      table={() => (
        <table className="w-full text-sm">
          <caption className="sr-only">Cobros confirmados por mes</caption>
          <thead>
            <tr>
              <th scope="col" className="ebim-th">Mes</th>
              {currencies.map((c) => (
                <th key={c} scope="col" className="ebim-th text-right">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {months.map((m, i) => (
              <tr key={m}>
                <th scope="row" className="ebim-td text-left font-medium">
                  <button type="button" className="ebim-link" onClick={() => onSelect(m)}>
                    {monthShortLabel(m)}
                  </button>
                  {m === currentMonthKey ? <span className="ml-1 text-xs text-muted">(parcial)</span> : null}
                </th>
                {currencies.map((c) => (
                  <td key={c} className="ebim-td text-right tabular-nums">
                    {formatMoney(series[c]![i]!.amount, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    />
  );
}

function MrrByProductChart({
  query,
  onSelect,
}: {
  query: ReturnType<typeof useFinanceConsolidated>;
  onSelect: (productId: string) => void;
}) {
  const products = useProducts();
  const state = fromQuery(query, { isEmpty: (d) => d.groups.length === 0 });
  const groups = (query.data?.groups ?? []).filter((g) => g.key !== 'SIN_PRODUCTO');
  const mrrTotal = (c: string) => groups.reduce((t, g) => t + Number(g.metrics.MRR?.native?.[c] ?? 0), 0);
  const currencies = [...new Set(groups.flatMap((g) => Object.keys(g.metrics.MRR?.native ?? {})))].sort(
    (a, b) => mrrTotal(b) - mrrTotal(a),
  );
  const [picked, setPicked] = useState('');
  const currency = currencies.includes(picked) ? picked : (currencies[0] ?? '');
  const data: BarDatum[] = groups
    .map((g) => ({ key: g.key, label: g.label, value: Number(g.metrics.MRR?.native?.[currency] ?? 0) }))
    .filter((d) => d.value !== 0)
    .sort((a, b) => b.value - a.value);
  const withoutMrr = (products.data ?? []).filter(
    (p) => !groups.some((g) => g.key === p.id && Object.keys(g.metrics.MRR?.native ?? {}).length > 0),
  );

  return (
    <ChartPanel
      title="¿De qué productos viene el recurrente vigente?"
      unit={`MRR vigente en ${currency || 'moneda nativa'}`}
      period="Foto actual (no es evolución histórica)"
      source="finance_consolidated · v_subscription_mrr"
      coverage={withoutMrr.length ? `${withoutMrr.length} productos sin MRR vigente` : undefined}
      state={currencies.length === 0 && state.status === 'ready' ? { status: 'empty' } : state}
      onRetry={() => void query.refetch()}
      emptyText="Ningún producto tiene recurrente vigente"
      controls={<CurrencyPicker currencies={currencies} value={currency} onChange={setPicked} />}
      detailHref="/products"
      detailLabel="Ver productos"
      chart={() => (
        <SingleBars
          data={data}
          currency={currency}
          layout="horizontal-bars"
          ariaLabel={`MRR vigente por producto en ${currency}`}
          onSelect={(d) => onSelect(d.key)}
        />
      )}
      table={() => (
        <table className="w-full text-sm">
          <caption className="sr-only">MRR vigente por producto</caption>
          <thead>
            <tr>
              <th scope="col" className="ebim-th">Producto</th>
              {currencies.map((c) => (
                <th key={c} scope="col" className="ebim-th text-right">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {groups.map((g) => (
              <tr key={g.key}>
                <th scope="row" className="ebim-td text-left">
                  <Link className="ebim-link" to={`/products/${g.key}`}>{g.label}</Link>
                </th>
                {currencies.map((c) => (
                  <td key={c} className="ebim-td text-right tabular-nums">
                    {g.metrics.MRR?.native?.[c] !== undefined ? formatMoney(Number(g.metrics.MRR.native[c]), c) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    />
  );
}

interface AttentionItem {
  id: string;
  icon: typeof ReceiptIcon;
  title: string;
  detail: string;
  href: string;
  tone: 'warn' | 'danger' | 'info';
}

/** Requiere atención (spec §7.1.4): cartera, documentos, renovaciones y fallas reales. */
function AttentionList() {
  const aging = useReceivablesAging();
  const alerts = useBillingAlerts('OPEN');
  const documents = useSubscriptionDocumentStatus();
  const renewals = useRenewalPipeline();
  const saas = useSaasProvisioningRequests();
  const summary = useDashboardSummary();

  const sources = [aging, alerts, documents, renewals, saas, summary];
  const failed = sources.filter((q) => q.error).length;
  const loading = sources.some((q) => q.isLoading);

  const items: AttentionItem[] = [];
  const overdueBuckets = new Set(AGING_BUCKETS.filter((b) => b.overdue).map((b) => b.id as string));
  const overdueCount = (aging.data ?? []).filter((r) => overdueBuckets.has(r.aging_bucket)).reduce((a, r) => a + Number(r.invoice_count), 0);
  if (overdueCount > 0) {
    items.push({ id: 'overdue', icon: ReceiptIcon, tone: 'danger', title: `${formatNumber(overdueCount)} facturas vencidas`, detail: 'Saldo con vencimiento anterior a hoy', href: '/billing?estado=OPEN&antiguedad=VENCIDA' });
  }
  const noDue = (aging.data ?? []).filter((r) => r.aging_bucket === 'SIN_FECHA').reduce((a, r) => a + Number(r.invoice_count), 0);
  if (noDue > 0) {
    items.push({ id: 'nodue', icon: ReceiptIcon, tone: 'info', title: `${formatNumber(noDue)} facturas por cobrar sin vencimiento`, detail: 'No se pueden clasificar por antigüedad', href: '/billing?estado=OPEN&antiguedad=SIN_FECHA' });
  }
  const docsPending = (documents.data ?? []).filter((d) => d.document_required && !d.document_ok).length;
  if (docsPending > 0) {
    items.push({ id: 'docs', icon: FileTextIcon, tone: 'warn', title: `${formatNumber(docsPending)} contratos sin OS/OC vigente`, detail: 'El método de cobro exige un documento aprobado', href: '/subscriptions' });
  }
  const soon = (renewals.data ?? []).filter((r) => r.days_to_renewal !== null && Number(r.days_to_renewal) >= 0 && Number(r.days_to_renewal) <= 7).length;
  if (soon > 0) {
    items.push({ id: 'renew', icon: CalendarCheckIcon, tone: 'warn', title: `${formatNumber(soon)} renovaciones en 7 días`, detail: 'Revisar contrato y cobro', href: '/renewals' });
  }
  if ((alerts.data ?? []).length > 0) {
    items.push({ id: 'alerts', icon: BellRingingIcon, tone: 'warn', title: `${formatNumber(alerts.data!.length)} alertas de cobranza abiertas`, detail: 'Vencimientos, gracia y suspensiones pendientes', href: '/renewals' });
  }
  const saasFailed = (saas.data ?? []).filter((r) => r.status === 'FAILED').length;
  if (saasFailed > 0) {
    items.push({ id: 'saas', icon: StackIcon, tone: 'danger', title: `${formatNumber(saasFailed)} altas SaaS fallidas`, detail: 'Solicitudes de alta en un producto con error', href: '/saas-provisioning' });
  }
  const infraFailed = summary.data?.provisioning_failures ?? 0;
  if (infraFailed > 0) {
    items.push({ id: 'infra', icon: HardDrivesIcon, tone: 'danger', title: `${formatNumber(infraFailed)} solicitudes de infraestructura fallidas`, detail: 'Cola de infraestructura (distinta de las altas SaaS)', href: '/provisioning' });
  }

  return (
    <section className="ebim-card" aria-labelledby="attention-title">
      <header className="border-b border-border px-4 py-3">
        <h3 id="attention-title" className="text-sm font-bold text-fg">Requiere atención</h3>
        <p className="text-xs text-muted">Cartera, documentos, renovaciones y fallas reales. Cada elemento abre su operación actual.</p>
      </header>
      <div className="px-4 py-2">
        {loading ? (
          <StateMessage state={{ status: 'loading' }} />
        ) : (
          <>
            {items.length === 0 && failed === 0 ? (
              <p className="py-4 text-sm text-muted">Nada pendiente en las fuentes consultadas.</p>
            ) : null}
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.id}>
                  <Link to={item.href} className="flex items-center gap-3 py-2.5 hover:bg-[color:var(--bg)]">
                    <span
                      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        item.tone === 'danger' ? 'bg-danger-soft text-danger' : item.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-info-soft text-info'
                      }`}
                    >
                      <item.icon size={16} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-fg">{item.title}</span>
                      <span className="block text-xs text-muted">{item.detail}</span>
                    </span>
                    <span aria-hidden className="text-muted">→</span>
                  </Link>
                </li>
              ))}
            </ul>
            {failed > 0 ? (
              <p className="py-2 text-xs font-semibold text-warn" role="status">
                {failed} {failed === 1 ? 'fuente no se pudo leer' : 'fuentes no se pudieron leer'}: esta lista puede estar incompleta.
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/** Resumen compacto de operación SaaS: datos del control plane, sin llamadas a proveedores. */
function SaasSummary({ onOpen }: { onOpen: () => void }) {
  const saas = useSaasProvisioningRequests();
  const state = fromQuery(saas, { isEmpty: () => false });
  const byStatus: Record<string, number> = {};
  for (const r of saas.data ?? []) byStatus[r.status ?? 'SIN_ESTADO'] = (byStatus[r.status ?? 'SIN_ESTADO'] ?? 0) + 1;
  const mappingsActive = (saas.data ?? []).filter((r) => r.mapping_status === 'ACTIVE').length;
  return (
    <section className="ebim-card p-4" aria-labelledby="saas-summary-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="saas-summary-title" className="text-sm font-bold text-fg">Operación SaaS</h3>
          <p className="text-xs text-muted">Altas SaaS registradas en el control plane. No consulta a los proveedores.</p>
        </div>
        <button type="button" className="ebim-btn-secondary h-8 px-3 text-xs" onClick={onOpen}>
          Ver matriz por producto y entorno
        </button>
      </div>
      {state.status === 'ready' ? (
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div><dt className="text-xs text-muted">Solicitudes de alta</dt><dd className="font-bold tabular-nums">{formatNumber(saas.data!.length)}</dd></div>
          {Object.entries(byStatus).map(([s, n]) => (
            <div key={s}><dt className="text-xs text-muted">{s}</dt><dd className="font-bold tabular-nums">{formatNumber(n)}</dd></div>
          ))}
          <div><dt className="text-xs text-muted">Mappings activos</dt><dd className="font-bold tabular-nums">{formatNumber(mappingsActive)}</dd></div>
        </dl>
      ) : (
        <StateMessage state={state} compact onRetry={() => void saas.refetch()} />
      )}
    </section>
  );
}
