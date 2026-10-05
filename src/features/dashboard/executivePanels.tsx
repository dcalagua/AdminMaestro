import { Component, useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CalendarCheckIcon,
  CheckCircleIcon,
  CreditCardIcon,
  HandCoinsIcon,
  PauseCircleIcon,
  StackIcon,
  WarningCircleIcon,
  type Icon,
} from '@phosphor-icons/react';
import {
  useBillingAlerts,
  useDashboardSummary,
  usePartnerFeeStatements,
  useSaasProvisioningRequests,
  useSettlements,
  useTenantOverview,
  type ExecutiveMrrMixRow,
  type ExecutiveMrrMovementCustomer,
  type useExecutiveAging,
  type useExecutiveMrrMix,
} from '@/services/queries';
import { Skeleton } from '@/components/ui/primitives';
import { fromQuery, type DataState } from '@/features/executive/dataState';
import { ChartPanel } from '@/features/executive/components/ChartPanel';
import { StateMessage } from '@/features/executive/components/StateView';
import { formatCompactAmount, formatDelta, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { agingSummary, DIRECT_CHANNEL, topCustomers, topPartners, type RankedRow } from './executiveModel';

/* ---- Aislamiento por panel -------------------------------------------------------- */

/** Un panel que falla al dibujarse no tumba el tablero: se reemplaza por su aviso. */
export class PanelBoundary extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="ebim-card flex h-full min-h-[160px] flex-col items-start justify-center gap-1 p-5" role="alert">
        <span className="inline-flex items-center gap-1.5 text-body font-semibold text-fg">
          <WarningCircleIcon size={18} className="text-danger" aria-hidden />
          {this.props.title}: no se pudo mostrar
        </span>
        <span className="text-compact text-muted">El resto del resumen sigue disponible.</span>
        <button type="button" className="ebim-link text-compact" onClick={() => this.setState({ failed: false })}>
          Reintentar
        </button>
      </section>
    );
  }
}

