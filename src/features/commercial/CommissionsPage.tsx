import { useSettlements } from '@/services/queries';
import {
  fetchCommissionPage,
  useCommissionPage,
  useCommissionSummary,
  type CommissionFilter,
  type CommissionRow,
  type CommissionSort,
} from '@/services/financeRead';
import { useListState } from '@/hooks/useListState';
import { SectionTabs, StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { PagedTable, type TableColumn } from '@/components/ui/PagedTable';
import { ExportMenu } from '@/components/ui/ExportMenu';
import type { ExportColumn } from '@/lib/export';
import { formatMoney, formatPercent, formatDate, formatNumber } from '@/lib/format';
import { KpiCard, CurrencyLines } from '@/features/executive/components/StateView';
import { fromQuery } from '@/features/executive/dataState';
import { toCurrencyAmounts } from '@/features/executive/reportContext';
import { ConsistencyNote, InfoNote } from '@/features/billing/listing';
import { useDebouncedSearch } from '@/features/billing/listingState';

/**
 * Comisiones y liquidaciones (P14).
 *
 * El resumen lo agrega la base (`commission_summary`) con los MISMOS filtros
 * que la tabla (`v_commission_detail`). «Pendiente» es lo que ya se debe
 * (ELEGIBLE + DEVENGADA); «En espera» (PENDING) todavía no es deuda y se
 * muestra aparte para no inflar el pendiente.
 *
 * Cada evento muestra CÓMO se calculó (base × tasa × participación): una
 * comisión que no se puede explicar es una comisión que se discute.
 */

const FILTERS = ['ALL', 'PENDING', 'PAID', 'WAITING', 'VOID'] as const satisfies readonly CommissionFilter[];
const SORTS = ['earned_on', 'amount', 'agent_name', 'product_short_name'] as const satisfies readonly CommissionSort[];
const LIST = {
  filter: 'ALL' as CommissionFilter,
  filters: FILTERS,
  sortBy: 'earned_on' as CommissionSort,
  sorts: SORTS,
  sortDir: 'desc' as const,
};

/** Etiquetas de esta pantalla: «Pendiente» aquí es ELEGIBLE + DEVENGADA, no PENDING. */
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'En espera',
  ELIGIBLE: 'Elegible',
  ACCRUED: 'Devengada',
  PAID: 'Pagada',
  VOID: 'Anulada',
};
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral' | 'info'> = {
  PENDING: 'neutral',
  ELIGIBLE: 'warn',
  ACCRUED: 'warn',
  PAID: 'ok',
  VOID: 'danger',
};

const SETTLEMENT_LABEL: Record<string, string> = {
  OPEN: 'Abierta',
  APPROVED: 'Aprobada',
  PAID: 'Pagada',
  CANCELLED: 'Anulada',
};

