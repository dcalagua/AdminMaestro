import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { useProvisioningRequests } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageContainer, Card, DataTable, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import { PROVISIONING_STATUS_LABEL } from '@/types/domain';
/**
 * Cola de provisioning.
 *
 * Todo corre en DRY_RUN: la Edge Function `provisioning-worker` simula la
 * operación y registra el timeline sin tocar ninguna API remota. Pasar a LIVE
 * exige un secreto de servidor que la UI nunca ve (prompt fase 8).
 */
export function ProvisioningPage() {
    const requests = useProvisioningRequests();
    const [filter, setFilter] = useState('ALL');
    const [expanded, setExpanded] = useState(null);
    const [retryTarget, setRetryTarget] = useState(null);
    const { term, setTerm, filtered } = useSearchFilter(requests.data, (r) => [
        r.action, r.status, r.idempotency_key,
        r.tenants?.name,
        r.deployment_targets?.code,
    ]);
    const rows = filtered.filter((r) => {
        switch (filter) {
            case 'OPEN': return ['PENDING', 'VALIDATING', 'RUNNING'].includes(r.status);
            case 'FAILED': return r.status === 'FAILED';
            case 'DONE': return r.status === 'SUCCEEDED';
            default: return true;
        }
    });
    const all = requests.data ?? [];
    return (_jsxs(PageContainer, { title: "Provisioning", description: "Solicitudes de aprovisionamiento con m\u00E1quina de estados e idempotencia. Modo DRY_RUN por defecto: no se ejecuta ninguna llamada remota real.", actions: _jsx(Badge, { tone: "info", children: "Modo por defecto: DRY_RUN" }), children: [_jsxs("div", { className: "mb-4 grid gap-3 sm:grid-cols-4", children: [_jsx(StatCard, { label: "Solicitudes", value: String(all.length) }), _jsx(StatCard, { label: "En cola", value: String(all.filter((r) => ['PENDING', 'VALIDATING', 'RUNNING'].includes(r.status)).length), tone: "warn" }), _jsx(StatCard, { label: "Completadas", value: String(all.filter((r) => r.status === 'SUCCEEDED').length), tone: "ok" }), _jsx(StatCard, { label: "Fallidas", value: String(all.filter((r) => r.status === 'FAILED').length), tone: all.some((r) => r.status === 'FAILED') ? 'danger' : 'ok' })] }), _jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar por acci\u00F3n, tenant, target o clave de idempotencia\u2026", right: _jsx(StatusTabs, { value: filter, onChange: setFilter, options: [
                                { id: 'ALL', label: 'Todas', count: filtered.length },
                                { id: 'OPEN', label: 'En cola' },
                                { id: 'FAILED', label: 'Fallidas' },
                                { id: 'DONE', label: 'Completadas' },
                            ] }) }), requests.isLoading ? (_jsx(LoadingState, {})) : requests.error ? (_jsx(ErrorState, { error: requests.error, onRetry: () => void requests.refetch() })) : rows.length === 0 ? (_jsx(EmptyState, { title: "Sin solicitudes de provisioning" })) : (_jsx(DataTable, { columns: ['Acción', 'Tenant', 'Target', 'Modo', 'Estado', 'Intentos', 'Creada', ''], children: rows.map((r) => (_jsxs(_Fragment, { children: [_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-medium", children: r.action }), _jsx("td", { className: "ebim-td", children: r.tenants?.name ?? '—' }), _jsx("td", { className: "ebim-td font-mono text-xs text-muted", children: r.deployment_targets?.code ?? '—' }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: r.mode === 'DRY_RUN' ? 'info' : 'warn', children: r.mode }) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: r.status === 'SUCCEEDED' ? 'ok' : r.status === 'FAILED' ? 'danger' : 'warn', children: PROVISIONING_STATUS_LABEL[r.status] }) }), _jsxs("td", { className: "ebim-td tabular-nums", children: [r.attempts, "/", r.max_attempts] }), _jsx("td", { className: "ebim-td text-xs text-muted", children: formatDateTime(r.created_at) }), _jsxs("td", { className: "ebim-td text-right", children: [_jsx("button", { type: "button", className: "ebim-link text-[13px]", onClick: () => setExpanded(expanded === r.id ? null : r.id), children: expanded === r.id ? 'Ocultar' : 'Timeline' }), r.status === 'FAILED' && r.attempts < r.max_attempts ? (_jsx("button", { type: "button", className: "ebim-link ml-3 text-[13px]", onClick: () => setRetryTarget(r.id), children: "Reintentar" })) : null] })] }, r.id), expanded === r.id ? (_jsx("tr", { children: _jsxs("td", { colSpan: 8, className: "bg-[color:var(--bg)] px-4 py-3", children: [r.error_message ? (_jsx("p", { className: "mb-2 rounded-field bg-danger-soft px-3 py-2 text-xs text-danger", children: r.error_message })) : null, _jsxs("ol", { className: "space-y-1.5", children: [(r.provisioning_events ?? [])
                                                        .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))
                                                        .map((e) => (_jsxs("li", { className: "flex gap-3 text-xs", children: [_jsx("span", { className: "w-40 shrink-0 text-muted", children: formatDateTime(e.occurred_at) }), _jsx(Badge, { tone: "neutral", children: e.status }), _jsx("span", { className: "text-fg", children: e.message })] }, e.id))), (r.provisioning_events ?? []).length === 0 ? (_jsx("li", { className: "text-xs text-muted", children: "Sin eventos registrados." })) : null] })] }) }, `${r.id}-detail`)) : null] }))) }))] }), _jsx(ConfirmDialog, { open: retryTarget !== null, title: "Reintentar solicitud de provisioning", message: "Se volver\u00E1 a encolar la solicitud en modo DRY_RUN. La clave de idempotencia evita duplicar el trabajo si la operaci\u00F3n anterior s\u00ED lleg\u00F3 a completarse.", confirmLabel: "Reintentar", tone: "primary", onCancel: () => setRetryTarget(null), onConfirm: () => setRetryTarget(null) })] }));
}
