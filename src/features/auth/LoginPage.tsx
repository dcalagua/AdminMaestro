import { useEffect, useRef, useState } from 'react';
import { MoonIcon, SunIcon } from '@phosphor-icons/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAppearance } from '@/hooks/useAppearance';
import { EbimMark } from '@/components/ui/EbimMark';
import { requestPasswordReset } from './passwordReset';

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
    icon: (
      <path
        d="M4 7h16M4 12h16M4 17h10"
        strokeLinecap="round"
        strokeWidth="1.8"
        stroke="currentColor"
        fill="none"
      />
    ),
  },
  {
    title: 'Partners y clientes gobernados',
    description: 'Acuerdos por producto, tenants y márgenes en un solo lugar.',
    icon: (
      <path
        d="M12 4l7 3.5v5c0 4-3 6.6-7 7.5-4-.9-7-3.5-7-7.5v-5L12 4z"
        strokeLinejoin="round"
        strokeWidth="1.8"
        stroke="currentColor"
        fill="none"
      />
    ),
  },
  {
    title: 'Costo y margen visibles',
    description: 'MRR, cobros, infraestructura y comisiones sobre datos reales.',
    icon: (
      <path
        d="M5 19V9m5 10V5m5 14v-7m5 7V8"
        strokeLinecap="round"
        strokeWidth="1.8"
        stroke="currentColor"
        fill="none"
      />
    ),
  },
];

/**
 * Ayuda de acceso (spec §11.5). La solicitud de acceso NO es un formulario: las
 * cuentas se crean por invitación (M5) y se explica a quién pedirla.
 *
 * M5 · «¿Olvidaste tu contraseña?» sí es un flujo real: Supabase Auth envía al
 * correo del titular un enlace a `/bienvenida?mode=reset`. La respuesta es la
 * misma exista o no la cuenta.
 */
type HelpTopic = 'recover' | 'access';

const HELP_TEXT: Record<HelpTopic, { title: string; body: string }> = {
  recover: {
    title: 'Restablecer la contraseña',
    body: 'Te enviaremos un enlace a tu correo corporativo para crear una nueva contraseña. El enlace vence en una hora.',
  },
  access: {
    title: 'Solicitar acceso',
    body: 'Esta consola no permite auto-registro ni solicitudes en línea. Pide el acceso al equipo de plataforma EBIM (operador), indicando tu correo corporativo y tu organización.',
  },
};

