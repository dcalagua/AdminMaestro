import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useDeploymentTargets } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { Link } from 'react-router-dom';
import { PageContainer, Card, DataTable, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
/**
 * Deployment targets: la infraestructura FÍSICA, desacoplada del tenant lógico.
 *
 * Estas filas contienen SÓLO metadata pública (region, project ref). No hay
 * passwords, service_role keys ni PATs: un trigger en la base rechaza cualquier
 * clave JSONB que huela a credencial.
 */
export function DeploymentsPage() {
    const targets = useDeploymentTargets();
    const { term, setTerm, filtered } = useSearchFilter(targets.data, (t) => [
        t.code, t.name, t.region, t.provider, t.deployment_mode,
        t.organizations?.display_name,
    ]);
    const all = targets.data ?? [];
    const byMode = (mode) => all.filter((t) => t.deployment_mode === mode).length;
    return (_jsxs(PageContainer, { title: "Deployments", description: "D\u00F3nde vive f\u00EDsicamente cada tenant. Un target compartido aloja muchos; uno dedicado de cliente, exactamente uno.", children: [_jsxs("div", { className: "mb-4 grid gap-3 sm:grid-cols-4", children: [_jsx(StatCard, { label: "Targets totales", value: String(all.length) }), _jsx(StatCard, { label: "Compartidos", value: String(byMode('SHARED')) }), _jsx(StatCard, { label: "Dedicados de partner", value: String(byMode('PARTNER_DEDICATED')) }), _jsx(StatCard, { label: "Dedicados de cliente", value: String(byMode('TENANT_DEDICATED')) })] }), _jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar por c\u00F3digo, regi\u00F3n, proveedor u organizaci\u00F3n\u2026" }), targets.isLoading ? (_jsx(LoadingState, {})) : targets.error ? (_jsx(ErrorState, { error: targets.error, onRetry: () => void targets.refetch() })) : filtered.length === 0 ? (_jsx(EmptyState, { title: "Sin deployment targets" })) : (_jsx("div", { className: "divide-y divide-border", children: filtered.map((t) => {
                            const deployments = (t.tenant_deployments ?? []).filter((d) => d.status === 'ACTIVE');
                            return (_jsxs("div", { className: "p-4", children: [_jsxs("div", { className: "mb-2 flex flex-wrap items-center gap-2", children: [_jsx("span", { className: "font-mono text-sm font-bold", children: t.code }), _jsx(Badge, { tone: "accent", children: DEPLOYMENT_MODE_LABEL[t.deployment_mode] }), _jsx(Badge, { tone: "info", children: t.provider }), t.region ? _jsx(Badge, { tone: "neutral", children: t.region }) : null, _jsx(Badge, { tone: t.status === 'ACTIVE' ? 'ok' : 'neutral', children: t.status })] }), _jsx("p", { className: "mb-1 text-sm text-fg", children: t.name }), _jsxs("p", { className: "mb-3 text-xs text-muted", children: [t.owner_organization_id
                                                ? `Dueño: ${t.organizations?.display_name}`
                                                : 'Infraestructura de EBIM (compartida)', t.saas_products ? ` · ${t.saas_products.short_name}` : '', t.cost_center ? ` · centro de costo ${t.cost_center}` : '', ' · ref pública: ', _jsx("span", { className: "font-mono", children: t.provider_project_ref ?? '—' })] }), deployments.length === 0 ? (_jsx("p", { className: "text-xs text-muted", children: "Sin tenants asignados." })) : (_jsx("div", { className: "rounded-card border border-border", children: _jsx(DataTable, { columns: [`Tenants alojados (${deployments.length})`, 'Slug', 'Estado'], children: deployments.map((d) => {
                                                const tenant = d.tenants;
                                                return (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td", children: _jsx(Link, { className: "ebim-link", to: `/tenants/${d.tenant_id}`, children: tenant?.name }) }), _jsx("td", { className: "ebim-td font-mono text-xs text-muted", children: tenant?.slug }), _jsx("td", { className: "ebim-td text-muted", children: d.status })] }, d.tenant_id));
                                            }) }) }))] }, t.id));
                        }) }))] })] }));
}
