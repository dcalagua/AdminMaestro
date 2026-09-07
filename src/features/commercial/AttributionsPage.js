import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { useAttributions } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatDate } from '@/lib/format';
/**
 * Atribuciones comerciales.
 *
 * La suma de participaciones vigentes sobre un mismo objeto no puede pasar del
 * 100% — lo valida un trigger en la base, no esta pantalla. Ahí es donde nace
 * la comisión duplicada.
 */
export function AttributionsPage() {
    const attributions = useAttributions();
    const { term, setTerm, filtered } = useSearchFilter(attributions.data, (a) => [
        a.sales_agents?.full_name,
        a.saas_products?.short_name,
        a.tenants?.name,
        a.organizations?.display_name,
        a.source,
    ]);
    return (_jsx(PageContainer, { title: "Atribuciones comerciales", description: "Qui\u00E9n se lleva el cr\u00E9dito de cada venta, con vigencia. Una venta puede repartirse entre varios participantes sin duplicar la comisi\u00F3n.", children: _jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar por comercial, producto, cliente o tenant\u2026" }), attributions.isLoading ? (_jsx(LoadingState, {})) : attributions.error ? (_jsx(ErrorState, { error: attributions.error, onRetry: () => void attributions.refetch() })) : filtered.length === 0 ? (_jsx(EmptyState, { title: "Sin atribuciones", description: "No hay atribuciones visibles para tu rol." })) : (_jsx(DataTable, { columns: ['Comercial', 'Producto', 'Cliente', 'Tenant', 'Canal', '%', 'Plan de comisión', 'Origen', 'Vigencia'], children: filtered.map((a) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-semibold", children: a.sales_agents?.full_name }), _jsx("td", { className: "ebim-td", children: a.saas_products?.short_name }), _jsx("td", { className: "ebim-td", children: a.organizations?.display_name }), _jsx("td", { className: "ebim-td", children: a.tenant_id ? (_jsx(Link, { className: "ebim-link", to: `/tenants/${a.tenant_id}`, children: a.tenants?.name })) : (_jsx("span", { className: "text-muted", children: "\u2014" })) }), _jsx("td", { className: "ebim-td text-muted", children: a.channel_organization_id ? 'Partner' : 'Directo' }), _jsxs("td", { className: "ebim-td tabular-nums font-semibold", children: [(Number(a.attribution_pct) * 100).toFixed(0), "%"] }), _jsx("td", { className: "ebim-td text-muted", children: a.commission_plans?.name ?? 'Sin plan' }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "info", children: a.source }) }), _jsxs("td", { className: "ebim-td text-xs text-muted", children: [formatDate(a.valid_from), " \u2192 ", a.valid_to ? formatDate(a.valid_to) : 'sin fin'] })] }, a.id))) }))] }) }));
}
