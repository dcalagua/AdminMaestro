/**
 * Supabase Auth «Send Email Hook» → plantillas `masteradmin-acceso-*` de MailHub.
 *
 * Módulo PURO: lo prueba vitest. `auth-email-hook/index.ts` solo verifica la
 * firma, llama a `buildAuthEmails` y envía.
 *
 * El enlace se arma como el `{{ .ConfirmationURL }}` de Supabase:
 *   <SUPABASE_URL>/auth/v1/verify?token=<token_hash>&type=<tipo>&redirect_to=<redirect_to>
 *
 * Cambio de correo con «Secure email change» activo (así está QAS): DOS correos.
 * Ojo, los nombres están cruzados por compatibilidad (documentado por Supabase):
 *   · a la dirección ACTUAL (user.email)     → token + token_hash_new
 *   · a la dirección NUEVA  (user.new_email) → token_new + token_hash
 *
 * El enlace y el código son credenciales de un solo uso: viajan solo a MailHub
 * (que los escapa y los guarda con su retención) y NUNCA al outbox del Admin
 * Maestro ni a los logs. Lo que se registra es `loggedVariables`.
 */

export type AuthActionType =
  | 'signup'
  | 'invite'
  | 'magiclink'
  | 'recovery'
  | 'email_change'
  | 'email'
  | 'reauthentication'
  | string;

export interface AuthHookPayload {
  user: {
    id: string;
    email?: string | null;
    new_email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  };
  email_data: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type: AuthActionType;
    site_url?: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

export interface AuthEmail {
  to: string;
  templateKey: string;
  eventType: string;
  variables: Record<string, string>;
  /** Variables sin enlace ni código: lo único que se guarda en el outbox. */
  loggedVariables: Record<string, string>;
  idempotencyKey: string;
}

export interface AuthHookContext {
  supabaseUrl: string;
  /** URL pública de la consola (fallback de redirect_to). */
  appUrl: string;
  /** `webhook-id` del hook: base de la idempotencia. */
  webhookId: string;
  /** Validez del enlace en minutos (`mailer_otp_exp` / 60). */
  linkTtlMinutes: number;
}

export type AuthHookPlan = { kind: 'send'; emails: AuthEmail[] } | { kind: 'skip'; reason: string };

export const AUTH_TEMPLATES = {
  invite: 'masteradmin-acceso-invitacion',
  recovery: 'masteradmin-acceso-restablecer',
  magiclink: 'masteradmin-acceso-enlace',
  signup: 'masteradmin-acceso-confirmar',
  email_change: 'masteradmin-acceso-cambio-correo',
  reauthentication: 'masteradmin-acceso-codigo',
} as const;

export function ttlText(minutes: number): string {
  if (minutes >= 120 && minutes % 60 === 0) return `${minutes / 60} horas`;
  if (minutes === 60) return '1 hora';
  return `${minutes} minutos`;
}

export function verifyLink(ctx: AuthHookContext, tokenHash: string, type: string, redirectTo: string | undefined): string {
  const base = ctx.supabaseUrl.replace(/\/+$/, '');
  const redirect = redirectTo && /^https?:\/\//.test(redirectTo) ? redirectTo : ctx.appUrl;
  const params = new URLSearchParams({ token: tokenHash, type, redirect_to: redirect });
  return `${base}/auth/v1/verify?${params.toString()}`;
}

function displayName(payload: AuthHookPayload): string {
  const meta = payload.user.user_metadata ?? {};
  const name = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : '';
  return name.trim().slice(0, 120);
}

function email(
  ctx: AuthHookContext,
  to: string,
  templateKey: string,
  eventType: string,
  secretVars: Record<string, string>,
  publicVars: Record<string, string>,
  suffix: string,
): AuthEmail {
  return {
    to: to.trim().toLowerCase(),
    templateKey,
    eventType,
    variables: { ...publicVars, ...secretVars },
    loggedVariables: publicVars,
    idempotencyKey: `masteradmin-auth-${ctx.webhookId}-${suffix}`,
  };
}

export function buildAuthEmails(payload: AuthHookPayload, ctx: AuthHookContext): AuthHookPlan {
  const data = payload.email_data;
  const type = data?.email_action_type;
  const current = (payload.user?.email ?? '').trim();
  const vence = ttlText(ctx.linkTtlMinutes);
  const consola = ctx.appUrl;
  const nombre = displayName(payload);

  switch (type) {
    case 'invite':
    case 'recovery':
    case 'magiclink':
    case 'signup': {
      if (!current || !data.token_hash) return { kind: 'skip', reason: 'Faltan el correo o el token' };
      const key = AUTH_TEMPLATES[type];
      return {
        kind: 'send',
        emails: [
          email(
            ctx,
            current,
            key,
            `AUTH_${type.toUpperCase()}`,
            { enlace: verifyLink(ctx, data.token_hash, type, data.redirect_to) },
            { email: current, nombre: nombre || current, vence, consola_url: consola },
            type,
          ),
        ],
      };
    }
    case 'email_change': {
      const next = (payload.user?.new_email ?? '').trim();
      if (!next) return { kind: 'skip', reason: 'Cambio de correo sin dirección nueva' };
      const common = { email_actual: current, email_nuevo: next, nombre: nombre || current, vence, consola_url: consola };
      const out: AuthEmail[] = [];
      // Secure email change: el hash «_new» va a la dirección ACTUAL (nombres cruzados).
      if (current && data.token_hash_new) {
        out.push(
          email(
            ctx,
            current,
            AUTH_TEMPLATES.email_change,
            'AUTH_EMAIL_CHANGE',
            { enlace: verifyLink(ctx, data.token_hash_new, 'email_change', data.redirect_to) },
            { ...common, destino: 'su dirección actual' },
            'email_change-current',
          ),
        );
      }
      if (data.token_hash) {
        out.push(
          email(
            ctx,
            next,
            AUTH_TEMPLATES.email_change,
            'AUTH_EMAIL_CHANGE',
            { enlace: verifyLink(ctx, data.token_hash, 'email_change', data.redirect_to) },
            { ...common, destino: 'su nueva dirección' },
            'email_change-new',
          ),
        );
      }
      return out.length ? { kind: 'send', emails: out } : { kind: 'skip', reason: 'Cambio de correo sin token' };
    }
    case 'reauthentication': {
      if (!current || !data.token) return { kind: 'skip', reason: 'Reautenticación sin código' };
      return {
        kind: 'send',
        emails: [
          email(
            ctx,
            current,
            AUTH_TEMPLATES.reauthentication,
            'AUTH_REAUTHENTICATION',
            { codigo: data.token },
            { email: current, nombre: nombre || current, vence, consola_url: consola },
            'reauthentication',
          ),
        ],
      };
    }
    default:
      // Avisos (password_changed_notification, …) están desactivados en Auth; si
      // llegan, no hay plantilla: se aceptan sin enviar para no romper el flujo.
      return { kind: 'skip', reason: `Tipo sin plantilla: ${String(type)}` };
  }
}
