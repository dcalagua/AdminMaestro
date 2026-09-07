import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { useOrganizations } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { useState } from 'react';
const CAPABILITY_LABEL = {
    PARTNER: 'Partner',
    RESELLER: 'Reseller',
    CONSULTING: 'Consultora',
    CUSTOMER: 'Cliente',
};
/**
 * Listado de organizaciones.
 *
 * Una organización no tiene un "tipo": acumula CAPACIDADES. Consultora Andina
 * aparece como Partner + Consultora + Cliente en la misma fila, sin duplicar la
 * cuenta (D-006).
 */
export function OrganizationsPage({ capabilityFilter, title, description, } = {}) {
    const orgs = useOrganizations();
    const [tab, setTab] = useState(capabilityFilter ?? 'ALL');
    const { term, setTerm, filtered } = useSearchFilter(orgs.data, (o) => [
        o.display_name, o.legal_name, o.slug, o.tax_id, o.country_code,
    ]);
    const byCapability = filtered.filter((o) => {
        if (tab === 'ALL')
            return true;
        const caps = (o.organization_capabilities ?? []).map((c) => c.capability);
        if (tab === 'PARTNER')
            return caps.some((c) => ['PARTNER', 'RESELLER', 'CONSULTING'].includes(c));
        return caps.includes('CUSTOMER');
    });
    return (_jsx(PageContainer, { title: title ?? 'Organizaciones', description: description ??
            'Cuentas de la plataforma. Una organización puede ser partner y cliente a la vez: las capacidades son acumulativas.', children: _jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar por nombre, RUC/NIT o pa\u00EDs\u2026", right: capabilityFilter ? null : (_jsx(StatusTabs, { value: tab, onChange: setTab, options: [
                            { id: 'ALL', label: 'Todas' },
                            { id: 'PARTNER', label: 'Partners' },
                            { id: 'CUSTOMER', label: 'Clientes' },
                        ] })) }), orgs.isLoading ? (_jsx(LoadingState, {})) : orgs.error ? (_jsx(ErrorState, { error: orgs.error, onRetry: () => void orgs.refetch() })) : byCapability.length === 0 ? (_jsx(EmptyState, { title: "Sin organizaciones", description: "No hay organizaciones visibles para tu rol que coincidan con la b\u00FAsqueda." })) : (_jsx(DataTable, { columns: ['Organización', 'País', 'Identificación fiscal', 'Capacidades', 'Estado', ''], children: byCapability.map((o) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td", children: _jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx("span", { className: "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white", style: { background: o.accent_color ?? 'var(--accent2)' }, "aria-hidden": true, children: o.display_name.slice(0, 2).toUpperCase() }), _jsxs("div", { children: [_jsx("div", { className: "font-semibold", children: o.display_name }), _jsx("div", { className: "text-xs text-muted", children: o.legal_name })] })] }) }), _jsx("td", { className: "ebim-td", children: o.country_code }), _jsx("td", { className: "ebim-td font-mono text-xs text-muted", children: o.tax_id ?? '—' }), _jsx("td", { className: "ebim-td", children: _jsxs("div", { className: "flex flex-wrap gap-1", children: [o.kind === 'PLATFORM' ? _jsx(Badge, { tone: "accent", children: "Plataforma" }) : null, (o.organization_capabilities ?? []).map((c) => (_jsx(Badge, { tone: c.capability === 'CUSTOMER' ? 'info' : 'ok', children: CAPABILITY_LABEL[c.capability] ?? c.capability }, c.capability)))] }) }), _jsx("td", { className: "ebim-td text-muted", children: o.status }), _jsx("td", { className: "ebim-td text-right", children: _jsx(Link, { className: "ebim-link text-[13px]", to: `/organizations/${o.id}`, children: "Ver detalle" }) })] }, o.id))) }))] }) }));
}
