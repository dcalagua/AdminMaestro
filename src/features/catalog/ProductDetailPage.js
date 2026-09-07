import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useParams } from 'react-router-dom';
import { useProduct, useTenantOverview, useOrganizationAgreements, usePlans } from '@/services/queries';
import { SectionTabs } from '@/components/ui/SectionTabs';
import { PageContainer, Card, DataTable, LoadingState, ErrorState, EmptyState, Badge, StatCard, } from '@/components/ui/primitives';
import { formatMoney, formatPercent, formatNumber } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL } from '@/types/domain';
export function ProductDetailPage() {
    const { productId } = useParams();
    const product = useProduct(productId);
    const tenants = useTenantOverview();
    const agreements = useOrganizationAgreements();
    const plans = usePlans();
    if (product.isLoading)
        return _jsx(LoadingState, {});
    if (product.error)
        return _jsx(ErrorState, { error: product.error });
    if (!product.data) {
        return (_jsx(PageContainer, { title: "Producto no encontrado", children: _jsx(Card, { children: _jsx(EmptyState, { title: "No existe ese producto", description: "Puede haber sido archivado o no tienes acceso." }) }) }));
    }
    const p = product.data;
    const productTenants = (tenants.data ?? []).filter((t) => t.saas_product_id === p.id);
    const productAgreements = (agreements.data ?? []).filter((a) => a.saas_product_id === p.id);
    const productPlans = (plans.data ?? []).filter((pl) => pl.saas_product_id === p.id);
    return (_jsxs(PageContainer, { title: p.lockup_name ?? p.name, description: p.description ?? undefined, breadcrumbs: _jsx(Link, { className: "text-xs text-muted hover:text-fg", to: "/products", children: "\u2190 SaaS Products" }), children: [_jsxs("div", { className: "mb-5 grid gap-3 sm:grid-cols-4", children: [_jsx(StatCard, { label: "Tenants", value: formatNumber(productTenants.length) }), _jsx(StatCard, { label: "Organizaciones habilitadas", value: formatNumber(productAgreements.length) }), _jsx(StatCard, { label: "Planes", value: formatNumber(productPlans.length) }), _jsx(StatCard, { label: "Unidad de cobro", value: p.billing_unit })] }), _jsx(SectionTabs, { tabs: [
                    {
                        id: 'tenants',
                        label: 'Tenants',
                        content: (_jsx(Card, { children: productTenants.length === 0 ? (_jsx(EmptyState, { title: "Sin tenants para este producto" })) : (_jsx(DataTable, { columns: ['Tenant', 'Cliente', 'Partner', 'Tipo', 'Modelo', 'Estado'], children: productTenants.map((t) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td", children: _jsx(Link, { className: "ebim-link", to: `/tenants/${t.tenant_id}`, children: t.name }) }), _jsx("td", { className: "ebim-td", children: t.customer_name }), _jsx("td", { className: "ebim-td text-muted", children: t.managing_name ?? 'Directo EBIM' }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: t.tenant_type === 'PRODUCTION' ? 'ok' : 'info', children: TENANT_TYPE_LABEL[t.tenant_type] }) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "accent", children: DEPLOYMENT_MODE_LABEL[t.deployment_mode] }) }), _jsx("td", { className: "ebim-td text-muted", children: t.status })] }, t.tenant_id))) })) })),
                    },
                    {
                        id: 'partners',
                        label: 'Organizaciones habilitadas',
                        content: (_jsx(Card, { description: "Un partner puede vender varios SaaS con condiciones DISTINTAS por producto.", children: productAgreements.length === 0 ? (_jsx(EmptyState, { title: "Ninguna organizaci\u00F3n habilitada", description: "Nadie puede comercializar este producto todav\u00EDa." })) : (_jsx(DataTable, { columns: ['Organización', 'Puede revender', 'Administra tenants', 'Margen', 'Modelo por defecto'], children: productAgreements.map((a) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-semibold", children: a.organizations?.display_name }), _jsx("td", { className: "ebim-td", children: a.can_resell ? 'Sí' : 'No' }), _jsx("td", { className: "ebim-td", children: a.can_manage_tenants ? 'Sí' : 'No' }), _jsx("td", { className: "ebim-td tabular-nums", children: formatPercent(Number(a.margin_rate)) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "accent", children: DEPLOYMENT_MODE_LABEL[a.default_deployment_mode] }) })] }, a.id))) })) })),
                    },
                    {
                        id: 'plans',
                        label: 'Planes',
                        content: (_jsx(Card, { children: productPlans.length === 0 ? (_jsx(EmptyState, { title: "Sin planes definidos" })) : (_jsx(DataTable, { columns: ['Plan', 'Modelo', 'Sociedades incluidas', 'Precios vigentes'], children: productPlans.map((pl) => (_jsxs("tr", { children: [_jsxs("td", { className: "ebim-td", children: [_jsx("div", { className: "font-semibold", children: pl.name }), _jsx("div", { className: "text-xs text-muted", children: pl.description })] }), _jsx("td", { className: "ebim-td", children: pl.deployment_mode
                                                ? DEPLOYMENT_MODE_LABEL[pl.deployment_mode]
                                                : 'Cualquiera' }), _jsx("td", { className: "ebim-td tabular-nums", children: pl.included_companies }), _jsx("td", { className: "ebim-td", children: _jsx("div", { className: "space-y-0.5", children: (pl.plan_prices ?? [])
                                                    .filter((pr) => !pr.valid_to)
                                                    .map((pr) => (_jsxs("div", { className: "text-xs", children: [_jsxs("span", { className: "text-muted", children: [pr.charge_kind, ":"] }), ' ', _jsx("span", { className: "font-semibold tabular-nums", children: formatMoney(Number(pr.amount), pr.currency) }), _jsxs("span", { className: "text-muted", children: [" / ", pr.billing_interval] })] }, pr.id))) }) })] }, pl.id))) })) })),
                    },
                ] })] }));
}