function num(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function calculation(r: CommissionRow): string {
  const parts = [formatMoney(num(r.base_amount), r.currency)];
  if (r.applied_rate !== null && r.applied_rate !== undefined) parts.push(formatPercent(Number(r.applied_rate)));
  if (r.attribution_pct !== null && r.attribution_pct !== undefined && Number(r.attribution_pct) < 1) {
    parts.push(`${formatPercent(Number(r.attribution_pct), 0)} de participación`);
  }
  return parts.join(' × ');
}

export function CommissionsPage() {
  const settlements = useSettlements();
  return (
    <PageContainer
      title="Comisiones y liquidaciones"
      description="Cada comisión nace de un cobro confirmado. Una factura emitida pero impaga no devenga nada. Importes por moneda: no se suman monedas distintas."
    >
      <SectionTabs
        tabs={[
          { id: 'events', label: 'Eventos de comisión', content: <CommissionEventsSection /> },
          {
            id: 'settlements',
            label: `Liquidaciones${settlements.data ? ` (${formatNumber(settlements.data.length)})` : ''}`,
            content: <SettlementsSection query={settlements} />,
          },
        ]}
      />
    </PageContainer>
  );
}

function CommissionEventsSection() {
  const list = useListState(LIST);
  const [draft, setDraft] = useDebouncedSearch(list.search, list.setSearch);
  const tableParams = {
    search: list.search,
    filter: list.filter,
    page: list.page,
    pageSize: list.pageSize,
    sortBy: list.sortBy,
    sortDir: list.sortDir,
  };
  const page = useCommissionPage(tableParams);
  const summary = useCommissionSummary({ search: list.search, filter: list.filter });
  const summaryState = fromQuery(summary);
  const retry = () => void summary.refetch();

  const columns: TableColumn<CommissionRow>[] = [
    { id: 'date', header: 'Fecha', sortKey: 'earned_on', cell: (r) => <span className="whitespace-nowrap text-xs text-muted">{formatDate(r.earned_on)}</span> },
    { id: 'agent', header: 'Comercial', sortKey: 'agent_name', cell: (r) => <span className="font-semibold">{r.agent_name ?? '—'}</span> },
    { id: 'product', header: 'Producto', sortKey: 'product_short_name', cell: (r) => r.product_short_name ?? '—' },
    { id: 'tenant', header: 'Tenant', cell: (r) => <span className="text-muted">{r.tenant_name ?? '—'}</span> },
    {
      id: 'origin',
      header: 'Origen',
      cell: (r) => (
        <span className="text-xs">
          {r.source_label ?? '—'}
          {r.invoice_number ? <span className="block font-mono text-muted">{r.invoice_number}</span> : null}
          {r.is_reversal ? (
            <span className="mt-1 block">
              <Badge tone="danger">Reverso</Badge>
            </span>
          ) : null}
        </span>
      ),
    },
    { id: 'rule', header: 'Regla', cell: (r) => <span className="text-xs">{r.rule_name ?? '—'}</span> },
    // Trazabilidad del cálculo: base × tasa × participación.
    { id: 'calc', header: 'Cálculo', cell: (r) => <span className="whitespace-nowrap text-xs text-muted">{calculation(r)}</span> },
    {
      id: 'amount',
      header: 'Monto',
      sortKey: 'amount',
      align: 'right',
      cell: (r) => (
        <span className={`font-semibold ${Number(r.amount ?? 0) < 0 ? 'text-danger' : ''}`}>{formatMoney(num(r.amount), r.currency)}</span>
      ),
    },
    {
      id: 'status',
      header: 'Estado',
      cell: (r) => <Badge tone={STATUS_TONE[r.status ?? ''] ?? 'neutral'}>{STATUS_LABEL[r.status ?? ''] ?? r.status ?? '—'}</Badge>,
    },
    {
      id: 'settlement',
      header: 'Liquidación',
      cell: (r) => <span className="font-mono text-xs text-muted">{r.settlement_code ?? '—'}</span>,
    },
  ];

  const exportColumns: ExportColumn<CommissionRow>[] = [
    { header: 'Fecha', value: (r) => r.earned_on },
    { header: 'Comercial', value: (r) => r.agent_name },
    { header: 'Producto', value: (r) => r.product_short_name },
    { header: 'Tenant', value: (r) => r.tenant_name },
    { header: 'Origen', value: (r) => r.source_label },
    { header: 'Factura', value: (r) => r.invoice_number },
    { header: 'Regla', value: (r) => r.rule_name },
    { header: 'Moneda', value: (r) => r.currency },
    { header: 'Base', value: (r) => r.base_amount, kind: 'amount' },
    { header: 'Tasa', value: (r) => r.applied_rate, kind: 'number' },
    { header: 'Participación', value: (r) => r.attribution_pct, kind: 'number' },
    { header: 'Monto', value: (r) => r.amount, kind: 'amount' },
    { header: 'Estado', value: (r) => STATUS_LABEL[r.status ?? ''] ?? r.status },
    { header: 'Reverso', value: (r) => (r.is_reversal ? 'Sí' : 'No') },
    { header: 'Liquidación', value: (r) => r.settlement_code },
  ];

  const waiting = toCurrencyAmounts(summary.data?.by_status?.PENDING);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          id="commission-pending"
          label="Comisión pendiente"
          temporality="Según filtros"
          state={summaryState}
          onRetry={retry}
          hint="Elegible + devengada: lo que ya se debe y falta liquidar."
          render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.pending)} emptyLabel="Nada pendiente" />}
        />
        <KpiCard
          id="commission-paid"
          label="Comisión pagada"
          temporality="Según filtros"
          state={summaryState}
          onRetry={retry}
          hint="Cada liquidación es de una sola moneda."
          render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.paid)} emptyLabel="Nada pagado" />}
        />
        <KpiCard
          id="commission-waiting"
          label="En espera"
          temporality="Según filtros"
          state={summaryState}
          onRetry={retry}
          hint="Estado PENDING: aún no es elegible; no suma al pendiente."
          render={() => <CurrencyLines amounts={waiting} emptyLabel="Nada en espera" />}
        />
      </div>

      <ConsistencyNote
        summaryCount={summary.data && !summary.isFetching ? summary.data.row_count : undefined}
        tableTotal={page.data && !page.isFetching ? page.data.total : undefined}
        noun="comisiones"
      />

      <Card>
        <SearchBar
          value={draft}
          onChange={setDraft}
          placeholder="Buscar por comercial, producto, tenant o factura…"
          right={
            <ExportMenu
              filenameBase="comisiones"
              columns={exportColumns}
              pageRows={page.data?.rows ?? []}
              total={page.data?.total ?? 0}
              rowKey={(r) => r.commission_event_id ?? ''}
              fetchPage={(p, size) => fetchCommissionPage({ ...tableParams, page: p, pageSize: size })}
            />
          }
        />
        <div className="border-b border-border px-4 py-2">
          <StatusTabs
            value={list.filter}
            onChange={list.setFilter}
            options={[
              { id: 'ALL' as const, label: 'Todas' },
              { id: 'PENDING' as const, label: 'Pendientes' },
              { id: 'PAID' as const, label: 'Pagadas' },
              { id: 'WAITING' as const, label: 'En espera' },
              { id: 'VOID' as const, label: 'Anuladas' },
            ].map((o) => ({
              ...o,
              count: o.id === list.filter && summary.data ? Number(summary.data.row_count) : undefined,
            }))}
          />
        </div>
        <PagedTable
          label="Eventos de comisión"
          columns={columns}
          rows={page.data?.rows ?? []}
          rowKey={(r) => r.commission_event_id ?? ''}
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
          emptyTitle="Sin eventos de comisión"
          emptyDescription="No hay comisiones visibles para tu rol con estos filtros."
        />
      </Card>
    </div>
  );
}

