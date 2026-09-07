import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Component } from 'react';
import { EbimLockup } from './EbimMark';
/**
 * Error boundary de la aplicación.
 *
 * Muestra el mensaje del error pero NUNCA el stack en producción: un stack
 * expone rutas internas y nombres de módulos que no aportan al usuario.
 */
export class ErrorBoundary extends Component {
    state = { error: null };
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        console.error('[ebim-control-plane] error no capturado', error, info.componentStack);
    }
    render() {
        if (!this.state.error)
            return this.props.children;
        return (_jsx("div", { className: "flex min-h-screen items-center justify-center bg-bg p-6", children: _jsxs("div", { className: "ebim-card w-full max-w-lg p-8 text-center", children: [_jsx("div", { className: "mb-5 flex justify-center", children: _jsx(EbimLockup, { appName: "Control Plane" }) }), _jsx("h1", { className: "text-lg font-bold text-fg", children: "Algo sali\u00F3 mal" }), _jsx("p", { className: "mt-2 text-sm text-muted", children: "La consola encontr\u00F3 un error inesperado. Puedes recargar la p\u00E1gina; si el problema persiste, comparte el detalle con el equipo de plataforma." }), _jsx("pre", { className: "mt-4 overflow-x-auto rounded-field bg-[color:var(--bg)] p-3 text-left text-xs text-danger", children: this.state.error.message }), _jsx("button", { type: "button", className: "ebim-btn-primary mt-5", onClick: () => window.location.reload(), children: "Recargar la consola" })] }) }));
    }
}
