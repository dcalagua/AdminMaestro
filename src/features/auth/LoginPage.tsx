import { useEffect, useRef, useState } from 'react';
import { ChartLineUpIcon, HandshakeIcon, StackIcon, WarningCircleIcon, InfoIcon } from '@phosphor-icons/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { AuthLayout, PasswordInput, type BrandPanelContent } from './AuthLayout';
import { requestPasswordReset } from './passwordReset';

/*
 * Login — anatomía obligatoria del contrato §4.5 (ver AuthLayout). Aquí solo
 * varía el contenido: eyebrow, párrafo, los 3 bullets y el formulario.
 */
const BRAND: BrandPanelContent = {
  eyebrow: 'Consola central de la suite EBIM',
  paragraph:
    'Gerencia, finanzas y operación sobre los mismos datos: quién vende qué, cuánto se factura y se cobra, y cuánto deja realmente cada producto.',
  bullets: [
    {
      icon: ChartLineUpIcon,
      title: 'Ingresos recurrentes a la vista',
      description: 'MRR, cobranza y cartera vencida de toda la suite.',
    },
    {
      icon: HandshakeIcon,
      title: 'Clientes y partners gobernados',
      description: 'Contratos, tenants y comisiones en un solo lugar.',
    },
    {
      icon: StackIcon,
      title: 'Un catálogo, todos los productos',
      description: 'eSupplier, EWM, TMS, GMAO y eChange bajo el mismo modelo.',
    },
  ],
};

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
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <AuthLayout brand={BRAND}>
      {/* Encabezado + subtítulo que dice DE DÓNDE sale la credencial. En
          portales B2B donde al usuario lo dan de alta, su ausencia es la causa
          nº1 de tickets del primer día (contrato §4.5). */}
      <h1 className="text-h1 text-fg">Ingresa a tu consola</h1>
      <p className="mt-2 text-body text-fg-2">
        Tu acceso lo crea el equipo de plataforma EBIM. Si aún no tienes credenciales, solicítalas a tu
        administrador: esta consola no permite auto-registro.
      </p>

      <form className="mt-7 space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          {/* Label ENCIMA del input, sin icono de inicio. */}
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
          <div className="flex items-baseline justify-between gap-3">
            <label className="ebim-label" htmlFor="login-password">
              Contraseña
            </label>
            {/* Recuperar, a la derecha. Abre el panel que envía el enlace de
                restablecimiento (M5). */}
            <button
              type="button"
              className="rounded text-compact font-semibold text-accent-deep hover:underline"
              aria-expanded={help === 'recover'}
              aria-controls="login-help"
              onClick={() => toggleHelp('recover')}
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>
          <PasswordInput
            id="login-password"
            autoComplete="current-password"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {notice && !error ? (
          <p role="status" className="flex items-start gap-2 rounded-field bg-warn-soft px-3 py-2.5 text-compact font-medium text-warn">
            <InfoIcon size={18} className="mt-px shrink-0" aria-hidden />
            {notice}
          </p>
        ) : null}

        {error ? (
          <p
            id="login-error"
            role="alert"
            className="flex items-start gap-2 rounded-field bg-danger-soft px-3 py-2.5 text-compact font-medium text-danger"
          >
            <WarningCircleIcon size={18} className="mt-px shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}

        {/* CTA primario ancho completo. */}
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting || undefined}
          className="ebim-btn-primary ebim-btn-lg w-full text-[15px]"
        >
          {submitting ? <span className="ebim-spinner" aria-hidden /> : null}
          {submitting ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>

      {/* UN SOLO link secundario, en texto corriente. Apunta a la ayuda de esta
          misma página: no existe un formulario de solicitud. */}
      <p className="mt-6 text-center text-compact text-muted">
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
          className="ebim-success-enter mt-4 rounded-field border border-border bg-sunken px-4 py-3 text-compact"
        >
          <p id="login-help-title" className="font-semibold text-fg">
            {HELP_TEXT[help].title}
          </p>
          <p className="mt-1 text-fg-2">{HELP_TEXT[help].body}</p>
          {help === 'recover' ? (
            <div className="mt-3">
              {reset.state === 'sent' ? (
                <p role="status" className="text-ok">
                  {reset.message}
                </p>
              ) : (
                <button
                  type="button"
                  className="ebim-btn-primary ebim-btn-sm"
                  disabled={reset.state === 'sending'}
                  aria-busy={reset.state === 'sending' || undefined}
                  onClick={() => void sendReset()}
                >
                  {reset.state === 'sending' ? 'Enviando…' : 'Enviar enlace de restablecimiento'}
                </button>
              )}
              {reset.state === 'error' ? (
                <p role="alert" className="mt-2 text-danger">
                  {reset.message}
                </p>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className="mt-2 block rounded text-compact font-semibold text-accent-deep hover:underline"
            onClick={() => setHelp(null)}
          >
            {help === 'recover' ? 'Volver' : 'Entendido'}
          </button>
        </div>
      ) : null}
    </AuthLayout>
  );
}
