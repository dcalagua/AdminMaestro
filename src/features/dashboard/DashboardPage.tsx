import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { hasFinanceView } from '@/app/navigation';
import { useAttributions, usePartnerMargin, useTenantOverview } from '@/services/queries';
import {
  useCollectionsByMonth,
  useCommissionSummary,
  useInvoiceSummary,
  useRenewalPipeline,
} from '@/services/financeRead';
import { PageContainer, Card, DataTable, LoadingState, EmptyState, ErrorState, Badge } from '@/components/ui/primitives';
import { SectionTabs } from '@/components/ui/SectionTabs';
import { fromQuery } from '@/features/executive/dataState';
import { toCurrencyAmounts } from '@/features/executive/reportContext';
import { KPI_DICTIONARY } from '@/features/executive/kpis';
import { KpiCard, CurrencyLines } from '@/features/executive/components/StateView';
import { formatMoney, formatNumber, formatDate } from '@/lib/format';
import { ExecutivePerspective } from './ExecutivePerspective';
import { FinancePerspective } from './FinancePerspective';
import { OperationsPerspective } from './OperationsPerspective';
import { collectedInMonth, monthRange, periodLabel, renewalsInWindow, useReportContextParams } from './executiveData';
import { ExecutivePresentation } from './presentation/ExecutivePresentation';
import { isPresentationParam, PRESENTATION_PARAM } from './presentation/presentationModel';
import { usePrintInLightTheme } from './presentation/theme';

/**
 * Inicio adaptado al perfil.
 *
 * Todas las vistas leen de las MISMAS fuentes: la diferencia de contenido la
 * produce RLS, no el frontend. Las perspectivas Ejecutivo / Finanzas / Operación
 * SaaS son VISTAS de información (spec §4): no son roles ni conceden nada. El
 * personal EBIM con alcance sólo técnico ve únicamente Operación SaaS.
 */
export function DashboardPage() {
  const { persona, roles } = useAuth();
  const [params] = useSearchParams();

  if (persona === 'SALES_AGENT') return <CommercialDashboard />;
  if (persona === 'PARTNER') return <PartnerDashboard orgName={roles?.organizations[0]?.displayName} />;
  if (persona === 'TENANT') return <TenantHome />;
  if (!hasFinanceView(persona, roles)) {
    return (
      <PageContainer title="Resumen de operación SaaS" description="Tu perfil es técnico: ves la operación de los productos que te corresponden, sin información financiera.">
        <OperationsPerspective />
      </PageContainer>
    );
  }
  // Modo presentación (fase 14): solo personal EBIM con vista financiera; para el resto el parámetro no hace nada.
  const canPresent = persona === 'EBIM';
  if (canPresent && isPresentationParam(params.get(PRESENTATION_PARAM))) return <ExecutivePresentation />;
  return <ExecutiveHome canPresent={canPresent} />;
}

