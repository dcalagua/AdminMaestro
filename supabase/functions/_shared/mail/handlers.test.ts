import { describe, expect, it, vi } from 'vitest';
import { handleAuthEmailHook, handleMailhubCallback, type AuthHookDeps } from './handlers';
import { signMailhub, signStandardWebhook } from './signatures';
import type { MailhubSendResult } from './mailhub';

const NOW = 1_762_804_800;
const MH_SECRET = 'mhsec_secret_for_tests_0123456789';
const HOOK_SECRET = `v1,whsec_${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}`;

function headers(h: Record<string, string>) {
  return (name: string) => h[name.toLowerCase()] ?? null;
}

describe('mailhub-callback', () => {
  const event = {
    eventId: 'evt_1',
    type: 'email.delivered',
    occurredAt: '2026-11-13T10:00:00.000Z',
    application: 'masteradmin',
    environment: 'qas',
    emailId: 'em-1',
    recipient: 'ana@ebim.pe',
    status: 'delivered',
    messageStatus: 'delivered',
    metadata: { outboxId: 'o1' },
  };

  async function call(body: unknown, opts: { ts?: number; secret?: string; now?: number } = {}) {
    const raw = JSON.stringify(body);
    const ts = String(opts.ts ?? NOW);
    const applyEvent = vi.fn(async () => ({ duplicate: false, matched: true }));
    const res = await handleMailhubCallback(
      {
        method: 'POST',
        rawBody: raw,
        headers: headers({ 'x-mailhub-timestamp': ts, 'x-mailhub-signature': await signMailhub(opts.secret ?? MH_SECRET, ts, raw) }),
      },
      { secret: MH_SECRET, applyEvent },
      opts.now ?? NOW,
    );
    return { res, applyEvent };
  }

  it('firma válida: aplica el evento con eventId, emailId y estado', async () => {
    const { res, applyEvent } = await call(event);
    expect(res.status).toBe(200);
    expect(applyEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'evt_1', type: 'email.delivered', emailId: 'em-1', messageStatus: 'delivered' }));
  });

  it('firma de otro secreto o replay > 300 s: 401 y nada se aplica', async () => {
    const bad = await call(event, { secret: 'mhsec_otro' });
    expect(bad.res.status).toBe(401);
    expect(bad.applyEvent).not.toHaveBeenCalled();
    const replay = await call(event, { now: NOW + 301 });
    expect(replay.res.status).toBe(401);
  });

  it('webhook de prueba de MailHub: 200 sin tocar la base', async () => {
    const { res, applyEvent } = await call({ eventId: 'evt_t', type: 'mailhub.test' });
    expect(res.status).toBe(200);
    expect(applyEvent).not.toHaveBeenCalled();
  });

  it('del rebote se guarda solo el motivo (no los metadatos)', async () => {
    const { applyEvent } = await call({ ...event, type: 'email.bounced', bounce: { type: 'Permanent', message: 'Mailbox does not exist' } });
    expect(applyEvent).toHaveBeenCalledWith(expect.objectContaining({ detail: { bounceType: 'Permanent', reason: 'Mailbox does not exist' } }));
  });

  it('sin secreto configurado: 503; método distinto de POST: 405', async () => {
    const r = await handleMailhubCallback({ method: 'POST', rawBody: '{}', headers: headers({}) }, { secret: '', applyEvent: vi.fn() }, NOW);
    expect(r.status).toBe(503);
    const g = await handleMailhubCallback({ method: 'GET', rawBody: '', headers: headers({}) }, { secret: MH_SECRET, applyEvent: vi.fn() }, NOW);
    expect(g.status).toBe(405);
  });
});

describe('auth-email-hook', () => {
  const OK: MailhubSendResult = { ok: true, emailId: 'em-9', status: 'queued', replayed: false, suppressed: [] };

  function deps(result: MailhubSendResult = OK): AuthHookDeps & { send: ReturnType<typeof vi.fn>; record: ReturnType<typeof vi.fn> } {
    return {
      secret: HOOK_SECRET,
      ctx: { supabaseUrl: 'https://ref.supabase.co', appUrl: 'https://adminmaestro.pages.dev', linkTtlMinutes: 60 },
      send: vi.fn(async () => result),
      record: vi.fn(async () => undefined),
    };
  }

  async function call(body: unknown, d: AuthHookDeps, opts: { id?: string; tamper?: boolean } = {}) {
    const raw = JSON.stringify(body);
    const id = opts.id ?? 'msg_abc';
    const sig = await signStandardWebhook(HOOK_SECRET, id, String(NOW), raw);
    return handleAuthEmailHook(
      { method: 'POST', rawBody: opts.tamper ? raw.replace('ebim', 'evil') : raw, headers: headers({ 'webhook-id': id, 'webhook-timestamp': String(NOW), 'webhook-signature': sig }) },
      d,
      NOW,
    );
  }

  const invite = {
    user: { id: 'u1', email: 'qa+mailhub@ebim.pe', user_metadata: { full_name: 'Prueba MailHub' } },
    email_data: { token: '1', token_hash: 'th', redirect_to: 'https://adminmaestro.pages.dev/bienvenida', email_action_type: 'invite', site_url: '', token_new: '', token_hash_new: '' },
  };

  it('invitación: envía la plantilla y deja constancia SIN el enlace', async () => {
    const d = deps();
    const res = await call(invite, d);
    expect(res).toEqual({ status: 200, body: {} });
    expect(d.send).toHaveBeenCalledWith(expect.objectContaining({ to: ['qa+mailhub@ebim.pe'], templateKey: 'masteradmin-acceso-invitacion', idempotencyKey: 'masteradmin-auth-msg_abc-invite' }));
    const rec = d.record.mock.calls[0][0];
    expect(rec).toMatchObject({ status: 'SENT', emailId: 'em-9', eventType: 'AUTH_INVITE' });
    expect(rec.variables).not.toHaveProperty('enlace');
  });

  it('firma inválida: 401 y no se envía nada', async () => {
    const d = deps();
    const res = await call(invite, d, { tamper: true });
    expect(res.status).toBe(401);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('MailHub falla: 502 para que Auth lo informe (user-admin cae al enlace manual)', async () => {
    const d = deps({ ok: false, retryable: true, httpStatus: 503, code: 'internal_error', message: 'caído' });
    const res = await call(invite, d);
    expect(res.status).toBe(502);
    expect(d.record.mock.calls[0][0]).toMatchObject({ status: 'FAILED', errorCode: 'internal_error' });
  });

  it('dominio de prueba: se acepta sin enviar', async () => {
    const d = deps();
    const res = await call({ ...invite, user: { ...invite.user, email: 'nuevo@cliente.test' } }, d);
    expect(res.status).toBe(200);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.record.mock.calls[0][0]).toMatchObject({ status: 'SKIPPED' });
  });

  it('tipo sin plantilla: 200 sin enviar', async () => {
    const d = deps();
    const res = await call({ ...invite, email_data: { ...invite.email_data, email_action_type: 'password_changed_notification' } }, d);
    expect(res.status).toBe(200);
    expect(d.send).not.toHaveBeenCalled();
  });
});
