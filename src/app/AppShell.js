import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useAppearance } from '@/hooks/useAppearance';
import { navGroupsFor } from './navigation';
import { EbimMark } from '@/components/ui/EbimMark';
import { PLATFORM_ROLE_LABEL, ORG_ROLE_LABEL } from '@/types/domain';
import { env } from '@/lib/env';
/**
 * Shell administrativo.
 *
 * Topbar: tratamiento (A) NEUTRO del contrato §4.4 — `var(--card)` + borde, con
 * la marca viviendo sólo en el sidebar. El contrato admite exactamente dos
 * tratamientos y prohíbe inventar un tercero con un tinte arbitrario del accent.
 */
export function AppShell() {
    const { roles, persona, signOut } = useAuth();
    const { mode, density, toggleMode, setDensity } = useAppearance();
    const location = useLocation();
    const [mobileOpen, setMobileOpen] = useState(false);
    const groups = navGroupsFor(persona);
    const roleLabel = roles?.platformRole
        ? PLATFORM_ROLE_LABEL[roles.platformRole]
        : roles?.organizations[0]
            ? `${ORG_ROLE_LABEL[roles.organizations[0].role]} · ${roles.organizations[0].displayName}`
            : roles?.salesAgentId
                ? 'Comercial'
                : 'Usuario de tenant';
    return (_jsxs("div", { className: "flex min-h-screen bg-bg", children: [_jsxs("aside", { className: `fixed inset-y-0 left-0 z-40 w-[248px] shrink-0 overflow-y-auto text-white transition-transform lg:static lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`, style: { background: 'var(--sidebar)' }, children: [_jsxs("div", { className: "flex items-center gap-2.5 px-5 py-5", children: [_jsx(EbimMark, { size: 28, color: "#FFFFFF", animated: true }), _jsxs("div", { className: "leading-none", children: [_jsx("div", { className: "text-[15px] font-extrabold tracking-tight", children: "Control Plane" }), _jsx("div", { className: "mt-[3px] text-[9px] font-bold tracking-[0.22em] text-white/70", children: "BY EBIM" })] })] }), _jsx("nav", { className: "px-3 pb-8", children: groups.map(({ group, items }) => (_jsxs("div", { className: "mb-4", children: [_jsx("div", { className: "px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/50", children: group }), items.map((item) => (_jsx(NavLink, { to: item.to, end: item.to === '/', onClick: () => setMobileOpen(false), className: ({ isActive }) => `block rounded-field px-2.5 py-2 text-[13.5px] font-medium transition-colors ${isActive
                                        ? 'bg-white/20 font-semibold text-white'
                                        : 'text-white/80 hover:bg-white/10 hover:text-white'}`, children: item.label }, item.to)))] }, group))) })] }), mobileOpen ? (_jsx("button", { type: "button", "aria-label": "Cerrar men\u00FA", className: "fixed inset-0 z-30 bg-black/40 lg:hidden", onClick: () => setMobileOpen(false) })) : null, _jsxs("div", { className: "flex min-w-0 flex-1 flex-col", children: [_jsxs("header", { className: "sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card px-4", children: [_jsx("button", { type: "button", className: "rounded-field border border-border p-1.5 text-muted lg:hidden", "aria-label": "Abrir men\u00FA", onClick: () => setMobileOpen(true), children: _jsx("svg", { viewBox: "0 0 24 24", className: "h-4 w-4", fill: "none", stroke: "currentColor", "aria-hidden": true, children: _jsx("path", { d: "M4 7h16M4 12h16M4 17h16", strokeWidth: "1.8", strokeLinecap: "round" }) }) }), _jsx("div", { className: "min-w-0 flex-1", children: _jsx("span", { className: "text-xs text-muted", children: location.pathname }) }), env.appEnv !== 'PRD' ? (_jsx("span", { className: "rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-bold text-warn", children: env.appEnv })) : null, _jsxs("label", { className: "hidden items-center gap-1.5 text-xs text-muted sm:flex", children: [_jsx("span", { className: "sr-only", children: "Densidad" }), _jsxs("select", { className: "rounded-field border border-border bg-card px-2 py-1 text-xs text-fg", value: density, onChange: (e) => setDensity(e.target.value), "aria-label": "Densidad de la interfaz", children: [_jsx("option", { value: "comoda", children: "C\u00F3moda" }), _jsx("option", { value: "equilibrada", children: "Equilibrada" }), _jsx("option", { value: "compacta", children: "Compacta" })] })] }), _jsx("button", { type: "button", onClick: toggleMode, className: "rounded-field border border-border px-2 py-1 text-xs font-semibold text-muted hover:text-fg", "aria-label": mode === 'light' ? 'Activar modo oscuro' : 'Activar modo claro', children: mode === 'light' ? '🌙' : '☀️' }), _jsxs("div", { className: "hidden text-right sm:block", children: [_jsx("div", { className: "text-[13px] font-semibold leading-tight text-fg", children: roles?.fullName ?? roles?.email ?? 'Sesión' }), _jsx("div", { className: "text-[11px] leading-tight text-muted", children: roleLabel })] }), _jsx("button", { type: "button", className: "ebim-btn-ghost h-8 px-3 text-xs", onClick: () => void signOut(), children: "Salir" })] }), _jsx("main", { className: "flex-1", children: _jsx(Outlet, {}) })] })] }));
}
