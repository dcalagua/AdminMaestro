import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useCommissionEvents, useSettlements } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { SectionTabs, StatusTabs } from '@/components/ui/SectionTabs';
import { PageContainer, Card, DataTable, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatMoney, formatDate, formatPercent } from '@/lib/format';
import { COMMISSION_STATUS_LABEL } from '@/types/domain';
/**
 * Comisiones y liquidaciones.
 *
 * Cada evento muestra CÓMO se calculó (base × tasa × participación), no sólo el
 * monto: una comisión que no se puede explicar es una comisión que se discute.
 */
export function CommissionsPage() {
    const events = useCommissionEvents();
    const settlements = useSettlements();
    const [filter, setFilter] = useState('ALL');
    const { term, setTerm, filtered } = useSearchFilter(events.data, (e) => [
        e.sales_agents?.full_name,
        e.saas_products?.short_name,
        e.tenants?.name,
        e.status,
    ]);
    const rows = filtered.filter((e) => {
        if (filter === 'PAID')
            return e.status === 'PAID';
        if (filter === 'PENDING')
            return e.status === 'ELIGIBLE' || e.status === 'ACCRUED';
        return true;
    });
    const totals = (events.data ?? []).reduce((acc, e) => {
        const amount = Number(e.amount);
        if (e.status === 'PAID')
            acc.paid += amount;
        else if (e.status !== 'VOID')
            acc.pending += amount;
        return acc;
    }, { paid: 0, pending: 0 });
    return (_jsxs(PageContainer, { title: "Comisiones y liquidaciones", description: "Cada comisi\u00F3n nace de un cobro confirmado. Una factura emitida pero impaga no devenga nada.", children: [_jsxs("div", { className: "mb-4 grid gap-3 sm:grid-cols-3", children: [_jsx(StatCard, { label: "Comisi\u00F3n pendiente", value: formatMoney(totals.pending), tone: "warn", hint: "Elegible + devengada" }), _jsx(StatCard, { label: "Comisi\u00F3n pagada", value: formatMoney(totals.paid), tone: "ok" }), _jsx(StatCard, { label: "Liquidaciones", value: String(settlements.data?.length ?? 0) })] }), _jsx(SectionTabs, { tabs: [
                    {
                        id: 'events',
                        label: 'Eventos de comisión',
                        content: (_jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar por comercial, producto o tenant\u2026", right: _jsx(StatusTabs, { value: filter, onChange: setFilter, options: [
                                            { id: 'ALL', label: 'Todos', count: filtered.length },
                                            { id: 'PENDING', label: 'Pendientes' },
                                            { id: 'PAID', label: 'Pagadas' },
                                        ] }) }), events.isLoading ? (_jsx(LoadingState, {})) : events.error ? (_jsx(ErrorState, { error: events.error, onRetry: () => void events.refetch() })) : rows.length === 0 ? (_jsx(EmptyState, { title: "Sin eventos de comisi\u00F3n", description: "No hay comisiones devengadas visibles para tu rol." })) : (_jsx(DataTable, { columns: ['Fecha', 'Comercial', 'Producto', 'Tenant', 'Regla', 'Cálculo', 'Monto', 'Estado', 'Liquidación'], children: rows.map((e) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td text-xs text-muted", children: formatDate(e.earned_on) }), _jsx("td", { className: "ebim-td font-semibold", children: e.sales_agents?.full_name }), _jsx("td", { className: "ebim-td", children: e.saas_products?.short_name }), _jsx("td", { className: "ebim-td text-muted", children: e.tenants?.name ?? '—' }), _jsx("td", { className: "ebim-td text-xs", children: e.commission_rules?.name }), _jsxs("td", { className: "ebim-td whitespace-nowrap text-xs text-muted", children: [formatMoney(Number(e.base_amount), e.currency), e.applied_rate !== null ? ` × ${formatPercent(Number(e.applied_rate))}` : '', Number(e.attribution_pct) < 1 ? ` × ${formatPercent(Number(e.attribution_pct), 0)}` : ''] }), _jsx("td", { className: "ebim-td tabular-nums font-semibold", children: formatMoney(Number(e.amount), e.currency) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: e.status === 'PAID' ? 'ok' : e.status === 'VOID' ? 'danger' : 'warn', children: COMMISSION_STATUS_LABEL[e.status] }) }), _jsx("td", { className: "ebim-td font-mono text-xs text-muted", children: e.commission_settlements?.code ?? '—' })] }, e.id))) }))] })),
                    },
                    {
                        id: 'settlements',
                        label: 'Liquidaciones',
                        content: (_jsx(Card, { description: "Una liquidaci\u00F3n agrupa eventos de un periodo. Marcarla PAID exige fecha y referencia de pago.", children: settlements.isLoading ? (_jsx(LoadingState, {})) : (settlements.data ?? []).length === 0 ? (_jsx(EmptyState, { title: "Sin liquidaciones" })) : (_jsx(DataTable, { columns: ['Código', 'Comercial', 'Periodo', 'Total', 'Estado', 'Referencia de pago'], children: (settlements.data ?? []).map((s) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-mono text-xs font-semibold", children: s.code }), _jsx("td", { className: "ebim-td", children: s.sales_agents?.full_name }), _jsxs("td", { className: "ebim-td text-xs text-muted", children: [formatDate(s.period_start), " \u2192 ", formatDate(s.period_end)] }), _jsx("td", { className: "ebim-td tabular-nums font-semibold", children: formatMoney(Number(s.total_amount), s.currency) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: s.status === 'PAID' ? 'ok' : s.status === 'CANCELLED' ? 'danger' : 'warn', children: s.status }) }), _jsx("td", { className: "ebim-td font-mono text-xs text-muted", children: s.payment_reference ?? '—' })] }, s.id))) })) })),
                    },
                ] })] }));
}
