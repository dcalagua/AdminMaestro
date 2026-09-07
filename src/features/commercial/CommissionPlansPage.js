import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCommissionPlans } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatMoney, formatPercent, formatDate } from '@/lib/format';
const BASIS_LABEL = {
    COLLECTED_LICENSE: '% de licencia cobrada',
    COLLECTED_IMPLEMENTATION: '% de implementación cobrada',
    COLLECTED_ANY: '% de cualquier cobro',
    FIXED_AMOUNT: 'Monto fijo',
};
/**
 * Planes y reglas de comisión.
 *
 * Todas las bases parten de un COBRO ("collected"), nunca de un facturado: no se
 * paga comisión sobre una factura impaga (prompt fase 6).
 */
export function CommissionPlansPage() {
    const plans = useCommissionPlans();
    const { term, setTerm, filtered } = useSearchFilter(plans.data, (p) => [
        p.code, p.name, p.description,
    ]);
    return (_jsx(PageContainer, { title: "Planes de comisi\u00F3n", description: "Las reglas tienen vigencia y no se editan retroactivamente: se cierran y se abre una nueva, para que una comisi\u00F3n hist\u00F3rica siga siendo explicable.", children: _jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar plan de comisi\u00F3n\u2026" }), plans.isLoading ? (_jsx(LoadingState, {})) : plans.error ? (_jsx(ErrorState, { error: plans.error, onRetry: () => void plans.refetch() })) : filtered.length === 0 ? (_jsx(EmptyState, { title: "Sin planes de comisi\u00F3n" })) : (_jsx("div", { className: "divide-y divide-border", children: filtered.map((p) => (_jsxs("div", { className: "p-4", children: [_jsxs("div", { className: "mb-2 flex flex-wrap items-center gap-2", children: [_jsx("span", { className: "text-sm font-bold", children: p.name }), _jsx("span", { className: "font-mono text-xs text-muted", children: p.code }), _jsx(Badge, { tone: p.status === 'ACTIVE' ? 'ok' : 'neutral', children: p.status }), p.saas_products ? (_jsx(Badge, { tone: "info", children: p.saas_products.short_name })) : (_jsx(Badge, { tone: "neutral", children: "Todos los productos" }))] }), _jsx("p", { className: "mb-3 text-sm text-muted", children: p.description }), _jsx("div", { className: "rounded-card border border-border", children: _jsx(DataTable, { columns: ['Regla', 'Base', 'Tasa / Monto', 'Recurrente', 'Tope meses', 'Tope monto', 'Vigencia'], children: (p.commission_rules ?? []).map((r) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-medium", children: r.name }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "accent", children: BASIS_LABEL[r.basis] ?? r.basis }) }), _jsx("td", { className: "ebim-td tabular-nums font-semibold", children: r.rate !== null
                                                    ? formatPercent(Number(r.rate))
                                                    : formatMoney(Number(r.fixed_amount), r.currency) }), _jsx("td", { className: "ebim-td", children: r.is_recurring ? 'Sí' : 'Sólo la primera vez' }), _jsx("td", { className: "ebim-td tabular-nums", children: r.max_months ?? '—' }), _jsx("td", { className: "ebim-td tabular-nums", children: r.max_total_amount ? formatMoney(Number(r.max_total_amount), r.currency) : '—' }), _jsxs("td", { className: "ebim-td text-xs text-muted", children: [formatDate(r.valid_from), " \u2192 ", r.valid_to ? formatDate(r.valid_to) : 'sin fin'] })] }, r.id))) }) })] }, p.id))) }))] }) }));
}
