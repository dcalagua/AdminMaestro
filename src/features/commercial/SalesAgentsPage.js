import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useSalesAgents, useAttributions } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatDate, formatNumber } from '@/lib/format';
const AGENT_TYPE_LABEL = {
    EBIM_INTERNAL: 'Interno EBIM',
    INDEPENDENT: 'Independiente',
    PARTNER_AGENT: 'De partner',
};
/**
 * Comerciales.
 *
 * Un comercial puede existir sin `user_id` (no todos tienen login) y sin
 * organización (independiente). Crear uno NUNCA crea un tenant_membership.
 */
export function SalesAgentsPage() {
    const agents = useSalesAgents();
    const attributions = useAttributions();
    const { term, setTerm, filtered } = useSearchFilter(agents.data, (a) => [
        a.full_name, a.code, a.contact_email, a.agent_type,
        a.organizations?.display_name,
    ]);
    const salesByAgent = new Map();
    for (const a of attributions.data ?? []) {
        const key = a.sales_agent_id;
        salesByAgent.set(key, (salesByAgent.get(key) ?? 0) + 1);
    }
    return (_jsx(PageContainer, { title: "Comerciales", description: "Independientes, de partner o internos de EBIM. Un comercial cobra comisi\u00F3n por lo que vendi\u00F3; eso no le da acceso operativo a ning\u00FAn tenant.", children: _jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar comercial por nombre, c\u00F3digo u organizaci\u00F3n\u2026" }), agents.isLoading ? (_jsx(LoadingState, {})) : agents.error ? (_jsx(ErrorState, { error: agents.error, onRetry: () => void agents.refetch() })) : filtered.length === 0 ? (_jsx(EmptyState, { title: "Sin comerciales", description: "Ning\u00FAn comercial coincide con la b\u00FAsqueda." })) : (_jsx(DataTable, { columns: ['Comercial', 'Tipo', 'Organización', 'Contacto', 'Ventas atribuidas', 'Vigencia', 'Estado'], children: filtered.map((a) => (_jsxs("tr", { children: [_jsxs("td", { className: "ebim-td", children: [_jsx("div", { className: "font-semibold", children: a.full_name }), _jsx("div", { className: "font-mono text-xs text-muted", children: a.code })] }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: a.agent_type === 'INDEPENDENT' ? 'accent' : 'info', children: AGENT_TYPE_LABEL[a.agent_type] ?? a.agent_type }) }), _jsx("td", { className: "ebim-td text-muted", children: a.organizations?.display_name ?? 'Independiente' }), _jsx("td", { className: "ebim-td text-muted", children: a.contact_email ?? '—' }), _jsx("td", { className: "ebim-td tabular-nums", children: formatNumber(salesByAgent.get(a.id) ?? 0) }), _jsxs("td", { className: "ebim-td text-xs text-muted", children: [formatDate(a.valid_from), " \u2192 ", a.valid_to ? formatDate(a.valid_to) : 'sin fin'] }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: a.status === 'ACTIVE' ? 'ok' : 'neutral', children: a.status }) })] }, a.id))) }))] }) }));
}
