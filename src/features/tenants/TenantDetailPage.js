import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useParams } from 'react-router-dom';
import { useTenant, useTenantFeatures, useTenantAttributions, useSubscriptions, useTenantMargin, useProvisioningRequests, useAuditLogs, } from '@/services/queries';
import { useAuth } from '@/hooks/useAuth';
import { isFinance, canManagePlatform } from '@/features/auth/session';
import { SectionTabs } from '@/components/ui/SectionTabs';
import { PageContainer, Card, DataTable, StatCard, LoadingState, ErrorState, EmptyState, Badge, } from '@/components/ui/primitives';
import { formatMoney, formatDate, formatDateTime } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL, TENANT_STATUS_LABEL, PROVISIONING_STATUS_LABEL } from '@/types/domain';
/**
 * Detalle de tenant en pestañas administrativas (prompt fase 9).
 *
 * Lo que NO aparece aquí, deliberadamente: proveedores, órdenes, inventario,
 * documentos. El Control Plane administra metadatos y gobierno; los datos
 * operativos viven en el proyecto Supabase de cada app (contrato §7).
 */
export function TenantDetailPage() {
    const { tenantId } = useParams();
    const { roles } = useAuth();
    const tenant = useTenant(tenantId);
    const features = useTenantFeatures(tenantId);
    const attributions = useTenantAttributions(tenantId);
    const subscriptions = useSubscriptions();
    const margins = useTenantMargin();
    const provisioning = useProvisioningRequests();
    const audit = useAuditLogs();
    if (tenant.isLoading)
        return _jsx(LoadingState, {});
    if (tenant.error)
        return _jsx(ErrorState, { error: tenant.error });
    if (!tenant.data) {
        return (_jsx(PageContainer, { title: "Tenant no encontrado", children: _jsx(Card, { children: _jsx(EmptyState, { title: "No existe o no tienes acceso", description: "RLS impide ver tenants fuera de tu organizaci\u00F3n o de tu membres\u00EDa. No es un fallo de la pantalla." }) }) }));
    }
    const t = tenant.data;
    const tenantSubs = (subscriptions.data ?? []).filter((s) => s.tenant_id === tenantId);
    const margin = (margins.data ?? []).find((m) => m.tenant_id === tenantId);
    const tenantProvisioning = (provisioning.data ?? []).filter((p) => p.tenant_id === tenantId);
    const tenantAudit = (audit.data ?? []).filter((a) => a.tenant_id === tenantId);
    const showFinance = isFinance(roles) || canManagePlatform(roles);
    return (_jsxs(PageContainer, { title: t.name, description: `${t.product_lockup} · ${t.customer_name}${t.managing_name ? ` · administrado por ${t.managing_name}` : ' · venta directa EBIM'}`, breadcrumbs: _jsx(Link, { className: "text-xs text-muted hover:text-fg", to: "/tenants", children: "\u2190 Tenants" }), actions: _jsxs("div", { className: "flex flex-wrap gap-1.5", children: [_jsx(Badge, { tone: t.tenant_type === 'PRODUCTION' ? 'ok' : 'info', children: TENANT_TYPE_LABEL[t.tenant_type] }), _jsx(Badge, { tone: "accent", children: DEPLOYMENT_MODE_LABEL[t.deployment_mode] }), _jsx(Badge, { tone: t.status === 'ACTIVE' ? 'ok' : 'warn', children: TENANT_STATUS_LABEL[t.status] })] }), children: [_jsxs("div", { className: "mb-5 grid gap-3 sm:grid-cols-4", children: [_jsx(StatCard, { label: "MRR", value: formatMoney(Number(t.mrr), t.currency ?? 'USD'), tone: "ok" }), _jsx(StatCard, { label: "Plan", value: t.plan_name ?? 'Sin plan' }), _jsx(StatCard, { label: "Infraestructura", value: t.deployment_target_code ?? 'Sin asignar', hint: t.deployment_region ?? undefined }), _jsx(StatCard, { label: "Administrador", value: t.admin_activated_at ? 'Activado' : 'Sin activar', tone: t.admin_activated_at ? 'ok' : 'warn', hint: t.admin_email })] }), _jsx(SectionTabs, { tabs: [
                    {
                        id: 'overview',
                        label: 'Resumen',
                        content: (_jsx(Card, { title: "Datos del tenant", children: _jsx("dl", { className: "divide-y divide-border", children: [
                                    ['Slug', t.slug],
                                    ['Producto', t.product_lockup],
                                    ['Organización cliente', t.customer_name],
                                    ['Organización que administra', t.managing_name ?? 'Ninguna (venta directa EBIM)'],
                                    ['Tipo', TENANT_TYPE_LABEL[t.tenant_type]],
                                    ['Entorno', t.environment],
                                    ['Modelo de despliegue', DEPLOYMENT_MODE_LABEL[t.deployment_mode]],
                                    ['Correo del administrador', t.admin_email],
                                    ['Administrador activado', t.admin_activated_at ? formatDateTime(t.admin_activated_at) : 'Pendiente de activar'],
                                    ['Creado', formatDateTime(t.created_at)],
                                    ['Activado', t.activated_at ? formatDateTime(t.activated_at) : '—'],
                                ].map(([k, v]) => (_jsxs("div", { className: "flex justify-between gap-4 px-4 py-2.5 text-sm", children: [_jsx("dt", { className: "text-muted", children: k }), _jsx("dd", { className: "text-right font-medium", children: v ?? '—' })] }, k))) }) })),
                    },
                    {
                        id: 'commercial',
                        label: 'Atribución comercial',
                        content: (_jsx(Card, { description: "Qui\u00E9n se lleva el cr\u00E9dito de esta venta. Estar aqu\u00ED NO da acceso operacional al tenant (regla \u00A72.3).", children: (attributions.data ?? []).length === 0 ? (_jsx(EmptyState, { title: "Sin atribuci\u00F3n comercial", description: "Esta venta no tiene comercial asignado." })) : (_jsx(DataTable, { columns: ['Comercial', 'Tipo', 'Participación', 'Plan de comisión', 'Origen', 'Vigencia'], children: (attributions.data ?? []).map((a) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-semibold", children: a.sales_agents?.full_name }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "info", children: a.sales_agents?.agent_type }) }), _jsxs("td", { className: "ebim-td tabular-nums", children: [(Number(a.attribution_pct) * 100).toFixed(0), "%"] }), _jsx("td", { className: "ebim-td", children: a.commission_plans?.name ?? '—' }), _jsx("td", { className: "ebim-td text-muted", children: a.source }), _jsxs("td", { className: "ebim-td text-xs text-muted", children: [formatDate(a.valid_from), " \u2192 ", a.valid_to ? formatDate(a.valid_to) : 'sin fin'] })] }, a.id))) })) })),
                    },
                    {
                        id: 'subscription',
                        label: 'Suscripción',
                        content: (_jsx(Card, { children: tenantSubs.length === 0 ? (_jsx(EmptyState, { title: "Sin suscripci\u00F3n", description: t.tenant_type === 'DEMO'
                                    ? 'Es un tenant DEMO: por regla de negocio no genera cobro recurrente.'
                                    : 'Todavía no se ha creado una suscripción para este tenant.' })) : (_jsx("div", { className: "space-y-4 p-4", children: tenantSubs.map((s) => (_jsxs("div", { className: "rounded-card border border-border", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5", children: [_jsxs("div", { children: [_jsx("span", { className: "font-semibold", children: s.code }), _jsx("span", { className: "ml-2 text-sm text-muted", children: s.plans?.name })] }), _jsx(Badge, { tone: s.status === 'ACTIVE' ? 'ok' : 'warn', children: s.status })] }), _jsx(DataTable, { columns: ['Concepto', 'Cargo', 'Cantidad', 'Unitario', 'Periodicidad', 'Total'], children: (s.subscription_items ?? []).map((i) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td", children: i.description }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: String(i.charge_kind).includes('FEE') ? 'warn' : 'accent', children: i.charge_kind }) }), _jsx("td", { className: "ebim-td tabular-nums", children: Number(i.quantity) }), _jsx("td", { className: "ebim-td tabular-nums", children: formatMoney(Number(i.unit_amount), i.currency) }), _jsx("td", { className: "ebim-td text-muted", children: i.billing_interval }), _jsx("td", { className: "ebim-td tabular-nums font-semibold", children: formatMoney(Number(i.amount), i.currency) })] }, i.id))) })] }, s.id))) })) })),
                    },
                    {
                        id: 'deployment',
                        label: 'Infraestructura',
                        content: (_jsxs("div", { className: "space-y-4", children: [_jsx(Card, { title: "D\u00F3nde vive este tenant", children: _jsx("dl", { className: "divide-y divide-border", children: [
                                            ['Modelo', DEPLOYMENT_MODE_LABEL[t.deployment_mode]],
                                            ['Deployment target', t.deployment_target_code ?? 'Sin asignar'],
                                            ['Proveedor', t.deployment_provider ?? '—'],
                                            ['Región', t.deployment_region ?? '—'],
                                        ].map(([k, v]) => (_jsxs("div", { className: "flex justify-between gap-4 px-4 py-2.5 text-sm", children: [_jsx("dt", { className: "text-muted", children: k }), _jsx("dd", { className: "text-right font-medium", children: v ?? '—' })] }, k))) }) }), _jsx(Card, { title: "Solicitudes de provisioning", description: "Todo corre en DRY_RUN salvo autorizaci\u00F3n expl\u00EDcita del operador.", children: tenantProvisioning.length === 0 ? (_jsx(EmptyState, { title: "Sin solicitudes de provisioning" })) : (_jsx(DataTable, { columns: ['Acción', 'Modo', 'Estado', 'Intentos', 'Creada'], children: tenantProvisioning.map((p) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-medium", children: p.action }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: p.mode === 'DRY_RUN' ? 'info' : 'warn', children: p.mode }) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: p.status === 'SUCCEEDED' ? 'ok' : p.status === 'FAILED' ? 'danger' : 'warn', children: PROVISIONING_STATUS_LABEL[p.status] }) }), _jsxs("td", { className: "ebim-td tabular-nums", children: [p.attempts, "/", p.max_attempts] }), _jsx("td", { className: "ebim-td text-xs text-muted", children: formatDateTime(p.created_at) })] }, p.id))) })) })] })),
                    },
                    {
                        id: 'features',
                        label: 'Features',
                        content: (_jsx(Card, { description: "`source` explica POR QU\u00C9 est\u00E1 encendido: por plan, por addon contratado o por decisi\u00F3n manual.", children: (features.data ?? []).length === 0 ? (_jsx(EmptyState, { title: "Sin feature flags", description: "Este tenant usa la configuraci\u00F3n por defecto del plan." })) : (_jsx(DataTable, { columns: ['Flag', 'Origen', 'Estado', 'Actualizado'], children: (features.data ?? []).map((f) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td font-mono text-[13px] font-semibold", children: f.feature_key }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: f.source === 'ADDON' ? 'accent' : f.source === 'PLAN' ? 'info' : 'warn', children: f.source }) }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: f.enabled ? 'ok' : 'neutral', children: f.enabled ? 'Activo' : 'Inactivo' }) }), _jsx("td", { className: "ebim-td text-xs text-muted", children: formatDateTime(f.updated_at) })] }, f.feature_key))) })) })),
                    },
                    {
                        id: 'costs',
                        label: 'Costos y margen',
                        hidden: !showFinance,
                        content: (_jsx(Card, { title: "Rentabilidad del tenant", children: margin ? (_jsxs("div", { className: "grid gap-3 p-4 sm:grid-cols-4", children: [_jsx(StatCard, { label: "MRR", value: formatMoney(Number(margin.mrr), margin.currency ?? 'USD') }), _jsx(StatCard, { label: "Ingreso cobrado", value: formatMoney(Number(margin.collected_revenue), margin.currency ?? 'USD') }), _jsx(StatCard, { label: "Costo directo", value: formatMoney(Number(margin.direct_cost), margin.currency ?? 'USD'), tone: "warn" }), _jsx(StatCard, { label: "Margen bruto", value: formatMoney(Number(margin.gross_margin), margin.currency ?? 'USD'), tone: Number(margin.gross_margin) >= 0 ? 'ok' : 'danger', hint: "cobrado \u2212 costo \u2212 comisi\u00F3n" })] })) : (_jsx(EmptyState, { title: "Sin datos de margen para este tenant" })) })),
                    },
                    {
                        id: 'audit',
                        label: 'Auditoría',
                        content: (_jsx(Card, { description: "Bit\u00E1cora append-only: no se puede editar ni borrar, ni desde la consola ni por PATCH directo.", children: tenantAudit.length === 0 ? (_jsx(EmptyState, { title: "Sin eventos registrados para este tenant" })) : (_jsx(DataTable, { columns: ['Fecha', 'Actor', 'Acción', 'Entidad'], children: tenantAudit.map((a) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td text-xs text-muted", children: formatDateTime(a.occurred_at) }), _jsx("td", { className: "ebim-td", children: a.actor_email ?? '—' }), _jsx("td", { className: "ebim-td font-semibold", children: a.action }), _jsx("td", { className: "ebim-td text-muted", children: a.entity_type })] }, a.id))) })) })),
                    },
                ] })] }));
}
