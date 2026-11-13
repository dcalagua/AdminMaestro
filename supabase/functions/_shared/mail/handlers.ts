/**
 * Manejadores de los dos webhooks entrantes del correo. PUROS (dependencias
 * inyectadas): los `index.ts` solo leen el cuerpo crudo y construyen clientes.
 *
 *   · `handleMailhubCallback`: firma HMAC de MailHub + ventana de 300 s,
 *     deduplicación por `eventId` (en la base) y estado de entrega al outbox.
 *   · `handleAuthEmailHook`: firma Standard Webhooks de Supabase Auth, arma los
 *     correos `masteradmin-acceso-*`, los envía por MailHub y deja constancia
 *     (sin enlace ni código). Si un envío falla responde 5xx: Auth devuelve el
 *     error y `user-admin` cae a su plan B (enlace manual para el operador).
 */
import { buildAuthEmails, type AuthHookContext, type AuthHookPayload } from './auth-hook.ts';
import { decideDelivery } from './policy.ts';
import type { MailhubSendRequest, MailhubSendResult } from './mailhub.ts';
import { verifyMailhubSignature, verifyStandardWebhook } from './signatures.ts';

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export const MAX_WEBHOOK_BODY = 64 * 1024;

// ---------------------------------------------------------------------------
// MailHub → mailhub-callback
// ---------------------------------------------------------------------------
export interface MailhubCallbackDeps {
  secret: string;
  applyEvent: (e: {
    eventId: string;
    type: string;
    emailId: string | null;
    messageStatus: string | null;
    recipient: string | null;
    occurredAt: string | null;
    detail: Record<string, unknown>;
  }) => Promise<{ duplicate: boolean; matched?: boolean }>;
}

/** Del evento solo se guarda lo que explica una entrega fallida (nunca metadatos completos). */
function eventDetail(evt: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const bounce = evt.bounce as Record<string, unknown> | undefined;
  const failure = evt.failure as Record<string, unknown> | undefined;
  if (bounce && typeof bounce === 'object') {
    out.bounceType = typeof bounce.type === 'string' ? bounce.type.slice(0, 40) : null;
    out.reason = typeof bounce.message === 'string' ? bounce.message.slice(0, 300) : 'Rebote';
  }
  if (failure && typeof failure === 'object') {
    out.reason = typeof failure.message === 'string' ? failure.message.slice(0, 300) : typeof failure.reason === 'string' ? failure.reason.slice(0, 300) : 'Fallo de entrega';
  }
  if (evt.type === 'email.complained') out.reason = 'El destinatario marcó el correo como spam';
  if (evt.type === 'email.suppressed') out.reason = 'Dirección en la lista de supresión de MailHub';
  return out;
}

export async function handleMailhubCallback(
  req: { method: string; rawBody: string; headers: (name: string) => string | null },
  deps: MailhubCallbackDeps,
  nowSeconds: number,
): Promise<HandlerResult> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'METODO_NO_PERMITIDO' } };
  if (!deps.secret) return { status: 503, body: { error: 'CONFIGURACION_INCOMPLETA' } };
  if (req.rawBody.length > MAX_WEBHOOK_BODY) return { status: 413, body: { error: 'CUERPO_DEMASIADO_GRANDE' } };

  const check = await verifyMailhubSignature(
    deps.secret,
    { timestamp: req.headers('x-mailhub-timestamp'), signature: req.headers('x-mailhub-signature') },
    req.rawBody,
    nowSeconds,
  );
  if (!check.ok) return { status: 401, body: { error: 'FIRMA_INVALIDA', reason: check.reason } };

  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(req.rawBody) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { error: 'JSON_INVALIDO' } };
  }
  const eventId = typeof evt.eventId === 'string' ? evt.eventId : req.headers('x-mailhub-event-id');
  const type = typeof evt.type === 'string' ? evt.type : req.headers('x-mailhub-event-type');
  if (!eventId || !type) return { status: 400, body: { error: 'EVENTO_INCOMPLETO' } };
  // El botón «Enviar webhook de prueba» de MailHub: firma válida, sin correo detrás.
  if (type === 'mailhub.test') return { status: 200, body: { ok: true, test: true } };
  if (!/^[a-z_]+\.[a-z_]+$/.test(type)) return { status: 400, body: { error: 'TIPO_INVALIDO' } };

  const result = await deps.applyEvent({
    eventId: eventId.slice(0, 120),
    type,
    emailId: typeof evt.emailId === 'string' ? evt.emailId : null,
    messageStatus: typeof evt.messageStatus === 'string' ? evt.messageStatus : typeof evt.status === 'string' ? evt.status : null,
    recipient: typeof evt.recipient === 'string' ? evt.recipient : null,
    occurredAt: typeof evt.occurredAt === 'string' ? evt.occurredAt : null,
    detail: eventDetail(evt),
  });
  return { status: 200, body: { ok: true, duplicate: result.duplicate } };
}

