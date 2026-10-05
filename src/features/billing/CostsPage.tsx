import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import { useProductMargin, usePartnerMargin, useTenantMargin, useFinanceMonthlySeries } from '@/services/queries';
import {
  fetchCostPage,
  useCostPage,
  useCostSummary,
  type CostFilter,
  type CostRow,
  type CostSort,
} from '@/services/financeRead';
import { useListState } from '@/hooks/useListState';
import { SectionTabs, StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, Badge, EmptyState, ErrorState, LoadingState, KpiTile, type DataColumn,
} from '@/components/ui/primitives';
import { PagedTable, type TableColumn } from '@/components/ui/PagedTable';
import { ExportMenu } from '@/components/ui/ExportMenu';
import type { ExportColumn } from '@/lib/export';
import { formatCompactAmount, formatDate, formatMoney, formatPercent, sumByCurrency } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import { StateMessage } from '@/features/executive/components/StateView';
import { ChartLegend, ChartPanel } from '@/features/executive/components/ChartPanel';
import { fromQuery } from '@/features/executive/dataState';
import { currentMonth, lastMonths, toCurrencyAmounts } from '@/features/executive/reportContext';
import { monthLongLabel } from '@/features/dashboard/executiveModel';
import { monthShortLabel } from '@/features/dashboard/executiveData';
import { ConsistencyNote, InfoNote } from './listing';
import { useDebouncedSearch } from './listingState';
import { FilterTotals, KpiStrip } from './financeUi';
import { analyzedMonth, closedWindow, longMonthName, nativeInline, relChange, shortMonthName } from './financeModel';
import { PeriodBars } from './lazyFinanceCharts';

/**
 * Costos y margen gerencial (P03).
 *
 * Fórmula única (docs/finance/COST_MARGIN_MODEL.md):
 *   margen gerencial = ingreso COBRADO − costo asignado − comisión
 * No es utilidad neta, EBITDA ni resultado contable.
 *
 * El resumen de costos lo agrega la base (`cost_summary`) con los MISMOS
 * filtros que la tabla (`v_cost_entry_list`). El costo de PLATAFORMA no se
 * reparte: suma en el costo registrado pero no en el margen por producto.
 */

const COST_FILTERS = [
  'ALL', 'PLATFORM', 'PRODUCT', 'ORGANIZATION', 'TENANT', 'DEPLOYMENT_TARGET', 'UNALLOCATED',
] as const satisfies readonly CostFilter[];
const COST_SORTS = ['period_start', 'amount', 'description', 'category_text'] as const satisfies readonly CostSort[];
const COST_LIST = {
  filter: 'ALL' as CostFilter,
  filters: COST_FILTERS,
  sortBy: 'period_start' as CostSort,
  sorts: COST_SORTS,
  sortDir: 'desc' as const,
};

const SCOPE_LABEL: Record<string, string> = {
  ALL: 'Todos',
  PLATFORM: 'Plataforma',
  PRODUCT: 'Producto',
  ORGANIZATION: 'Organización',
  TENANT: 'Tenant',
  DEPLOYMENT_TARGET: 'Target',
  UNALLOCATED: 'Sin asignar',
};

const CATEGORY_LABEL: Record<string, string> = {
  DATABASE: 'Base de datos',
  COMPUTE: 'Cómputo',
  STORAGE: 'Almacenamiento',
  BANDWIDTH: 'Transferencia',
  MESSAGING: 'Mensajería',
  FRONTEND_HOSTING: 'Hosting frontend',
  DOMAIN: 'Dominios',
  SUPPORT: 'Soporte',
  DEDICATED_INFRA: 'Infraestructura dedicada',
  THIRD_PARTY: 'Servicios de terceros',
  ADMIN_MANUAL: 'Administrativo (manual)',
};

function categoryLabel(value: string | null): string {
  if (!value) return 'Sin categoría';
  return CATEGORY_LABEL[value] ?? value;
}

