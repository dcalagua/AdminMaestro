import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EbimMark } from '@/components/ui/EbimMark';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { establishWelcomeSession, passwordProblem, type WelcomeMode } from './welcomeSession';

/**
 * M5 · `/bienvenida` (pública, fuera de RequireAuth/AppShell).
 *
 * Recibe la sesión del enlace de invitación o de restablecimiento y pide fijar
 * la contraseña (`auth.updateUser`). Tras una invitación marca aceptadas las
 * invitaciones del usuario (`accept_my_invitations`) y entra a la consola.
 * Si el enlace venció o ya se usó, lo dice sin tecnicismos.
 */
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

  const mode = phase.kind === 'form' ? phase.mode : 'invite';

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="ebim-card w-full max-w-md p-7 shadow-brand">
        <div className="flex items-center gap-2.5">
          <EbimMark size={30} color="var(--brand-mark)" />
          <div className="leading-none">
            <div className="text-[17px] font-extrabold tracking-tight text-fg">Control Plane</div>
            <div className="mt-[3px] text-[9.5px] font-bold tracking-[0.22em] text-muted opacity-85">BY EBIM</div>
          </div>
        </div>

        {phase.kind === 'checking' ? (
          <p role="status" className="py-10 text-center text-sm text-muted">
            Verificando tu enlace…
          </p>
        ) : phase.kind === 'error' ? (
          <div role="alert" className="mt-6">
            <h1 className="text-lg font-bold text-fg">No pudimos abrir tu enlace</h1>
            <p className="mt-2 text-sm text-muted">{phase.message}</p>
            <Link to="/login" className="ebim-btn-primary mt-5 inline-flex">
              Ir al ingreso
            </Link>
          </div>
        ) : phase.kind === 'done' ? (
          <p role="status" className="py-10 text-center text-sm text-muted">
            Contraseña guardada. Entrando a la consola…
          </p>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={(e) => void submit(e)} noValidate>
            <div>
              <h1 className="text-lg font-bold text-fg">
                {mode === 'reset' ? 'Crea una nueva contraseña' : 'Te damos la bienvenida'}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {mode === 'reset'
                  ? 'Elige una contraseña nueva para tu cuenta.'
                  : 'Tu acceso ya está creado. Elige una contraseña para ingresar en adelante.'}
                {session?.user?.email ? (
                  <>
                    {' '}
                    Cuenta: <strong className="text-fg">{session.user.email}</strong>.
                  </>
                ) : null}
              </p>
            </div>
            <div>
              <label className="ebim-label" htmlFor="welcome-password">
                Nueva contraseña
              </label>
              <input
                id="welcome-password"
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                className="ebim-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby="welcome-hint"
              />
              <p id="welcome-hint" className="mt-1 text-xs text-muted">
                Al menos 8 caracteres, con letras y números.
              </p>
            </div>
            <div>
              <label className="ebim-label" htmlFor="welcome-confirm">
                Repite la contraseña
              </label>
              <input
                id="welcome-confirm"
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                className="ebim-input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              Mostrar contraseña
            </label>
            {error ? (
              <p role="alert" className="rounded-field bg-danger-soft px-3 py-2.5 text-[13px] font-medium text-danger">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              className="ebim-btn-primary w-full"
              disabled={saving}
              aria-busy={saving || undefined}
            >
              {saving ? 'Guardando…' : 'Guardar contraseña y entrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
