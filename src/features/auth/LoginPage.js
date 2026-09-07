import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAppearance } from '@/hooks/useAppearance';
import { EbimMark } from '@/components/ui/EbimMark';
/* ==========================================================================
   Anatomía de login — contrato §4.5. OBLIGATORIA, no es elección de la app.

   Criterio de aceptación del contrato: tapando el nombre del producto, el
   usuario NO debe poder decir de qué app se trata, pero SÍ que es EBIM.

   Estructura fija (no varía entre apps):
     · tarjeta flotante centrada, radius 22, grid 1fr 1fr, max-w 1000, min-h 580,
       sombra difusa teñida de marca;
     · panel izquierdo en degradado de marca, en ESTE orden:
         1 isotipo EBIM arriba-izquierda (32px, blanco)
         2 wordmark del producto (40px, "e" inicial en acento)
         3 eyebrow en MAYÚSCULAS, letter-spacing .16em
         4 párrafo de valor de 2-3 líneas
         5 EXACTAMENTE 3 bullets (ni dos ni cinco)
         6 pie de confianza con escudo
       oculto en móvil (display:none), NO se apila;
     · panel derecho: labels ENCIMA del input, radius 11, ojo de contraseña,
       link de recuperar a la derecha, CTA ancho completo, UN solo link
       secundario, lockup "by EBIM" al pie tras un divisor.

   Lo que SÍ varía: nombre, eyebrow, párrafo, los 3 bullets, color de acento.
   ========================================================================== */
