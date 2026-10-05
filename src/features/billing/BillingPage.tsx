import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  fetchCollectedPaymentPage,
  fetchInvoicePage,
  useCollectedPaymentPage,
  useCollectionsByMonth,
  useInvoicePage,
  useInvoiceSummary,
  type AgingFilter,
  type CollectedPaymentRow,
  type InvoiceFilter,
  type InvoiceRow,
  type InvoiceSort,
  type PaymentSort,
} from '@/services/financeRead';
import { useExecutiveBillingSeries, useWeeklyCollections, type WeeklyCollectionPoint } from '@/services/queries';
import { useListState } from '@/hooks/useListState';
import { SectionTabs, StatusTabs } from '@/components/ui/SectionTabs';
import { PageContainer, Card, SearchBar, Badge, KpiTile } from '@/components/ui/primitives';
import { PagedTable, type TableColumn } from '@/components/ui/PagedTable';
import { ExportMenu } from '@/components/ui/ExportMenu';
import type { ExportColumn } from '@/lib/export';
import { formatCompactAmount, formatDate, formatMoney, formatNumber, formatPercent, sumByCurrency } from '@/lib/format';
import { INVOICE_STATUS_LABEL } from '@/types/domain';
import { fromQuery } from '@/features/executive/dataState';
import { AGING_BUCKETS } from '@/features/executive/kpis';
import { currentMonth, lastMonths, toCurrencyAmounts } from '@/features/executive/reportContext';
import { ChartPanel } from '@/features/executive/components/ChartPanel';
import { monthLongLabel } from '@/features/dashboard/executiveModel';
import { ConsistencyNote, InfoNote, ScopeChip, ScopeChips } from './listing';
import { parseIsoDate, useDebouncedSearch } from './listingState';
import { FilterTotals, KpiStrip, NativeAmountTile } from './financeUi';
import { analyzedMonth, closedWindow, longMonthName, relChange, shortMonthName } from './financeModel';
import { PeriodBars } from './lazyFinanceCharts';

/**
 * Facturación y cobros (P02).
 *
 * El RESUMEN lo agrega la base (`invoice_summary`) sobre el universo completo y
 * con los MISMOS filtros que la tabla (búsqueda, pestaña, antigüedad); la tabla
 * es una página de ese universo (`v_invoice_balances`). Nada se suma en el
 * navegador y nunca se mezclan monedas.
 *
 * DRAFT y VOID se listan (existen en la operación) pero no cuentan como
 * facturado ni como saldo: eso lo decide la base.
 */

const INVOICE_FILTERS = ['ALL', 'OPEN', 'PAID', 'EXCLUDED', 'UNCOLLECTIBLE'] as const satisfies readonly InvoiceFilter[];
const INVOICE_SORTS = [
  'issue_date', 'due_date', 'number', 'total', 'balance', 'organization_name',
] as const satisfies readonly InvoiceSort[];
const INVOICE_LIST = {
  filter: 'ALL' as InvoiceFilter,
  filters: INVOICE_FILTERS,
  sortBy: 'issue_date' as InvoiceSort,
  sorts: INVOICE_SORTS,
  sortDir: 'desc' as const,
};

const PAYMENT_SORTS = ['collected_on', 'collected_amount', 'organization_name', 'invoice_number'] as const satisfies readonly PaymentSort[];
const PAYMENT_LIST = {
  filter: 'ALL' as const,
  filters: ['ALL'] as const,
  sortBy: 'collected_on' as PaymentSort,
  sorts: PAYMENT_SORTS,
  sortDir: 'desc' as const,
};

const AGING_VALUES: AgingFilter[] = ['VENCIDA', 'VIGENTE', 'D1_30', 'D31_60', 'D61_90', 'D90_MAS', 'SIN_FECHA', 'A_FAVOR'];

function agingLabel(value: string): string {
  if (value === 'VENCIDA') return 'Vencida (todas las bandas)';
  if (value === 'SALDADA') return 'Saldada';
  return AGING_BUCKETS.find((b) => b.id === value)?.label ?? value;
}

function parseAging(value: string): AgingFilter {
  return (AGING_VALUES as string[]).includes(value) ? (value as AgingFilter) : '';
}

