/**
 * Edge Function: auth-email-hook — Supabase Auth «Send Email Hook» → EBIM MailHub.
 *
 * Con el hook activo, Auth ya no envía correos: llama aquí (firma Standard
 * Webhooks con SEND_EMAIL_HOOK_SECRET = "v1,whsec_…") y esta función envía la
 * plantilla `masteradmin-acceso-*` que corresponde por MailHub.
 *
 * `verify_jwt = false`: Auth no manda JWT; la autenticación es la firma,
 * verificada sobre el cuerpo crudo con ventana de 300 s antes de parsear.
 * Timeout de MailHub de 4 s (Auth corta el hook a los 5 s); la clave
 * idempotente usa el `webhook-id`, así que un reintento no duplica el correo.
 * El enlace y el código solo viajan a MailHub; al outbox va la constancia.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleAuthEmailHook } from '../_shared/mail/handlers.ts';
import { parseMailhubConfig, sendViaMailhub } from '../_shared/mail/mailhub.ts';

const env = (name: string) => Deno.env.get(name);

function appUrl(): string {
  return (env('MASTERADMIN_APP_URL') || env('SITE_URL') || 'http://127.0.0.1:5199').replace(/\/+$/, '');
}

Deno.serve(async (req: Request) => {
  const supabaseUrl = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const mailhub = parseMailhubConfig(env);
  if (!supabaseUrl || !serviceKey || !mailhub) {
    return Response.json({ error: { http_code: 503, message: 'El correo de acceso no está configurado' } }, { status: 503 });
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    db: { schema: 'platform' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rawBody = req.method === 'POST' ? await req.text() : '';
  const ttl = Number.parseInt(env('AUTH_LINK_TTL_MINUTES') ?? '60', 10);
  // El enlace apunta al dominio público del proyecto (el mismo de `{{ .ConfirmationURL }}`).
  const publicUrl = (env('AUTH_PUBLIC_URL') || supabaseUrl).replace(/\/+$/, '');

  try {
    const res = await handleAuthEmailHook(
      { method: req.method, rawBody, headers: (name) => req.headers.get(name) },
      {
        secret: env('SEND_EMAIL_HOOK_SECRET') ?? '',
        ctx: { supabaseUrl: publicUrl, appUrl: appUrl(), linkTtlMinutes: Number.isFinite(ttl) && ttl > 0 ? ttl : 60 },
        send: (request) => sendViaMailhub(mailhub, request, fetch, 4000),
        record: async (r) => {
          const { error } = await admin.rpc('mail_record_auth', {
            p_event_type: r.eventType,
            p_template_key: r.templateKey,
            p_to: r.to,
            p_to_name: r.name,
            p_variables: r.variables,
            p_idempotency_key: r.idempotencyKey,
            p_status: r.status,
            p_detail: r.detail,
            p_mailhub_email_id: r.emailId,
            p_mailhub_status: r.mailhubStatus,
            p_error_code: r.errorCode,
          });
          if (error) console.error('auth-email-hook record', error.message);
        },
      },
      Math.floor(Date.now() / 1000),
    );
    return Response.json(res.body, { status: res.status });
  } catch (error) {
    console.error('auth-email-hook', error instanceof Error ? error.message : 'error');
    return Response.json({ error: { http_code: 500, message: 'Error interno del hook de correo' } }, { status: 500 });
  }
});
