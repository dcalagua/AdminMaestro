import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useAllFeatureFlags } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
/**
 * Feature flags por tenant.
 *
 * `source` distingue de dónde sale el flag: PLAN (viene del plan contratado),
 * ADDON (se contrató aparte) o MANUAL (lo encendió el operador). Sin esa
 * distinción, nadie puede responder "¿por qué este cliente tiene esto?".
 */
export function FeatureFlagsPage() {
    const flags = useAllFeatureFlags();
    const { term, setTerm, filtered } = useSearchFilter(flags.data, (f) => [
        f.feature_key,
        f.source,
        f.tenants?.name,
        f.tenants?.slug,
    ]);
    return (_jsx(PageContainer, { title: "Feature flags", description: "Qu\u00E9 est\u00E1 encendido en cada tenant y por qu\u00E9: por plan, por addon contratado o por decisi\u00F3n manual del operador.", children: _jsxs(Card, { children: [_jsx(SearchBar, { value: term, onChange: setTerm, placeholder: "Buscar por flag o tenant\u2026" }), flags.isLoading ? (_jsx(LoadingState, {})) : flags.error ? (_jsx(ErrorState, { error: flags.error, onRetry: () => void flags.refetch() })) : filtered.length === 0 ? (_jsx(EmptyState, { title: "Sin feature flags", description: "Ning\u00FAn tenant tiene flags configurados." })) : (_jsx(DataTable, { columns: ['Flag', 'Tenant', 'Producto', 'Origen', 'Estado', 'Actualizado'], children: filtered.map((f) => {
                        const tenant = f.tenants;
                        return (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-mono text-[13px] font-semibold", children: f.feature_key }), _jsx("td", { className: "ebim-td", children: tenant?.name ?? '—' }), _jsx("td", { className: "ebim-td text-muted", children: tenant?.saas_products?.short_name ?? '—' }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: f.source === 'ADDON' ? 'accent' : f.source === 'PLAN' ? 'info' : 'warn', children: f.source }) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: f.enabled ? 'ok' : 'neutral', children: f.enabled ? 'Activo' : 'Inactivo' }) }), _jsx("td", { className: "ebim-td text-xs text-muted", children: formatDateTime(f.updated_at) })] }, `${f.tenant_id}-${f.feature_key}`));
                    }) }))] }) }));
}
