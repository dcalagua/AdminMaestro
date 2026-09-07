import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useSubscriptions } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatMoney, formatDate, formatPercent } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
/**
 * Suscripciones.
 *
 * Una suscripción SIN tenant es la licencia base de un partner en
 * PARTNER_DEDICATED: es del partner, no de ninguno de sus clientes. Por eso la
 * columna "Tenant" puede decir "Nivel partner" y no es un dato faltante.
 */
export function SubscriptionsPage() {
    const subs = useSubscriptions();
    const { term, setTerm, filtered } = useSearchFilter(subs.data, (s) => [
        s.code,
        s.organizations?.display_name,
        s.tenants?.name,
        s.saas_products?.short_name,
        s.plans?.name,
        s.status,
    ]);
    return (_jsxs(PageContainer, { title: "Suscripciones", description: "El contrato recurrente vivo. Incluye licencias por tenant, licencias base de partner y fees de infraestructura dedicada.", children: [_jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar por c\u00F3digo, organizaci\u00F3n, tenant o plan\u2026" }), subs.isLoading ? (_jsx(LoadingState, {})) : subs.error ? (_jsx(ErrorState, { error: subs.error, onRetry: () => void subs.refetch() })) : filtered.length === 0 ? (_jsx(EmptyState, { title: "Sin suscripciones" })) : (_jsx(DataTable, { columns: ['Código', 'Facturado a', 'Producto', 'Tenant', 'Plan', 'Modelo', 'Margen canal', 'Inicio', 'Estado'], children: filtered.map((s) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-mono text-xs font-semibold", children: s.code }), _jsx("td", { className: "ebim-td", children: s.organizations?.display_name }), _jsx("td", { className: "ebim-td", children: s.saas_products?.short_name }), _jsx("td", { className: "ebim-td", children: s.tenant_id ? (s.tenants?.name) : (_jsx(Badge, { tone: "accent", children: "Nivel partner" })) }), _jsx("td", { className: "ebim-td text-muted", children: s.plans?.name }), _jsx("td", { className: "ebim-td", children: s.tenants ? (_jsx(Badge, { tone: "info", children: DEPLOYMENT_MODE_LABEL[s.tenants.deployment_mode] })) : (_jsx("span", { className: "text-muted", children: "\u2014" })) }), _jsx("td", { className: "ebim-td tabular-nums", children: s.channel_margin_rate !== null ? formatPercent(Number(s.channel_margin_rate)) : '—' }), _jsx("td", { className: "ebim-td text-xs text-muted", children: formatDate(s.started_on) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: s.status === 'ACTIVE' ? 'ok' : s.status === 'CANCELLED' ? 'danger' : 'warn', children: s.status }) })] }, s.id))) }))] }), _jsxs("p", { className: "mt-3 px-1 text-xs text-muted", children: ["Total de l\u00EDneas recurrentes:", ' ', formatMoney((filtered ?? []).reduce((sum, s) => sum +
                        (s.subscription_items ?? [])
                            .filter((i) => i.billing_interval === 'MONTHLY')
                            .reduce((a, i) => a + Number(i.amount), 0), 0)), ' ', "mensuales entre las suscripciones listadas."] })] }));
}
