import { useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { useFinanceMonthlySeries, useSettlements } from '@/services/queries';
import { usePermissions } from '@/hooks/usePermissions';
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
import { PageContainer, Card, SearchBar, Badge, KpiTile } from '@/components/ui/primitives';
import { PagedTable, type TableColumn } from '@/components/ui/PagedTable';
import { ExportMenu } from '@/components/ui/ExportMenu';
import type { ExportColumn } from '@/lib/export';
import { formatCompactAmount, formatMoney, formatPercent, formatDate, formatNumber, sumByCurrency } from '@/lib/format';
import { SettlementsSection } from './SettlementsSection';
import { ChartLegend, ChartPanel } from '@/features/executive/components/ChartPanel';
import { fromQuery } from '@/features/executive/dataState';
import { currentMonth, lastMonths, toCurrencyAmounts } from '@/features/executive/reportContext';
import { monthLongLabel } from '@/features/dashboard/executiveModel';
import { monthShortLabel } from '@/features/dashboard/executiveData';
import { ConsistencyNote } from '@/features/billing/listing';
import { useDebouncedSearch } from '@/features/billing/listingState';
import { FilterTotals, KpiStrip, NativeAmountTile } from '@/features/billing/financeUi';
import { analyzedMonth, closedWindow, longMonthName, relChange, shortMonthName } from '@/features/billing/financeModel';
import { PeriodBars } from '@/features/billing/lazyFinanceCharts';

/**
 * Comisiones y liquidaciones (P14; liquidación y pago en la fase 13).
 *
 * El resumen lo agrega la base (`commission_summary`) con los MISMOS filtros
 * que la tabla (`v_commission_detail`). «Pendiente» es lo que ya se debe
 * (ELEGIBLE + DEVENGADA); «En espera» (PENDING) todavía no es deuda y se
 * muestra aparte para no inflar el pendiente.
 *
 * Cada evento muestra CÓMO se calculó (base × tasa × participación): una
 * comisión que no se puede explicar es una comisión que se discute.
 *
 * Pestañas: «Devengado» (lo que generan los cobros) y «Liquidaciones» (el
 * ciclo Generar → Aprobar → Registrar pago, o Anular con motivo). Un comercial
 * ve lo suyo por RLS y sin acciones.
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
  const { canReadFinance } = usePermissions();
  const [generating, setGenerating] = useState(false);
  const awaiting = (settlements.data ?? []).filter((x) => x.status === 'OPEN' || x.status === 'APPROVED').length;
  return (
    <PageContainer
      title="Comisiones y liquidaciones"
      description={
        canReadFinance
          ? 'Cada comisión nace de un cobro confirmado: una factura emitida pero impaga no devenga nada. Finanzas agrupa lo elegible en liquidaciones por comercial, período y moneda, las aprueba y registra su pago. No se suman monedas distintas.'
          : 'Tus comisiones nacen de cobros confirmados. Finanzas las agrupa en liquidaciones, las aprueba y registra el pago; aquí ves en qué estado está cada una.'
      }
      actions={
        canReadFinance ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setGenerating(true)}>
            <PlusIcon size={16} weight="bold" aria-hidden />
            Generar liquidación
          </button>
        ) : undefined
      }
    >
      <CommissionKpis settlements={settlements} />
      <SectionTabs
        tabs={[
          {
            id: 'devengado',
            label: 'Devengado',
            content: (
              <div className="space-y-6">
                <CommissionsByMonthPanel />
                <CommissionEventsSection />
              </div>
            ),
          },
          {
            id: 'liquidaciones',
            label: 'Liquidaciones',
            count: settlements.data ? awaiting : undefined,
            content: (
              <SettlementsSection
                query={settlements}
                canManage={canReadFinance}
                generateOpen={generating}
                onGenerateClose={() => setGenerating(false)}
              />
            ),
          },
        ]}
      />
    </PageContainer>
  );
}

/* ==========================================================================
   Franja: devengado (S09) · por liquidar · en liquidación · pagado
   ========================================================================== */

const OPEN_SETTLEMENT = ['OPEN', 'APPROVED'];

function plural(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

function CommissionKpis({ settlements }: { settlements: ReturnType<typeof useSettlements> }) {
  const month = analyzedMonth();
  const series = useFinanceMonthlySeries({ from: `${lastMonths(currentMonth(), 14)[0]}-01` });
  const summary = useCommissionSummary({ search: '', filter: 'ALL' });
  const { current, previous, trend } = closedWindow(series.data, month);
  const rc = series.data?.[0]?.reportingCurrency;
  const summaryState = fromQuery(summary, { isEmpty: () => false });
  const settlementState = fromQuery(settlements, { isEmpty: () => false });
  const all = settlements.data ?? [];
  const inProgress = all.filter((x) => OPEN_SETTLEMENT.includes(x.status));
  const approvedCount = inProgress.filter((x) => x.status === 'APPROVED').length;
  const paidCount = all.filter((x) => x.status === 'PAID').length;
  const rate = current?.commission != null && current.collected ? current.commission / current.collected : null;

  return (
    <KpiStrip label="Indicadores de comisiones">
      <KpiTile
        label={`Devengado · ${shortMonthName(month)}`}
        info="Comisión devengada en el mes sobre cobros confirmados (sin anuladas), en moneda de reporte (S09)."
        currency={current?.commission != null ? rc : undefined}
        value={current?.commission == null ? null : formatCompactAmount(current.commission)}
        delta={{
          value: relChange(current?.commission, previous?.commission),
          comparison: previous ? `vs ${longMonthName(previous.month.slice(0, 7))}` : undefined,
          goodWhen: 'none',
        }}
        trend={trend.map((p) => p.commission)}
        trendDescription="Comisión devengada de los últimos meses cerrados"
        footer={
          current && !current.complete
            ? `Falta tasa ${current.missingCurrencies.join(', ')}: no se consolida`
            : rate != null
              ? `${formatPercent(rate)} de lo cobrado en ${shortMonthName(month)}`
              : monthLongLabel(month)
        }
        loading={series.isLoading}
        error={series.error}
        onRetry={() => void series.refetch()}
      />
      <NativeAmountTile
        label="Por liquidar"
        info="Comisiones elegibles que todavía no están en ninguna liquidación. Por moneda."
        amounts={toCurrencyAmounts(summary.data?.by_status?.ELIGIBLE)}
        state={summaryState}
        onRetry={() => void summary.refetch()}
        emptyLabel="Nada por liquidar"
        footer="Elegibles, fuera de una liquidación"
      />
      <NativeAmountTile
        label="En liquidación"
        info="Liquidaciones abiertas (en revisión) o aprobadas (por pagar). Cada liquidación es de una sola moneda."
        amounts={sumByCurrency(inProgress, (x) => x.total_amount, (x) => x.currency)}
        state={settlementState}
        onRetry={() => void settlements.refetch()}
        emptyLabel="Ninguna liquidación abierta"
        footer={`${plural(inProgress.length - approvedCount, 'abierta', 'abiertas')} · ${plural(approvedCount, 'aprobada por pagar', 'aprobadas por pagar')}`}
      />
      <NativeAmountTile
        label="Pagado"
        info="Comisión ya pagada (histórico), por moneda."
        amounts={toCurrencyAmounts(summary.data?.paid)}
        state={summaryState}
        onRetry={() => void summary.refetch()}
        emptyLabel="Nada pagado todavía"
        footer={`Histórico · ${plural(paidCount, 'liquidación pagada', 'liquidaciones pagadas')}`}
      />
    </KpiStrip>
  );
}

const COMMISSION_SERIES = [
  { key: 'paid', label: 'Pagada', color: 'var(--chart-1)' },
  { key: 'owed', label: 'Por pagar', color: 'var(--chart-2)' },
];

function CommissionsByMonthPanel() {
  const month = analyzedMonth();
  const query = useFinanceMonthlySeries({ from: `${lastMonths(currentMonth(), 14)[0]}-01` });
  const { trend } = closedWindow(query.data, month);
  const rc = query.data?.[0]?.reportingCurrency ?? '';
  const owed = (p: (typeof trend)[number]) =>
    p.commission == null || p.commissionPaid == null ? null : Math.round((p.commission - p.commissionPaid) * 100) / 100;
  const total = trend.every((p) => p.commission != null) ? trend.reduce((t, p) => t + (p.commission ?? 0), 0) : null;
  const state = fromQuery(query, { isEmpty: (rows) => rows.every((p) => !p.commission) });
  return (
    <ChartPanel
      id="comisiones-mes"
      title="¿Cuánta comisión generan los cobros cada mes?"
      unit={`Comisión devengada por mes en ${rc || 'moneda de reporte'}, según su estado de hoy`}
      period={`${trend[0] ? monthShortLabel(trend[0].month.slice(0, 7)) : ''} – ${monthShortLabel(month)}${total != null ? ` · ${formatMoney(total, rc)} en el período` : ''}`}
      source="finance_monthly_series"
      coverage="Por fecha de devengo; «por pagar» incluye lo pendiente y lo que está en espera"
      state={state}
      onRetry={() => void query.refetch()}
      emptyText="Sin comisiones devengadas en el período"
      refreshing={query.isPlaceholderData}
      legend={<ChartLegend items={COMMISSION_SERIES.map((c) => ({ label: c.label, color: c.color }))} />}
      chart={() => (
        <PeriodBars
          stacked
          data={trend.map((p) => ({
            key: p.month,
            label: monthShortLabel(p.month.slice(0, 7)),
            title: monthLongLabel(p.month.slice(0, 7)),
            values: { paid: p.commissionPaid, owed: owed(p) },
          }))}
          series={COMMISSION_SERIES}
          unit={{ currency: rc }}
          height={220}
          ariaLabel={`Comisión devengada por mes en ${rc}, separada en pagada y por pagar${total != null ? `; ${formatMoney(total, rc)} en total` : ''}. Use la vista Tabla para leer cada mes.`}
        />
      )}
      table={() => (
        <table className="w-full text-compact">
          <caption className="sr-only">Comisión devengada por mes</caption>
          <thead>
            <tr>
              <th scope="col" className="ebim-th">Mes</th>
              <th scope="col" className="ebim-th text-right">Devengada ({rc})</th>
              <th scope="col" className="ebim-th text-right">Pagada</th>
              <th scope="col" className="ebim-th text-right">Por pagar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...trend].reverse().map((p) => (
              <tr key={p.month}>
                <th scope="row" className="ebim-td text-left font-medium">{monthLongLabel(p.month.slice(0, 7))}</th>
                <td className="ebim-td ebim-num">{p.commission == null ? 'Sin tasa' : formatMoney(p.commission, rc)}</td>
                <td className="ebim-td ebim-num">{p.commissionPaid == null ? 'Sin tasa' : formatMoney(p.commissionPaid, rc)}</td>
                <td className="ebim-td ebim-num">{owed(p) == null ? 'Sin tasa' : formatMoney(owed(p), rc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    />
  );
}

/* ==========================================================================
   Eventos de comisión
   ========================================================================== */

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
    { id: 'date', header: 'Fecha', sortKey: 'earned_on', cell: (r) => <span className="whitespace-nowrap text-compact text-fg-2">{formatDate(r.earned_on)}</span> },
    {
      id: 'agent',
      header: 'Comercial',
      sortKey: 'agent_name',
      cell: (r) => (
        <span className="block min-w-[140px]">
          <span className="block font-semibold">{r.agent_name ?? '—'}</span>
          <span className="block max-w-[160px] truncate text-compact text-fg-2" title={r.tenant_name ?? undefined}>
            {r.tenant_name ?? 'Sin tenant'}
          </span>
        </span>
      ),
    },
    // Producto y origen en una celda (el origen es la línea cobrada y su factura):
    // como columnas separadas la tabla no cabía a 1280.
    {
      id: 'product',
      header: 'Producto · origen',
      sortKey: 'product_short_name',
      cell: (r) => (
        <span className="block max-w-[200px] text-compact">
          <span className="block truncate text-body" title={r.rule_name ? `Regla: ${r.rule_name}` : undefined}>
            {r.product_short_name ?? '—'}
            <span className="text-fg-2"> · {r.source_label ?? '—'}</span>
          </span>
          {r.invoice_number ? (
            <span className="block truncate font-mono text-caption text-muted" title={r.invoice_number}>
              {r.invoice_number}
            </span>
          ) : null}
        </span>
      ),
    },
    // Trazabilidad del cálculo: base × tasa × participación (la regla, al pasar el cursor).
    {
      id: 'calc',
      header: 'Cálculo',
      cell: (r) => (
        <span className="block whitespace-nowrap text-compact text-fg-2" title={r.rule_name ? `Regla: ${r.rule_name}` : undefined}>
          {calculation(r)}
          <span className="block max-w-[180px] truncate text-caption text-muted">{r.rule_name ?? 'Sin regla'}</span>
        </span>
      ),
    },
    {
      id: 'amount',
      header: 'Monto',
      sortKey: 'amount',
      align: 'right',
      cell: (r) => (
        <span className={`whitespace-nowrap font-semibold ${Number(r.amount ?? 0) < 0 ? 'text-danger' : ''}`}>{formatMoney(num(r.amount), r.currency)}</span>
      ),
    },
    {
      id: 'status',
      header: 'Estado / liquidación',
      cell: (r) => (
        <span className="block">
          <span className="flex gap-1">
            <Badge tone={STATUS_TONE[r.status ?? ''] ?? 'neutral'}>{STATUS_LABEL[r.status ?? ''] ?? r.status ?? '—'}</Badge>
            {r.is_reversal ? <Badge tone="danger">Reverso</Badge> : null}
          </span>
          {r.settlement_code ? (
            <span className="mt-0.5 block max-w-[128px] truncate whitespace-nowrap font-mono text-caption text-muted" title={`Liquidación ${r.settlement_code}`}>
              {r.settlement_code}
            </span>
          ) : null}
        </span>
      ),
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
        <div className="border-b border-border px-5 py-2.5">
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
        <FilterTotals
          state={summaryState}
          onRetry={retry}
          items={[
            {
              label: 'Comisión pendiente',
              amounts: toCurrencyAmounts(summary.data?.pending),
              emptyLabel: 'Nada pendiente',
              hint: 'Elegible + devengada: lo que ya se debe y falta liquidar.',
            },
            {
              label: 'Comisión pagada',
              amounts: toCurrencyAmounts(summary.data?.paid),
              emptyLabel: 'Nada pagado',
              hint: 'Cada liquidación es de una sola moneda.',
            },
            {
              label: 'En espera',
              amounts: waiting,
              emptyLabel: 'Nada en espera',
              hint: 'Estado PENDING: aún no es elegible; no suma al pendiente.',
            },
          ]}
          note={
            <ConsistencyNote
              summaryCount={summary.data && !summary.isFetching ? summary.data.row_count : undefined}
              tableTotal={page.data && !page.isFetching ? page.data.total : undefined}
              noun="comisiones"
            />
          }
        />
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