export function LoginPage() {
  const { signIn, notice } = useAuth();
  const { mode, toggleMode } = useAppearance();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [help, setHelp] = useState<HelpTopic | null>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [reset, setReset] = useState<{ state: 'idle' | 'sending' | 'sent' | 'error'; message?: string }>({
    state: 'idle',
  });

  async function sendReset() {
    const target = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) {
      setReset({ state: 'error', message: 'Escribe arriba tu correo corporativo y vuelve a intentarlo.' });
      emailRef.current?.focus();
      return;
    }
    setReset({ state: 'sending' });
    try {
      await requestPasswordReset(target);
      setReset({
        state: 'sent',
        message: `Si ${target} tiene una cuenta, recibirás el enlace en unos minutos. Revisa también la carpeta de correo no deseado.`,
      });
    } catch (err) {
      setReset({ state: 'error', message: err instanceof Error ? err.message : 'No se pudo enviar el enlace.' });
    }
  }

  useEffect(() => {
    if (help) helpRef.current?.focus();
  }, [help]);

  const toggleHelp = (topic: HelpTopic) => {
    setReset({ state: 'idle' });
    setHelp((current) => (current === topic ? null : topic));
  };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg p-4">
      {/* (7) Controles de idioma/tema FLOTANDO sobre la página, fuera de la
          tarjeta: se comparten con el resto de pantallas de auth. */}
      <div className="absolute right-5 top-5 flex items-center gap-2">
        <span className="rounded-field border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted">
          ES
        </span>
        <button
          type="button"
          onClick={toggleMode}
          aria-label={mode === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
          className="rounded-field border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted hover:text-fg"
        >
          <span className="inline-flex items-center gap-1">
            {mode === 'light' ? <MoonIcon size={14} aria-hidden /> : <SunIcon size={14} aria-hidden />}
            {mode === 'light' ? 'Oscuro' : 'Claro'}
          </span>
        </button>
      </div>

      <div
        className="grid w-full max-w-[1000px] overflow-hidden rounded-login shadow-brand md:min-h-[580px] md:grid-cols-2"
        style={{ background: 'var(--card)' }}
      >
        {/* ---- PANEL IZQUIERDO — MARCA (oculto en móvil, NO se apila) ---- */}
        <div
          className="hidden flex-col justify-between p-10 text-white md:flex"
          style={{ background: 'var(--hero-grad)' }}
        >
          <div>
            {/* 1 · Isotipo EBIM arriba-izquierda, 32px, versión blanca. */}
            <EbimMark size={32} color="#FFFFFF" animated />

            {/* 2 · Wordmark: la "e" inicial en el acento, el resto en blanco. */}
            <h1 className="mt-9 text-[40px] font-extrabold leading-none tracking-tight">
              <span style={{ color: '#A8E6C4' }}>C</span>ontrol Plane
            </h1>

            {/* 3 · Eyebrow: dice qué ES, no qué hace. */}
            <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.16em] text-white/75">
              Consola central de la suite EBIM
            </p>

            {/* 4 · Párrafo de valor sobre el trabajo del usuario. */}
            <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-white/90">
              El lugar donde se decide quién vende qué, sobre qué infraestructura corre cada
              cliente y cuánto deja realmente cada producto. Un solo tablero para toda la suite.
            </p>
          </div>

          {/* 5 · EXACTAMENTE 3 bullets. */}
          <ul className="my-8 space-y-4">
            {BULLETS.map((bullet) => (
              <li key={bullet.title} className="flex gap-3">
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-white/15">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-white" aria-hidden>
                    {bullet.icon}
                  </svg>
                </span>
                <span>
                  <span className="block text-sm font-bold">{bullet.title}</span>
                  <span className="block text-[13px] leading-snug text-white/75">
                    {bullet.description}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {/* 6 · Pie de confianza. */}
          <div className="flex items-center gap-2 text-[12px] text-white/70">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" aria-hidden>
              <path
                d="M12 3l7 3v6c0 4-3 6.7-7 7.8C8 18.7 5 16 5 12V6l7-3z"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
            Cifrado en tránsito y aislamiento de datos por cliente.
          </div>
        </div>

        {/* ---- PANEL DERECHO — FORMULARIO ---- */}
        <div className="flex flex-col justify-center bg-card px-7 py-10 sm:px-10">
          {/* Isotipo visible en móvil, donde el panel de marca está oculto. */}
          <div className="mb-6 flex justify-center md:hidden">
            <EbimMark size={34} color="var(--brand-mark)" animated />
          </div>

          {/* 8 · Encabezado + subtítulo que dice DE DÓNDE sale la credencial.
              En portales B2B donde al usuario lo dan de alta, su ausencia es la
              causa nº1 de tickets del primer día (contrato §4.5). */}
          <h2 className="text-[22px] font-bold tracking-tight text-fg">Ingresa a tu consola</h2>
          <p className="mt-1.5 text-sm text-muted">
            Tu acceso lo crea el equipo de plataforma EBIM. Si aún no tienes credenciales,
            solicítalas a tu administrador — esta consola no permite auto-registro.
          </p>

          <form className="mt-7 space-y-4" onSubmit={handleSubmit} noValidate>
            <div>
              {/* 9 · Label ENCIMA del input, sin icono de inicio. */}
              <label className="ebim-label" htmlFor="login-email">
                Correo corporativo
              </label>
              <input
                ref={emailRef}
                id="login-email"
                type="email"
                autoComplete="username"
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'login-error' : undefined}
                className="ebim-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nombre@empresa.com"
              />
            </div>

            <div>
              <label className="ebim-label" htmlFor="login-password">
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  className="ebim-input pr-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {/* 10 · Toggle de ver contraseña al final del campo. */}
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted hover:text-fg"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" aria-hidden>
                    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" strokeWidth="1.7" />
                    <circle cx="12" cy="12" r="3" strokeWidth="1.7" />
                    {showPassword ? <path d="m4 20 16-16" strokeWidth="1.7" strokeLinecap="round" /> : null}
                  </svg>
                </button>
              </div>
              {/* 11 · Recuperar, alineado a la derecha, bajo el campo. Abre el panel
                  que envía el enlace de restablecimiento (M5). */}
              <div className="mt-1.5 text-right">
                <button
                  type="button"
                  className="rounded text-[13px] font-semibold text-accent-deep hover:underline"
                  aria-expanded={help === 'recover'}
                  aria-controls="login-help"
                  onClick={() => toggleHelp('recover')}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            </div>

            {notice && !error ? (
              <p role="status" className="rounded-field bg-warn-soft px-3 py-2.5 text-[13px] font-medium text-warn">
                {notice}
              </p>
            ) : null}

            {error ? (
              <p
                id="login-error"
                role="alert"
                className="rounded-field bg-danger-soft px-3 py-2.5 text-[13px] font-medium text-danger"
              >
                {error}
              </p>
            ) : null}

            {/* 12 · CTA primario ancho completo, padding vertical 14px. */}
            <button
              type="submit"
              disabled={submitting}
              className="ebim-btn-primary w-full py-[14px] shadow-[0_10px_24px_-14px_var(--accent2)]"
              style={{ height: 'auto' }}
            >
              {submitting ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>

          {/* 13 · UN SOLO link secundario, en texto corriente. Apunta a la ayuda
              de esta misma página: no existe un formulario de solicitud. */}
          <p className="mt-5 text-center text-[13px] text-muted">
            ¿Necesitas acceso?{' '}
            <a
              className="font-semibold text-accent-deep hover:underline"
              href="#login-help"
              aria-expanded={help === 'access'}
              aria-controls="login-help"
              onClick={(e) => {
                e.preventDefault();
                toggleHelp('access');
              }}
            >
              Solicítalo al equipo de plataforma
            </a>
          </p>

          {help ? (
            <div
              id="login-help"
              ref={helpRef}
              tabIndex={-1}
              role="note"
              aria-labelledby="login-help-title"
              className="mt-4 rounded-field border border-border bg-[color:var(--bg)] px-4 py-3 text-[13px]"
            >
              <p id="login-help-title" className="font-semibold text-fg">
                {HELP_TEXT[help].title}
              </p>
              <p className="mt-1 text-muted">{HELP_TEXT[help].body}</p>
              {help === 'recover' ? (
                <div className="mt-3">
                  {reset.state === 'sent' ? (
                    <p role="status" className="text-ok">{reset.message}</p>
                  ) : (
                    <button
                      type="button"
                      className="ebim-btn-primary"
                      disabled={reset.state === 'sending'}
                      aria-busy={reset.state === 'sending' || undefined}
                      onClick={() => void sendReset()}
                    >
                      {reset.state === 'sending' ? 'Enviando…' : 'Enviar enlace de restablecimiento'}
                    </button>
                  )}
                  {reset.state === 'error' ? (
                    <p role="alert" className="mt-2 text-danger">{reset.message}</p>
                  ) : null}
                </div>
              ) : null}
              <button
                type="button"
                className="mt-2 block rounded text-[13px] font-semibold text-accent-deep hover:underline"
                onClick={() => setHelp(null)}
              >
                {help === 'recover' ? 'Volver' : 'Entendido'}
              </button>
            </div>
          ) : null}

          {/* 14 · Lockup "by EBIM" al pie, tras un divisor sutil, centrado. */}
          <div className="mt-7 border-t border-border pt-5 text-center">
            <span className="text-[13px] font-bold text-fg">Control Plane</span>
            <span className="ml-1.5 text-[9.5px] font-bold tracking-[0.22em] text-muted">
              BY EBIM
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
