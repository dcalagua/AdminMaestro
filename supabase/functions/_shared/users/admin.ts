/**
 * M5 · Edge Function `user-admin` (spec §6.3).
 *
 * Módulo PURO con dependencias inyectadas (patrón de `payments/autocharge.ts`).
 * El `index.ts` solo autentica el JWT y construye los clientes.
 *
 * Regla de oro: la AUTORIZACIÓN la decide la base, llamando las RPC con el JWT
 * del operador (`userRpc`). La clave de servicio solo se usa para la API de
 * administración de Auth (invitar, generar enlace, banear) y para leer un perfil
 * por correo, y SIEMPRE después de que la base dijo que sí:
 *
 *   invite  → authorize_user_invitation (JWT) → [¿ya existe?] → inviteUserByEmail
 *             o, si no hay SMTP / falla, generateLink(invite) → aplicar el acceso
 *             con la RPC que corresponde (JWT) → record_user_invitation (JWT).
 *   resend  → authorize_invitation_resend (JWT) → inviteUserByEmail / generateLink
 *             → record_invitation_resend (JWT). Solo invitaciones PENDIENTES.
 *   ban     → deactivate_user (JWT) → updateUserById(ban_duration).
 *   unban   → reactivate_user (JWT) → updateUserById(ban_duration: 'none').
 *
 * El enlace de acción (`action_link`) es una credencial de un solo uso: se
 * devuelve al operador SOLO cuando no se pudo enviar el correo, y nunca se
 * guarda ni se registra.
 */

export interface RpcResult {
  data: unknown;
  error: { message?: string } | null;
}

export interface AuthResult {
  userId: string | null;
  actionLink?: string | null;
  error: { message?: string; status?: number } | null;
}

export interface AuthUserState {
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
}

export interface UserAdminDeps {
  /** RPC con el JWT del operador: la base decide si puede. */
  userRpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  /** API de administración de Auth (clave de servicio, solo servidor). */
  inviteUserByEmail: (email: string, redirectTo: string, fullName: string | null) => Promise<AuthResult>;
  generateInviteLink: (email: string, redirectTo: string, fullName: string | null) => Promise<AuthResult>;
  setBanned: (userId: string, banned: boolean) => Promise<{ error: { message?: string } | null }>;
  getAuthUser: (userId: string) => Promise<AuthUserState | null>;
  /** Perfil existente por correo (clave de servicio). */
  findUserIdByEmail: (email: string) => Promise<string | null>;
  /** URL pública de la consola (sin barra final). */
  appUrl: string;
}

export interface UserAdminResponse {
  status: number;
  body: Record<string, unknown>;
}

export const USER_ADMIN_MAX_BODY = 16 * 1024;
/** «Para siempre» a efectos prácticos: Auth exige una duración, no admite infinito. */
export const BAN_DURATION = '876000h';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const GRANT_KINDS = new Set(['PLATFORM_ROLE', 'ORG_MEMBERSHIP', 'TENANT_MEMBERSHIP', 'PROVISIONING_ROLE']);

/** `CODIGO: texto` → `CODIGO`. */
export function rpcErrorCode(error: { message?: string } | null | undefined): string | null {
  const match = /^([A-Z][A-Z0-9_]{2,}):/.exec(String(error?.message ?? '').trim());
  return match ? match[1]! : null;
}

function rpcErrorText(error: { message?: string } | null | undefined): string {
  const raw = String(error?.message ?? '').trim();
  const match = /^[A-Z][A-Z0-9_]{2,}:\s*(.+)$/s.exec(raw);
  return match ? match[1]!.trim() : 'La operación fue rechazada.';
}

const FORBIDDEN = new Set([
  'NO_AUTORIZADO', 'SUPER_ADMIN_NO_ASIGNABLE', 'SUPER_ADMIN_PROTEGIDO', 'ULTIMO_SUPER_ADMIN',
  'DOMINIO_OPERADOR_BLOQUEADO', 'ROL_FUERA_DE_ALCANCE', 'MEMBRESIA_PROPIA',
  'ORGANIZACION_PLATAFORMA_PROTEGIDA',
]);

/** Respuesta de error con el código canónico de la base y su texto en español. */
export function rpcFailure(error: { message?: string } | null | undefined): UserAdminResponse {
  const code = rpcErrorCode(error);
  if (!code) {
    return { status: 500, body: { error: 'ERROR_INTERNO', message: 'No se pudo completar la operación.' } };
  }
  const status = FORBIDDEN.has(code) ? 403 : /NO_ENCONTRAD[OA]$/.test(code) ? 404 : 409;
  return { status, body: { error: code, message: rpcErrorText(error) } };
}

function bad(error: string, message: string, status = 400): UserAdminResponse {
  return { status, body: { error, message } };
}

export interface AccessGrant {
  kind: 'PLATFORM_ROLE' | 'ORG_MEMBERSHIP' | 'TENANT_MEMBERSHIP' | 'PROVISIONING_ROLE';
  role: string;
  organization_id?: string;
  tenant_id?: string;
  company_id?: string;
}

