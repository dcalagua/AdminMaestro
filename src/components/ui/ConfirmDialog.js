import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
/**
 * Confirmación para operaciones destructivas o de alto impacto.
 * Requisito UX del prompt fase 9. Bloquea el foco dentro del diálogo y cierra
 * con Escape.
 */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', tone = 'danger', onConfirm, onCancel, }) {
    const confirmRef = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        confirmRef.current?.focus();
        const onKey = (e) => {
            if (e.key === 'Escape')
                onCancel();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onCancel]);
    if (!open)
        return null;
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4", role: "dialog", "aria-modal": "true", "aria-labelledby": "confirm-title", children: _jsxs("div", { className: "ebim-card w-full max-w-md p-5 shadow-pop", children: [_jsx("h2", { id: "confirm-title", className: "text-base font-bold text-fg", children: title }), _jsx("p", { className: "mt-2 text-sm text-muted", children: message }), _jsxs("div", { className: "mt-5 flex justify-end gap-2", children: [_jsx("button", { type: "button", className: "ebim-btn-ghost", onClick: onCancel, children: cancelLabel }), _jsx("button", { ref: confirmRef, type: "button", className: tone === 'danger' ? 'ebim-btn-danger' : 'ebim-btn-primary', onClick: onConfirm, children: confirmLabel })] })] }) }));
}
