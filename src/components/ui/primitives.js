import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ==========================================================================
   Primitivos de UI del Control Plane.

   Deliberadamente pequeños: el objetivo es que las pantallas se lean igual
   entre sí, no construir una librería. Los colores salen SIEMPRE de tokens
   (`src/app/tokens.css`) para soportar theming/white-label — contrato §4.3.
   ========================================================================== */
export function PageContainer({ title, description, actions, breadcrumbs, children, }) {
    return (_jsxs("div", { className: "mx-auto w-full max-w-[1440px] px-6 py-6", children: [breadcrumbs ? _jsx("div", { className: "mb-3", children: breadcrumbs }) : null, _jsxs("header", { className: "mb-5 flex flex-wrap items-start justify-between gap-3", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-[22px] font-bold tracking-tight text-fg", children: title }), description ? _jsx("p", { className: "mt-1 max-w-3xl text-sm text-muted", children: description }) : null] }), actions ? _jsx("div", { className: "flex items-center gap-2", children: actions }) : null] }), children] }));
}
export function Card({ title, description, actions, children, className = '', }) {
    return (_jsxs("section", { className: `ebim-card ${className}`, children: [title ? (_jsxs("div", { className: "flex items-start justify-between gap-3 border-b border-border px-4 py-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-bold text-fg", children: title }), description ? _jsx("p", { className: "mt-0.5 text-xs text-muted", children: description }) : null] }), actions] })) : null, children] }));
}
/** Tarjeta de KPI. `value` siempre es un dato ya formateado. */
export function StatCard({ label, value, hint, tone = 'neutral', }) {
    const toneClass = {
        neutral: 'text-fg',
        ok: 'text-ok',
        warn: 'text-warn',
        danger: 'text-danger',
    }[tone];
    return (_jsxs("div", { className: "ebim-card p-4", children: [_jsx("div", { className: "text-[11px] font-bold uppercase tracking-wider text-muted", children: label }), _jsx("div", { className: `mt-1.5 text-2xl font-bold tabular-nums ${toneClass}`, children: value }), hint ? _jsx("div", { className: "mt-1 text-xs text-muted", children: hint }) : null] }));
}
export function Badge({ children, tone = 'neutral' }) {
    const tones = {
        neutral: 'bg-[color:var(--border)] text-fg',
        ok: 'bg-ok-soft text-ok',
        warn: 'bg-warn-soft text-warn',
        danger: 'bg-danger-soft text-danger',
        info: 'bg-info-soft text-info',
        // `accent-deep` y no `accent`: regla AA del contrato §4.4 para TEXTO.
        accent: 'bg-accent-soft text-accent-deep',
    };
    return (_jsx("span", { className: `inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`, children: children }));
}
/* ---- Estados de pantalla (contrato/DESIGN-BRIEF: vacío, carga, error) ---- */
export function LoadingState({ label = 'Cargando…' }) {
    return (_jsxs("div", { className: "flex items-center justify-center gap-3 px-4 py-14 text-sm text-muted", children: [_jsx("span", { className: "h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent", "aria-hidden": true }), _jsx("span", { role: "status", children: label })] }));
}
export function EmptyState({ title, description, action, }) {
    return (_jsxs("div", { className: "px-4 py-14 text-center", children: [_jsx("p", { className: "text-sm font-semibold text-fg", children: title }), description ? _jsx("p", { className: "mx-auto mt-1 max-w-md text-sm text-muted", children: description }) : null, action ? _jsx("div", { className: "mt-4", children: action }) : null] }));
}
export function ErrorState({ error, onRetry }) {
    const message = error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
    return (_jsxs("div", { className: "px-4 py-12 text-center", role: "alert", children: [_jsx("p", { className: "text-sm font-semibold text-danger", children: "No se pudo cargar la informaci\u00F3n" }), _jsx("p", { className: "mx-auto mt-1 max-w-lg text-sm text-muted", children: message }), onRetry ? (_jsx("button", { type: "button", className: "ebim-btn-ghost mt-4", onClick: onRetry, children: "Reintentar" })) : null] }));
}
/**
 * Buscador único de listados — contrato §8 / regla `esupplier-022`.
 *
 * DELIBERADAMENTE no acepta filtros multi-campo: un solo campo de búsqueda
 * general cubre ~90% de los casos y evita fragmentar la pantalla. Los tabs de
 * estado sí están permitidos y viven en `SectionTabs`.
 */
export function SearchBar({ value, onChange, placeholder = 'Buscar…', right, }) {
    return (_jsxs("div", { className: "flex flex-wrap items-center gap-2 border-b border-border px-4 py-3", children: [_jsxs("div", { className: "relative min-w-[240px] flex-1", children: [_jsx("input", { type: "search", className: "ebim-input pl-9", value: value, placeholder: placeholder, "aria-label": placeholder, onChange: (e) => onChange(e.target.value) }), _jsxs("svg", { className: "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted", viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: "1.8", "aria-hidden": true, children: [_jsx("circle", { cx: "9", cy: "9", r: "6" }), _jsx("path", { d: "m17 17-3.6-3.6", strokeLinecap: "round" })] })] }), right] }));
}
export function DataTable({ columns, children, }) {
    return (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full border-collapse", children: [_jsx("thead", { className: "border-b border-border bg-[color:var(--bg)]", children: _jsx("tr", { children: columns.map((c) => (_jsx("th", { scope: "col", className: "ebim-th", children: c }, c))) }) }), _jsx("tbody", { className: "divide-y divide-border", children: children })] }) }));
}
