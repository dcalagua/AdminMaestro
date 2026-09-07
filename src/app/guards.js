import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { LoadingState, PageContainer, Card, EmptyState } from '@/components/ui/primitives';
/** Exige sesión activa. Recuerda la ruta pedida para volver tras el login. */
export function RequireAuth({ children }) {
    const { session, loading } = useAuth();
    const location = useLocation();
    if (loading)
        return _jsx(LoadingState, { label: "Verificando sesi\u00F3n\u2026" });
    if (!session) {
        return _jsx(Navigate, { to: "/login", replace: true, state: { from: location.pathname } });
    }
    return _jsx(_Fragment, { children: children });
}
/**
 * Restringe una ruta a ciertos perfiles.
 *
 * IMPORTANTE: esto es UX, no autorización. La autorización real vive en las
 * políticas RLS: aunque alguien fuerce la URL, las consultas devuelven cero
 * filas. Este guard sólo evita mostrar una pantalla vacía y confusa.
 */
export function RequirePersona({ personas, children, }) {
    const { persona, loading } = useAuth();
    if (loading)
        return _jsx(LoadingState, {});
    if (!personas.includes(persona)) {
        return (_jsx(PageContainer, { title: "Sin acceso a esta secci\u00F3n", children: _jsx(Card, { children: _jsx(EmptyState, { title: "Tu rol no tiene acceso a esta secci\u00F3n", description: "Si crees que deber\u00EDas verla, p\u00EDdele al equipo de plataforma EBIM que revise tus permisos. El contenido est\u00E1 protegido en la base de datos, no s\u00F3lo en el men\u00FA." }) }) }));
    }
    return _jsx(_Fragment, { children: children });
}
