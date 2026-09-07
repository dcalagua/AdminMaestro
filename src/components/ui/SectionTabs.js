import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
export function SectionTabs({ tabs }) {
    const visible = tabs.filter((t) => !t.hidden);
    const [active, setActive] = useState(() => {
        const fromHash = window.location.hash.replace('#', '');
        return visible.some((t) => t.id === fromHash) ? fromHash : (visible[0]?.id ?? '');
    });
    useEffect(() => {
        const onHashChange = () => {
            const next = window.location.hash.replace('#', '');
            if (visible.some((t) => t.id === next))
                setActive(next);
        };
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, [visible]);
    // Si la pestaña activa desaparece (por permisos), se cae a la primera visible.
    useEffect(() => {
        if (visible.length > 0 && !visible.some((t) => t.id === active)) {
            setActive(visible[0].id);
        }
    }, [visible, active]);
    const current = visible.find((t) => t.id === active) ?? visible[0];
    return (_jsxs("div", { children: [_jsx("div", { className: "mb-4 flex justify-center border-b border-border", children: _jsx("div", { role: "tablist", "aria-label": "Secciones", className: "flex flex-wrap justify-center gap-1", children: visible.map((tab) => {
                        const isActive = tab.id === current?.id;
                        return (_jsx("button", { type: "button", role: "tab", id: `tab-${tab.id}`, "aria-selected": isActive, "aria-controls": `panel-${tab.id}`, className: `-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${isActive
                                ? 'border-accent text-accent-deep'
                                : 'border-transparent text-muted hover:text-fg'}`, onClick: () => {
                                setActive(tab.id);
                                window.location.hash = tab.id;
                            }, children: tab.label }, tab.id));
                    }) }) }), current ? (_jsx("div", { role: "tabpanel", id: `panel-${current.id}`, "aria-labelledby": `tab-${current.id}`, children: current.content })) : null] }));
}
/**
 * Tabs de ESTADO para listados (Todos / Activos / …).
 * El contrato prohíbe paneles de filtros multi-campo, pero permite estos tabs.
 */
export function StatusTabs({ options, value, onChange, }) {
    return (_jsx("div", { role: "tablist", "aria-label": "Filtro de estado", className: "flex flex-wrap gap-1", children: options.map((opt) => {
            const isActive = opt.id === value;
            return (_jsxs("button", { type: "button", role: "tab", "aria-selected": isActive, className: `rounded-field px-3 py-1.5 text-[13px] font-semibold transition-colors ${isActive
                    ? 'bg-accent-soft text-accent-deep'
                    : 'text-muted hover:bg-[color:var(--bg)] hover:text-fg'}`, onClick: () => onChange(opt.id), children: [opt.label, opt.count !== undefined ? (_jsx("span", { className: "ml-1.5 tabular-nums opacity-70", children: opt.count })) : null] }, opt.id));
        }) }));
}
