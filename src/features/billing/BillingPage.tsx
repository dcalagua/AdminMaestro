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
import { useListState } from '@/hooks/useListState';
import { SectionTabs, StatusTabs } from '@/components/ui/SectionTabs';
import { PageContainer, Card, SearchBar, Badge } from '@/components/ui/primitives';
import { PagedTable, type TableColumn } from '@/components/ui/PagedTable';
import { ExportMenu } from '@/components/ui/ExportMenu';
import type { ExportColumn } from '@/lib/export';
import { formatDate, formatMoney, formatNumber, sumByCurrency } from '@/lib/format';
import { INVOICE_STATUS_LABEL } from '@/types/domain';
import { KpiCard, CurrencyLines, StateMessage } from '@/features/executive/components/StateView';
import { fromQuery } from '@/features/executive/dataState';
import { AGING_BUCKETS } from '@/features/executive/kpis';
import { toCurrencyAmounts } from '@/features/executive/reportContext';
import { ConsistencyNote, InfoNote, ScopeChip, ScopeChips } from './listing';
import { parseIsoDate, useDebouncedSearch } from './listingState';

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

const AGING_VALUES: AgingFilter[] = ['VENCIDA', 'VIGENTE', 'D1_30', 'D31_60', 'D61_90', 'D90_MAS', 'SIN_FECHA'];

