/**
 * Edge Function: mailhub-callback — estado de entrega que EBIM MailHub envía firmado.
 *
 * `verify_jwt = false`: MailHub no tiene JWT de este proyecto. La autenticación
 * es la firma `X-MailHub-Signature` (HMAC-SHA256 con MAILHUB_WEBHOOK_SECRET
 * sobre `timestamp.cuerpoCrudo`), con ventana de 300 s, verificada ANTES de
 * parsear. La base deduplica por `eventId` (entrega al menos una vez) y avanza
 * el estado del outbox sin retroceder. Responde 2xx rápido; sin 2xx MailHub
 * reintenta con backoff.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleMailhubCallback } from '../_shared/mail/handlers.ts';

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return Response.json({ error: 'CONFIGURACION_INCOMPLETA' }, { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    db: { schema: 'platform' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rawBody = req.method === 'POST' ? await req.text() : '';
  try {
    const res = await handleMailhubCallback(
      { method: req.method, rawBody, headers: (name) => req.headers.get(name) },
      {
        secret: Deno.env.get('MAILHUB_WEBHOOK_SECRET') ?? '',
        applyEvent: async (e) => {
          const { data, error } = await admin.rpc('mail_apply_event', {
            p_event_id: e.eventId,
            p_event_type: e.type,
            p_mailhub_email_id: e.emailId,
            p_message_status: e.messageStatus,
            p_recipient: e.recipient,
            p_occurred_at: e.occurredAt,
            p_detail: e.detail,
          });
          if (error) throw new Error(error.message);
          return (data ?? { duplicate: false }) as { duplicate: boolean; matched?: boolean };
        },
      },
      Math.floor(Date.now() / 1000),
    );
    return Response.json(res.body, { status: res.status });
  } catch (error) {
    console.error('mailhub-callback', error instanceof Error ? error.message : 'error');
    // 5xx: MailHub reintenta.
    return Response.json({ error: 'ERROR_INTERNO' }, { status: 500 });
  }
});
