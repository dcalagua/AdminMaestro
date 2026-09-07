import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { usePlans } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatMoney } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
/**
 * Planes y licencias.
 *
 * Los tres modelos comerciales conviven aquí sin ramas de código:
 *   SHARED            -> licencia por tenant productivo
 *   PARTNER_DEDICATED -> licencia base del partner (is_partner_base) + N licencias
 *   TENANT_DEDICATED  -> licencia Enterprise + infra + soporte
 * Lo que los distingue es `deployment_mode` y los `charge_kind` de sus precios.
 */
export function PlansPage() {
    const plans = usePlans();
    const { term, setTerm, filtered } = useSearchFilter(plans.data, (p) => [
        p.code, p.name, p.description, p.saas_products?.short_name,
    ]);
    return (_jsx(PageContainer, { title: "Planes y licencias", description: "Cat\u00E1logo comercial por producto y modelo de despliegue. Los precios tienen vigencia: nunca se editan, se cierran y se abre uno nuevo.", children: _jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar plan por nombre, c\u00F3digo o producto\u2026" }), plans.isLoading ? (_jsx(LoadingState, {})) : plans.error ? (_jsx(ErrorState, { error: plans.error, onRetry: () => void plans.refetch() })) : filtered.length === 0 ? (_jsx(EmptyState, { title: "Sin planes", description: "Ning\u00FAn plan coincide con la b\u00FAsqueda." })) : (_jsx(DataTable, { columns: ['Plan', 'Producto', 'Modelo', 'Sociedades', 'Precios vigentes'], children: filtered.map((p) => (_jsxs("tr", { children: [_jsxs("td", { className: "ebim-td", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-semibold", children: p.name }), p.is_partner_base ? _jsx(Badge, { tone: "accent", children: "Licencia base partner" }) : null, p.multi_country ? _jsx(Badge, { tone: "info", children: "Multi-pa\u00EDs" }) : null] }), _jsx("div", { className: "font-mono text-xs text-muted", children: p.code })] }), _jsx("td", { className: "ebim-td", children: p.saas_products?.short_name }), _jsx("td", { className: "ebim-td", children: p.deployment_mode ? (_jsx(Badge, { tone: "accent", children: DEPLOYMENT_MODE_LABEL[p.deployment_mode] })) : (_jsx("span", { className: "text-muted", children: "Cualquiera" })) }), _jsx("td", { className: "ebim-td tabular-nums", children: p.included_companies }), _jsx("td", { className: "ebim-td", children: _jsxs("div", { className: "space-y-0.5", children: [(p.plan_prices ?? [])
                                            .filter((pr) => !pr.valid_to)
                                            .map((pr) => (_jsxs("div", { className: "whitespace-nowrap text-xs", children: [_jsx("span", { className: "text-muted", children: pr.charge_kind }), ' ', _jsx("span", { className: "font-semibold tabular-nums", children: formatMoney(Number(pr.amount), pr.currency) }), _jsxs("span", { className: "text-muted", children: [" / ", pr.billing_interval] })] }, pr.id))), (p.plan_prices ?? []).length === 0 ? (_jsx("span", { className: "text-xs text-muted", children: "Sin precios" })) : null] }) })] }, p.id))) }))] }) }));
}