function agingLabel(value: string): string {
  if (value === 'VENCIDA') return 'Vencida (todas las bandas)';
  if (value === 'VENCIDA') return 'Vencida (todas las bandas)';
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
      description="Control gerencial, no contabilidad. Importes por moneda nativa: nunca se suman monedas distintas. Borradores y anuladas no cuentan como ingreso."
    >
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
      cell: (r) => <span className="font-mono text-xs font-semibold">{r.number ?? '—'}</span>,
    },
    {
      id: 'organization',
      header: 'Organización',
      sortKey: 'organization_name',
      cell: (r) =>
        r.customer_organization_id ? (
          <Link className="ebim-link" to={`/organizations/${r.customer_organization_id}`}>
            {r.organization_name ?? 'Sin nombre'}
          </Link>
        ) : (
          <span className="text-muted">{r.organization_name ?? '—'}</span>
        ),
    },
    { id: 'issue', header: 'Emisión', sortKey: 'issue_date', cell: (r) => <span className="text-xs text-muted">{formatDate(r.issue_date)}</span> },
    { id: 'due', header: 'Vencimiento', sortKey: 'due_date', cell: (r) => <span className="text-xs text-muted">{formatDate(r.due_date)}</span> },
    {
      id: 'total',
      header: 'Total',
      sortKey: 'total',
      align: 'right',
      cell: (r) => <span className="font-semibold">{formatMoney(num(r.total), r.currency)}</span>,
    },
    { id: 'paid', header: 'Cobrado', align: 'right', cell: (r) => formatMoney(num(r.confirmed_paid), r.currency) },
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
            <span className="text-danger">
              {formatMoney(balance, r.currency)}
              <span className="block text-[11px] font-semibold">Saldo a favor del cliente</span>
            </span>
          );
        }
        return <span className={balance ? 'font-semibold' : 'text-muted'}>{formatMoney(balance, r.currency)}</span>;
      },
    },
    {
      id: 'status',
      header: 'Estado',
      cell: (r) => <Badge tone={INVOICE_TONE[r.status ?? ''] ?? 'neutral'}>{invoiceStatusLabel(r.status)}</Badge>,
    },
    {
      id: 'aging',
      header: 'Antigüedad',
      cell: (r) => {
        if (!r.is_receivable || !r.aging_bucket) return <span className="text-xs text-muted">No aplica</span>;
        const bucket = AGING_BUCKETS.find((b) => b.id === r.aging_bucket);
        return (
          <span className={`text-xs ${bucket?.overdue ? 'font-semibold text-warn' : 'text-muted'}`}>
            {agingLabel(r.aging_bucket)}
            {r.days_overdue && r.days_overdue > 0 ? ` · ${formatNumber(r.days_overdue)} d` : ''}
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          id="billing-invoiced"
          label="Facturado (emitido)"
          temporality="Según filtros"
          state={summaryState}
          onRetry={retrySummary}
          hint="Facturas emitidas; excluye borrador y anuladas. Por moneda."
          render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.invoiced)} />}
        />
        <KpiCard
          id="billing-collected"
          label="Cobrado (confirmado)"
          temporality="Según filtros"
          state={summaryState}
          onRetry={retrySummary}
          hint="Sólo pagos confirmados sobre estas facturas."
          render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.collected)} />}
        />
        <KpiCard
          id="billing-receivable"
          label="Saldo por cobrar"
          temporality="Foto actual"
          state={summaryState}
          onRetry={retrySummary}
          hint="Total − cobros confirmados. Un sobrepago queda negativo."
          render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.receivable)} emptyLabel="Sin saldo" />}
        />
        <KpiCard
          id="billing-overdue"
          label="Cartera vencida"
          temporality="Foto actual"
          state={summaryState}
          onRetry={retrySummary}
          hint="Saldo con vencimiento anterior a hoy. «Sin fecha» no cuenta."
          render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.overdue)} emptyLabel="Sin cartera vencida" />}
        />
      </div>

      <ConsistencyNote
        summaryCount={summary.data && !summary.isFetching ? summary.data.row_count : undefined}
        tableTotal={page.data && !page.isFetching ? page.data.total : undefined}
        noun="facturas"
      />

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
        <div className="border-b border-border px-4 py-2">
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
            <span className="text-xs text-muted">Contexto:</span>
            <ScopeChip label={`Antigüedad: ${agingLabel(aging)}`} onRemove={() => list.setExtra('antiguedad', null)} />
          </ScopeChips>
        ) : null}
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
      {Object.keys(counts).length > 0 ? (
        <p className="px-1 text-xs text-muted">
          Estados en el resultado:{' '}
          {Object.entries(counts)
            .map(([status, n]) => `${invoiceStatusLabel(status)} ${formatNumber(Number(n))}`)
            .join(' · ')}
        </p>
      ) : null}
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
    { id: 'date', header: 'Fecha de cobro', sortKey: 'collected_on', cell: (r) => <span className="text-xs">{formatDate(r.collected_on)}</span> },
    {
      id: 'invoice',
      header: 'Factura',
      sortKey: 'invoice_number',
      cell: (r) => <span className="font-mono text-xs font-semibold">{r.invoice_number ?? '—'}</span>,
    },
    {
      id: 'organization',
      header: 'Organización',
      sortKey: 'organization_name',
      cell: (r) =>
        r.customer_organization_id ? (
          <Link className="ebim-link" to={`/organizations/${r.customer_organization_id}`}>
            {r.organization_name ?? 'Sin nombre'}
          </Link>
        ) : (
          <span className="text-muted">{r.organization_name ?? '—'}</span>
        ),
    },
    { id: 'method', header: 'Método', cell: (r) => <span className="text-xs text-muted">{r.method ?? 'Sin método'}</span> },
    { id: 'reference', header: 'Referencia', cell: (r) => <span className="font-mono text-xs text-muted">{r.reference ?? '—'}</span> },
    {
      id: 'amount',
      header: 'Cobrado',
      sortKey: 'collected_amount',
      align: 'right',
      cell: (r) => (
        <span className="font-semibold">
          {formatMoney(num(r.collected_amount), r.currency)}
          {num(r.payment_amount) !== null && num(r.payment_amount) !== num(r.collected_amount) ? (
            <span className="block text-[11px] font-normal text-muted">
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
        <section className="ebim-card p-4" aria-labelledby="period-total">
          <h3 id="period-total" className="text-[11px] font-bold uppercase tracking-wider text-muted">
            Cobrado en el período
          </h3>
          <div className="mt-2 text-xl font-bold text-fg">
            {/* El agregado mensual no conoce el término buscado: sólo se muestra
                con período cerrado y sin búsqueda, para no aparentar otro universo. */}
            {from && to && !list.search ? (
              <PeriodTotal from={from} to={to} />
            ) : (
              <p className="text-sm font-normal text-muted">
                {list.search
                  ? 'El total del período se calcula sin búsqueda: quita el término para verlo.'
                  : 'Indica fecha de inicio y de fin para calcular el total.'}
              </p>
            )}
          </div>
        </section>
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
            <span className="text-xs text-muted">Contexto:</span>
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
  if (state.status === 'ready') {
    return (
      <CurrencyLines
        amounts={sumByCurrency(state.data, (r) => r.amount, (r) => r.currency)}
        emptyLabel="Sin cobros en el período"
      />
    );
  }
  return <StateMessage state={state} compact emptyText="Sin cobros en el período" onRetry={() => void totals.refetch()} />;
}