function num(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

interface AllocationView {
  scope: string;
  weight: number;
  product: string | null;
  tenant: string | null;
  target: string | null;
}

/** `allocations` de v_cost_entry_list (jsonb) en forma segura para pintar. */
function allocationsOf(raw: unknown): AllocationView[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a: Record<string, unknown>) => ({
    scope: String(a.scope ?? ''),
    weight: Number(a.weight ?? 0),
    product: (a.product as string | null) ?? null,
    tenant: (a.tenant as string | null) ?? null,
    target: (a.target as string | null) ?? null,
  }));
}

export function CostsPage() {
  return (
    <PageContainer
      title="Costos y margen"
      description="Margen gerencial = cobrado − costo asignado − comisión. Es una lectura de gestión, no utilidad neta, EBITDA ni resultado contable."
    >
      <MarginOverview />
      <div className="mb-4">
        <InfoNote>
          El <strong>costo de plataforma no se reparte</strong> entre productos, partners ni tenants: cuenta en el costo
          registrado y en el margen total, pero no en los márgenes por producto, partner o tenant. Las tablas van en la
          moneda de cada registro; no se convierte con un tipo de cambio implícito.
        </InfoNote>
      </div>
      <SectionTabs
        tabs={[
          { id: 'entries', label: 'Costos registrados', content: <CostEntriesSection /> },
          { id: 'by-product', label: 'Margen por producto', content: <ProductMarginSection /> },
          { id: 'by-partner', label: 'Margen por partner', content: <PartnerMarginSection /> },
          { id: 'by-tenant', label: 'Margen por tenant', content: <TenantMarginSection /> },
        ]}
      />
    </PageContainer>
  );
}

/* ==========================================================================
   Franja de KPIs y componentes del margen por mes (S09, moneda de reporte)
   ========================================================================== */

const COMPONENT_SERIES = [
  { key: 'collected', label: 'Cobrado', color: 'var(--chart-collected)' },
  { key: 'cost', label: 'Costo asignado', color: 'var(--chart-cost)' },
  { key: 'commission', label: 'Comisión', color: 'var(--chart-commission)' },
];

