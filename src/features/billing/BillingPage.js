import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useInvoices } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { PageContainer, Card, DataTable, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatMoney, formatDate } from '@/lib/format';
import { INVOICE_STATUS_LABEL } from '@/types/domain';
/**
 * Facturación y cobros.
 *
 * DRAFT y VOID se muestran, pero marcados: existen en la operación y ocultarlos
 * haría que los totales no cuadren con lo que el usuario ve. Lo que NO hacen es
 * contar como ingreso — eso se decide en la vista `v_collected_revenue`.
 */
export function BillingPage() {
    const invoices = useInvoices();
    const [filter, setFilter] = useState('ALL');
    const { term, setTerm, filtered } = useSearchFilter(invoices.data, (i) => [
        i.number, i.organizations?.display_name, i.status,
    ]);
    const rows = filtered.filter((i) => {
        switch (filter) {
            case 'OPEN': return i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID';
            case 'PAID': return i.status === 'PAID';
            case 'EXCLUDED': return i.status === 'DRAFT' || i.status === 'VOID';
            default: return true;
        }
    });
    const all = invoices.data ?? [];
    const countable = all.filter((i) => !['DRAFT', 'VOID'].includes(i.status));
    const invoiced = countable.reduce((sum, i) => sum + Number(i.total), 0);
    const collected = all.reduce((sum, i) => sum +
        (i.payments ?? [])
            .filter((p) => p.status === 'CONFIRMED')
            .reduce((a, p) => a + Number(p.amount), 0), 0);
    return (_jsxs(PageContainer, { title: "Facturaci\u00F3n y cobros", description: "Control gerencial, no contabilidad. Las facturas en borrador o anuladas nunca cuentan como ingreso.", children: [_jsxs("div", { className: "mb-4 grid gap-3 sm:grid-cols-3", children: [_jsx(StatCard, { label: "Facturado (emitido)", value: formatMoney(invoiced), hint: "Excluye borrador y anuladas" }), _jsx(StatCard, { label: "Cobrado", value: formatMoney(collected), tone: "ok", hint: "S\u00F3lo pagos confirmados" }), _jsx(StatCard, { label: "Pendiente de cobro", value: formatMoney(invoiced - collected), tone: invoiced - collected > 0 ? 'warn' : 'ok' })] }), _jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar por n\u00FAmero de factura u organizaci\u00F3n\u2026", right: _jsx(StatusTabs, { value: filter, onChange: setFilter, options: [
                                { id: 'ALL', label: 'Todas', count: filtered.length },
                                { id: 'OPEN', label: 'Por cobrar' },
                                { id: 'PAID', label: 'Pagadas' },
                                { id: 'EXCLUDED', label: 'Borrador / anuladas' },
                            ] }) }), invoices.isLoading ? (_jsx(LoadingState, {})) : invoices.error ? (_jsx(ErrorState, { error: invoices.error, onRetry: () => void invoices.refetch() })) : rows.length === 0 ? (_jsx(EmptyState, { title: "Sin facturas", description: "No hay facturas visibles para tu rol con ese filtro." })) : (_jsx(DataTable, { columns: ['Número', 'Organización', 'Periodo', 'Emisión', 'Total', 'Cobrado', 'Estado'], children: rows.map((i) => {
                            const paid = (i.payments ?? [])
                                .filter((p) => p.status === 'CONFIRMED')
                                .reduce((a, p) => a + Number(p.amount), 0);
                            const excluded = i.status === 'DRAFT' || i.status === 'VOID';
                            return (_jsxs("tr", { className: excluded ? 'opacity-60' : undefined, children: [_jsx("td", { className: "ebim-td font-mono text-xs font-semibold", children: i.number }), _jsx("td", { className: "ebim-td", children: i.organizations?.display_name }), _jsxs("td", { className: "ebim-td text-xs text-muted", children: [formatDate(i.period_start), " \u2192 ", formatDate(i.period_end)] }), _jsx("td", { className: "ebim-td text-xs text-muted", children: formatDate(i.issue_date) }), _jsx("td", { className: "ebim-td tabular-nums font-semibold", children: formatMoney(Number(i.total), i.currency) }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(paid, i.currency) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: i.status === 'PAID' ? 'ok'
                                                : i.status === 'VOID' ? 'danger'
                                                    : i.status === 'DRAFT' ? 'neutral'
                                                        : 'warn', children: INVOICE_STATUS_LABEL[i.status] }) })] }, i.id));
                        }) }))] })] }));
}
