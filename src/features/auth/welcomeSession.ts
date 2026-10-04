import { supabase } from '@/lib/supabase';

/**
 * M5 · Sesión que trae un enlace de invitación o de restablecimiento.
 *
 * El cliente de la consola tiene `detectSessionInUrl: false` a propósito (el
 * portal de pago usa el fragmento `#` para su propio token), así que
 * `/bienvenida` la recoge a mano, en este orden:
 *   1. `#access_token=…&refresh_token=…&type=invite|recovery` (enlaces de Auth);
 *   2. `?token_hash=…&type=…` (plantillas de correo con verifyOtp);
 *   3. `?code=…` (flujo PKCE).
 * Después borra los tokens de la barra de direcciones: no deben quedar en el
 * historial ni en un `Referer`.
 */

export type WelcomeMode = 'invite' | 'reset';

export type WelcomeSessionResult =
  | { status: 'ok'; mode: WelcomeMode }
  | { status: 'none' }
  | { status: 'error'; message: string };

const EXPIRED =
  'El enlace no es válido o ya venció. Pide una nueva invitación a tu administrador o usa «¿Olvidaste tu contraseña?» en la pantalla de ingreso.';

const OTP_TYPES = new Set(['invite', 'recovery', 'signup', 'magiclink', 'email']);

function modeFrom(type: string | null, search: URLSearchParams): WelcomeMode {
  if (search.get('mode') === 'reset' || type === 'recovery') return 'reset';
  return 'invite';
}

/** Deja solo `?mode=reset` (si venía) y quita tokens del fragmento y la query. */
export function scrubUrl(location: Location = window.location): void {
  const search = new URLSearchParams(location.search);
  const keep = search.get('mode') === 'reset' ? '?mode=reset' : '';
  window.history.replaceState(window.history.state, '', `${location.pathname}${keep}`);
}

export async function establishWelcomeSession(
  location: Location = window.location,
): Promise<WelcomeSessionResult> {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const search = new URLSearchParams(location.search);

  const urlError = hash.get('error_description') ?? search.get('error_description');
  if (urlError || hash.get('error') || search.get('error')) {
    scrubUrl(location);
    return { status: 'error', message: EXPIRED };
  }

  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    scrubUrl(location);
    return error ? { status: 'error', message: EXPIRED } : { status: 'ok', mode: modeFrom(hash.get('type'), search) };
  }

  const tokenHash = search.get('token_hash');
  const type = search.get('type');
  if (tokenHash && type && OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'invite' | 'recovery' | 'signup' | 'magiclink' | 'email',
    });
    scrubUrl(location);
    return error ? { status: 'error', message: EXPIRED } : { status: 'ok', mode: modeFrom(type, search) };
  }

  const code = search.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    scrubUrl(location);
    return error ? { status: 'error', message: EXPIRED } : { status: 'ok', mode: modeFrom(null, search) };
  }

  return { status: 'none' };
}

/** Regla local de contraseña (Auth exige al menos 6; la consola pide 8 con letras y números). */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < 8) return 'Usa al menos 8 caracteres.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Combina letras y números.';
  if (password !== confirm) return 'Las contraseñas no coinciden.';
  return null;
}