/** Tarjeta de panel sin gráfico (listas): misma anatomía que `ChartPanel`. */
function PanelCard({
  title,
  subtitle,
  children,
  footer,
  className = '',
  id,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section className={`ebim-card flex h-full min-w-0 flex-col ${className}`} aria-labelledby={headingId} data-panel={id}>
      <header className="px-5 pb-2 pt-4">
        <h3 id={headingId} className="text-h3 text-fg">
          {title}
        </h3>
        <p className="mt-0.5 text-caption text-muted">{subtitle}</p>
      </header>
      <div className="min-w-0 flex-1 px-5 pb-4 pt-1">{children}</div>
      {footer ? (
        <footer className="flex flex-wrap items-center justify-between gap-2 rounded-b-card border-t border-border bg-sunken px-5 py-2.5 text-caption text-muted">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true">
      <span role="status" className="sr-only">
        Cargando…
      </span>
      <div className="space-y-3 py-1" aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Change({ value, isNew }: { value: number | null; isNew?: boolean }) {
  if (isNew) return <span className="text-caption font-semibold text-accent-deep">Nuevo</span>;
  if (value == null || value === 0) return <span className="text-caption tabular-nums text-muted">{value === 0 ? '0.0%' : '—'}</span>;
  const up = value > 0;
  const Arrow = up ? ArrowUpRightIcon : ArrowDownRightIcon;
  return (
    <span className={`inline-flex items-center gap-0.5 text-caption font-semibold tabular-nums ${up ? 'text-ok' : 'text-danger'}`}>
      <Arrow size={12} weight="bold" aria-hidden />
      {formatDelta(value)}
    </span>
  );
}

/* ---- Barras horizontales ordenadas (mix) ----------------------------------------- */

/**
 * Barras horizontales HTML (§6.6 «Mix»): una serie → todas `--chart-1`, orden
 * descendente, valor al final de la barra y participación. Cada fila es el enlace
 * a su detalle (el teclado llega igual que el ratón).
 */
export function RankedBars({
  rows,
  currency,
  hrefFor,
  ariaLabel,
}: {
  rows: Array<{ key: string; label: string; mrr: number | null; share: number | null; detail?: string }>;
  currency: string;
  hrefFor: (key: string) => string;
  ariaLabel: string;
}) {
  const max = Math.max(...rows.map((r) => r.mrr ?? 0), 0);
  return (
    <ul aria-label={ariaLabel} className="space-y-1">
      {rows.map((r) => (
        <li key={r.key}>
          <Link
            to={hrefFor(r.key)}
            className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-fast hover:bg-hover"
          >
            <span className="truncate text-compact font-semibold text-fg" title={r.label}>
              {r.label}
            </span>
            <span className="flex h-3 items-center" aria-hidden>
              <span
                className="block h-3 rounded-r-sm bg-chart-1"
                style={{ width: r.mrr != null && max > 0 ? `${Math.max(2, (r.mrr / max) * 100)}%` : '0%' }}
              />
            </span>
            <span className="flex items-baseline justify-end gap-2 whitespace-nowrap">
              <span className="text-compact font-semibold tabular-nums text-fg">
                {r.mrr == null ? 'Sin tasa' : `${currency} ${formatCompactAmount(r.mrr)}`}
              </span>
              <span className="w-12 text-right text-caption tabular-nums text-muted">{r.share == null ? '—' : formatPercent(r.share, 0)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const DIMENSION_COPY = {
  PRODUCT: {
    title: '¿Qué productos sostienen el MRR?',
    unit: 'MRR por producto',
    empty: 'Ningún producto tenía MRR al cierre del mes',
    href: (key: string) => `/products/${key}`,
    detail: { href: '/products', label: 'Ver suite SaaS' },
    column: 'Producto',
  },
  MARKET: {
    title: '¿En qué mercados está el MRR?',
    unit: 'MRR por país',
    empty: 'Sin MRR por mercado al cierre del mes',
    href: () => '/customers',
    detail: { href: '/customers', label: 'Ver clientes' },
    column: 'Mercado',
  },
} as const;

export function MixPanel({
  dimension,
  query,
  currency,
  monthLabel,
  refreshing,
}: {
  dimension: 'PRODUCT' | 'MARKET';
  query: ReturnType<typeof useExecutiveMrrMix>;
  currency: string;
  monthLabel: string;
  refreshing?: boolean;
}) {
  const copy = DIMENSION_COPY[dimension];
  const rows = query.data ?? [];
  const missing = [...new Set(rows.flatMap((r) => r.missingCurrencies))];
  const state: DataState<unknown> = fromQuery(query);
  return (
    <ChartPanel
      id={dimension === 'PRODUCT' ? 'mix-producto' : 'mix-mercado'}
      title={copy.title}
      unit={`${copy.unit} en ${currency}`}
      period={`Cierre de ${monthLabel}`}
      source={`executive_mrr_mix (${dimension})`}
      coverage={missing.length ? `Sin tasa para ${missing.join(', ')}: esas filas no se consolidan` : 'Orden de mayor a menor; % sobre el total del mes'}
      state={state.status === 'ready' && missing.length ? { status: 'partial', data: rows, reasons: [`falta tasa ${missing.join(', ')}`] } : state}
      onRetry={() => void query.refetch()}
      emptyText={copy.empty}
      refreshing={refreshing}
      detailHref={copy.detail.href}
      detailLabel={copy.detail.label}
      chart={() => (
        <RankedBars
          rows={rows}
          currency={currency}
          hrefFor={copy.href}
          ariaLabel={`${copy.unit} en ${currency}, cierre de ${monthLabel}`}
        />
      )}
      table={() => (
        <table className="w-full text-compact">
          <caption className="sr-only">{copy.unit}</caption>
          <thead>
            <tr>
              <th scope="col" className="ebim-th">{copy.column}</th>
              <th scope="col" className="ebim-th text-right">MRR ({currency})</th>
              <th scope="col" className="ebim-th text-right">%</th>
              <th scope="col" className="ebim-th text-right">Clientes</th>
              <th scope="col" className="ebim-th">Nativo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r: ExecutiveMrrMixRow) => (
              <tr key={r.key}>
                <th scope="row" className="ebim-td text-left font-semibold">
                  <Link className="ebim-link" to={copy.href(r.key)}>{r.label}</Link>
                </th>
                <td className="ebim-td text-right tabular-nums">{r.mrr == null ? 'Sin tasa' : formatMoney(r.mrr, currency)}</td>
                <td className="ebim-td text-right tabular-nums">{r.share == null ? '—' : formatPercent(r.share)}</td>
                <td className="ebim-td text-right tabular-nums">{formatNumber(r.activeCustomers)}</td>
                <td className="ebim-td text-caption text-muted">
                  {Object.entries(r.native).map(([c, v]) => `${c} ${formatCompactAmount(v)}`).join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    />
  );
}

/* ---- Cartera por antigüedad ------------------------------------------------------- */

export function AgingPanel({
  query,
  currency,
  asOfLabel,
  refreshing,
}: {
  query: ReturnType<typeof useExecutiveAging>;
  currency: string;
  asOfLabel: string;
  refreshing?: boolean;
}) {
  const summary = agingSummary(query.data);
  const base = fromQuery(query, { isEmpty: (d) => d === null || (agingSummary(d)?.overdueInvoices ?? 0) === 0 });
  const state: DataState<unknown> =
    base.status === 'ready' && summary && !summary.complete
      ? { status: 'partial', data: summary, reasons: [`falta tasa ${summary.missingCurrencies.join(', ')}`] }
      : base;
  const link = (bucket: string) => `/billing?estado=OPEN&antiguedad=${bucket}`;

  return (
    <ChartPanel
      id="antiguedad"
      title="¿Qué tan vencida está la cartera?"
      unit={`Saldo vencido en ${currency} por antigüedad`}
      period={asOfLabel}
      source="executive_receivables_aging"
      coverage="Clic en un tramo abre Facturación filtrada (a hoy)"
      state={state}
      onRetry={() => void query.refetch()}
      emptyText="No hay facturas vencidas a esa fecha"
      refreshing={refreshing}
      detailHref="/billing?estado=OPEN&antiguedad=VENCIDA"
      detailLabel="Ver vencidas"
      chart={() =>
        summary ? (
          <div>
            <p className="flex items-baseline gap-2">
              <span className="text-h3 font-semibold text-muted">{currency}</span>
              <span className="text-kpi text-fg">{summary.overdue == null ? '—' : formatCompactAmount(summary.overdue)}</span>
              <span className="text-compact text-muted">
                en {formatNumber(summary.overdueInvoices)} {summary.overdueInvoices === 1 ? 'factura' : 'facturas'}
              </span>
            </p>
            <div className="mt-3 flex h-6 w-full gap-0.5 overflow-hidden rounded-sm" aria-hidden>
              {summary.segments
                .filter((s) => (s.share ?? 0) > 0)
                .map((s) => (
                  <Link
                    key={s.bucket}
                    to={link(s.bucket)}
                    tabIndex={-1}
                    title={`${s.label}: ${formatMoney(s.balance, currency)}`}
                    className="h-full transition-opacity duration-fast hover:opacity-80"
                    style={{ width: `${(s.share ?? 0) * 100}%`, background: s.token }}
                  />
                ))}
            </div>
            <ul className="mt-4 divide-y divide-border">
              {summary.segments.map((s) => (
                <li key={s.bucket}>
                  <Link
                    to={link(s.bucket)}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md px-1 py-2 transition-colors duration-fast hover:bg-hover"
                  >
                    <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: s.token }} />
                    <span className="text-compact text-fg">{s.label}</span>
                    <span className="text-caption tabular-nums text-muted">
                      {formatNumber(s.invoiceCount)} fact.
                    </span>
                    <span className="w-24 text-right text-compact font-semibold tabular-nums text-fg">
                      {s.balance == null ? 'Sin tasa' : `${currency} ${formatCompactAmount(s.balance)}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {summary.current && summary.current.invoiceCount > 0 ? (
              <p className="mt-2 text-caption text-muted">
                Aún no vencida: {summary.current.balance == null ? 'sin tasa' : `${currency} ${formatCompactAmount(summary.current.balance)}`} en{' '}
                {formatNumber(summary.current.invoiceCount)} facturas
                {summary.noDueDate && summary.noDueDate.invoiceCount > 0
                  ? ` · ${formatNumber(summary.noDueDate.invoiceCount)} sin fecha de vencimiento`
                  : ''}
                .
              </p>
            ) : null}
          </div>
        ) : null
      }
      table={() => (
        <table className="w-full text-compact">
          <caption className="sr-only">Cartera por antigüedad</caption>
          <thead>
            <tr>
              <th scope="col" className="ebim-th">Antigüedad</th>
              <th scope="col" className="ebim-th text-right">Facturas</th>
              <th scope="col" className="ebim-th text-right">Saldo ({currency})</th>
              <th scope="col" className="ebim-th">Nativo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(query.data?.buckets ?? []).map((b) => (
              <tr key={b.bucket}>
                <th scope="row" className="ebim-td text-left">
                  <Link className="ebim-link" to={link(b.bucket)}>{AGING_LABEL[b.bucket]}</Link>
                </th>
                <td className="ebim-td text-right tabular-nums">{formatNumber(b.invoiceCount)}</td>
                <td className="ebim-td text-right tabular-nums">{b.balance == null ? 'Sin tasa' : formatMoney(b.balance, currency)}</td>
                <td className="ebim-td text-caption text-muted">
                  {Object.entries(b.native).map(([c, v]) => formatMoney(v, c)).join(' · ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    />
  );
}

const AGING_LABEL: Record<string, string> = {
  VIGENTE: 'Aún no vencida',
  D1_30: '1–30 días',
  D31_60: '31–60 días',
  D61_90: '61–90 días',
  D90_MAS: 'Más de 90 días',
  SIN_FECHA: 'Sin fecha de vencimiento',
};

/* ---- Top clientes y partners ------------------------------------------------------ */

function RankedList({
  rows,
  currency,
  hrefFor,
  emptyText,
}: {
  rows: RankedRow[];
  currency: string;
  hrefFor: (key: string) => string;
  emptyText: string;
}) {
  if (rows.length === 0) return <p className="py-6 text-compact text-muted">{emptyText}</p>;
  return (
    <ol className="divide-y divide-border">
      {rows.map((r, i) => (
        <li key={r.key}>
          <Link
            to={hrefFor(r.key)}
            className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-1 py-2.5 transition-colors duration-fast hover:bg-hover"
          >
            <span className="text-caption font-semibold tabular-nums text-muted">{i + 1}</span>
            <span className="min-w-0">
              <span className="block truncate text-compact font-semibold text-fg" title={r.label}>
                {r.label}
              </span>
              <span className="mt-1 block h-1 w-full rounded-full bg-sunken" aria-hidden>
                <span className="block h-1 rounded-full bg-chart-1" style={{ width: `${Math.max(3, (r.share ?? 0) * 100)}%` }} />
              </span>
            </span>
            <span className="flex flex-col items-end">
              <span className="text-compact font-semibold tabular-nums text-fg">
                {currency} {formatCompactAmount(r.mrr)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-caption tabular-nums text-muted">{r.share == null ? '' : formatPercent(r.share, 0)}</span>
                <Change value={r.change} isNew={r.isNew} />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function TopCustomersPanel({
  rows,
  state,
  currency,
  monthLabel,
  onRetry,
}: {
  rows: readonly ExecutiveMrrMovementCustomer[] | undefined;
  state: DataState<unknown>;
  currency: string;
  monthLabel: string;
  onRetry: () => void;
}) {
  const top = topCustomers(rows, 5);
  return (
    <PanelCard
      id="top-clientes"
      title="Top 5 clientes"
      subtitle={`MRR al cierre de ${monthLabel} · % del total y variación vs mes anterior`}
      footer={
        <>
          <span>Fuente: <span className="font-mono">executive_mrr_movement_customers</span></span>
          <Link className="ebim-link text-caption font-semibold" to="/customers">
            Ver clientes <span aria-hidden>→</span>
          </Link>
        </>
      }
    >
      {state.status === 'loading' ? (
        <ListSkeleton />
      ) : state.status === 'ready' || state.status === 'empty' ? (
        <RankedList rows={top} currency={currency} hrefFor={(id) => `/organizations/${id}`} emptyText="Sin clientes con MRR al cierre del mes" />
      ) : (
        <StateMessage state={state} onRetry={onRetry} />
      )}
    </PanelCard>
  );
}

export function TopPartnersPanel({
  current,
  previous,
  currency,
  monthLabel,
}: {
  current: ReturnType<typeof useExecutiveMrrMix>;
  previous: ReturnType<typeof useExecutiveMrrMix>;
  currency: string;
  monthLabel: string;
}) {
  const state = fromQuery(current, { isEmpty: () => false });
  const top = topPartners(current.data, previous.data, 5);
  const direct = current.data?.find((r) => r.key === DIRECT_CHANNEL);
  return (
    <PanelCard
      id="top-partners"
      title="Top partners"
      subtitle={`MRR de los tenants que gestiona cada canal · cierre de ${monthLabel}`}
      footer={
        <>
          <span>Fuente: <span className="font-mono">executive_mrr_mix (PARTNER)</span></span>
          <Link className="ebim-link text-caption font-semibold" to="/partners">
            Ver partners <span aria-hidden>→</span>
          </Link>
        </>
      }
    >
      {state.status === 'loading' ? (
        <ListSkeleton />
      ) : state.status === 'ready' ? (
        <>
          <RankedList rows={top} currency={currency} hrefFor={(id) => `/organizations/${id}`} emptyText="Ningún partner gestiona tenants con MRR" />
          {direct && direct.share != null ? (
            <p className="mt-2 text-caption text-muted">
              Venta directa: {currency} {formatCompactAmount(direct.mrr)} ({formatPercent(direct.share, 0)} del MRR).
            </p>
          ) : null}
        </>
      ) : (
        <StateMessage state={state} onRetry={() => void current.refetch()} />
      )}
    </PanelCard>
  );
}

/* ---- Requiere atención ------------------------------------------------------------ */

interface AttentionRow {
  id: string;
  icon: Icon;
  title: string;
  detail: string;
  href: string;
  action: string;
  count: number | null;
  tone: 'danger' | 'warn' | 'info';
  failed: boolean;
}

const TONE_CHIP: Record<AttentionRow['tone'], string> = {
  danger: 'bg-danger-soft text-danger',
  warn: 'bg-warn-soft text-warn',
  info: 'bg-info-soft text-info',
};

/**
 * Requiere atención (D-V05): siempre las mismas cinco preguntas, con su conteo
 * y su acción. Un conteo en cero se muestra resuelto (✓), no desaparece; una
 * fuente que no se pudo leer lo dice en su fila y no cuenta como cero.
 */
export function AttentionPanel() {
  const alerts = useBillingAlerts('OPEN');
  const tenants = useTenantOverview();
  const settlements = useSettlements();
  const statements = usePartnerFeeStatements({});
  const saas = useSaasProvisioningRequests();
  const summary = useDashboardSummary();

  const loading = [alerts, tenants, settlements, statements, saas, summary].some((q) => q.isLoading);
  const byType = (t: string) => (alerts.data ?? []).filter((a) => a.alert_type === t).length;
  const openSettlements = (settlements.data ?? []).filter((s) => s.status === 'OPEN').length;
  const draftStatements = (statements.data ?? []).filter((s) => s.status === 'DRAFT').length;
  const suspended = (tenants.data ?? []).filter((t) => t.status === 'SUSPENDED').length;
  const saasFailed = (saas.data ?? []).filter((r) => r.status === 'FAILED').length;
  const infraFailed = summary.data?.provisioning_failures ?? 0;

  const rows: AttentionRow[] = [
    {
      id: 'renewals',
      icon: CalendarCheckIcon,
      title: 'Avisos de renovación',
      detail: 'Contratos que renuevan dentro de su ventana de aviso',
      href: '/renewals?ventana=30',
      action: 'Revisar renovaciones',
      count: alerts.error ? null : byType('RENEWAL_NOTICE'),
      tone: 'info',
      failed: Boolean(alerts.error),
    },
    {
      id: 'collections',
      icon: CreditCardIcon,
      title: 'Cobros fallidos o por suspender',
      detail: alerts.error
        ? 'Alertas de cobranza'
        : `${formatNumber(byType('PAYMENT_FAILURE'))} cobros fallidos · ${formatNumber(byType('SUSPENSION_DUE') + byType('GRACE_ENDING'))} al fin de la gracia`,
      href: '/renewals',
      action: 'Gestionar cobranza',
      count: alerts.error ? null : byType('PAYMENT_FAILURE') + byType('SUSPENSION_DUE') + byType('GRACE_ENDING'),
      tone: 'danger',
      failed: Boolean(alerts.error),
    },
    {
      id: 'suspended',
      icon: PauseCircleIcon,
      title: 'Tenants suspendidos',
      detail: 'Sin servicio hasta regularizar',
      href: '/tenants',
      action: 'Ver tenants',
      count: tenants.error ? null : suspended,
      tone: 'warn',
      failed: Boolean(tenants.error),
    },
    {
      id: 'settlements',
      icon: HandCoinsIcon,
      title: 'Liquidaciones abiertas',
      detail: `${formatNumber(openSettlements)} de comisiones · ${formatNumber(draftStatements)} estados de partner en borrador`,
      href: openSettlements > 0 || draftStatements === 0 ? '/commissions#settlements' : '/partner-fees',
      action: 'Cerrar liquidaciones',
      count: settlements.error && statements.error ? null : openSettlements + draftStatements,
      tone: 'warn',
      failed: Boolean(settlements.error || statements.error),
    },
    {
      id: 'provisioning',
      icon: StackIcon,
      title: 'Altas e infraestructura fallidas',
      detail: `${formatNumber(saasFailed)} altas SaaS · ${formatNumber(infraFailed)} solicitudes de infraestructura`,
      href: saasFailed > 0 || infraFailed === 0 ? '/saas-provisioning' : '/provisioning',
      action: 'Ver solicitudes',
      count: saas.error && summary.error ? null : saasFailed + infraFailed,
      tone: 'danger',
      failed: Boolean(saas.error || summary.error),
    },
  ];
  const pending = rows.filter((r) => (r.count ?? 0) > 0).length;

  return (
    <PanelCard
      id="atencion"
      title="Requiere atención"
      subtitle={loading ? 'Revisando cobranza, tenants y liquidaciones…' : pending === 0 ? 'Nada pendiente en las fuentes consultadas' : `${pending} de ${rows.length} frentes con pendientes`}
    >
      {loading ? (
        <ListSkeleton rows={5} />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const done = r.count === 0 && !r.failed;
            return (
              <li key={r.id}>
                <Link
                  to={r.href}
                  className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-1 py-2.5 transition-colors duration-fast hover:bg-hover"
                  data-attention={r.id}
                >
                  <span
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${done ? 'bg-ok-soft text-ok' : TONE_CHIP[r.tone]}`}
                  >
                    {done ? <CheckCircleIcon size={16} weight="fill" aria-hidden /> : <r.icon size={16} aria-hidden />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-compact font-semibold text-fg">{r.title}</span>
                    <span className="block truncate text-caption text-muted" title={r.detail}>
                      {r.failed ? 'No se pudo leer esta fuente: el conteo puede estar incompleto' : done ? 'Sin pendientes' : `${r.detail} · ${r.action}`}
                    </span>
                  </span>
                  <span className={`text-h3 tabular-nums ${done ? 'text-muted' : 'text-fg'}`}>
                    {r.count == null ? '—' : formatNumber(r.count)}
                    <span className="sr-only">{done ? ' (resuelto)' : ' pendientes'}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PanelCard>
  );
}