function ReportContextBar({ ctx, months, setMonth, setFxDate }: ReturnType<typeof useReportContextParams>) {
  return (
    <section
      aria-label="Contexto del reporte"
      className="ebim-card mb-4 flex flex-wrap items-end gap-x-6 gap-y-3 px-4 py-3 text-sm"
    >
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Período de operaciones</span>
        <select className="ebim-input h-9 min-w-[190px]" value={ctx.period.start.slice(0, 7)} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m, i) => (
            <option key={m} value={m}>
              {m}
              {i === 0 ? ' (mes en curso)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Fecha de tipo de cambio</span>
        <input type="date" className="ebim-input h-9" value={ctx.fxDate} onChange={(e) => e.target.value && setFxDate(e.target.value)} />
      </label>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
        <div>
          <dt className="inline">Movimientos: </dt>
          <dd className="inline font-semibold text-fg">{periodLabel(ctx)}</dd>
        </div>
        <div>
          <dt className="inline">Foto actual (MRR, saldo, antigüedad): </dt>
          <dd className="inline font-semibold text-fg">{formatDate(ctx.snapshotDate)}</dd>
        </div>
        <div>
          <dt className="inline">Monedas: </dt>
          <dd className="inline font-semibold text-fg">nativas, sin sumar entre sí</dd>
        </div>
      </dl>
    </section>
  );
}

function ExecutiveHome({ canPresent }: { canPresent: boolean }) {
  usePrintInLightTheme();
  return (
    <PageContainer
      title="Resumen ejecutivo"
      description="Cuánto factura el negocio, si crece, de dónde viene el crecimiento, si se cobra y qué requiere atención. Cada cifra abre el detalle que la compone."
    >
      <SectionTabs
        tabs={[
          { id: 'ejecutivo', label: 'Ejecutivo', content: <ExecutivePerspective canPresent={canPresent} /> },
          { id: 'finanzas', label: 'Finanzas', content: <FinanceTab /> },
          { id: 'operacion', label: 'Operación SaaS', content: <OperationsPerspective /> },
        ]}
      />
    </PageContainer>
  );
}

/** Finanzas conserva su contexto de período y fecha FX (movimientos en moneda nativa). */
function FinanceTab() {
  const report = useReportContextParams();
  return (
    <>
      <ReportContextBar {...report} />
      <FinancePerspective ctx={report.ctx} />
    </>
  );
}

/**
 * Partner: su cartera, con las mismas lecturas (RLS limita a lo suyo). No hay
 * margen «EBIM» ni costos internos: el margen del canal sale de v_partner_margin.
 */
function PartnerDashboard({ orgName }: { orgName?: string }) {
  const report = useReportContextParams();
  const { ctx } = report;
  const month = ctx.period.start.slice(0, 7);
  const invoices = useInvoiceSummary({ search: '', filter: 'ALL' });
  const collections = useCollectionsByMonth(ctx.period.start, ctx.period.end);
  const renewals = useRenewalPipeline();
  const margin = usePartnerMargin();
  const win = renewals.data ? renewalsInWindow(renewals.data, 30) : null;

  return (
    <PageContainer
      title={`Tu cartera · ${orgName ?? 'Partner'}`}
      description="Clientes y contratos de tu canal. Los costos internos de EBIM no se exponen al canal."
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          id="K02"
          label={KPI_DICTIONARY.K02.name}
          temporality={periodLabel(ctx)}
          state={fromQuery(collections, { isEmpty: () => false })}
          render={() => <CurrencyLines amounts={collectedInMonth(collections.data ?? [], month)} emptyLabel="Sin cobros confirmados" />}
          detailHref={`/billing?desde=${monthRange(month).from}&hasta=${monthRange(month).to}#cobros`}
        />
        <KpiCard
          id="K03"
          label={KPI_DICTIONARY.K03.name}
          temporality="Foto actual"
          state={fromQuery(invoices, { isEmpty: () => false })}
          render={() => <CurrencyLines amounts={toCurrencyAmounts(invoices.data?.receivable)} emptyLabel="Sin saldo pendiente" />}
          detailHref="/billing?estado=OPEN"
        />
        <KpiCard
          id="K04"
          label={KPI_DICTIONARY.K04.name}
          temporality="Foto actual"
          state={fromQuery(invoices, { isEmpty: () => false })}
          render={() => <CurrencyLines amounts={toCurrencyAmounts(invoices.data?.overdue)} emptyLabel="Sin cartera vencida" />}
          detailHref="/billing?estado=OPEN&antiguedad=VENCIDA"
        />
        <KpiCard
          id="K06"
          label={KPI_DICTIONARY.K06.name}
          temporality="Próximos 30 días"
          state={fromQuery(renewals, { isEmpty: () => false })}
          render={() => (win ? <p className="tabular-nums">{formatNumber(win.count)} contratos</p> : null)}
          detailHref="/renewals"
        />
      </div>

      <div className="mt-5">
        <Card title="Margen de tu canal" description="Cobrado − comisión dentro de tu cartera, por moneda. Los costos internos de EBIM no se incluyen.">
          {margin.isLoading ? (
            <LoadingState />
          ) : margin.error ? (
            <ErrorState error={margin.error} onRetry={() => void margin.refetch()} />
          ) : margin.data && margin.data.length > 0 ? (
            <DataTable columns={['Organización', 'Tenants', 'Moneda', 'MRR vigente', 'Cobrado', 'Comisión', 'Margen']}>
              {margin.data.map((row) => (
                <tr key={`${row.organization_id as string}-${row.currency ?? 'x'}`}>
                  <td className="ebim-td font-semibold">
                    <Link className="ebim-link" to={`/organizations/${row.organization_id as string}`}>{row.display_name}</Link>
                  </td>
                  <td className="ebim-td tabular-nums">{formatNumber(Number(row.managed_tenants))}</td>
                  <td className="ebim-td">{row.currency ?? '—'}</td>
                  <td className="ebim-td tabular-nums">{formatMoney(Number(row.mrr), row.currency)}</td>
                  <td className="ebim-td tabular-nums">{formatMoney(Number(row.collected_revenue), row.currency)}</td>
                  <td className="ebim-td tabular-nums">{formatMoney(Number(row.commission_total), row.currency)}</td>
                  <td className="ebim-td tabular-nums font-semibold">{formatMoney(Number(row.gross_margin), row.currency)}</td>
                </tr>
              ))}
            </DataTable>
          ) : (
            <EmptyState title="Sin margen calculable todavía" description="Aparecerá cuando existan cobros sobre tus tenants." />
          )}
        </Card>
      </div>
    </PageContainer>
  );
}

/**
 * Comercial: SÓLO su dominio. Totales del servidor (v_commission_detail, RLS
 * acotada al comercial): pendiente = elegible + devengada; «en espera» aparte.
 */
function CommercialDashboard() {
  const attributions = useAttributions();
  const summary = useCommissionSummary({ search: '', filter: 'ALL' });
  const state = fromQuery(summary, { isEmpty: () => false });
  const waiting = toCurrencyAmounts(summary.data?.by_status?.PENDING);

  return (
    <PageContainer
      title="Mi tablero comercial"
      description="Tus ventas atribuidas y tus comisiones. Esta consola no expone datos operativos de los tenants que vendiste."
    >
      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard
          id="attr"
          label="Ventas atribuidas"
          temporality="Vigentes y pasadas"
          state={fromQuery(attributions, { isEmpty: () => false })}
          render={() => <p className="tabular-nums">{formatNumber(attributions.data?.length ?? 0)}</p>}
          detailHref="/attributions"
        />
        <KpiCard
          id="pending"
          label="Comisión pendiente"
          temporality="Elegible + devengada"
          state={state}
          render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.pending)} emptyLabel="Sin pendiente" />}
          hint={Object.keys(waiting).length ? `En espera de cobro: ${Object.entries(waiting).map(([c, v]) => formatMoney(v, c)).join(' · ')}` : undefined}
          detailHref="/commissions?estado=PENDING"
        />
        <KpiCard
          id="paid"
          label="Comisión pagada"
          temporality="Acumulada"
          state={state}
          render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.paid)} emptyLabel="Sin pagos" />}
          detailHref="/commissions?estado=PAID"
        />
      </div>

      <div className="mt-5">
        <Card title="Mis atribuciones">
          {attributions.isLoading ? (
            <LoadingState />
          ) : attributions.error ? (
            <ErrorState error={attributions.error} onRetry={() => void attributions.refetch()} />
          ) : attributions.data && attributions.data.length > 0 ? (
            <DataTable columns={['Producto', 'Cliente', 'Tenant', '%', 'Desde']}>
              {attributions.data.map((a) => (
                <tr key={a.id as string}>
                  <td className="ebim-td">{(a.saas_products as { short_name: string } | null)?.short_name}</td>
                  <td className="ebim-td">{(a.organizations as { display_name: string } | null)?.display_name}</td>
                  <td className="ebim-td text-muted">{(a.tenants as { name: string } | null)?.name ?? '—'}</td>
                  <td className="ebim-td tabular-nums">{(Number(a.attribution_pct) * 100).toFixed(0)}%</td>
                  <td className="ebim-td text-muted">{formatDate(a.valid_from as string)}</td>
                </tr>
              ))}
            </DataTable>
          ) : (
            <EmptyState title="Aún no tienes atribuciones" />
          )}
        </Card>
      </div>
    </PageContainer>
  );
}

/** Usuario de tenant: sus cuentas; sin administración corporativa. */
function TenantHome() {
  const tenants = useTenantOverview();
  return (
    <PageContainer title="Mi cuenta" description="Los espacios de trabajo (tenants) a los que tienes acceso.">
      <Card>
        {tenants.isLoading ? (
          <LoadingState />
        ) : tenants.error ? (
          <ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} />
        ) : (tenants.data ?? []).length === 0 ? (
          <EmptyState title="Sin tenants visibles" />
        ) : (
          <DataTable columns={['Tenant', 'Producto', 'Estado']}>
            {tenants.data!.map((t) => (
              <tr key={t.tenant_id as string}>
                <td className="ebim-td font-semibold">
                  <Link className="ebim-link" to={`/tenants/${t.tenant_id as string}`}>{t.name}</Link>
                </td>
                <td className="ebim-td">{t.product_short_name}</td>
                <td className="ebim-td"><Badge>{t.status as string}</Badge></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </PageContainer>
  );
}
