import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckIcon,
  CircleIcon,
  EnvelopeSimpleIcon,
  KeyIcon,
  LinkBreakIcon,
  SignInIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { SuccessCheck } from '@/components/ui/SuccessCheck';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { AuthLayout, PasswordInput, type BrandPanelContent } from './AuthLayout';
import {
  establishWelcomeSession,
  passwordProblem,
  passwordStrength,
  type PasswordStrengthLevel,
  type WelcomeMode,
} from './welcomeSession';

/**
 * M5 · `/bienvenida` (pública, fuera de RequireAuth/AppShell).
 *
 * Recibe la sesión del enlace de invitación o de restablecimiento y pide fijar
 * la contraseña (`auth.updateUser`). Tras una invitación marca aceptadas las
 * invitaciones del usuario (`accept_my_invitations`) y entra a la consola.
 * Si el enlace venció o ya se usó, lo dice sin tecnicismos.
 *
 * Misma anatomía que el login (AuthLayout, U-04): cambia el panel de marca
 * según sea primer ingreso o recuperación, y el formulario añade un medidor
 * de fortaleza (solo UX: la regla que bloquea es `passwordProblem`).
 */
const BRAND: Record<WelcomeMode, BrandPanelContent> = {
  invite: {
    eyebrow: 'Primer ingreso',
    paragraph:
      'Tu acceso a la consola ya fue creado por el equipo de plataforma EBIM. Solo falta que elijas tu contraseña.',
    bullets: [
      { icon: KeyIcon, title: 'Una contraseña solo tuya', description: 'Nadie en EBIM la conoce ni puede verla.' },
      { icon: LinkBreakIcon, title: 'Enlace de un solo uso', description: 'Vence pronto y deja de servir al usarse.' },
      {
        icon: SignInIcon,
        title: 'Entras directo a tu consola',
        description: 'Con los permisos que te asignó tu administrador.',
      },
    ],
  },
  reset: {
    eyebrow: 'Recuperación de acceso',
    paragraph: 'Pediste restablecer tu contraseña. Elige una nueva y vuelve a tu consola en un paso.',
    bullets: [
      { icon: KeyIcon, title: 'La anterior deja de servir', description: 'Solo funcionará la contraseña que elijas ahora.' },
      { icon: LinkBreakIcon, title: 'Enlace de un solo uso', description: 'Vence en una hora y deja de servir al usarse.' },
      {
        icon: SignInIcon,
        title: 'Tus permisos no cambian',
        description: 'Entras con el mismo acceso que tenías.',
      },
    ],
  },
};

const STRENGTH_FILL: Record<PasswordStrengthLevel, string> = {
  0: 'bg-[color:var(--border)]',
  1: 'bg-danger',
  2: 'bg-warn',
  3: 'bg-accent',
  4: 'bg-ok',
};
const STRENGTH_TEXT: Record<PasswordStrengthLevel, string> = {
  0: 'text-muted',
  1: 'text-danger',
  2: 'text-warn',
  3: 'text-accent-deep',
  4: 'text-ok',
};
type Phase =
  | { kind: 'checking' }
  | { kind: 'form'; mode: WelcomeMode }
  | { kind: 'error'; message: string }
  | { kind: 'done' };

