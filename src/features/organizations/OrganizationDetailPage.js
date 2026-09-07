import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useParams } from 'react-router-dom';
import { useOrganization, useOrganizationAgreements, useTenantOverview, usePartnerMargin, useSalesAgents, } from '@/services/queries';
import { useAuth } from '@/hooks/useAuth';
import { isFinance } from '@/features/auth/session';
import { SectionTabs } from '@/components/ui/SectionTabs';
import { PageContainer, Card, DataTable, StatCard, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatMoney, formatPercent, formatNumber, formatDate } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL } from '@/types/domain';
/**
 * Detalle de organización, en tabs centrados con deep-link `#hash`
 * (contrato §8 / regla gmao-025).
 */
export function OrganizationDetailPage() {
    const { organizationId } = useParams();
    const { roles } = useAuth();
    const org = useOrganization(organizationId);
    const agreements = useOrganizationAgreements(organizationId);
    const tenants = useTenantOverview();
    const margin = usePartnerMargin();
    const agents = useSalesAgents();
    if (org.isLoading)
        return _jsx(LoadingState, {});
    if (org.error)
        return _jsx(ErrorState, { error: org.error });
    if (!org.data) {
        return (_jsx(PageContainer, { title: "Organizaci\u00F3n no encontrada", children: _jsx(Card, { children: _jsx(EmptyState, { title: "No existe o no tienes acceso", description: "Las pol\u00EDticas RLS impiden ver organizaciones fuera de tu alcance. Esto no es un error de la pantalla." }) }) }));
    }
    const o = org.data;
    const companies = (o.companies ?? []);
    const capabilities = (o.organization_capabilities ?? []).map((c) => c.capability);
    const asCustomer = (tenants.data ?? []).filter((t) => t.customer_organization_id === o.id);
    const asManager = (tenants.data ?? []).filter((t) => t.managing_organization_id === o.id);
    const orgMargin = (margin.data ?? []).find((m) => m.organization_id === o.id);
    const orgAgents = (agents.data ?? []).filter((a) => a.organization_id === o.id);
    return (_jsxs(PageContainer, { title: o.display_name, description: `${o.legal_name} · ${o.country_code}${o.tax_id ? ` · ${o.tax_id}` : ''}`, breadcrumbs: _jsx(Link, { className: "text-xs text-muted hover:text-fg", to: "/organizations", children: "\u2190 Organizaciones" }), actions: _jsx("div", { className: "flex flex-wrap gap-1", children: capabilities.map((c) => (_jsx(Badge, { tone: c === 'CUSTOMER' ? 'info' : 'ok', children: c }, c))) }), children: [_jsxs("div", { className: "mb-5 grid gap-3 sm:grid-cols-4", children: [_jsx(StatCard, { label: "Sociedades", value: formatNumber(companies.length) }), _jsx(StatCard, { label: "Tenants como cliente", value: formatNumber(asCustomer.length) }), _jsx(StatCard, { label: "Tenants que administra", value: formatNumber(asManager.length) }), _jsx(StatCard, { label: "Productos autorizados", value: formatNumber(agreements.data?.length ?? 0) })] }), _jsx(SectionTabs, { tabs: [
                    {
                        id: 'overview',
                        label: 'Resumen',
                        content: (_jsxs("div", { className: "grid gap-4 lg:grid-cols-2", children: [_jsx(Card, { title: "Identidad y marca", description: "Contrato \u00A74.3: interfaz de branding homologada.", children: _jsx("dl", { className: "divide-y divide-border", children: [
                                            ['Slug', o.slug],
                                            ['Brand slug (link de ingreso)', o.brand_slug ? `?t=${o.brand_slug}` : '—'],
                                            ['Color de acento', o.accent_color ?? 'Hereda de EBIM'],
                                            ['Marca blanca', o.white_label ? 'Sí' : 'No'],
                                            ['Correo de facturación', o.billing_email ?? '—'],
                                        ].map(([k, v]) => (_jsxs("div", { className: "flex justify-between gap-4 px-4 py-2.5 text-sm", children: [_jsx("dt", { className: "text-muted", children: k }), _jsx("dd", { className: "text-right font-medium", children: v })] }, k))) }) }), _jsx(Card, { title: "Sociedades", description: "Contrato \u00A73.1: multipa\u00EDs dentro de la misma cuenta.", children: companies.length === 0 ? (_jsx(EmptyState, { title: "Sin sociedades registradas" })) : (_jsx(DataTable, { columns: ['Sociedad', 'País', 'Moneda', 'ERP code'], children: companies.map((c) => (_jsxs("tr", { children: [_jsxs("td", { className: "ebim-td font-semibold", children: [c.name, c.is_default ? _jsx(Badge, { tone: "accent", children: "Principal" }) : null] }), _jsx("td", { className: "ebim-td", children: c.country_code }), _jsx("td", { className: "ebim-td", children: c.currency }), _jsx("td", { className: "ebim-td font-mono text-xs text-muted", children: c.erp_code ?? '—' })] }, c.id))) })) })] })),
                    },
                    {
                        id: 'products',
                        label: 'Productos autorizados',
                        content: (_jsx(Card, { description: "Un partner multi-SaaS tiene condiciones potencialmente distintas por producto (contrato \u00A711.1).", children: (agreements.data ?? []).length === 0 ? (_jsx(EmptyState, { title: "Sin acuerdos de producto", description: "Esta organizaci\u00F3n no est\u00E1 habilitada para comercializar ning\u00FAn SaaS." })) : (_jsx(DataTable, { columns: ['Producto', 'Revende', 'Administra', 'Margen', 'Modelo por defecto', 'Vigencia'], children: (agreements.data ?? []).map((a) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-semibold", children: a.saas_products?.lockup_name }), _jsx("td", { className: "ebim-td", children: a.can_resell ? 'Sí' : 'No' }), _jsx("td", { className: "ebim-td", children: a.can_manage_tenants ? 'Sí' : 'No' }), _jsx("td", { className: "ebim-td tabular-nums font-semibold", children: formatPercent(Number(a.margin_rate)) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "accent", children: DEPLOYMENT_MODE_LABEL[a.default_deployment_mode] }) }), _jsxs("td", { className: "ebim-td text-xs text-muted", children: [formatDate(a.valid_from), " \u2192 ", a.valid_to ? formatDate(a.valid_to) : 'sin fin'] })] }, a.id))) })) })),
                    },
                    {
                        id: 'tenants',
                        label: 'Tenants',
                        content: (_jsxs("div", { className: "space-y-4", children: [_jsx(TenantTable, { title: "Tenants que administra (como partner)", rows: asManager }), _jsx(TenantTable, { title: "Tenants propios (como cliente)", rows: asCustomer })] })),
                    },
                    {
                        id: 'commercials',
                        label: 'Comerciales',
                        content: (_jsx(Card, { description: "Comerciales afiliados a esta organizaci\u00F3n.", children: orgAgents.length === 0 ? (_jsx(EmptyState, { title: "Sin comerciales afiliados" })) : (_jsx(DataTable, { columns: ['Comercial', 'Tipo', 'Contacto', 'Estado'], children: orgAgents.map((a) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-semibold", children: a.full_name }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "info", children: a.agent_type }) }), _jsx("td", { className: "ebim-td text-muted", children: a.contact_email ?? '—' }), _jsx("td", { className: "ebim-td", children: a.status })] }, a.id))) })) })),
                    },
                    {
                        id: 'margin',
                        label: 'Margen',
                        // El margen es información financiera: se oculta a quien no debe verla.
                        // Aunque forzara la pestaña, RLS no le devolvería las filas.
                        hidden: !isFinance(roles) && roles?.platformRole !== 'EBIM_PRODUCT_ADMIN',
                        content: (_jsx(Card, { title: "Margen de la organizaci\u00F3n", children: orgMargin ? (_jsxs("div", { className: "grid gap-3 p-4 sm:grid-cols-4", children: [_jsx(StatCard, { label: "MRR", value: formatMoney(Number(orgMargin.mrr), orgMargin.currency ?? 'USD') }), _jsx(StatCard, { label: "Cobrado", value: formatMoney(Number(orgMargin.collected_revenue), orgMargin.currency ?? 'USD') }), _jsx(StatCard, { label: "Costo directo", value: formatMoney(Number(orgMargin.direct_cost), orgMargin.currency ?? 'USD'), tone: "warn" }), _jsx(StatCard, { label: "Margen bruto", value: formatMoney(Number(orgMargin.gross_margin), orgMargin.currency ?? 'USD'), tone: Number(orgMargin.gross_margin) >= 0 ? 'ok' : 'danger' })] })) : (_jsx(EmptyState, { title: "Sin margen calculable", description: "Aparece cuando la organizaci\u00F3n administra tenants con cobros registrados." })) })),
                    },
                ] })] }));
}
function TenantTable({ title, rows }) {
    return (_jsx(Card, { title: title, children: rows.length === 0 ? (_jsx(EmptyState, { title: "Sin tenants en esta categor\u00EDa" })) : (_jsx(DataTable, { columns: ['Tenant', 'Producto', 'Tipo', 'Modelo', 'MRR', 'Estado'], children: rows.map((t) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td", children: _jsx(Link, { className: "ebim-link", to: `/tenants/${t.tenant_id}`, children: t.name }) }), _jsx("td", { className: "ebim-td", children: t.product_short_name }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: t.tenant_type === 'PRODUCTION' ? 'ok' : 'info', children: TENANT_TYPE_LABEL[t.tenant_type] }) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "accent", children: DEPLOYMENT_MODE_LABEL[t.deployment_mode] }) }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(t.mrr), t.currency ?? 'USD') }), _jsx("td", { className: "ebim-td text-muted", children: t.status })] }, t.tenant_id))) })) }));
}
