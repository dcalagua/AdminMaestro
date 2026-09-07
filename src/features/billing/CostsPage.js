import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCostEntries, useProductMargin, usePartnerMargin, useTenantMargin } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { SectionTabs } from '@/components/ui/SectionTabs';
import { PageContainer, Card, DataTable, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatMoney, formatDate, formatPercent } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
/**
 * Costos y margen.
 *
 * Fórmula única, documentada en docs/finance/COST_MARGIN_MODEL.md:
 *   margen bruto = ingreso COBRADO − costo directo − comisión
 *
 * "Cobrado", no "facturado": una factura emitida y no pagada no es margen.
 */
export function CostsPage() {
    const costs = useCostEntries();
    const byProduct = useProductMargin();
    const byPartner = usePartnerMargin();
    const byTenant = useTenantMargin();
    const { term, setTerm, filtered } = useSearchFilter(costs.data, (c) => [
        c.description, c.vendor, c.category,
    ]);
    const totalCost = (costs.data ?? []).reduce((s, c) => s + Number(c.amount), 0);
    const totalMargin = (byProduct.data ?? []).reduce((s, p) => s + Number(p.gross_margin), 0);
    const totalRevenue = (byProduct.data ?? []).reduce((s, p) => s + Number(p.collected_revenue), 0);
    return (_jsxs(PageContainer, { title: "Costos y margen", description: "margen bruto = ingreso cobrado \u2212 costo directo \u2212 comisi\u00F3n. Los agregados van por moneda: no se convierte con un tipo de cambio impl\u00EDcito.", children: [_jsxs("div", { className: "mb-4 grid gap-3 sm:grid-cols-4", children: [_jsx(StatCard, { label: "Costo registrado", value: formatMoney(totalCost), tone: "warn" }), _jsx(StatCard, { label: "Ingreso cobrado", value: formatMoney(totalRevenue) }), _jsx(StatCard, { label: "Margen bruto", value: formatMoney(totalMargin), tone: totalMargin >= 0 ? 'ok' : 'danger' }), _jsx(StatCard, { label: "Margen sobre cobrado", value: totalRevenue > 0 ? formatPercent(totalMargin / totalRevenue) : '—', tone: totalMargin >= 0 ? 'ok' : 'danger' })] }), _jsx(SectionTabs, { tabs: [
                    {
                        id: 'by-product',
                        label: 'Por producto',
                        content: (_jsx(Card, { children: byProduct.isLoading ? (_jsx(LoadingState, {})) : (byProduct.data ?? []).length === 0 ? (_jsx(EmptyState, { title: "Sin datos" })) : (_jsx(DataTable, { columns: ['Producto', 'MRR', 'ARR', 'Cobrado recurrente', 'Cobrado one-time', 'Costo', 'Comisión', 'Margen'], children: (byProduct.data ?? []).map((r) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-semibold", children: r.short_name }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(r.mrr), r.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(r.arr), r.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(r.collected_recurring), r.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums text-muted", children: formatMoney(Number(r.collected_one_time), r.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums text-warn", children: formatMoney(Number(r.direct_cost), r.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(r.commission_total), r.currency ?? 'USD') }), _jsx("td", { className: `ebim-td tabular-nums font-semibold ${Number(r.gross_margin) >= 0 ? 'text-ok' : 'text-danger'}`, children: formatMoney(Number(r.gross_margin), r.currency ?? 'USD') })] }, r.saas_product_id))) })) })),
                    },
                    {
                        id: 'by-partner',
                        label: 'Por partner',
                        content: (_jsx(Card, { children: (byPartner.data ?? []).length === 0 ? (_jsx(EmptyState, { title: "Sin partners con margen calculable" })) : (_jsx(DataTable, { columns: ['Partner', 'Tenants', 'MRR', 'Cobrado', 'Costo', 'Comisión', 'Margen'], children: (byPartner.data ?? []).map((r) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-semibold", children: r.display_name }), _jsx("td", { className: "ebim-td tabular-nums", children: Number(r.managed_tenants) }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(r.mrr), r.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(r.collected_revenue), r.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums text-warn", children: formatMoney(Number(r.direct_cost), r.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(r.commission_total), r.currency ?? 'USD') }), _jsx("td", { className: `ebim-td tabular-nums font-semibold ${Number(r.gross_margin) >= 0 ? 'text-ok' : 'text-danger'}`, children: formatMoney(Number(r.gross_margin), r.currency ?? 'USD') })] }, r.organization_id))) })) })),
                    },
                    {
                        id: 'by-tenant',
                        label: 'Por tenant',
                        content: (_jsx(Card, { children: (byTenant.data ?? []).length === 0 ? (_jsx(EmptyState, { title: "Sin tenants con margen calculable" })) : (_jsx(DataTable, { columns: ['Tenant', 'Producto', 'Modelo', 'MRR', 'Cobrado', 'Costo', 'Comisión', 'Margen'], children: (byTenant.data ?? []).map((r) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-semibold", children: r.name }), _jsx("td", { className: "ebim-td", children: r.product_code }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "accent", children: DEPLOYMENT_MODE_LABEL[r.deployment_mode] }) }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(r.mrr), r.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(r.collected_revenue), r.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums text-warn", children: formatMoney(Number(r.direct_cost), r.currency ?? 'USD') }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(r.commission_total), r.currency ?? 'USD') }), _jsx("td", { className: `ebim-td tabular-nums font-semibold ${Number(r.gross_margin) >= 0 ? 'text-ok' : 'text-danger'}`, children: formatMoney(Number(r.gross_margin), r.currency ?? 'USD') })] }, r.tenant_id))) })) })),
                    },
                    {
                        id: 'entries',
                        label: 'Costos registrados',
                        content: (_jsxs(Card, { description: "Un costo compartido se reparte con una regla EXPL\u00CDCITA (weight), nunca con un prorrateo impl\u00EDcito.", children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar costo por concepto, proveedor o categor\u00EDa\u2026" }), costs.isLoading ? (_jsx(LoadingState, {})) : costs.error ? (_jsx(ErrorState, { error: costs.error })) : filtered.length === 0 ? (_jsx(EmptyState, { title: "Sin costos registrados" })) : (_jsx(DataTable, { columns: ['Concepto', 'Categoría', 'Proveedor', 'Periodo', 'Monto', 'Imputación'], children: filtered.map((c) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-medium", children: c.description }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "info", children: c.category }) }), _jsx("td", { className: "ebim-td text-muted", children: c.vendor ?? '—' }), _jsxs("td", { className: "ebim-td text-xs text-muted", children: [formatDate(c.period_start), " \u2192 ", formatDate(c.period_end)] }), _jsx("td", { className: "ebim-td tabular-nums font-semibold", children: formatMoney(Number(c.amount), c.currency) }), _jsx("td", { className: "ebim-td text-xs", children: (c.cost_allocations ?? []).map((a) => (_jsxs("div", { className: "text-muted", children: [a.scope, a.saas_products ? ` · ${a.saas_products.short_name}` : '', a.tenants ? ` · ${a.tenants.name}` : '', a.deployment_targets ? ` · ${a.deployment_targets.code}` : '', Number(a.weight) < 1 ? ` (${formatPercent(Number(a.weight), 0)})` : ''] }, a.id))) })] }, c.id))) }))] })),
                    },
                ] })] }));
}
