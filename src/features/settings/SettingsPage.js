import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useAuth } from '@/hooks/useAuth';
import { useAppearance } from '@/hooks/useAppearance';
import { SectionTabs } from '@/components/ui/SectionTabs';
import { PageContainer, Card, Badge, DataTable, EmptyState } from '@/components/ui/primitives';
import { PLATFORM_ROLE_LABEL, ORG_ROLE_LABEL } from '@/types/domain';
import { env } from '@/lib/env';
import { EbimLockup } from '@/components/ui/EbimMark';
/**
 * Configuración.
 *
 * Apariencia (contrato §4.4): el usuario elige SÓLO modo y densidad. No existe
 * selector de color — el acento lo fija la marca del tenant y un preset de
 * usuario nunca puede sobreescribirlo.
 */
export function SettingsPage() {
    const { roles, persona } = useAuth();
    const { mode, density, setMode, setDensity } = useAppearance();
    return (_jsx(PageContainer, { title: "Configuraci\u00F3n", description: "Tu sesi\u00F3n, tu apariencia y el entorno de esta consola.", children: _jsx(SectionTabs, { tabs: [
                {
                    id: 'appearance',
                    label: 'Apariencia',
                    content: (_jsx(Card, { title: "Apariencia", description: "S\u00F3lo modo y densidad. El color de marca no es elegible por el usuario: lo define la marca del portal (contrato \u00A74.4).", children: _jsxs("div", { className: "space-y-5 p-4", children: [_jsxs("div", { children: [_jsx("span", { className: "ebim-label", children: "Modo" }), _jsx("div", { className: "flex gap-2", children: ['light', 'dark'].map((m) => (_jsx("button", { type: "button", onClick: () => setMode(m), className: mode === m ? 'ebim-btn-primary' : 'ebim-btn-ghost', children: m === 'light' ? 'Claro' : 'Oscuro' }, m))) })] }), _jsxs("div", { children: [_jsx("span", { className: "ebim-label", children: "Densidad" }), _jsx("div", { className: "flex flex-wrap gap-2", children: ['comoda', 'equilibrada', 'compacta'].map((d) => (_jsx("button", { type: "button", onClick: () => setDensity(d), className: density === d ? 'ebim-btn-primary' : 'ebim-btn-ghost', children: d === 'comoda' ? 'Cómoda' : d === 'equilibrada' ? 'Equilibrada' : 'Compacta' }, d))) }), _jsx("p", { className: "mt-2 text-xs text-muted", children: "Altura de control / fila: c\u00F3moda 40/52 \u00B7 equilibrada 36/44 \u00B7 compacta 32/38." })] }), _jsxs("div", { className: "rounded-field border border-border p-4", children: [_jsx("p", { className: "mb-2 text-xs font-bold uppercase tracking-wider text-muted", children: "Vista previa" }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("button", { type: "button", className: "ebim-btn-primary", children: "Acci\u00F3n primaria" }), _jsx("button", { type: "button", className: "ebim-btn-ghost", children: "Secundaria" }), _jsx("input", { className: "ebim-input max-w-[200px]", placeholder: "Campo de texto" }), _jsx(Badge, { tone: "ok", children: "Activo" }), _jsx(Badge, { tone: "warn", children: "Pendiente" })] })] })] }) })),
                },
                {
                    id: 'session',
                    label: 'Mi sesión',
                    content: (_jsxs("div", { className: "grid gap-4 lg:grid-cols-2", children: [_jsx(Card, { title: "Identidad", children: _jsx("dl", { className: "divide-y divide-border", children: [
                                        ['Correo', roles?.email ?? '—'],
                                        ['Nombre', roles?.fullName ?? '—'],
                                        ['Perfil', persona],
                                        ['Rol de plataforma', roles?.platformRole ? PLATFORM_ROLE_LABEL[roles.platformRole] : 'Ninguno'],
                                        ['Comercial asociado', roles?.salesAgentId ? 'Sí' : 'No'],
                                    ].map(([k, v]) => (_jsxs("div", { className: "flex justify-between gap-4 px-4 py-2.5 text-sm", children: [_jsx("dt", { className: "text-muted", children: k }), _jsx("dd", { className: "text-right font-medium", children: v })] }, k))) }) }), _jsx(Card, { title: "Mis membres\u00EDas", description: "El alcance real de lo que puedes ver lo decide RLS, no este listado.", children: (roles?.organizations.length ?? 0) === 0 && (roles?.tenantRoles.length ?? 0) === 0 ? (_jsx(EmptyState, { title: "Sin membres\u00EDas", description: "Tu acceso proviene de tu rol de plataforma." })) : (_jsxs(DataTable, { columns: ['Ámbito', 'Nombre', 'Rol'], children: [(roles?.organizations ?? []).map((o) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td", children: "Organizaci\u00F3n" }), _jsx("td", { className: "ebim-td font-semibold", children: o.displayName }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "info", children: ORG_ROLE_LABEL[o.role] }) })] }, o.organizationId))), (roles?.tenantRoles ?? []).map((t) => (_jsxs("tr", { children: [_jsx("td", { className: "ebim-td", children: "Tenant" }), _jsxs("td", { className: "ebim-td font-mono text-xs", children: [t.tenantId.slice(0, 8), "\u2026"] }), _jsx("td", { className: "ebim-td", children: _jsx(Badge, { tone: "accent", children: t.role }) })] }, t.tenantId)))] })) })] })),
                },
                {
                    id: 'environment',
                    label: 'Entorno',
                    content: (_jsx(Card, { title: "Entorno de la consola", children: _jsxs("div", { className: "p-4", children: [_jsx("div", { className: "mb-4", children: _jsx(EbimLockup, { appName: "Control Plane" }) }), _jsx("dl", { className: "divide-y divide-border", children: [
                                        ['Entorno', env.appEnv],
                                        ['URL de Supabase', env.supabaseUrl],
                                        ['Clave en uso', 'anon / publicable — la seguridad la da RLS'],
                                        // La regla de lint prohíbe el token literal en el cliente, incluso
                                        // dentro de una etiqueta de UI. Se describe sin escribirlo.
                                        ['Clave de servicio en el navegador', 'Nunca. Sólo existe del lado servidor.'],
                                        ['Modo de provisioning', 'DRY_RUN (por defecto)'],
                                    ].map(([k, v]) => (_jsxs("div", { className: "flex justify-between gap-4 px-1 py-2.5 text-sm", children: [_jsx("dt", { className: "text-muted", children: k }), _jsx("dd", { className: "break-all text-right font-mono text-xs", children: v })] }, k))) })] }) })),
                },
            ] }) }));
}