// ---------------------------------------------------------------------------
// Supabase Auth → auth-email-hook
// ---------------------------------------------------------------------------
export interface AuthHookDeps {
  secret: string;
  ctx: Omit<AuthHookContext, 'webhookId'>;
  send: (req: MailhubSendRequest) => Promise<MailhubSendResult>;
  record: (r: {
    eventType: string;
    templateKey: string;
    to: string;
    name: string | null;
    variables: Record<string, string>;
    idempotencyKey: string;
    status: 'SENT' | 'FAILED' | 'SKIPPED' | 'SUPPRESSED';
    detail: string | null;
    emailId: string | null;
    mailhubStatus: string | null;
    errorCode: string | null;
  }) => Promise<void>;
}

function hookError(status: number, message: string): HandlerResult {
  // Formato que Supabase Auth muestra al cliente.
  return { status, body: { error: { http_code: status, message } } };
}

export async function handleAuthEmailHook(
  req: { method: string; rawBody: string; headers: (name: string) => string | null },
  deps: AuthHookDeps,
  nowSeconds: number,
): Promise<HandlerResult> {
  if (req.method !== 'POST') return hookError(405, 'Método no permitido');
  if (!deps.secret) return hookError(503, 'El hook de correo no está configurado');
  if (req.rawBody.length > MAX_WEBHOOK_BODY) return hookError(413, 'Cuerpo demasiado grande');

  const webhookId = req.headers('webhook-id');
  const check = await verifyStandardWebhook(
    deps.secret,
    { id: webhookId, timestamp: req.headers('webhook-timestamp'), signature: req.headers('webhook-signature') },
    req.rawBody,
    nowSeconds,
  );
  if (!check.ok || !webhookId) return hookError(401, 'Firma del hook inválida');

  let payload: AuthHookPayload;
  try {
    payload = JSON.parse(req.rawBody) as AuthHookPayload;
  } catch {
    return hookError(400, 'JSON inválido');
  }
  const plan = buildAuthEmails(payload, { ...deps.ctx, webhookId: webhookId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) });
  if (plan.kind === 'skip') return { status: 200, body: { skipped: plan.reason } };

  const name = (payload.user?.user_metadata?.full_name as string | undefined) ?? null;
  const failures: string[] = [];
  for (const mail of plan.emails) {
    // Los accesos van a personas de la consola: pasan en cualquier ambiente.
    // Solo se descartan los dominios de prueba (no son buzones).
    const decision = decideDelivery(mail.to, { mode: 'live', allowedDomains: [], redirectTo: null });
    if (decision.action !== 'SEND') {
      await deps
        .record({ eventType: mail.eventType, templateKey: mail.templateKey, to: mail.to, name, variables: mail.loggedVariables, idempotencyKey: mail.idempotencyKey, status: 'SKIPPED', detail: decision.reason, emailId: null, mailhubStatus: null, errorCode: null })
        .catch(() => undefined);
      continue;
    }
    const result = await deps.send({
      to: [mail.to],
      templateKey: mail.templateKey,
      variables: mail.variables,
      idempotencyKey: mail.idempotencyKey,
      referenceId: mail.eventType,
      metadata: { event: mail.eventType, category: 'AUTH' },
    });
    const suppressed = result.ok && result.suppressed.map((s) => s.toLowerCase()).includes(mail.to);
    await deps
      .record({
        eventType: mail.eventType,
        templateKey: mail.templateKey,
        to: mail.to,
        name,
        variables: mail.loggedVariables,
        idempotencyKey: mail.idempotencyKey,
        status: result.ok ? (suppressed ? 'SUPPRESSED' : 'SENT') : 'FAILED',
        detail: result.ok ? (suppressed ? 'Dirección en la lista de supresión de MailHub' : null) : result.message,
        emailId: result.ok ? result.emailId : null,
        mailhubStatus: result.ok ? result.status : null,
        errorCode: result.ok ? null : result.code,
      })
      .catch(() => undefined);
    if (!result.ok) failures.push(result.code);
    else if (suppressed) failures.push('suppressed');
  }
  if (failures.length) return hookError(502, `No se pudo enviar el correo (${failures.join(', ')})`);
  return { status: 200, body: {} };
}
