import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function EbimMark({ size = 32, color = 'currentColor', animated = false, className = '', }) {
    return (_jsxs("svg", { width: size, height: size, viewBox: "0 0 200 200", fill: color, role: "img", "aria-label": "EBIM", className: `${animated ? 'animate-spin-stop' : ''} ${className}`.trim(), children: [_jsx("path", { d: "M100 18c14 0 25 11 25 25s-11 25-25 25-25-11-25-25 11-25 25-25z" }), _jsx("path", { d: "M157 51c10 10 10 26 0 36s-26 10-36 0-10-26 0-36 26-10 36 0z" }), _jsx("path", { d: "M182 100c0 14-11 25-25 25s-25-11-25-25 11-25 25-25 25 11 25 25z" }), _jsx("path", { d: "M157 149c10 10 10 26 0 36s-26 10-36 0-10-26 0-36 26-10 36 0z", opacity: ".82" }), _jsx("path", { d: "M100 132c14 0 25 11 25 25s-11 25-25 25-25-11-25-25 11-25 25-25z", opacity: ".64" }), _jsx("path", { d: "M43 75c14 0 25 11 25 25s-11 25-25 25-25-11-25-25 11-25 25-25z", opacity: ".46" })] }));
}
/**
 * Lockup de suite: `[isotipo] <NombreApp>` + `BY EBIM` debajo.
 * El nombre de app varía; "by EBIM" es fijo (contrato §4.6 y §4.5 punto 14).
 */
export function EbimLockup({ appName = 'Control Plane', color, markColor, size = 30, }) {
    return (_jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx(EbimMark, { size: size, color: markColor ?? color ?? 'var(--brand-mark)', animated: true }), _jsxs("div", { className: "leading-none", style: color ? { color } : undefined, children: [_jsx("div", { className: "text-[19px] font-extrabold tracking-tight", children: appName }), _jsx("div", { className: "mt-[3px] text-[9.5px] font-bold tracking-[0.22em] opacity-85", children: "BY EBIM" })] })] }));
}
