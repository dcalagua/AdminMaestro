/**
 * Edge Function: mail-dispatch — envía la bandeja `mail_outbox` a EBIM MailHub.
 *
 * Dos canales, como `tenant-sync`:
 *   1. SERVIDOR: pg_cron (`invoke_scheduled_function('MAIL_DISPATCH')`, cada
 *      minuto si hay cola) y el disparo inmediato `_mail_kick()` al encolar. La
 *      clave de servicio llega en `x-provisioning-secret` (tiempo constante).
 *   2. HUMANO: «Procesar ahora» en Gobierno › Correos. JWT y `can_view_mail()`
 *      explícito ANTES de asumir service_role.
 *
 * Secretos: MAILHUB_FUNCTIONS_URL, MAILHUB_API_KEY (token `mh_<env>_…`),
 * MAIL_DELIVERY_MODE / MAIL_ALLOWED_DOMAINS / MAIL_REDIRECT_TO (salvaguarda de
 * QAS; sin valor = allowlist) y MASTERADMIN_APP_URL (enlaces de la consola).
 * Sin configuración de MailHub NO se toma ninguna fila: la cola queda intacta.
 * La respuesta lleva solo conteos; nunca destinatarios ni variables.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseAllowedOrigins, withCors } from '../_shared/provisioning/index.ts';
import { runDispatch, type OutboxRow } from '../_shared/mail/dispatch.ts';
import { parseMailhubConfig, sendViaMailhub } from '../_shared/mail/mailhub.ts';
import { parseDeliveryConfig } from '../_shared/mail/policy.ts';
import { constantTimeEqual } from '../_shared/mail/signatures.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const allowedOrigins = parseAllowedOrigins(Deno.env.get('MASTERADMIN_ALLOWED_ORIGINS'));
const env = (name: string) => Deno.env.get(name);

function appUrl(): string {
  return (env('MASTERADMIN_APP_URL') || env('SITE_URL') || 'http://127.0.0.1:5199').replace(/\/+$/, '');
}

Deno.serve(withCors(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'METODO_NO_PERMITIDO' }, 405);

  const supabaseUrl = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = env('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: 'CONFIGURACION_INCOMPLETA: faltan credenciales del servidor' }, 500);
  }

  const presented = req.headers.get('x-provisioning-secret');
  let trigger = 'SERVER';
  if (!(presented && constantTimeEqual(presented, serviceKey))) {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return json({ error: 'NO_AUTENTICADO: falta el token de sesión' }, 401);
    }
    const asUser = createClient(supabaseUrl, anonKey, {
      db: { schema: 'platform' },
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await asUser.auth.getUser(authHeader.slice(7).trim());
    if (userError || !userData?.user) return json({ error: 'NO_AUTENTICADO: sesión inválida' }, 401);
    // AUTORIZACIÓN EXPLÍCITA: `=== true`; un error o un null NO autorizan.
    const { data: allowed, error: authzError } = await asUser.rpc('can_view_mail');
    if (authzError || allowed !== true) {
      return json({ error: 'NO_AUTORIZADO', message: 'Procesar la bandeja exige super admin, producto o finanzas' }, 403);
    }
    trigger = 'MANUAL';
  }

  const mailhub = parseMailhubConfig(env);
  if (!mailhub) {
    return json({ error: 'MAILHUB_NO_CONFIGURADO', message: 'Faltan MAILHUB_FUNCTIONS_URL o MAILHUB_API_KEY' }, 503);
  }
  const delivery = parseDeliveryConfig(env);

  // Solo aquí, superado el gate, se asume el rol de servidor.
  const admin = createClient(supabaseUrl, serviceKey, {
    db: { schema: 'platform' },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const summary = await runDispatch({
      delivery,
      appUrl: appUrl(),
      claimBatch: async (limit) => {
        const { data, error } = await admin.rpc('mail_claim_batch', { p_limit: limit });
        if (error) throw new Error(`CLAIM: ${error.message}`);
        return (data ?? []) as OutboxRow[];
      },
      paymentLink: async (outboxId) => {
        const { data, error } = await admin.rpc('mail_payment_link', { p_outbox_id: outboxId });
        if (error) throw new Error(error.message);
        const d = data as { payment_link_token?: string; payment_link_expires?: string } | null;
        if (!d?.payment_link_token) throw new Error('PAYMENT_LINK_ERROR: sin token');
        return { token: d.payment_link_token, expires: d.payment_link_expires ?? '' };
      },
      markResult: async (r) => {
        const { error } = await admin.rpc('mail_mark_result', {
          p_id: r.id,
          p_status: r.status,
          p_detail: r.detail ?? null,
          p_mailhub_email_id: r.mailhubEmailId ?? null,
          p_mailhub_status: r.mailhubStatus ?? null,
          p_error_code: r.errorCode ?? null,
          p_retry_in_seconds: r.retryInSeconds ?? null,
          p_delivered_to: r.deliveredTo ?? null,
          p_delivery_mode: r.deliveryMode ?? null,
        });
        if (error) throw new Error(`MARK: ${error.message}`);
      },
      send: (request) => sendViaMailhub(mailhub, request, fetch),
    });
    return json({ trigger, mode: delivery.mode, ...summary });
  } catch (error) {
    console.error('mail-dispatch', error instanceof Error ? error.message : 'error');
    return json({ error: 'ERROR_INTERNO' }, 500);
  }
}, allowedOrigins));