function MarginOverview() {
  const month = analyzedMonth();
  const query = useFinanceMonthlySeries({ from: `${lastMonths(currentMonth(), 14)[0]}-01` });
  const rows = query.data ?? [];
  const { current, previous, trend } = closedWindow(rows, month);
  const rc = rows[0]?.reportingCurrency ?? '';
  const name = shortMonthName(month);
  const vs = previous ? `vs ${longMonthName(previous.month.slice(0, 7))}` : undefined;
  const common = { loading: query.isLoading, error: query.error, onRetry: () => void query.refetch() };
  const missing = current && !current.complete ? `Falta tasa ${current.missingCurrencies.join(', ')}: no se consolida` : null;
  const share = (v: number | null | undefined) =>
    v != null && current?.collected ? `${formatPercent(v / current.collected)} de lo cobrado` : null;
  const marginRate = current?.margin != null && current.collected ? current.margin / current.collected : null;

  const chartRows = trend;
  const state = fromQuery(query, {
    isEmpty: (r) => r.every((p) => !p.collected && !p.cost && !p.commission),
  });
  const best = [...chartRows].filter((p) => p.margin != null).sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0))[0];

  return (
    <>
      <KpiStrip label="Indicadores de costo y margen">
        <KpiTile
          label={`Cobrado · ${name}`}
          info="Cobros confirmados del mes (v_collected_revenue), la primera línea del margen gerencial (K05)."
          currency={current?.collected != null ? rc : undefined}
          value={current?.collected == null ? null : formatCompactAmount(current.collected)}
          delta={{ value: relChange(current?.collected, previous?.collected), comparison: vs }}
          trend={trend.map((p) => p.collected)}
          trendDescription="Cobrado de los últimos meses cerrados"
          footer={missing ?? monthLongLabel(month)}
          {...common}
        />
        <KpiTile
          label={`Costo asignado · ${name}`}
          info="Costos imputados con regla explícita (peso), por fin de período, incluido el costo de plataforma."
          currency={current?.cost != null ? rc : undefined}
          value={current?.cost == null ? null : formatCompactAmount(current.cost)}
          delta={{ value: relChange(current?.cost, previous?.cost), comparison: vs, goodWhen: 'down' }}
          trend={trend.map((p) => p.cost)}
          trendDescription="Costo asignado de los últimos meses cerrados"
          footer={missing ?? share(current?.cost) ?? 'Sin cobros con qué comparar'}
          {...common}
        />
        <KpiTile
          label={`Comisión · ${name}`}
          info="Comisión devengada en el mes sobre cobros confirmados (sin anuladas)."
          currency={current?.commission != null ? rc : undefined}
          value={current?.commission == null ? null : formatCompactAmount(current.commission)}
          delta={{ value: relChange(current?.commission, previous?.commission), comparison: vs, goodWhen: 'none' }}
          trend={trend.map((p) => p.commission)}
          trendDescription="Comisión devengada de los últimos meses cerrados"
          footer={missing ?? share(current?.commission) ?? 'Sin cobros con qué comparar'}
          to="/commissions"
          {...common}
        />
        <KpiTile
          label={`Margen gerencial · ${name}`}
          info="Cobrado − costo asignado − comisión del mes. Gestión, no utilidad contable."
          currency={current?.margin != null ? rc : undefined}
          value={current?.margin == null ? null : formatCompactAmount(current.margin)}
          delta={{ value: relChange(current?.margin, previous?.margin), comparison: vs }}
          trend={trend.map((p) => p.margin)}
          trendDescription="Margen gerencial de los últimos meses cerrados"
          footer={missing ?? (marginRate != null ? `${formatPercent(marginRate)} sobre lo cobrado` : 'Sin cobros en el mes')}
          {...common}
        />
      </KpiStrip>
      <div className="mb-6">
        <ChartPanel
          id="componentes-margen"
          title="¿Cuánto se queda EBIM de lo que cobra?"
          unit={`Cobrado, costo asignado y comisión por mes en ${rc || 'moneda de reporte'}`}
          period={`${chartRows[0] ? monthShortLabel(chartRows[0].month.slice(0, 7)) : ''} – ${monthShortLabel(month)} · meses cerrados`}
          source="finance_monthly_series"
          coverage="Mismos hechos que el consolidado (K05); tasa del cierre de cada mes"
          state={state}
          onRetry={() => void query.refetch()}
          emptyText="Sin cobros, costos ni comisiones en el período"
          refreshing={query.isPlaceholderData}
          legend={<ChartLegend items={COMPONENT_SERIES.map((c) => ({ label: c.label, color: c.color }))} />}
          chart={() => (
            <PeriodBars
              data={chartRows.map((p) => ({
                key: p.month,
                label: monthShortLabel(p.month.slice(0, 7)),
                title: monthLongLabel(p.month.slice(0, 7)),
                values: { collected: p.collected, cost: p.cost, commission: p.commission },
              }))}
              series={COMPONENT_SERIES}
              unit={{ currency: rc }}
              height={240}
              ariaLabel={`Cobrado, costo asignado y comisión por mes en ${rc}${best ? `; el mejor margen fue ${monthLongLabel(best.month.slice(0, 7))} con ${formatMoney(best.margin, rc)}` : ''}. Use la vista Tabla para leer cada mes.`}
            />
          )}
          table={() => (
            <table className="w-full text-compact">
              <caption className="sr-only">Componentes del margen gerencial por mes</caption>
              <thead>
                <tr>
                  <th scope="col" className="ebim-th">Mes</th>
                  <th scope="col" className="ebim-th text-right">Cobrado ({rc})</th>
                  <th scope="col" className="ebim-th text-right">Costo asignado</th>
                  <th scope="col" className="ebim-th text-right">Comisión</th>
                  <th scope="col" className="ebim-th text-right">Margen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...chartRows].reverse().map((p) => (
                  <tr key={p.month}>
                    <th scope="row" className="ebim-td text-left font-medium">{monthLongLabel(p.month.slice(0, 7))}</th>
                    <td className="ebim-td ebim-num">{p.collected == null ? 'Sin tasa' : formatMoney(p.collected, rc)}</td>
                    <td className="ebim-td ebim-num">{p.cost == null ? 'Sin tasa' : formatMoney(p.cost, rc)}</td>
                    <td className="ebim-td ebim-num">{p.commission == null ? 'Sin tasa' : formatMoney(p.commission, rc)}</td>
                    <td className={`ebim-td ebim-num font-semibold ${(p.margin ?? 0) < 0 ? 'text-danger' : ''}`}>
                      {p.margin == null ? '—' : formatMoney(p.margin, rc)}
                    </td>
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

/* ==========================================================================
   Costos registrados
   ========================================================================== */

function CostEntriesSection() {
  const list = useListState(COST_LIST);
  const [draft, setDraft] = useDebouncedSearch(list.search, list.setSearch);
  const tableParams = {
    search: list.search,
    filter: list.filter,
    page: list.page,
    pageSize: list.pageSize,
    sortBy: list.sortBy,
    sortDir: list.sortDir,
  };
  const page = useCostPage(tableParams);
  const summary = useCostSummary({ search: list.search, filter: list.filter });
  const summaryState = fromQuery(summary);
  const retry = () => void summary.refetch();

  const columns: TableColumn<CostRow>[] = [
    {
      id: 'description',
      header: 'Concepto',
      sortKey: 'description',
      cell: (r) => (
        <span className="block min-w-[160px] max-w-[220px]">
          <span className="block truncate font-medium" title={r.description ?? undefined}>
            {r.description ?? '—'}
          </span>
          <span className="block truncate text-compact text-fg-2">{r.vendor ?? 'Sin proveedor'}</span>
        </span>
      ),
    },
    {
      id: 'category',
      header: 'Categoría',
      sortKey: 'category_text',
      // Texto que puede partirse (no insignia): «Infraestructura dedicada» ensanchaba la tabla.
      cell: (r) => <span className="block max-w-[120px] text-compact text-fg-2">{categoryLabel(r.category)}</span>,
    },
    {
      id: 'period',
      header: 'Período',
      sortKey: 'period_start',
      cell: (r) => (
        <span className="block whitespace-nowrap text-compact text-fg-2">
          {formatDate(r.period_start)}
          <span className="block">→ {formatDate(r.period_end)}</span>
          {r.is_recurring ? <span className="block text-caption text-muted">Recurrente</span> : null}
        </span>
      ),
    },
    {
      id: 'amount',
      header: 'Monto',
      sortKey: 'amount',
      align: 'right',
      cell: (r) => <span className="whitespace-nowrap font-semibold">{formatMoney(num(r.amount), r.currency)}</span>,
    },
    // Asignado / plataforma / sin asignar en una sola celda (sólo los no nulos):
    // como tres columnas la tabla no cabía a 1280.
    {
      id: 'split',
      header: 'Reparto',
      align: 'right',
      cell: (r) => {
        const parts = [
          { label: 'Asignado', value: num(r.allocated_amount), tone: 'text-fg' },
          { label: 'Plataforma', value: num(r.platform_amount), tone: 'text-fg-2' },
          { label: 'Sin asignar', value: num(r.unallocated_amount), tone: 'font-semibold text-warn' },
        ].filter((p) => p.value);
        if (!parts.length) return <span className="text-muted">—</span>;
        return (
          <span className="block space-y-0.5 text-compact">
            {parts.map((p) => (
              <span key={p.label} className={`block whitespace-nowrap ${p.tone}`}>
                <span className="text-caption text-muted">{p.label} </span>
                {formatMoney(p.value, r.currency)}
              </span>
            ))}
          </span>
        );
      },
    },
    {
      id: 'scopes',
      header: 'Imputación',
      cell: (r) =>
        !r.allocation_count ? (
          <Badge tone="warn">Sin asignar</Badge>
        ) : (
          // Regla EXPLÍCITA de cada asignación: destino y peso (nunca un prorrateo implícito).
          <ul className="space-y-0.5 text-compact">
            {allocationsOf(r.allocations).map((a, i) => (
              <li key={i} className="flex items-center gap-1.5 whitespace-nowrap">
                <Badge tone={a.scope === 'PLATFORM' ? 'neutral' : 'accent'}>{SCOPE_LABEL[a.scope] ?? a.scope}</Badge>
                {(() => {
                  const text = `${[a.product, a.tenant, a.target].filter(Boolean).join(' · ') || (a.scope === 'PLATFORM' ? 'no se reparte' : 'destino no visible')}${a.weight < 1 ? ` (${formatPercent(a.weight, 0)})` : ''}`;
                  return (
                    <span className="block max-w-[140px] truncate text-fg-2" title={text}>
                      {text}
                    </span>
                  );
                })()}
              </li>
            ))}
          </ul>
        ),
    },
  ];

  const exportColumns: ExportColumn<CostRow>[] = [
    { header: 'Concepto', value: (r) => r.description },
    { header: 'Proveedor', value: (r) => r.vendor },
    { header: 'Categoría', value: (r) => categoryLabel(r.category) },
    { header: 'Inicio', value: (r) => r.period_start },
    { header: 'Fin', value: (r) => r.period_end },
    { header: 'Moneda', value: (r) => r.currency },
    { header: 'Monto', value: (r) => r.amount, kind: 'amount' },
    { header: 'Asignado', value: (r) => r.allocated_amount, kind: 'amount' },
    { header: 'Plataforma', value: (r) => r.platform_amount, kind: 'amount' },
    { header: 'Sin asignar', value: (r) => r.unallocated_amount, kind: 'amount' },
    {
      header: 'Imputación',
      value: (r) =>
        allocationsOf(r.allocations)
          .map((a) => `${SCOPE_LABEL[a.scope] ?? a.scope}${[a.product, a.tenant, a.target].filter(Boolean).length ? ` ${[a.product, a.tenant, a.target].filter(Boolean).join('/')}` : ''} ${Math.round(a.weight * 100)}%`)
          .join(' | '),
    },
  ];

  const categories = [...(summary.data?.by_category ?? [])]
    .map((c) => ({ ...c, amount: Number(c.amount) }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.amount - a.amount);

  return (
    <div className="space-y-4">
      <Card title="Costo por categoría" description="Mismo filtro que la tabla. Una fila por categoría y moneda.">
        {summaryState.status === 'ready' ? (
          categories.length === 0 ? (
            <EmptyState title="Sin costos en este alcance" />
          ) : (
            <DataTable label="Costo por categoría" columns={['Categoría', 'Moneda', { label: 'Monto', align: 'right' }]}>
              {categories.map((c) => (
                <tr key={`${c.category}-${c.currency}`}>
                  <td className="ebim-td">{categoryLabel(c.category)}</td>
                  <td className="ebim-td text-muted">{c.currency}</td>
                  <td className="ebim-td ebim-num whitespace-nowrap font-semibold">{formatMoney(c.amount, c.currency)}</td>
                </tr>
              ))}
            </DataTable>
          )
        ) : (
          <div className="px-5">
            <StateMessage state={summaryState} onRetry={retry} />
          </div>
        )}
      </Card>

      <Card description="Un costo compartido se reparte con una regla explícita (peso), nunca con un prorrateo implícito.">
        <SearchBar
          value={draft}
          onChange={setDraft}
          placeholder="Buscar costo por concepto, proveedor o categoría…"
          right={
            <ExportMenu
              filenameBase="costos"
              columns={exportColumns}
              pageRows={page.data?.rows ?? []}
              total={page.data?.total ?? 0}
              rowKey={(r) => r.id ?? ''}
              fetchPage={(p, size) => fetchCostPage({ ...tableParams, page: p, pageSize: size })}
            />
          }
        />
        <div className="border-b border-border px-5 py-2.5">
          <StatusTabs
            value={list.filter}
            onChange={list.setFilter}
            options={COST_FILTERS.map((id) => ({
              id,
              label: SCOPE_LABEL[id] ?? id,
              count: id === list.filter && summary.data ? Number(summary.data.row_count) : undefined,
            }))}
          />
        </div>
        <FilterTotals
          state={summaryState}
          onRetry={retry}
          items={[
            { label: 'Costo registrado', amounts: toCurrencyAmounts(summary.data?.registered), hint: 'Todo lo registrado en el alcance elegido.' },
            {
              label: 'Asignado',
              amounts: toCurrencyAmounts(summary.data?.allocated),
              hint: 'Imputado a producto, organización, tenant o target: entra en el margen.',
            },
            {
              label: 'Costo de plataforma',
              amounts: toCurrencyAmounts(summary.data?.platform),
              hint: 'No se reparte: no está en el margen por producto, partner ni tenant.',
            },
            {
              label: 'Sin asignar',
              amounts: toCurrencyAmounts(summary.data?.unallocated),
              emptyLabel: 'Todo asignado',
              hint: 'Costo sin regla de imputación: revisar y asignar.',
            },
          ]}
          note={
            <ConsistencyNote
              summaryCount={summary.data && !summary.isFetching ? summary.data.row_count : undefined}
              tableTotal={page.data && !page.isFetching ? page.data.total : undefined}
              noun="costos"
            />
          }
        />
        <PagedTable
          label="Costos registrados"
          columns={columns}
          rows={page.data?.rows ?? []}
          rowKey={(r) => r.id ?? ''}
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
          emptyTitle="Sin costos registrados"
          emptyDescription="No hay costos visibles para tu rol con estos filtros."
        />
      </Card>
    </div>
  );
}

/* ==========================================================================
   Márgenes (vistas completas, una fila por entidad y moneda)
   ========================================================================== */

/** Solo una pérdida se marca (§5.7): un margen positivo no se pinta de verde (A09). */
function marginClass(value: number | string | null | undefined): string {
  return Number(value ?? 0) < 0 ? 'text-danger' : 'text-fg';
}

const R = (label: string): DataColumn => ({ label, align: 'right' });

function MarginBlock<Row>({
  query,
  emptyTitle,
  children,
}: {
  query: UseQueryResult<Row[]>;
  emptyTitle: string;
  children: (rows: Row[]) => ReactNode;
}) {
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const rows = query.data ?? [];
  if (rows.length === 0) return <EmptyState title={emptyTitle} description="Sin cobros, costos asignados ni comisiones en este corte." />;
  return <>{children(rows)}</>;
}

function MarginTotals<Row>({
  rows,
  margin,
  currency,
}: {
  rows: readonly Row[];
  margin: (row: Row) => number | string | null | undefined;
  currency: (row: Row) => string | null | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-card border-t border-border bg-sunken px-5 py-3">
      <span className="text-caption text-muted">Una fila por entidad y moneda. Totales por moneda, sin costo de plataforma.</span>
      <span className="text-compact font-semibold tabular-nums text-fg">
        Margen: {nativeInline(sumByCurrency(rows, margin, currency)) || 'sin importes'}
      </span>
    </div>
  );
}

function ProductMarginSection() {
  const query = useProductMargin();
  return (
    <Card title="Margen gerencial por producto" description="Cobrado recurrente y único separados; ARR es proyección (MRR × 12), no cobro.">
      <MarginBlock query={query} emptyTitle="Sin productos con margen calculable">
        {(rows) => (
          <>
            <DataTable label="Margen gerencial por producto"
              columns={['Producto', R('MRR · ARR estimado'), R('Cobrado recurrente'), R('Cobrado único'), R('Costo asignado'), R('Comisión'), R('Margen gerencial')]}>
              {rows.map((r) => (
                <tr key={`${r.saas_product_id}-${r.currency}`}>
                  {/* Moneda bajo el nombre (cada importe ya la lleva) y ARR bajo el MRR:
                      como columnas propias la matriz no cabía a 1280. */}
                  <td className="ebim-td">
                    <span className="block font-semibold">{r.short_name}</span>
                    <span className="block text-caption text-muted">{r.currency ?? '—'}</span>
                  </td>
                  <td className="ebim-td ebim-num whitespace-nowrap">
                    {formatMoney(num(r.mrr), r.currency)}
                    <span className="block text-caption text-muted">ARR {formatMoney(num(r.arr), r.currency)}</span>
                  </td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{formatMoney(num(r.collected_recurring), r.currency)}</td>
                  <td className="ebim-td ebim-num whitespace-nowrap text-muted">{formatMoney(num(r.collected_one_time), r.currency)}</td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{formatMoney(num(r.direct_cost), r.currency)}</td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{formatMoney(num(r.commission_total), r.currency)}</td>
                  <td className={`ebim-td ebim-num whitespace-nowrap font-semibold ${marginClass(r.gross_margin)}`}>
                    {formatMoney(num(r.gross_margin), r.currency)}
                  </td>
                </tr>
              ))}
            </DataTable>
            <MarginTotals rows={rows} margin={(r) => r.gross_margin} currency={(r) => r.currency} />
          </>
        )}
      </MarginBlock>
    </Card>
  );
}

function PartnerMarginSection() {
  const query = usePartnerMargin();
  return (
    <Card title="Margen gerencial por partner" description="Cobrado de los tenants que gestiona cada partner, menos su costo asignado y comisiones.">
      <MarginBlock query={query} emptyTitle="Sin partners con margen calculable">
        {(rows) => (
          <>
            <DataTable label="Margen gerencial por partner"
              columns={['Partner', R('Tenants'), R('MRR'), R('Cobrado'), R('Costo asignado'), R('Comisión'), R('Margen gerencial')]}>
              {rows.map((r) => (
                <tr key={`${r.organization_id}-${r.currency}`}>
                  <td className="ebim-td font-semibold">
                    {r.organization_id ? (
                      <Link className="ebim-link" to={`/organizations/${r.organization_id}`}>
                        {r.display_name}
                      </Link>
                    ) : (
                      r.display_name
                    )}
                    <span className="block text-caption font-normal text-muted">{r.currency ?? '—'}</span>
                  </td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{Number(r.managed_tenants ?? 0)}</td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{formatMoney(num(r.mrr), r.currency)}</td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{formatMoney(num(r.collected_revenue), r.currency)}</td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{formatMoney(num(r.direct_cost), r.currency)}</td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{formatMoney(num(r.commission_total), r.currency)}</td>
                  <td className={`ebim-td ebim-num whitespace-nowrap font-semibold ${marginClass(r.gross_margin)}`}>
                    {formatMoney(num(r.gross_margin), r.currency)}
                  </td>
                </tr>
              ))}
            </DataTable>
            <MarginTotals rows={rows} margin={(r) => r.gross_margin} currency={(r) => r.currency} />
          </>
        )}
      </MarginBlock>
    </Card>
  );
}

function TenantMarginSection() {
  const query = useTenantMargin();
  return (
    <Card title="Margen gerencial por tenant" description="Incluye costo directo y la parte del target compartido que le corresponde por regla explícita.">
      <MarginBlock query={query} emptyTitle="Sin tenants con margen calculable">
        {(rows) => (
          <>
            <DataTable label="Margen gerencial por tenant"
              columns={['Tenant', 'Producto · modelo', R('MRR'), R('Cobrado'), R('Costo asignado'), R('Comisión'), R('Margen gerencial')]}>
              {rows.map((r) => (
                <tr key={`${r.tenant_id}-${r.currency}`}>
                  <td className="ebim-td font-semibold">
                    {r.tenant_id ? (
                      <Link className="ebim-link" to={`/tenants/${r.tenant_id}`}>
                        {r.name}
                      </Link>
                    ) : (
                      r.name
                    )}
                    <span className="block text-caption font-normal text-muted">{r.currency ?? '—'}</span>
                  </td>
                  <td className="ebim-td">
                    <span className="block">{r.product_code}</span>
                    <span className="block text-caption text-fg-2">
                      {DEPLOYMENT_MODE_LABEL[r.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL] ?? r.deployment_mode ?? '—'}
                    </span>
                  </td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{formatMoney(num(r.mrr), r.currency)}</td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{formatMoney(num(r.collected_revenue), r.currency)}</td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{formatMoney(num(r.direct_cost), r.currency)}</td>
                  <td className="ebim-td ebim-num whitespace-nowrap">{formatMoney(num(r.commission_total), r.currency)}</td>
                  <td className={`ebim-td ebim-num whitespace-nowrap font-semibold ${marginClass(r.gross_margin)}`}>
                    {formatMoney(num(r.gross_margin), r.currency)}
                  </td>
                </tr>
              ))}
            </DataTable>
            <MarginTotals rows={rows} margin={(r) => r.gross_margin} currency={(r) => r.currency} />
          </>
        )}
      </MarginBlock>
    </Card>
  );
}
