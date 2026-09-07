import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useAuditLogs } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
/**
 * Bitácora de auditoría.
 *
 * Append-only REAL: `authenticated` no tiene GRANT de UPDATE ni DELETE sobre
 * `audit_logs`, y no existe política que los permita. No es "append-only por
 * convención" — esa distinción es exactamente la lección `esupplier-030`.
 */
export function AuditPage() {
    const logs = useAuditLogs();
    const { term, setTerm, filtered } = useSearchFilter(logs.data, (l) => [
        l.action, l.actor_email, l.entity_type, l.entity_id,
    ]);
    return (_jsx(PageContainer, { title: "Auditor\u00EDa", description: "Acciones administrativas sensibles. La bit\u00E1cora no se puede editar ni borrar desde la aplicaci\u00F3n: el enforcement est\u00E1 en los GRANT, no en una convenci\u00F3n.", children: _jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar por acci\u00F3n, actor o entidad\u2026" }), logs.isLoading ? (_jsx(LoadingState, {})) : logs.error ? (_jsx(ErrorState, { error: logs.error, onRetry: () => void logs.refetch() })) : filtered.length === 0 ? (_jsx(EmptyState, { title: "Sin eventos de auditor\u00EDa", description: "No hay eventos visibles para tu rol." })) : (_jsx(DataTable, { columns: ['Fecha', 'Actor', 'Acción', 'Entidad', 'Referencia', 'Metadata'], children: filtered.map((l) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td whitespace-nowrap text-xs text-muted", children: formatDateTime(l.occurred_at) }), _jsx("td", { className: "ebim-td", children: l.actor_email ?? 'Sistema' }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "accent", children: l.action }) }), _jsx("td", { className: "ebim-td text-muted", children: l.entity_type }), _jsx("td", { className: "ebim-td font-mono text-xs text-muted", children: l.entity_id ? `${String(l.entity_id).slice(0, 8)}…` : '—' }), _jsx("td", { className: "ebim-td font-mono text-xs text-muted", children: Object.keys(l.metadata ?? {}).length > 0
                                    ? JSON.stringify(l.metadata)
                                    : '—' })] }, String(l.id)))) }))] }) }));
}