/** Forma mínima del acceso; las reglas reales las aplica la base. */
export function parseGrant(input: unknown): AccessGrant | null {
  if (!input || typeof input !== 'object') return null;
  const g = input as Record<string, unknown>;
  const kind = typeof g.kind === 'string' ? g.kind.toUpperCase() : '';
  const role = typeof g.role === 'string' ? g.role.trim().toUpperCase() : '';
  if (!GRANT_KINDS.has(kind) || !/^[A-Z_]{3,40}$/.test(role)) return null;
  const out: AccessGrant = { kind: kind as AccessGrant['kind'], role };
  for (const key of ['organization_id', 'tenant_id', 'company_id'] as const) {
    const v = g[key];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || !UUID_RE.test(v)) return null;
    out[key] = v;
  }
  if (kind === 'ORG_MEMBERSHIP' && !out.organization_id) return null;
  if (kind === 'TENANT_MEMBERSHIP' && !out.tenant_id) return null;
  return out;
}

/** RPC (con el JWT del operador) que aplica el acceso a un usuario ya creado. */
export function grantRpc(grant: AccessGrant, userId: string): [string, Record<string, unknown>] {
  const reason = 'Acceso otorgado al invitar';
  switch (grant.kind) {
    case 'PLATFORM_ROLE':
      return ['grant_platform_role', { p_user_id: userId, p_role: grant.role, p_reason: reason }];
    case 'PROVISIONING_ROLE':
      return ['grant_provisioning_role', { p_user_id: userId, p_role: grant.role, p_notes: reason }];
    case 'ORG_MEMBERSHIP':
      return ['upsert_organization_membership', {
        p_user_id: userId, p_org_id: grant.organization_id, p_role: grant.role,
        p_company_id: grant.company_id ?? null, p_reason: reason,
      }];
    case 'TENANT_MEMBERSHIP':
      return ['upsert_tenant_membership', {
        p_user_id: userId, p_tenant_id: grant.tenant_id, p_role: grant.role, p_reason: reason,
      }];
  }
}