const INVOICE_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral' | 'info'> = {
  PAID: 'ok',
  ISSUED: 'info',
  PARTIALLY_PAID: 'warn',
  DRAFT: 'neutral',
  VOID: 'neutral',
  UNCOLLECTIBLE: 'danger',
};

function invoiceStatusLabel(status: string | null): string {
  if (!status) return 'Sin estado';
  return INVOICE_STATUS_LABEL[status as keyof typeof INVOICE_STATUS_LABEL] ?? status;
}

function num(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** Tab de cobros confirmados: se abre sola si el enlace trae un período. */
const PAYMENTS_TAB = 'cobros';

export function BillingPage() {
  const [params] = useSearchParams();
  // Un enlace con período (`?desde=…&hasta=…`) viene de «cobrado del período»:
  // se abre directamente la pestaña de cobros, salvo que el #hash diga otra cosa.
  useState(() => {
    if ((params.get('desde') || params.get('hasta')) && !window.location.hash) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${PAYMENTS_TAB}`);
    }
    return null;
  });

  return (
    <PageContainer
      title="Facturación y cobros"
      description="Cómo vamos facturando y cobrando, y qué falta cobrar. La franja y el gráfico van en moneda de reporte; las tablas, en la moneda de cada factura (nunca se suman monedas)."
    >
      <BillingKpis />
      <div className="mb-6">
        <WeeklyCollectionsPanel />
      </div>
      <SectionTabs
        tabs={[
          { id: 'facturas', label: 'Facturas', content: <InvoicesSection /> },
          { id: PAYMENTS_TAB, label: 'Cobros confirmados', content: <CollectedPaymentsSection /> },
        ]}
      />
    </PageContainer>
  );
}

/* ==========================================================================
   Franja de KPIs (S06, moneda de reporte) y cobros por semana (S10)
   ========================================================================== */

function missingFx(point: { complete: boolean; missingCurrencies: string[] } | undefined): string | null {
  return point && !point.complete ? `Falta tasa ${point.missingCurrencies.join(', ')}: no se consolida` : null;
}

function BillingKpis() {
  const month = analyzedMonth();
  const now = currentMonth();
  const series = useExecutiveBillingSeries({ from: `${lastMonths(now, 14)[0]}-01` });
  const rows = series.data ?? [];
  const { current, previous, trend } = closedWindow(rows, month);
  const today = rows.find((r) => r.month.slice(0, 7) === now);
  const rc = rows[0]?.reportingCurrency;
  const name = shortMonthName(month);
  const vs = previous ? `vs ${longMonthName(previous.month.slice(0, 7))}` : undefined;
  const common = { loading: series.isLoading, error: series.error, onRetry: () => void series.refetch() };
  const rate = current?.collectionRate ?? null;
  const prevRate = previous?.collectionRate ?? null;
  const overdueTrend = rows.filter((r) => r.month.slice(0, 7) <= now).slice(-12);

  return (
    <KpiStrip label="Indicadores de facturación y cobro">
      <KpiTile
        label={`Facturado · ${name}`}
        info="Facturas emitidas en el mes (excluye borradores y anuladas), en moneda de reporte con la tasa del cierre del mes (S06)."
        currency={current?.invoiced != null ? rc : undefined}
        value={current?.invoiced == null ? null : formatCompactAmount(current.invoiced)}
        delta={{ value: relChange(current?.invoiced, previous?.invoiced), comparison: vs }}
        trend={trend.map((p) => p.invoiced)}
        trendDescription={`Facturado de los últimos ${trend.length} meses cerrados`}
        footer={missingFx(current) ?? `${formatNumber(current?.invoiceCount ?? 0)} facturas · ${monthLongLabel(month)}`}
        {...common}
      />
      <KpiTile
        label={`Cobrado · ${name}`}
        info="Pagos confirmados en el mes (K02), en moneda de reporte con la tasa del cierre del mes."
        currency={current?.collected != null ? rc : undefined}
        value={current?.collected == null ? null : formatCompactAmount(current.collected)}
        delta={{ value: relChange(current?.collected, previous?.collected), comparison: vs }}
        trend={trend.map((p) => p.collected)}
        trendDescription={`Cobrado de los últimos ${trend.length} meses cerrados`}
        footer={missingFx(current) ?? `${formatNumber(current?.paymentCount ?? 0)} pagos confirmados`}
        {...common}
      />
      <KpiTile
        label={`Cobro del mes · ${name}`}
        info="Cobrado ÷ facturado del MISMO mes (razón de caja): puede superar 100 % si se cobró atraso."
        value={rate == null ? null : formatPercent(rate)}
        delta={{
          value: rate != null && prevRate != null ? (rate - prevRate) * 100 : null,
          kind: 'pp',
          comparison: vs,
        }}
        trend={trend.map((p) => p.collectionRate)}
        trendDescription="Razón de cobro de los últimos meses cerrados"
        footer="Cobrado ÷ facturado del mes"
        {...common}
      />
      <KpiTile
        label="Cartera vencida · hoy"
        info="Saldo de facturas con 1 día o más de atraso, a hoy (bandas 1–30 a más de 90 días, S05)."
        currency={today?.overdue != null ? rc : undefined}
        value={today?.overdue == null ? null : formatCompactAmount(today.overdue)}
        delta={{
          value: relChange(today?.overdue, current?.overdue),
          comparison: `vs cierre de ${longMonthName(month)}`,
          goodWhen: 'down',
        }}
        trend={overdueTrend.map((p) => p.overdue)}
        trendPartial={Boolean(today?.isPartial)}
        trendDescription="Cartera vencida al cierre de cada mes; el último punto es hoy"
        footer={missingFx(today) ?? `${formatNumber(today?.overdueInvoiceCount ?? 0)} facturas vencidas`}
        {...common}
      />
    </KpiStrip>
  );
}

function weekLabel(p: WeeklyCollectionPoint): string {
  const [, m, d] = p.weekStart.split('-') as [string, string, string];
  return `${Number(d)} ${shortMonthName(`${p.weekStart.slice(0, 4)}-${m}`)}`;
}

function WeeklyCollectionsPanel() {
  const query = useWeeklyCollections(12);
  const points = query.data ?? [];
  const rc = points[0]?.reportingCurrency ?? '';
  const closed = points.filter((p) => !p.isPartial);
  const total = closed.every((p) => p.collected != null) ? closed.reduce((t, p) => t + (p.collected ?? 0), 0) : null;
  const best = [...closed].sort((a, b) => (b.collected ?? 0) - (a.collected ?? 0))[0];
  const state = fromQuery(query, { isEmpty: (rows) => rows.every((r) => r.paymentCount === 0) });
  const data = points.map((p) => ({
    key: p.weekStart,
    label: weekLabel(p),
    title: `Semana del ${formatDate(p.weekStart)} al ${formatDate(p.weekEnd)}`,
    partial: p.isPartial,
    values: { collected: p.collected },
  }));
  return (
    <ChartPanel
      id="cobros-semana"
      title="¿Cómo entra la caja semana a semana?"
      unit={`Cobrado por semana en ${rc || 'moneda de reporte'}`}
      period={`Últimas ${points.length || 12} semanas${total != null ? ` · ${formatMoney(total, rc)} en semanas cerradas` : ''}`}
      source="collections_by_week"
      coverage="Pagos confirmados por fecha de cobro; la semana en curso va más tenue"
      state={state}
      onRetry={() => void query.refetch()}
      emptyText="Sin cobros confirmados en las últimas semanas"
      refreshing={query.isPlaceholderData}
      chart={() => (
        <PeriodBars
          data={data}
          series={[{ key: 'collected', label: 'Cobrado', color: 'var(--chart-1)' }]}
          unit={{ currency: rc }}
          height={220}
          ariaLabel={`Cobrado por semana en ${rc}${best ? `; la semana más alta fue la del ${formatDate(best.weekStart)} con ${formatMoney(best.collected, rc)}` : ''}. Use la vista Tabla para leer cada semana.`}
        />
      )}
      table={() => (
        <table className="w-full text-compact">
          <caption className="sr-only">Cobrado por semana</caption>
          <thead>
            <tr>
              <th scope="col" className="ebim-th">Semana</th>
              <th scope="col" className="ebim-th text-right">Cobrado ({rc})</th>
              <th scope="col" className="ebim-th text-right">Pagos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...points].reverse().map((p) => (
              <tr key={p.weekStart}>
                <th scope="row" className="ebim-td text-left font-medium">
                  {formatDate(p.weekStart)} – {formatDate(p.weekEnd)}
                  {p.isPartial ? <span className="ml-1 text-caption text-muted">(en curso)</span> : null}
                </th>
                <td className="ebim-td ebim-num">{p.collected == null ? 'Sin tasa' : formatMoney(p.collected, rc)}</td>
                <td className="ebim-td ebim-num">{formatNumber(p.paymentCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    />
  );
}

/* ==========================================================================
   Facturas
   ========================================================================== */

function InvoicesSection() {
  const list = useListState(INVOICE_LIST);
  const aging = parseAging(list.extra('antiguedad'));
  const [draft, setDraft] = useDebouncedSearch(list.search, list.setSearch);

  const tableParams = {
    search: list.search,
    filter: list.filter,
    page: list.page,
    pageSize: list.pageSize,
    sortBy: list.sortBy,
    sortDir: list.sortDir,
    aging,
  };
  const page = useInvoicePage(tableParams);
  const summary = useInvoiceSummary({ search: list.search, filter: list.filter, aging });
  const summaryState = fromQuery(summary);
  const retrySummary = () => void summary.refetch();
  const counts = summary.data?.status_counts ?? {};

  const tabs: Array<{ id: InvoiceFilter; label: string }> = [
    { id: 'ALL', label: 'Todas' },
    { id: 'OPEN', label: 'Por cobrar' },
    { id: 'PAID', label: 'Pagadas' },
    { id: 'EXCLUDED', label: 'Borrador y anuladas' },
    { id: 'UNCOLLECTIBLE', label: 'Incobrables' },
  ];

  const columns: TableColumn<InvoiceRow>[] = [
    {
      id: 'number',
      header: 'Número',
      sortKey: 'number',
      cell: (r) => (
        <span className="block max-w-[160px] truncate whitespace-nowrap font-mono text-compact font-semibold" title={r.number ?? undefined}>
          {r.number ?? '—'}
        </span>
      ),
    },
    {
      id: 'organization',
      header: 'Organización',
      sortKey: 'organization_name',
      cell: (r) =>
        r.customer_organization_id ? (
          <Link
            className="ebim-link block max-w-[160px] truncate"
            title={r.organization_name ?? undefined}
            to={`/organizations/${r.customer_organization_id}`}
          >
            {r.organization_name ?? 'Sin nombre'}
          </Link>
        ) : (
          <span className="block max-w-[160px] truncate text-muted">{r.organization_name ?? '—'}</span>
        ),
    },
    { id: 'issue', header: 'Emisión', sortKey: 'issue_date', cell: (r) => <span className="whitespace-nowrap text-compact text-fg-2">{formatDate(r.issue_date)}</span> },
    { id: 'due', header: 'Vence', sortKey: 'due_date', cell: (r) => <span className="whitespace-nowrap text-compact text-fg-2">{formatDate(r.due_date)}</span> },
    // Lo cobrado va bajo el total (saldo = total − cobrado): como columna propia
    // la tabla no cabía a 1280.
    {
      id: 'total',
      header: 'Total · cobrado',
      sortKey: 'total',
      align: 'right',
      cell: (r) => (
        <span className="whitespace-nowrap">
          <span className="block font-semibold">{formatMoney(num(r.total), r.currency)}</span>
          <span className="block text-caption text-muted">cobrado {formatMoney(num(r.confirmed_paid), r.currency)}</span>
        </span>
      ),
    },
    {
      id: 'balance',
      header: 'Saldo',
      sortKey: 'balance',
      align: 'right',
      cell: (r) => {
        const balance = num(r.balance);
        if (balance !== null && balance < 0) {
          // Sobrepago: se muestra tal cual, sin recortar a cero.
          return (
            <span className="whitespace-nowrap text-danger">
              {formatMoney(balance, r.currency)}
              <span className="block text-caption font-semibold">Saldo a favor del cliente</span>
            </span>
          );
        }
        return <span className={`whitespace-nowrap ${balance ? 'font-semibold' : 'text-muted'}`}>{formatMoney(balance, r.currency)}</span>;
      },
    },
    {
      // Estado y antigüedad comparten celda: la antigüedad sólo existe para lo
      // que se puede cobrar y como columna propia empujaba la tabla fuera de 1280.
      id: 'status',
      header: 'Estado · antigüedad',
      cell: (r) => {
        const bucket = r.is_receivable && r.aging_bucket ? AGING_BUCKETS.find((b) => b.id === r.aging_bucket) : null;
        return (
          <span className="flex flex-col items-start gap-0.5">
            <Badge tone={INVOICE_TONE[r.status ?? ''] ?? 'neutral'}>{invoiceStatusLabel(r.status)}</Badge>
            {bucket && r.aging_bucket ? (
              <span className={`whitespace-nowrap text-caption ${bucket.overdue ? 'font-semibold text-warn' : 'text-muted'}`}>
                {agingLabel(r.aging_bucket)}
                {r.days_overdue && r.days_overdue > 0 ? ` · ${formatNumber(r.days_overdue)} d` : ''}
              </span>
            ) : null}
          </span>
        );
      },
    },
  ];

  const exportColumns: ExportColumn<InvoiceRow>[] = [
    { header: 'Número', value: (r) => r.number },
    { header: 'Organización', value: (r) => r.organization_name },
    { header: 'Emisión', value: (r) => r.issue_date },
    { header: 'Vencimiento', value: (r) => r.due_date },
    { header: 'Moneda', value: (r) => r.currency },
    { header: 'Total', value: (r) => r.total, kind: 'amount' },
    { header: 'Cobrado confirmado', value: (r) => r.confirmed_paid, kind: 'amount' },
    { header: 'Saldo', value: (r) => r.balance, kind: 'amount' },
    { header: 'Estado', value: (r) => invoiceStatusLabel(r.status) },
    { header: 'Antigüedad', value: (r) => (r.aging_bucket ? agingLabel(r.aging_bucket) : '') },
    { header: 'Días vencida', value: (r) => r.days_overdue, kind: 'number' },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <SearchBar
          value={draft}
          onChange={setDraft}
          placeholder="Buscar por número de factura u organización…"
          right={
            <ExportMenu
              filenameBase="facturas"
              columns={exportColumns}
              pageRows={page.data?.rows ?? []}
              total={page.data?.total ?? 0}
              rowKey={(r) => r.invoice_id ?? ''}
              fetchPage={(p, size) => fetchInvoicePage({ ...tableParams, page: p, pageSize: size })}
            />
          }
        />
        <div className="border-b border-border px-5 py-2.5">
          <StatusTabs
            value={list.filter}
            onChange={list.setFilter}
            options={tabs.map((t) => ({
              ...t,
              count: t.id === list.filter && summary.data ? Number(summary.data.row_count) : undefined,
            }))}
          />
        </div>
        {aging ? (
          <ScopeChips>
            <span className="text-caption text-muted">Contexto:</span>
            <ScopeChip label={`Antigüedad: ${agingLabel(aging)}`} onRemove={() => list.setExtra('antiguedad', null)} />
          </ScopeChips>
        ) : null}
        <FilterTotals
          state={summaryState}
          onRetry={retrySummary}
          items={[
            {
              label: 'Facturado (emitido)',
              amounts: toCurrencyAmounts(summary.data?.invoiced),
              hint: 'Facturas emitidas del resultado; excluye borrador y anuladas.',
            },
            {
              label: 'Cobrado (confirmado)',
              amounts: toCurrencyAmounts(summary.data?.collected),
              hint: 'Sólo pagos confirmados sobre estas facturas.',
            },
            {
              label: 'Saldo por cobrar',
              amounts: toCurrencyAmounts(summary.data?.receivable),
              emptyLabel: 'Sin saldo',
              hint: 'Total − cobros confirmados, a hoy. Un sobrepago queda negativo.',
            },
            {
              label: 'Cartera vencida',
              amounts: toCurrencyAmounts(summary.data?.overdue),
              emptyLabel: 'Sin cartera vencida',
              hint: 'Saldo con vencimiento anterior a hoy. «Sin fecha» no cuenta.',
            },
          ]}
          note={
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <ConsistencyNote
                summaryCount={summary.data && !summary.isFetching ? summary.data.row_count : undefined}
                tableTotal={page.data && !page.isFetching ? page.data.total : undefined}
                noun="facturas"
              />
              {Object.keys(counts).length > 0 ? (
                <p className="text-caption text-muted">
                  {Object.entries(counts)
                    .map(([status, n]) => `${invoiceStatusLabel(status)} ${formatNumber(Number(n))}`)
                    .join(' · ')}
                </p>
              ) : null}
            </div>
          }
        />
        <PagedTable
          label="Facturas"
          columns={columns}
          rows={page.data?.rows ?? []}
          rowKey={(r) => r.invoice_id ?? `${r.number}`}
          sortBy={list.sortBy}
          sortDir={list.sortDir}
          onSortChange={list.setSort}
          page={list.page}
          pageSize={list.pageSize}
          total={page.data?.total ?? 0}
          onPageChange={list.setPage}
          onPageSizeChange={list.setPageSize}
          loading={page.isLoading}
          fetching={page.isFetching}
          error={page.error}
          onRetry={() => void page.refetch()}
          emptyTitle="Sin facturas"
          emptyDescription="No hay facturas visibles para tu rol con estos filtros."
        />
      </Card>
    </div>
  );
}

/* ==========================================================================
   Cobros confirmados
   ========================================================================== */

function CollectedPaymentsSection() {
  const list = useListState(PAYMENT_LIST, 'c');
  const [params, setParams] = useSearchParams();
  const from = parseIsoDate(params.get('desde') ?? '');
  const to = parseIsoDate(params.get('hasta') ?? '');
  const [draft, setDraft] = useDebouncedSearch(list.search, list.setSearch);

  const tableParams = {
    search: list.search,
    filter: 'ALL' as const,
    page: list.page,
    pageSize: list.pageSize,
    sortBy: list.sortBy,
    sortDir: list.sortDir,
    from: from || undefined,
    to: to || undefined,
  };
  const page = useCollectedPaymentPage(tableParams);
  const clearPeriod = () =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('desde');
        next.delete('hasta');
        next.delete('cp');
        return next;
      },
      { replace: true, preventScrollReset: true },
    );

  const periodLabel = from || to ? `Período: ${from ? formatDate(from) : 'inicio'} – ${to ? formatDate(to) : 'hoy'}` : '';

  const columns: TableColumn<CollectedPaymentRow>[] = [
    { id: 'date', header: 'Fecha de cobro', sortKey: 'collected_on', cell: (r) => <span className="whitespace-nowrap text-compact">{formatDate(r.collected_on)}</span> },
    {
      id: 'invoice',
      header: 'Factura',
      sortKey: 'invoice_number',
      cell: (r) => (
        <span className="block max-w-[160px] truncate whitespace-nowrap font-mono text-compact font-semibold" title={r.invoice_number ?? undefined}>
          {r.invoice_number ?? '—'}
        </span>
      ),
    },
    {
      id: 'organization',
      header: 'Organización',
      sortKey: 'organization_name',
      cell: (r) =>
        r.customer_organization_id ? (
          <Link
            className="ebim-link block max-w-[160px] truncate"
            title={r.organization_name ?? undefined}
            to={`/organizations/${r.customer_organization_id}`}
          >
            {r.organization_name ?? 'Sin nombre'}
          </Link>
        ) : (
          <span className="block max-w-[160px] truncate text-muted">{r.organization_name ?? '—'}</span>
        ),
    },
    { id: 'method', header: 'Método', cell: (r) => <span className="text-compact text-fg-2">{r.method ?? 'Sin método'}</span> },
    {
      id: 'reference',
      header: 'Referencia',
      cell: (r) => (
        <span className="block max-w-[180px] truncate font-mono text-compact text-muted" title={r.reference ?? undefined}>
          {r.reference ?? '—'}
        </span>
      ),
    },
    {
      id: 'amount',
      header: 'Cobrado',
      sortKey: 'collected_amount',
      align: 'right',
      cell: (r) => (
        <span className="whitespace-nowrap font-semibold">
          {formatMoney(num(r.collected_amount), r.currency)}
          {num(r.payment_amount) !== null && num(r.payment_amount) !== num(r.collected_amount) ? (
            <span className="block text-caption font-normal text-muted">
              Pago de {formatMoney(num(r.payment_amount), r.currency)}
            </span>
          ) : null}
        </span>
      ),
    },
  ];

  const exportColumns: ExportColumn<CollectedPaymentRow>[] = [
    { header: 'Fecha de cobro', value: (r) => r.collected_on },
    { header: 'Factura', value: (r) => r.invoice_number },
    { header: 'Organización', value: (r) => r.organization_name },
    { header: 'Método', value: (r) => r.method },
    { header: 'Referencia', value: (r) => r.reference },
    { header: 'Moneda', value: (r) => r.currency },
    { header: 'Cobrado', value: (r) => r.collected_amount, kind: 'amount' },
    { header: 'Importe del pago', value: (r) => r.payment_amount, kind: 'amount' },
  ];

  return (
    <div className="space-y-4">
      <InfoNote>
        Sólo pagos <strong>confirmados</strong> sobre facturas emitidas, parcialmente pagadas o pagadas. Pagos pendientes o
        revertidos no son cobro.
      </InfoNote>

      {from || to ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* El agregado mensual no conoce el término buscado: sólo se muestra
              con período cerrado y sin búsqueda, para no aparentar otro universo. */}
          {from && to && !list.search ? (
            <PeriodTotal from={from} to={to} />
          ) : (
            <KpiTile
              label="Cobrado en el período"
              value={null}
              footer={
                list.search
                  ? 'El total del período se calcula sin búsqueda: quita el término para verlo.'
                  : 'Indica fecha de inicio y de fin para calcular el total.'
              }
            />
          )}
        </div>
      ) : null}

      <Card>
        <SearchBar
          value={draft}
          onChange={setDraft}
          placeholder="Buscar por factura, organización o referencia…"
          right={
            <ExportMenu
              filenameBase="cobros-confirmados"
              columns={exportColumns}
              pageRows={page.data?.rows ?? []}
              total={page.data?.total ?? 0}
              rowKey={(r) => `${r.payment_id ?? ''}:${r.invoice_id ?? ''}`}
              fetchPage={(p, size) => fetchCollectedPaymentPage({ ...tableParams, page: p, pageSize: size })}
            />
          }
        />
        {periodLabel ? (
          <ScopeChips>
            <span className="text-caption text-muted">Contexto:</span>
            <ScopeChip label={periodLabel} onRemove={clearPeriod} />
          </ScopeChips>
        ) : null}
        <PagedTable
          label="Cobros confirmados"
          columns={columns}
          rows={page.data?.rows ?? []}
          rowKey={(r) => `${r.payment_id ?? ''}:${r.invoice_id ?? ''}`}
          sortBy={list.sortBy}
          sortDir={list.sortDir}
          onSortChange={list.setSort}
          page={list.page}
          pageSize={list.pageSize}
          total={page.data?.total ?? 0}
          onPageChange={list.setPage}
          onPageSizeChange={list.setPageSize}
          loading={page.isLoading}
          fetching={page.isFetching}
          error={page.error}
          onRetry={() => void page.refetch()}
          emptyTitle="Sin cobros confirmados"
          emptyDescription="No hay cobros confirmados visibles para tu rol con estos filtros."
        />
      </Card>
    </div>
  );
}

function PeriodTotal({ from, to }: { from: string; to: string }) {
  const totals = useCollectionsByMonth(from, to);
  const state = fromQuery(totals);
  return (
    <NativeAmountTile
      label="Cobrado en el período"
      info="Pagos confirmados con fecha de cobro dentro del período, por moneda nativa."
      amounts={state.status === 'ready' ? sumByCurrency(state.data, (r) => r.amount, (r) => r.currency) : {}}
      state={state}
      onRetry={() => void totals.refetch()}
      emptyLabel="Sin cobros en el período"
      footer={`${formatDate(from)} – ${formatDate(to)}`}
    />
  );
}