const BULLETS = [
    {
        title: 'Multi-SaaS desde un catálogo',
        description: 'eSupplier, EWM, TMS, GMAO y eChange bajo el mismo modelo.',
        icon: (_jsx("path", { d: "M4 7h16M4 12h16M4 17h10", strokeLinecap: "round", strokeWidth: "1.8", stroke: "currentColor", fill: "none" })),
    },
    {
        title: 'Partners y clientes gobernados',
        description: 'Acuerdos por producto, tenants y márgenes en un solo lugar.',
        icon: (_jsx("path", { d: "M12 4l7 3.5v5c0 4-3 6.6-7 7.5-4-.9-7-3.5-7-7.5v-5L12 4z", strokeLinejoin: "round", strokeWidth: "1.8", stroke: "currentColor", fill: "none" })),
    },
    {
        title: 'Costo y margen visibles',
        description: 'MRR, cobros, infraestructura y comisiones sobre datos reales.',
        icon: (_jsx("path", { d: "M5 19V9m5 10V5m5 14v-7m5 7V8", strokeLinecap: "round", strokeWidth: "1.8", stroke: "currentColor", fill: "none" })),
    },
];
export function LoginPage() {
    const { signIn } = useAuth();
    const { mode, toggleMode } = useAppearance();
    const navigate = useNavigate();
    const location = useLocation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    async function handleSubmit(event) {
        event.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            await signIn(email.trim(), password);
            const from = location.state?.from ?? '/';
            navigate(from, { replace: true });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsxs("div", { className: "relative flex min-h-screen items-center justify-center bg-bg p-4", children: [_jsxs("div", { className: "absolute right-5 top-5 flex items-center gap-2", children: [_jsx("span", { className: "rounded-field border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted", children: "ES" }), _jsx("button", { type: "button", onClick: toggleMode, "aria-label": mode === 'light' ? 'Activar modo oscuro' : 'Activar modo claro', className: "rounded-field border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted hover:text-fg", children: mode === 'light' ? '🌙 Oscuro' : '☀️ Claro' })] }), _jsxs("div", { className: "grid w-full max-w-[1000px] overflow-hidden rounded-login shadow-brand md:min-h-[580px] md:grid-cols-2", style: { background: 'var(--card)' }, children: [_jsxs("div", { className: "hidden flex-col justify-between p-10 text-white md:flex", style: { background: 'var(--hero-grad)' }, children: [_jsxs("div", { children: [_jsx(EbimMark, { size: 32, color: "#FFFFFF", animated: true }), _jsxs("h1", { className: "mt-9 text-[40px] font-extrabold leading-none tracking-tight", children: [_jsx("span", { style: { color: '#A8E6C4' }, children: "C" }), "ontrol Plane"] }), _jsx("p", { className: "mt-3 text-[11px] font-bold uppercase tracking-[0.16em] text-white/75", children: "Consola central de la suite EBIM" }), _jsx("p", { className: "mt-5 max-w-sm text-[15px] leading-relaxed text-white/90", children: "El lugar donde se decide qui\u00E9n vende qu\u00E9, sobre qu\u00E9 infraestructura corre cada cliente y cu\u00E1nto deja realmente cada producto. Un solo tablero para toda la suite." })] }), _jsx("ul", { className: "my-8 space-y-4", children: BULLETS.map((bullet) => (_jsxs("li", { className: "flex gap-3", children: [_jsx("span", { className: "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-white/15", children: _jsx("svg", { viewBox: "0 0 24 24", className: "h-[18px] w-[18px] text-white", "aria-hidden": true, children: bullet.icon }) }), _jsxs("span", { children: [_jsx("span", { className: "block text-sm font-bold", children: bullet.title }), _jsx("span", { className: "block text-[13px] leading-snug text-white/75", children: bullet.description })] })] }, bullet.title))) }), _jsxs("div", { className: "flex items-center gap-2 text-[12px] text-white/70", children: [_jsx("svg", { viewBox: "0 0 24 24", className: "h-4 w-4", fill: "none", stroke: "currentColor", "aria-hidden": true, children: _jsx("path", { d: "M12 3l7 3v6c0 4-3 6.7-7 7.8C8 18.7 5 16 5 12V6l7-3z", strokeWidth: "1.6", strokeLinejoin: "round" }) }), "Cifrado en tr\u00E1nsito y aislamiento de datos por cliente."] })] }), _jsxs("div", { className: "flex flex-col justify-center bg-card px-7 py-10 sm:px-10", children: [_jsx("div", { className: "mb-6 flex justify-center md:hidden", children: _jsx(EbimMark, { size: 34, color: "var(--brand-mark)", animated: true }) }), _jsx("h2", { className: "text-[22px] font-bold tracking-tight text-fg", children: "Ingresa a tu consola" }), _jsx("p", { className: "mt-1.5 text-sm text-muted", children: "Tu acceso lo crea el equipo de plataforma EBIM. Si a\u00FAn no tienes credenciales, solic\u00EDtalas a tu administrador \u2014 esta consola no permite auto-registro." }), _jsxs("form", { className: "mt-7 space-y-4", onSubmit: handleSubmit, noValidate: true, children: [_jsxs("div", { children: [_jsx("label", { className: "ebim-label", htmlFor: "login-email", children: "Correo corporativo" }), _jsx("input", { id: "login-email", type: "email", autoComplete: "username", required: true, className: "ebim-input", value: email, onChange: (e) => setEmail(e.target.value), placeholder: "nombre@empresa.com" })] }), _jsxs("div", { children: [_jsx("label", { className: "ebim-label", htmlFor: "login-password", children: "Contrase\u00F1a" }), _jsxs("div", { className: "relative", children: [_jsx("input", { id: "login-password", type: showPassword ? 'text' : 'password', autoComplete: "current-password", required: true, className: "ebim-input pr-11", value: password, onChange: (e) => setPassword(e.target.value) }), _jsx("button", { type: "button", onClick: () => setShowPassword((v) => !v), "aria-label": showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña', className: "absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted hover:text-fg", children: _jsxs("svg", { viewBox: "0 0 24 24", className: "h-4 w-4", fill: "none", stroke: "currentColor", "aria-hidden": true, children: [_jsx("path", { d: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z", strokeWidth: "1.7" }), _jsx("circle", { cx: "12", cy: "12", r: "3", strokeWidth: "1.7" }), showPassword ? _jsx("path", { d: "m4 20 16-16", strokeWidth: "1.7", strokeLinecap: "round" }) : null] }) })] }), _jsx("div", { className: "mt-1.5 text-right", children: _jsx("a", { className: "text-[13px] font-semibold text-accent-deep hover:underline", href: "#recuperar", children: "\u00BFOlvidaste tu contrase\u00F1a?" }) })] }), error ? (_jsx("p", { role: "alert", className: "rounded-field bg-danger-soft px-3 py-2.5 text-[13px] font-medium text-danger", children: error })) : null, _jsx("button", { type: "submit", disabled: submitting, className: "ebim-btn-primary w-full py-[14px] shadow-[0_10px_24px_-14px_var(--accent2)]", style: { height: 'auto' }, children: submitting ? 'Ingresando…' : 'Ingresar' })] }), _jsxs("p", { className: "mt-5 text-center text-[13px] text-muted", children: ["\u00BFNecesitas acceso?", ' ', _jsx("a", { className: "font-semibold text-accent-deep hover:underline", href: "#solicitar", children: "Solic\u00EDtalo al equipo de plataforma" })] }), _jsxs("div", { className: "mt-7 border-t border-border pt-5 text-center", children: [_jsx("span", { className: "text-[13px] font-bold text-fg", children: "Control Plane" }), _jsx("span", { className: "ml-1.5 text-[9.5px] font-bold tracking-[0.22em] text-muted", children: "BY EBIM" })] })] })] })] }));
}
