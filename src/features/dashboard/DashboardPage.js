import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useDashboardSummary, useProductMargin, usePartnerMargin, useAttributions, useCommissionEvents } from '@/services/queries';
import { useAuth } from '@/hooks/useAuth';
import { PageContainer, StatCard, Card, DataTable, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatMoney, formatNumber, formatCurrencyMap, formatDate } from '@/lib/format';
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
    if (persona === 'SALES_AGENT')
        return _jsx(CommercialDashboard, {});
    if (persona === 'PARTNER')
        return _jsx(PartnerDashboard, { orgName: roles?.organizations[0]?.displayName });
    return _jsx(EbimDashboard, {});
}
function EbimDashboard() {
    const summary = useDashboardSummary();
    const margin = useProductMargin();
    if (summary.isLoading)
        return _jsx(LoadingState, { label: "Calculando indicadores\u2026" });
    if (summary.error)
        return _jsx(ErrorState, { error: summary.error, onRetry: () => void summary.refetch() });
    const s = summary.data;
    return (_jsxs(PageContainer, { title: "Dashboard EBIM", description: "Estado de la suite: cat\u00E1logo, cuentas, recurrente, cobros, costos y comisiones.", children: [_jsxs("div", { className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-4", children: [_jsx(StatCard, { label: "SaaS activos", value: formatNumber(s.active_products) }), _jsx(StatCard, { label: "Organizaciones", value: formatNumber(s.organizations), hint: `${s.partners} partners · ${s.customers} clientes` }), _jsx(StatCard, { label: "Tenants productivos", value: formatNumber(s.production_tenants) }), _jsx(StatCard, { label: "Demos y trials", value: formatNumber(s.demo_trial_tenants), hint: "No generan recurrente" }), _jsx(StatCard, { label: "MRR", value: formatCurrencyMap(s.mrr_by_currency), tone: "ok", hint: "S\u00F3lo suscripciones activas" }), _jsx(StatCard, { label: "ARR estimado", value: formatCurrencyMap(Object.fromEntries(Object.entries(s.mrr_by_currency).map(([currency, value]) => [currency, Number(value) * 12]))), hint: "MRR \u00D7 12" }), _jsx(StatCard, { label: "Ingreso cobrado", value: formatCurrencyMap(s.collected_by_currency), hint: "Excluye DRAFT y VOID" }), _jsx(StatCard, { label: "Costo de infraestructura", value: formatCurrencyMap(s.cost_by_currency), tone: "warn" }), _jsx(StatCard, { label: "Comisi\u00F3n pendiente", value: formatMoney(Number(s.commission_pending)), tone: "warn", hint: "Elegible + devengada" }), _jsx(StatCard, { label: "Comisi\u00F3n pagada", value: formatMoney(Number(s.commission_paid)) }), _jsx(StatCard, { label: "Provisioning fallido", value: formatNumber(s.provisioning_failures), tone: s.provisioning_failures > 0 ? 'danger' : 'ok' }), _jsx(StatCard, { label: "Tenants por modelo", value: Object.values(s.tenants_by_mode).join(' / ') || '—', hint: Object.keys(s.tenants_by_mode).join(' / ') || 'Sin datos' })] }), _jsx("div", { className: "mt-5", children: _jsx(Card, { title: "Margen por producto SaaS", description: "margen bruto = ingreso cobrado \u2212 costo directo \u2212 comisi\u00F3n. Ingreso COBRADO, no facturado.", children: margin.isLoading ? (_jsx(LoadingState, {})) : margin.error ? (_jsx(ErrorState, { error: margin.error })) : margin.data && margin.data.length > 0 ? (_jsx(DataTable, { columns: ['Producto', 'MRR', 'ARR', 'Cobrado', 'Costo directo', 'Comisión', 'Margen bruto'], children: margin.data.map((row) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-semibold", children: row.short_name }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(row.mrr), row.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(row.arr), row.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(row.collected_revenue), row.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums text-warn", children: formatMoney(Number(row.direct_cost), row.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(row.commission_total), row.currency ?? 'USD') }), _jsx("td", { className: `ebim-td tabular-nums font-semibold ${Number(row.gross_margin) >= 0 ? 'text-ok' : 'text-danger'}`, children: formatMoney(Number(row.gross_margin), row.currency ?? 'USD') })] }, row.saas_product_id))) })) : (_jsx(EmptyState, { title: "Sin datos de margen", description: "A\u00FAn no hay cobros ni costos registrados." })) }) })] }));
}
function PartnerDashboard({ orgName }) {
    const summary = useDashboardSummary();
    const margin = usePartnerMargin();
    if (summary.isLoading)
        return _jsx(LoadingState, {});
    if (summary.error)
        return _jsx(ErrorState, { error: summary.error });
    const s = summary.data;
    return (_jsxs(PageContainer, { title: `Dashboard · ${orgName ?? 'Partner'}`, description: "Tus productos autorizados, los tenants que administras y tu margen visible.", children: [_jsxs("div", { className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-4", children: [_jsx(StatCard, { label: "Tenants que administras", value: formatNumber(s.production_tenants) }), _jsx(StatCard, { label: "Demos y trials", value: formatNumber(s.demo_trial_tenants) }), _jsx(StatCard, { label: "MRR de tu cartera", value: formatCurrencyMap(s.mrr_by_currency), tone: "ok" }), _jsx(StatCard, { label: "Ingreso cobrado", value: formatCurrencyMap(s.collected_by_currency) })] }), _jsx("div", { className: "mt-5", children: _jsx(Card, { title: "Tu margen", description: "Los costos de infraestructura de EBIM no se exponen al canal: son informaci\u00F3n interna.", children: margin.isLoading ? (_jsx(LoadingState, {})) : margin.data && margin.data.length > 0 ? (_jsx(DataTable, { columns: ['Organización', 'Tenants', 'MRR', 'Cobrado', 'Comisión', 'Margen'], children: margin.data.map((row) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-semibold", children: row.display_name }), _jsx("td", { className: "ebim-td tabular-nums", children: formatNumber(Number(row.managed_tenants)) }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(row.mrr), row.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(row.collected_revenue), row.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(row.commission_total), row.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums font-semibold", children: formatMoney(Number(row.gross_margin), row.currency ?? 'USD') })] }, row.organization_id))) })) : (_jsx(EmptyState, { title: "Sin margen calculable todav\u00EDa", description: "Aparecer\u00E1 cuando existan cobros sobre tus tenants." })) }) })] }));
}
/**
 * Dashboard del comercial. Muestra SÓLO su dominio comercial.
 * No hay ninguna sección de datos operativos del tenant — y aunque la hubiera,
 * RLS no devolvería nada (regla §2.3, probada en 01_rls_isolation.test.sql).
 */
function CommercialDashboard() {
    const attributions = useAttributions();
    const events = useCommissionEvents();
    const totals = (events.data ?? []).reduce((acc, e) => {
        const amount = Number(e.amount);
        if (e.status === 'PAID')
            acc.paid += amount;
        else if (e.status !== 'VOID')
            acc.pending += amount;
        return acc;
    }, { paid: 0, pending: 0 });
    return (_jsxs(PageContainer, { title: "Mi tablero comercial", description: "Tus ventas atribuidas y tus comisiones. Esta consola no expone datos operativos de los tenants que vendiste.", children: [_jsxs("div", { className: "grid gap-3 sm:grid-cols-3", children: [_jsx(StatCard, { label: "Ventas atribuidas", value: formatNumber(attributions.data?.length ?? 0) }), _jsx(StatCard, { label: "Comisi\u00F3n pendiente", value: formatMoney(totals.pending), tone: "warn" }), _jsx(StatCard, { label: "Comisi\u00F3n pagada", value: formatMoney(totals.paid), tone: "ok" })] }), _jsxs("div", { className: "mt-5 grid gap-4 lg:grid-cols-2", children: [_jsx(Card, { title: "Mis atribuciones", children: attributions.isLoading ? (_jsx(LoadingState, {})) : attributions.data && attributions.data.length > 0 ? (_jsx(DataTable, { columns: ['Producto', 'Cliente', 'Tenant', '%', 'Desde'], children: attributions.data.map((a) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td", children: a.saas_products?.short_name }), _jsx("td", { className: "ebim-td", children: a.organizations?.display_name }), _jsx("td", { className: "ebim-td text-muted", children: a.tenants?.name ?? '—' }), _jsxs("td", { className: "ebim-td tabular-nums", children: [(Number(a.attribution_pct) * 100).toFixed(0), "%"] }), _jsx("td", { className: "ebim-td text-muted", children: formatDate(a.valid_from) })] }, a.id))) })) : (_jsx(EmptyState, { title: "A\u00FAn no tienes atribuciones" })) }), _jsx(Card, { title: "Mis comisiones", description: "Cada evento nace de un cobro confirmado.", children: events.isLoading ? (_jsx(LoadingState, {})) : events.data && events.data.length > 0 ? (_jsx(DataTable, { columns: ['Fecha', 'Producto', 'Monto', 'Estado'], children: events.data.slice(0, 25).map((e) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td text-muted", children: formatDate(e.earned_on) }), _jsx("td", { className: "ebim-td", children: e.saas_products?.short_name }), _jsx("td", { className: "ebim-td tabular-nums font-semibold", children: formatMoney(Number(e.amount), e.currency ?? 'USD') }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: e.status === 'PAID' ? 'ok' : e.status === 'VOID' ? 'danger' : 'warn', children: COMMISSION_STATUS_LABEL[e.status] }) })] }, e.id))) })) : (_jsx(EmptyState, { title: "Sin comisiones devengadas", description: "Se generan cuando se confirma un cobro de una venta que te est\u00E1 atribuida." })) })] })] }));
}
