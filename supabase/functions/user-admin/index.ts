/**
 * Edge Function: administración de usuarios (M5, spec §6.3).
 *
 * `verify_jwt = true`, y eso NO basta: el JWT demuestra sesión, no permiso. Cada
 * acción pide primero a la base, CON EL JWT DEL OPERADOR, que autorice
 * (`authorize_user_invitation`, `authorize_invitation_resend`, `deactivate_user`,
 * `reactivate_user`). Solo después se usa la clave de servicio, y solo para la
 * API de administración de Auth (invitar, generar enlace, banear) y para leer un
 * perfil por correo. La lógica vive en `_shared/users/admin.ts`.
 *
 * Acciones (POST, cuerpo JSON ≤ 16 KB):
 *   {action:'invite', email, full_name?, grant}  → correo de invitación o, sin
 *        SMTP, enlace copiable (`action_link`), + acceso + user_invitations.
 *   {action:'resend', user_id}                   → solo invitaciones pendientes.
 *   {action:'ban', user_id, reason}              → deactivate_user + ban en Auth.
 *   {action:'unban', user_id, reason?}           → reactivate_user + unban.
 *
 * `redirectTo` = `${MASTERADMIN_APP_URL || SITE_URL}/bienvenida`. El enlace de
 * acción nunca se registra en logs ni en la base.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { BAN_DURATION, handleUserAdmin } from '../_shared/users/admin.ts';
import { parseAllowedOrigins, withCors } from '../_shared/provisioning/cors.ts';

const allowedOrigins = parseAllowedOrigins(Deno.env.get('MASTERADMIN_ALLOWED_ORIGINS'));

/** Consola local por defecto (vite.config.ts: 5199). */
const DEFAULT_APP_URL = 'http://127.0.0.1:5199';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function resolveAppUrl(): string {
  for (const candidate of [Deno.env.get('MASTERADMIN_APP_URL'), Deno.env.get('SITE_URL')]) {
    const value = (candidate ?? '').trim().replace(/\/+$/, '');
    if (/^https?:\/\/[^\s]+$/.test(value)) return value;
  }
  return DEFAULT_APP_URL;
}

Deno.serve(
  withCors(async (req: Request) => {
    if (req.method !== 'POST') return json({ error: 'METODO_NO_PERMITIDO' }, 405);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: 'CONFIGURACION_INCOMPLETA' }, 500);

    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) return json({ error: 'NO_AUTENTICADO' }, 401);
    const bearer = authHeader.slice('bearer '.length).trim();

    // Cliente CON el JWT del operador: la base decide cada permiso.
    const asUser = createClient(supabaseUrl, anonKey, {
      db: { schema: 'platform' },
      // `Authorization` con mayúscula: ver payment-setup (cabecera duplicada → 401).
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await asUser.auth.getUser(bearer);
    if (userError || !userData?.user) return json({ error: 'NO_AUTENTICADO' }, 401);

    const bodyText = await req.text();

    // Solo servidor y solo para la API de Auth: se construye, no se usa hasta
    // que una RPC con el JWT del operador haya autorizado la acción.
    const admin = createClient(supabaseUrl, serviceKey, {
      db: { schema: 'platform' },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const res = await handleUserAdmin({ method: req.method, bodyText }, {
      appUrl: resolveAppUrl(),
      userRpc: async (fn, args) => {
        const { data, error } = await asUser.rpc(fn, args);
        return { data, error };
      },
      inviteUserByEmail: async (email, redirectTo, fullName) => {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo,
          data: fullName ? { full_name: fullName } : undefined,
        });
        return { userId: data?.user?.id ?? null, error: error ? { message: error.message, status: error.status } : null };
      },
      generateInviteLink: async (email, redirectTo, fullName) => {
        const { data, error } = await admin.auth.admin.generateLink({
          type: 'invite',
          email,
          options: { redirectTo, data: fullName ? { full_name: fullName } : undefined },
        });
        return {
          userId: data?.user?.id ?? null,
          actionLink: data?.properties?.action_link ?? null,
          error: error ? { message: error.message, status: error.status } : null,
        };
      },
      setBanned: async (userId, banned) => {
        const { error } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: banned ? BAN_DURATION : 'none',
        });
        return { error: error ? { message: error.message } : null };
      },
      getAuthUser: async (userId) => {
        const { data, error } = await admin.auth.admin.getUserById(userId);
        if (error || !data?.user) return null;
        return {
          emailConfirmedAt: data.user.email_confirmed_at ?? null,
          lastSignInAt: data.user.last_sign_in_at ?? null,
        };
      },
      findUserIdByEmail: async (email) => {
        const { data } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
        return (data as { id?: string } | null)?.id ?? null;
      },
    });
    return json(res.body, res.status);
  }, allowedOrigins),
);