function welcomeUrl(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/bienvenida`;
}

/**
 * Envía la invitación: primero por correo (Supabase Auth); si no hay SMTP o el
 * envío falla (límite de correos, SMTP caído), genera el enlace para copiarlo.
 */
async function deliverInvite(
  email: string,
  fullName: string | null,
  deps: UserAdminDeps,
): Promise<{ delivery: 'EMAIL' | 'LINK'; userId: string; actionLink: string | null } | { error: string }> {
  const redirectTo = welcomeUrl(deps.appUrl);
  const sent = await deps.inviteUserByEmail(email, redirectTo, fullName);
  if (!sent.error && sent.userId) return { delivery: 'EMAIL', userId: sent.userId, actionLink: null };

  const link = await deps.generateInviteLink(email, redirectTo, fullName);
  if (!link.error && link.userId && link.actionLink) {
    return { delivery: 'LINK', userId: link.userId, actionLink: link.actionLink };
  }
  return { error: 'INVITACION_FALLIDA' };
}

async function invite(body: Record<string, unknown>, deps: UserAdminDeps): Promise<UserAdminResponse> {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 254) return bad('EMAIL_INVALIDO', 'Indica un correo válido.');
  const fullName = typeof body.full_name === 'string' && body.full_name.trim() !== ''
    ? body.full_name.trim().slice(0, 160)
    : null;
  const grant = parseGrant(body.grant);
  if (!grant) return bad('ACCESO_INVALIDO', 'Indica el tipo de acceso y su destino.');

  // 1. ¿Puede el operador otorgar ese acceso? Si no, no se crea ninguna cuenta.
  const authz = await deps.userRpc('authorize_user_invitation', { p_email: email, p_grant: grant });
  if (authz.error) return rpcFailure(authz.error);

  // 2. Usuario existente: no se reinvita; se le otorga el acceso pedido.
  const existing = await deps.findUserIdByEmail(email);
  if (existing) {
    const [fn, args] = grantRpc(grant, existing);
    const applied = await deps.userRpc(fn, args);
    if (applied.error) return rpcFailure(applied.error);
    return { status: 200, body: { status: 'EXISTING_USER', user_id: existing, grant_applied: true } };
  }

  // 3. Nuevo usuario: correo, o enlace copiable si no hay SMTP.
  const delivered = await deliverInvite(email, fullName, deps);
  if ('error' in delivered) {
    return bad(delivered.error, 'No se pudo crear la invitación en el servicio de autenticación.', 502);
  }

  // 4. Acceso pedido, con el JWT del operador (la base vuelve a decidir).
  const [fn, args] = grantRpc(grant, delivered.userId);
  const applied = await deps.userRpc(fn, args);
  const grantError = applied.error ? rpcFailure(applied.error).body : null;

  // 5. Rastro de la invitación (sin el enlace).
  const recorded = await deps.userRpc('record_user_invitation', {
    p_email: email, p_user_id: delivered.userId, p_grant: grant,
    p_delivery: delivered.delivery, p_full_name: fullName,
  });

  return {
    status: 200,
    body: {
      status: 'INVITED',
      user_id: delivered.userId,
      delivery: delivered.delivery,
      ...(delivered.actionLink ? { action_link: delivered.actionLink } : {}),
      grant_applied: !grantError,
      ...(grantError ? { grant_error: grantError.error, grant_message: grantError.message } : {}),
      invitation_id: recorded.error ? null : recorded.data,
      ...(recorded.error ? { record_error: rpcErrorCode(recorded.error) ?? 'ERROR_INTERNO' } : {}),
    },
  };
}

async function resend(body: Record<string, unknown>, deps: UserAdminDeps): Promise<UserAdminResponse> {
  const userId = typeof body.user_id === 'string' ? body.user_id : '';
  if (!UUID_RE.test(userId)) return bad('USUARIO_INVALIDO', 'Indica el usuario.');

  const authz = await deps.userRpc('authorize_invitation_resend', { p_user_id: userId });
  if (authz.error) return rpcFailure(authz.error);
  const info = (authz.data ?? {}) as { email?: string; full_name?: string | null };

  // Defensa adicional desde Auth: si ya activó su cuenta, no hay enlace que entregar.
  const state = await deps.getAuthUser(userId);
  if (!state) return bad('USUARIO_NO_ENCONTRADO', 'El usuario no existe en el servicio de autenticación.', 404);
  if (state.emailConfirmedAt || state.lastSignInAt) {
    return bad('INVITACION_YA_ACEPTADA',
      'El usuario ya activó su cuenta. Si olvidó su contraseña, que use «¿Olvidaste tu contraseña?».', 409);
  }

  const delivered = await deliverInvite(String(info.email ?? ''), info.full_name ?? null, deps);
  if ('error' in delivered) {
    return bad(delivered.error, 'No se pudo reenviar la invitación en el servicio de autenticación.', 502);
  }
  if (delivered.userId !== userId) {
    // Auth devolvió otra cuenta para ese correo: no se entrega nada.
    return bad('INVITACION_INCOHERENTE', 'El servicio de autenticación devolvió otra cuenta.', 409);
  }
  const recorded = await deps.userRpc('record_invitation_resend', { p_user_id: userId, p_delivery: delivered.delivery });
  return {
    status: 200,
    body: {
      status: 'RESENT',
      user_id: userId,
      delivery: delivered.delivery,
      ...(delivered.actionLink ? { action_link: delivered.actionLink } : {}),
      invitation_id: recorded.error ? null : recorded.data,
    },
  };
}

async function setAccess(
  body: Record<string, unknown>,
  deps: UserAdminDeps,
  ban: boolean,
): Promise<UserAdminResponse> {
  const userId = typeof body.user_id === 'string' ? body.user_id : '';
  if (!UUID_RE.test(userId)) return bad('USUARIO_INVALIDO', 'Indica el usuario.');
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (ban && reason === '') return bad('MOTIVO_REQUERIDO', 'Indica el motivo de la desactivación.');

  // La base decide (super admin, nunca el último super admin) y desactiva en cascada.
  const db = await deps.userRpc(ban ? 'deactivate_user' : 'reactivate_user', {
    p_user_id: userId,
    p_reason: reason || null,
  });
  if (db.error) return rpcFailure(db.error);

  const auth = await deps.setBanned(userId, ban);
  return {
    status: 200,
    body: {
      status: ban ? 'DEACTIVATED' : 'REACTIVATED',
      user_id: userId,
      ...(ban ? { summary: db.data } : {}),
      auth_updated: !auth.error,
      ...(auth.error ? { auth_error: 'AUTH_NO_ACTUALIZADO' } : {}),
    },
  };
}

export async function handleUserAdmin(
  req: { method: string; bodyText: string },
  deps: UserAdminDeps,
): Promise<UserAdminResponse> {
  if (req.method !== 'POST') return bad('METODO_NO_PERMITIDO', 'Usa POST.', 405);
  if (req.bodyText.length > USER_ADMIN_MAX_BODY) return bad('CUERPO_DEMASIADO_GRANDE', 'Cuerpo demasiado grande.', 413);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(req.bodyText || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('no-object');
    body = parsed as Record<string, unknown>;
  } catch {
    return bad('CUERPO_INVALIDO', 'El cuerpo debe ser un objeto JSON.');
  }

  try {
    switch (body.action) {
      case 'invite':
        return await invite(body, deps);
      case 'resend':
        return await resend(body, deps);
      case 'ban':
        return await setAccess(body, deps, true);
      case 'unban':
        return await setAccess(body, deps, false);
      default:
        return bad('ACCION_INVALIDA', 'Acción desconocida (invite, resend, ban, unban).');
    }
  } catch {
    // Nunca se reenvía el error crudo: podría contener la URL de acción.
    return { status: 500, body: { error: 'ERROR_INTERNO', message: 'No se pudo completar la operación.' } };
  }
}
