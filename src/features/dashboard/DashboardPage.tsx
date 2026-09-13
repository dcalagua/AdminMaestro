import { useDashboardSummary, useProductMargin, usePartnerMargin, useAttributions, useCommissionEvents } from '@/services/queries';
import { useAuth } from '@/hooks/useAuth';
import {
  PageContainer,
  StatCard,
  Card,
  DataTable,
  LoadingState,
  ErrorState,
  EmptyState,
  Badge,
} from '@/components/ui/primitives';
import { formatMoney, formatCurrencyMap, sumByCurrency, formatNumber, formatDate } from '@/lib/format';
import { COMMISSION_STATUS_LABEL } from '@/types/domain';

/**
 * Dashboard adaptado al perfil (prompt fase 9).
 *
 * Los tres dashboards leen de las MISMAS vistas: la diferencia de contenido no
 * la produce el frontend eligiendo qué pedir, sino RLS filtrando qué devuelve.
 * Por eso un partner que abra esta pantalla ve sus números, no los de EBIM.
 */
export function DashboardPage() {
  const { persona, roles } = useAuth();

  if (persona === 'SALES_AGENT') return <CommercialDashboard />;
  if (persona === 'PARTNER') return <PartnerDashboard orgName={roles?.organizations[0]?.displayName} />;
  return <EbimDashboard />;
}

function EbimDashboard() {
  const summary = useDashboardSummary();
  const margin = useProductMargin();

  if (summary.isLoading) return <LoadingState label="Calculando indicadores…" />;
  if (summary.error) return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;

  const s = summary.data!;

  return (
    <PageContainer
      title="Dashboard EBIM"
      description="Estado de la suite: catálogo, cuentas, recurrente, cobros, costos y comisiones."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="SaaS activos" value={formatNumber(s.active_products)} />
        <StatCard label="Organizaciones" value={formatNumber(s.organizations)} hint={`${s.partners} partners · ${s.customers} clientes`} />
        <StatCard label="Tenants productivos" value={formatNumber(s.production_tenants)} />
        <StatCard label="Demos y trials" value={formatNumber(s.demo_trial_tenants)} hint="No generan recurrente" />

        <StatCard label="MRR" value={formatCurrencyMap(s.mrr_by_currency)} tone="ok" hint="Sólo suscripciones activas" />
        <StatCard
          label="ARR estimado"
          value={formatCurrencyMap(
            Object.fromEntries(
              Object.entries(s.mrr_by_currency).map(([currency, value]) => [currency, Number(value) * 12]),
            ),
          )}
          hint="MRR × 12"
        />
        <StatCard label="Ingreso cobrado" value={formatCurrencyMap(s.collected_by_currency)} hint="Excluye DRAFT y VOID" />
        <StatCard label="Costo de infraestructura" value={formatCurrencyMap(s.cost_by_currency)} tone="warn" />

        <StatCard label="Comisión pendiente" value={formatCurrencyMap(s.commission_pending_by_currency)} tone="warn" hint="Elegible + devengada · por moneda" />
        <StatCard label="Comisión pagada" value={formatCurrencyMap(s.commission_paid_by_currency)} />
        <StatCard
          label="Provisioning fallido"
          value={formatNumber(s.provisioning_failures)}
          tone={s.provisioning_failures > 0 ? 'danger' : 'ok'}
        />
        <StatCard
          label="Tenants por modelo"
          value={Object.values(s.tenants_by_mode).join(' / ') || '—'}
          hint={Object.keys(s.tenants_by_mode).join(' / ') || 'Sin datos'}
        />
      </div>

      <div className="mt-5">
        <Card
          title="Margen por producto SaaS"
          description="margen bruto = ingreso cobrado − costo directo − comisión. Ingreso COBRADO, no facturado."
        >
          {margin.isLoading ? (
            <LoadingState />
          ) : margin.error ? (
            <ErrorState error={margin.error} />
          ) : margin.data && margin.data.length > 0 ? (
            <DataTable columns={['Producto', 'MRR', 'ARR', 'Cobrado', 'Costo directo', 'Comisión', 'Margen bruto']}>
              {margin.data.map((row) => (
                <tr key={row.saas_product_id as string}>
                  <td className="ebim-td font-semibold">{row.short_name}</td>
                  <td className="ebim-td tabular-nums">{formatMoney(Number(row.mrr), row.currency)}</td>
                  <td className="ebim-td tabular-nums">{formatMoney(Number(row.arr), row.currency)}</td>
                  <td className="ebim-td tabular-nums">{formatMoney(Number(row.collected_revenue), row.currency)}</td>
                  <td className="ebim-td tabular-nums text-warn">{formatMoney(Number(row.direct_cost), row.currency)}</td>
                  <td className="ebim-td tabular-nums">{formatMoney(Number(row.commission_total), row.currency)}</td>
                  <td className={`ebim-td tabular-nums font-semibold ${Number(row.gross_margin) >= 0 ? 'text-ok' : 'text-danger'}`}>
                    {formatMoney(Number(row.gross_margin), row.currency)}
                  </td>
                </tr>
              ))}
            </DataTable>
          ) : (
            <EmptyState title="Sin datos de margen" description="Aún no hay cobros ni costos registrados." />
          )}
        </Card>
      </div>
    </PageContainer>
  );
}

