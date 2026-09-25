import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import { useProductMargin, usePartnerMargin, useTenantMargin } from '@/services/queries';
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
import { PageContainer, Card, DataTable, SearchBar, Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { PagedTable, type TableColumn } from '@/components/ui/PagedTable';
import { ExportMenu } from '@/components/ui/ExportMenu';
import type { ExportColumn } from '@/lib/export';
import { formatDate, formatMoney, sumByCurrency } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import { KpiCard, CurrencyLines, StateMessage } from '@/features/executive/components/StateView';
import { fromQuery } from '@/features/executive/dataState';
import { toCurrencyAmounts } from '@/features/executive/reportContext';
import { ConsistencyNote, InfoNote } from './listing';
import { useDebouncedSearch } from './listingState';

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

export function CostsPage() {
  return (
    <PageContainer
      title="Costos y margen"
      description="Costo por alcance y categoría, y margen gerencial por producto, partner y tenant. Importes por moneda nativa: no se convierte con un tipo de cambio implícito."
    >
      <div className="mb-4">
        <InfoNote>
          <strong>Margen gerencial = cobrado − costo asignado − comisión.</strong> Es una lectura de gestión: no es
          utilidad neta, EBITDA ni resultado contable. El <strong>costo de plataforma no se reparte</strong> entre
          productos, partners ni tenants: cuenta en el costo registrado, pero no en los márgenes por producto, partner o
          tenant.
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
        <span>
          <span className="font-medium">{r.description ?? '—'}</span>
          <span className="block text-xs text-muted">{r.vendor ?? 'Sin proveedor'}</span>
        </span>
      ),
    },
    {
      id: 'category',
      header: 'Categoría',
      sortKey: 'category_text',
      cell: (r) => <Badge tone="info">{categoryLabel(r.category)}</Badge>,
    },
    {
      id: 'period',
      header: 'Período',
      sortKey: 'period_start',
      cell: (r) => (
        <span className="whitespace-nowrap text-xs text-muted">
          {formatDate(r.period_start)} → {formatDate(r.period_end)}
          {r.is_recurring ? <span className="block">Recurrente</span> : null}
        </span>
      ),
    },
    {
      id: 'amount',
      header: 'Monto',
      sortKey: 'amount',
      align: 'right',
      cell: (r) => <span className="font-semibold">{formatMoney(num(r.amount), r.currency)}</span>,
    },
    { id: 'allocated', header: 'Asignado', align: 'right', cell: (r) => formatMoney(num(r.allocated_amount), r.currency) },
    { id: 'platform', header: 'Plataforma', align: 'right', cell: (r) => formatMoney(num(r.platform_amount), r.currency) },
    {
      id: 'unallocated',
      header: 'Sin asignar',
      align: 'right',
      cell: (r) => {
        const value = num(r.unallocated_amount);
        return <span className={value ? 'font-semibold text-warn' : 'text-muted'}>{formatMoney(value, r.currency)}</span>;
      },
    },
    {
      id: 'scopes',
      header: 'Alcance',
      cell: (r) =>
        !r.allocation_count ? (
          <Badge tone="warn">Sin asignar</Badge>
        ) : (
          <span className="flex flex-wrap gap-1">
            {(r.scopes ?? []).map((s) => (
              <Badge key={s} tone={s === 'PLATFORM' ? 'neutral' : 'accent'}>
                {SCOPE_LABEL[s] ?? s}
              </Badge>
            ))}
          </span>
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
    { header: 'Alcances', value: (r) => (r.scopes ?? []).map((s) => SCOPE_LABEL[s] ?? s).join(' | ') },
  ];

  const categories = [...(summary.data?.by_category ?? [])]
    .map((c) => ({ ...c, amount: Number(c.amount) }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.amount - a.amount);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          id="cost-registered"
          label="Costo registrado"
          temporality="Según filtros"
          state={summaryState}
          onRetry={retry}
          hint="Todo lo registrado en el alcance elegido."
          render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.registered)} />}
        />
        <KpiCard
          id="cost-allocated"
          label="Asignado"
          temporality="Según filtros"
          state={summaryState}
          onRetry={retry}
          hint="Imputado a producto, organización, tenant o target: entra en el margen."
          render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.allocated)} />}
        />
        <KpiCard
          id="cost-platform"
          label="Costo de plataforma"
          temporality="Según filtros"
          state={summaryState}
          onRetry={retry}
          hint="No se reparte: no está en el margen por producto, partner ni tenant."
          render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.platform)} />}
        />
        <KpiCard
          id="cost-unallocated"
          label="Sin asignar"
          temporality="Según filtros"
          state={summaryState}
          onRetry={retry}
          hint="Costo sin regla de imputación: revisar y asignar."
          render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.unallocated)} emptyLabel="Todo asignado" />}
        />
      </div>

      <ConsistencyNote
        summaryCount={summary.data && !summary.isFetching ? summary.data.row_count : undefined}
        tableTotal={page.data && !page.isFetching ? page.data.total : undefined}
        noun="costos"
      />

      <Card title="Costo por categoría" description="Mismo filtro que la tabla. Una fila por categoría y moneda.">
        {summaryState.status === 'ready' ? (
          categories.length === 0 ? (
            <EmptyState title="Sin costos en este alcance" />
          ) : (
            <DataTable columns={['Categoría', 'Moneda', 'Monto']}>
              {categories.map((c) => (
                <tr key={`${c.category}-${c.currency}`}>
                  <td className="ebim-td">{categoryLabel(c.category)}</td>
                  <td className="ebim-td text-muted">{c.currency}</td>
                  <td className="ebim-td text-right font-semibold tabular-nums">{formatMoney(c.amount, c.currency)}</td>
                </tr>
              ))}
            </DataTable>
          )
        ) : (
          <div className="px-4">
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
        <div className="border-b border-border px-4 py-2">
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

function marginClass(value: number | string | null | undefined): string {
  return Number(value ?? 0) >= 0 ? 'text-ok' : 'text-danger';
}

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
    <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border px-4 py-3 text-sm">
      <span className="text-xs text-muted">
        Una fila por entidad y moneda. Totales por moneda, sin costo de plataforma.
      </span>
      <span className="font-semibold">
        <CurrencyLines amounts={sumByCurrency(rows, margin, currency)} />
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
            <DataTable columns={['Producto', 'Moneda', 'MRR', 'ARR (estimado)', 'Cobrado recurrente', 'Cobrado único', 'Costo asignado', 'Comisión', 'Margen gerencial']}>
              {rows.map((r) => (
                <tr key={`${r.saas_product_id}-${r.currency}`}>
                  <td className="ebim-td font-semibold">{r.short_name}</td>
                  <td className="ebim-td text-muted">{r.currency ?? '—'}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(num(r.mrr), r.currency)}</td>
                  <td className="ebim-td text-right tabular-nums text-muted">{formatMoney(num(r.arr), r.currency)}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(num(r.collected_recurring), r.currency)}</td>
                  <td className="ebim-td text-right tabular-nums text-muted">{formatMoney(num(r.collected_one_time), r.currency)}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(num(r.direct_cost), r.currency)}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(num(r.commission_total), r.currency)}</td>
                  <td className={`ebim-td text-right font-semibold tabular-nums ${marginClass(r.gross_margin)}`}>
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
            <DataTable columns={['Partner', 'Moneda', 'Tenants', 'MRR', 'Cobrado', 'Costo asignado', 'Comisión', 'Margen gerencial']}>
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
                  </td>
                  <td className="ebim-td text-muted">{r.currency ?? '—'}</td>
                  <td className="ebim-td text-right tabular-nums">{Number(r.managed_tenants ?? 0)}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(num(r.mrr), r.currency)}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(num(r.collected_revenue), r.currency)}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(num(r.direct_cost), r.currency)}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(num(r.commission_total), r.currency)}</td>
                  <td className={`ebim-td text-right font-semibold tabular-nums ${marginClass(r.gross_margin)}`}>
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
            <DataTable columns={['Tenant', 'Producto', 'Modelo', 'Moneda', 'MRR', 'Cobrado', 'Costo asignado', 'Comisión', 'Margen gerencial']}>
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
                  </td>
                  <td className="ebim-td">{r.product_code}</td>
                  <td className="ebim-td">
                    <Badge tone="accent">
                      {DEPLOYMENT_MODE_LABEL[r.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL] ?? r.deployment_mode ?? '—'}
                    </Badge>
                  </td>
                  <td className="ebim-td text-muted">{r.currency ?? '—'}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(num(r.mrr), r.currency)}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(num(r.collected_revenue), r.currency)}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(num(r.direct_cost), r.currency)}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(num(r.commission_total), r.currency)}</td>
                  <td className={`ebim-td text-right font-semibold tabular-nums ${marginClass(r.gross_margin)}`}>
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