function SettlementsSection({ query }: { query: ReturnType<typeof useSettlements> }) {
  return (
    <Card
      title="Liquidaciones"
      description="Una liquidación agrupa eventos de un período y de una sola moneda. Marcarla pagada exige fecha y referencia de pago."
    >
      <div className="px-4 pt-3">
        <InfoNote>Consulta de liquidaciones existentes. Esta pantalla no crea, paga ni revierte liquidaciones.</InfoNote>
      </div>
      {query.isLoading ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState title="Sin liquidaciones" description="Todavía no se ha liquidado ninguna comisión visible para tu rol." />
      ) : (
        <DataTable columns={['Código', 'Comercial', 'Período', 'Total', 'Estado', 'Referencia de pago']}>
          {(query.data ?? []).map((s) => (
            <tr key={s.id}>
              <td className="ebim-td font-mono text-xs font-semibold">{s.code}</td>
              <td className="ebim-td">{(s.sales_agents as { full_name: string } | null)?.full_name ?? '—'}</td>
              <td className="ebim-td whitespace-nowrap text-xs text-muted">
                {formatDate(s.period_start)} → {formatDate(s.period_end)}
              </td>
              <td className="ebim-td text-right font-semibold tabular-nums">{formatMoney(Number(s.total_amount), s.currency)}</td>
              <td className="ebim-td">
                <Badge tone={s.status === 'PAID' ? 'ok' : s.status === 'CANCELLED' ? 'danger' : 'warn'}>
                  {SETTLEMENT_LABEL[s.status] ?? s.status}
                </Badge>
              </td>
              <td className="ebim-td font-mono text-xs text-muted">{s.payment_reference ?? '—'}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  );
}

