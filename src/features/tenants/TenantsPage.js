import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTenantOverview } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, StatCard, } from '@/components/ui/primitives';
import { formatMoney, formatNumber } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL, TENANT_STATUS_LABEL } from '@/types/domain';
/**
 * Listado de tenants.
 *
 * Un solo buscador general + tabs de estado (contrato §8): nada de paneles con
 * dropdowns de producto/partner/modelo/estado. El buscador cubre producto,
 * cliente, partner y slug a la vez.
 */
export function TenantsPage() {
    const tenants = useTenantOverview();
    const [tab, setTab] = useState('ALL');
    const { term, setTerm, filtered } = useSearchFilter(tenants.data, (t) => [
        t.name, t.slug, t.customer_name, t.managing_name, t.product_short_name,
        t.deployment_mode, t.tenant_type, t.admin_email,
    ]);
    const rows = filtered.filter((t) => {
        switch (tab) {
            case 'PRODUCTION': return t.tenant_type === 'PRODUCTION';
            case 'DEMO_TRIAL': return t.tenant_type === 'DEMO' || t.tenant_type === 'TRIAL';
            case 'SHARED': return t.deployment_mode === 'SHARED';
            case 'DEDICATED': return t.deployment_mode !== 'SHARED';
            default: return true;
        }
    });
    const all = tenants.data ?? [];
    const totalMrr = all.reduce((sum, t) => sum + Number(t.mrr ?? 0), 0);
    return (_jsxs(PageContainer, { title: "Tenants", description: "Cada tenant pertenece a UN producto SaaS. D\u00F3nde vive f\u00EDsicamente lo decide su deployment mode, no su jerarqu\u00EDa comercial.", children: [_jsxs("div", { className: "mb-4 grid gap-3 sm:grid-cols-4", children: [_jsx(StatCard, { label: "Total de tenants", value: formatNumber(all.length) }), _jsx(StatCard, { label: "Productivos", value: formatNumber(all.filter((t) => t.tenant_type === 'PRODUCTION').length) }), _jsx(StatCard, { label: "Demo / trial", value: formatNumber(all.filter((t) => t.tenant_type === 'DEMO' || t.tenant_type === 'TRIAL').length), hint: "No generan recurrente" }), _jsx(StatCard, { label: "MRR agregado", value: formatMoney(totalMrr), tone: "ok" })] }), _jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar por tenant, cliente, partner, producto o slug\u2026", right: _jsx(StatusTabs, { value: tab, onChange: setTab, options: [
                                { id: 'ALL', label: 'Todos', count: filtered.length },
                                { id: 'PRODUCTION', label: 'Productivos' },
                                { id: 'DEMO_TRIAL', label: 'Demo / Trial' },
                                { id: 'SHARED', label: 'Compartidos' },
                                { id: 'DEDICATED', label: 'Dedicados' },
                            ] }) }), tenants.isLoading ? (_jsx(LoadingState, {})) : tenants.error ? (_jsx(ErrorState, { error: tenants.error, onRetry: () => void tenants.refetch() })) : rows.length === 0 ? (_jsx(EmptyState, { title: "Sin tenants", description: "No hay tenants visibles para tu rol que coincidan con el filtro." })) : (_jsx(DataTable, { columns: ['Tenant', 'Producto', 'Cliente', 'Administra', 'Tipo', 'Modelo', 'Infraestructura', 'MRR', 'Estado'], children: rows.map((t) => (_jsxs("tr", { children: [_jsxs("td", { className: "ebim-td", children: [_jsx(Link, { className: "ebim-link", to: `/tenants/${t.tenant_id}`, children: t.name }), _jsx("div", { className: "font-mono text-xs text-muted", children: t.slug })] }), _jsx("td", { className: "ebim-td", children: t.product_short_name }), _jsx("td", { className: "ebim-td", children: t.customer_name }), _jsx("td", { className: "ebim-td text-muted", children: t.managing_name ?? 'Directo EBIM' }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: t.tenant_type === 'PRODUCTION' ? 'ok' : 'info', children: TENANT_TYPE_LABEL[t.tenant_type] }) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "accent", children: DEPLOYMENT_MODE_LABEL[t.deployment_mode] }) }), _jsx("td", { className: "ebim-td font-mono text-xs text-muted", children: t.deployment_target_code ?? '—' }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(t.mrr), t.currency ?? 'USD') }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: t.status === 'ACTIVE' ? 'ok' : t.status === 'PENDING' ? 'warn' : 'neutral', children: TENANT_STATUS_LABEL[t.status] }) })] }, t.tenant_id))) }))] })] }));
}
