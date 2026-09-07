import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { useProducts, useTenantOverview } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatNumber } from '@/lib/format';
/**
 * Catálogo de SaaS.
 *
 * Añadir un producto nuevo a la suite es INSERTAR una fila aquí — no hay ninguna
 * columna `is_esupplier` ni rama de código por producto (prompt fase 3).
 */
export function ProductsPage() {
    const products = useProducts();
    const tenants = useTenantOverview();
    const { term, setTerm, filtered } = useSearchFilter(products.data, (p) => [
        p.code, p.name, p.short_name, p.description,
    ]);
    const tenantsByProduct = new Map();
    for (const t of tenants.data ?? []) {
        const key = t.saas_product_id;
        tenantsByProduct.set(key, (tenantsByProduct.get(key) ?? 0) + 1);
    }
    return (_jsx(PageContainer, { title: "SaaS Products", description: "Cat\u00E1logo de productos de la suite. El core no est\u00E1 atado a ninguno: un SaaS nuevo es una fila m\u00E1s.", children: _jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar producto por nombre o c\u00F3digo\u2026" }), products.isLoading ? (_jsx(LoadingState, {})) : products.error ? (_jsx(ErrorState, { error: products.error, onRetry: () => void products.refetch() })) : filtered.length === 0 ? (_jsx(EmptyState, { title: "Sin productos", description: "No hay productos que coincidan con la b\u00FAsqueda." })) : (_jsx(DataTable, { columns: ['Producto', 'Código', 'Unidad de cobro', 'Tenants', 'Estado', ''], children: filtered.map((p) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td", children: _jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx("span", { className: "h-6 w-1.5 rounded-full", style: { background: p.accent_color ?? 'var(--accent)' }, "aria-hidden": true }), _jsxs("div", { children: [_jsx("div", { className: "font-semibold", children: p.lockup_name }), _jsx("div", { className: "text-xs text-muted", children: p.description })] })] }) }), _jsx("td", { className: "ebim-td font-mono text-xs text-muted", children: p.code }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "info", children: p.billing_unit }) }), _jsx("td", { className: "ebim-td tabular-nums", children: formatNumber(tenantsByProduct.get(p.id) ?? 0) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: p.status === 'ACTIVE' ? 'ok' : 'neutral', children: p.status }) }), _jsx("td", { className: "ebim-td text-right", children: _jsx(Link, { className: "ebim-link text-[13px]", to: `/products/${p.id}`, children: "Ver detalle" }) })] }, p.id))) }))] }) }));
}