export function WelcomePage() {
  const navigate = useNavigate();
  const { session, refreshRoles } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const result = await establishWelcomeSession();
      if (result.status === 'ok') {
        setPhase({ kind: 'form', mode: result.mode });
        return;
      }
      if (result.status === 'error') {
        setPhase({ kind: 'error', message: result.message });
        return;
      }
      // Sin tokens en la URL: sirve si ya hay sesión (p. ej. recargó la página).
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        const reset = new URLSearchParams(window.location.search).get('mode') === 'reset';
        setPhase({ kind: 'form', mode: reset ? 'reset' : 'invite' });
      } else {
        setPhase({
          kind: 'error',
          message:
            'Abre esta página desde el enlace que recibiste. Si el enlace venció, pide una nueva invitación a tu administrador o usa «¿Olvidaste tu contraseña?».',
        });
      }
    })();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(
          /weak|short|characters/i.test(updateError.message)
            ? 'La contraseña es demasiado débil. Usa una más larga, con letras y números.'
            : /same|different/i.test(updateError.message)
              ? 'La nueva contraseña debe ser distinta de la anterior.'
              : 'No se pudo guardar la contraseña. Vuelve a abrir el enlace o pide uno nuevo.',
        );
        return;
      }
      // El rastro de la invitación pasa a ACCEPTED; si falla no bloquea el ingreso.
      await supabase.rpc('accept_my_invitations', {});
      await refreshRoles();
      setPhase({ kind: 'done' });
      navigate('/', { replace: true });
    } finally {
      setSaving(false);
    }
  }

  const mode: WelcomeMode =
    phase.kind === 'form'
      ? phase.mode
      : new URLSearchParams(window.location.search).get('mode') === 'reset'
        ? 'reset'
        : 'invite';
  const strength = passwordStrength(password);

  return (
    <AuthLayout brand={BRAND[mode]}>
      {phase.kind === 'checking' ? (
        <p role="status" className="flex items-center justify-center gap-2.5 py-16 text-body text-fg-2">
          <span className="ebim-spinner" aria-hidden />
          Verificando tu enlace…
        </p>
      ) : phase.kind === 'error' ? (
        <div role="alert">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
            <LinkBreakIcon size={26} weight="duotone" aria-hidden />
          </span>
          <h1 className="mt-5 text-h1 text-fg">No pudimos abrir tu enlace</h1>
          <p className="mt-2 text-body text-fg-2">{phase.message}</p>
          <Link to="/login" className="ebim-btn-primary ebim-btn-lg mt-7 w-full">
            Ir al ingreso
          </Link>
        </div>
      ) : phase.kind === 'done' ? (
        <div role="status" className="ebim-success-enter py-12 text-center">
          <SuccessCheck />
          <p className="mt-4 text-h2 text-fg">Contraseña guardada</p>
          <p className="mt-1 text-body text-fg-2">Entrando a la consola…</p>
        </div>
      ) : (
        <>
          <h1 className="text-h1 text-fg">{mode === 'reset' ? 'Crea una nueva contraseña' : 'Te damos la bienvenida'}</h1>
          <p className="mt-2 text-body text-fg-2">
            {mode === 'reset'
              ? 'Elige una contraseña nueva para tu cuenta.'
              : 'Tu acceso ya está creado. Elige una contraseña para ingresar en adelante.'}
          </p>
          {session?.user?.email ? (
            <p className="mt-4 inline-flex max-w-full items-center gap-2 self-start rounded-full bg-accent-soft px-3 py-1.5 text-compact text-fg">
              <EnvelopeSimpleIcon size={16} className="shrink-0 text-accent-deep" aria-hidden />
              <span className="sr-only">Cuenta: </span>
              <strong className="truncate font-semibold">{session.user.email}</strong>
            </p>
          ) : null}

          <form className="mt-6 space-y-4" onSubmit={(e) => void submit(e)} noValidate>
            <div>
              <label className="ebim-label" htmlFor="welcome-password">
                Nueva contraseña
              </label>
              <PasswordInput
                id="welcome-password"
                autoComplete="new-password"
                visible={show}
                onToggleVisible={() => setShow((v) => !v)}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby="welcome-strength welcome-hint"
              />
              <StrengthMeter level={strength.level} label={strength.label} />
              <ul id="welcome-hint" className="mt-2 space-y-1 text-caption" aria-label="Requisitos de la contraseña">
                <Requirement met={password.length >= 8}>Al menos 8 caracteres</Requirement>
                <Requirement met={/[A-Za-z]/.test(password) && /[0-9]/.test(password)}>Letras y números</Requirement>
              </ul>
            </div>
            <div>
              <label className="ebim-label" htmlFor="welcome-confirm">
                Repite la contraseña
              </label>
              <PasswordInput
                id="welcome-confirm"
                autoComplete="new-password"
                visible={show}
                onToggleVisible={() => setShow((v) => !v)}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-describedby={confirm ? 'welcome-match' : undefined}
              />
              {confirm ? (
                <ul id="welcome-match" className="mt-2 text-caption">
                  <Requirement met={confirm === password}>
                    {confirm === password ? 'Las contraseñas coinciden' : 'Las contraseñas aún no coinciden'}
                  </Requirement>
                </ul>
              ) : null}
            </div>
            {error ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-field bg-danger-soft px-3 py-2.5 text-compact font-medium text-danger"
              >
                <WarningCircleIcon size={18} className="mt-px shrink-0" aria-hidden />
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              className="ebim-btn-primary ebim-btn-lg w-full text-[15px]"
              disabled={saving}
              aria-busy={saving || undefined}
            >
              {saving ? <span className="ebim-spinner" aria-hidden /> : null}
              {saving ? 'Guardando…' : 'Guardar contraseña y entrar'}
            </button>
          </form>

          <p className="mt-6 text-center text-compact text-muted">
            {mode === 'reset' ? '¿La recordaste?' : '¿Ya tienes contraseña?'}{' '}
            <Link to="/login" className="font-semibold text-accent-deep hover:underline">
              Volver al ingreso
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}

/** Cuatro segmentos + etiqueta; el valor se anuncia como `meter`. */
function StrengthMeter({ level, label }: { level: PasswordStrengthLevel; label: string }) {
  return (
    <div className="mt-2.5 flex items-center gap-3">
      <div
        id="welcome-strength"
        role="meter"
        aria-label="Fortaleza de la contraseña"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={level}
        aria-valuetext={label || 'Sin contraseña'}
        className="grid flex-1 grid-cols-4 gap-1.5"
      >
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-1.5 rounded-full transition-colors duration-fast ease-out ${
              level >= step ? STRENGTH_FILL[level] : STRENGTH_FILL[0]
            }`}
          />
        ))}
      </div>
      <span className={`w-[76px] text-right text-caption font-semibold ${STRENGTH_TEXT[level]}`} aria-hidden>
        {label}
      </span>
    </div>
  );
}

function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-1.5 ${met ? 'text-ok' : 'text-muted'}`}>
      {met ? <CheckIcon size={14} weight="bold" aria-hidden /> : <CircleIcon size={14} aria-hidden />}
      {children}
      <span className="sr-only">{met ? ' (cumplido)' : ' (pendiente)'}</span>
    </li>
  );
}