function PartnerDashboard({ orgName }: { orgName?: string }) {
  const summary = useDashboardSummary();
  const margin = usePartnerMargin();

  if (summary.isLoading) return <LoadingState />;
  if (summary.error) return <ErrorState error={summary.error} />;

  const s = summary.data!;

  return (
    <PageContainer
      title={`Dashboard · ${orgName ?? 'Partner'}`}
      description="Tus productos autorizados, los tenants que administras y tu margen visible."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tenants que administras" value={formatNumber(s.production_tenants)} />
        <StatCard label="Demos y trials" value={formatNumber(s.demo_trial_tenants)} />
        <StatCard label="MRR de tu cartera" value={formatCurrencyMap(s.mrr_by_currency)} tone="ok" />
        <StatCard label="Ingreso cobrado" value={formatCurrencyMap(s.collected_by_currency)} />
      </div>

      <div className="mt-5">
        <Card
          title="Tu margen"
          description="Los costos de infraestructura de EBIM no se exponen al canal: son información interna."
        >
          {margin.isLoading ? (
            <LoadingState />
          ) : margin.data && margin.data.length > 0 ? (
            <DataTable columns={['Organización', 'Tenants', 'MRR', 'Cobrado', 'Comisión', 'Margen']}>
              {margin.data.map((row) => (
                <tr key={row.organization_id as string}>
                  <td className="ebim-td font-semibold">{row.display_name}</td>
                  <td className="ebim-td tabular-nums">{formatNumber(Number(row.managed_tenants))}</td>
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
 * Dashboard del comercial. Muestra SÓLO su dominio comercial.
 * No hay ninguna sección de datos operativos del tenant — y aunque la hubiera,
 * RLS no devolvería nada (regla §2.3, probada en 01_rls_isolation.test.sql).
 */
function CommercialDashboard() {
  const attributions = useAttributions();
  const events = useCommissionEvents();

  const totals = {
    pending: sumByCurrency(
      (events.data ?? []).filter((e) => e.status !== 'PAID' && e.status !== 'VOID'),
      (e) => e.amount, (e) => e.currency,
    ),
    paid: sumByCurrency((events.data ?? []).filter((e) => e.status === 'PAID'), (e) => e.amount, (e) => e.currency),
  };

  return (
    <PageContainer
      title="Mi tablero comercial"
      description="Tus ventas atribuidas y tus comisiones. Esta consola no expone datos operativos de los tenants que vendiste."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Ventas atribuidas" value={formatNumber(attributions.data?.length ?? 0)} />
        <StatCard label="Comisión pendiente" value={formatCurrencyMap(totals.pending)} tone="warn" hint="Por moneda" />
        <StatCard label="Comisión pagada" value={formatCurrencyMap(totals.paid)} tone="ok" hint="Por moneda" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card title="Mis atribuciones">
          {attributions.isLoading ? (
            <LoadingState />
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

        <Card title="Mis comisiones" description="Cada evento nace de un cobro confirmado.">
          {events.isLoading ? (
            <LoadingState />
          ) : events.data && events.data.length > 0 ? (
            <DataTable columns={['Fecha', 'Producto', 'Monto', 'Estado']}>
              {events.data.slice(0, 25).map((e) => (
                <tr key={e.id as string}>
                  <td className="ebim-td text-muted">{formatDate(e.earned_on as string)}</td>
                  <td className="ebim-td">{(e.saas_products as { short_name: string } | null)?.short_name}</td>
                  <td className="ebim-td tabular-nums font-semibold">{formatMoney(Number(e.amount), e.currency)}</td>
                  <td className="ebim-td">
                    <Badge tone={e.status === 'PAID' ? 'ok' : e.status === 'VOID' ? 'danger' : 'warn'}>
                      {COMMISSION_STATUS_LABEL[e.status as keyof typeof COMMISSION_STATUS_LABEL]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </DataTable>
          ) : (
            <EmptyState title="Sin comisiones devengadas" description="Se generan cuando se confirma un cobro de una venta que te está atribuida." />
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
