import { jsx as _jsx } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { PageContainer, Card, EmptyState } from '@/components/ui/primitives';
export function NotFoundPage() {
    return (_jsx(PageContainer, { title: "P\u00E1gina no encontrada", children: _jsx(Card, { children: _jsx(EmptyState, { title: "404 \u00B7 Esta ruta no existe en la consola", description: "Puede que el enlace est\u00E9 desactualizado o que la secci\u00F3n haya cambiado de nombre.", action: _jsx(Link, { className: "ebim-btn-primary", to: "/", children: "Volver al dashboard" }) }) }) }));
}
