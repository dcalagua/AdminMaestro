import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  constantTimeEqual,
  signMailhub,
  signStandardWebhook,
  standardWebhookKey,
  verifyMailhubSignature,
  verifyStandardWebhook,
} from './signatures';

/*
 * Firmas de los webhooks entrantes del correo.
 *   · Standard Webhooks (Supabase Auth «Send Email Hook»): base64(HMAC(base64decode(secreto), id.ts.body)).
 *   · MailHub: "sha256=" + hex(HMAC(secreto, ts.body)).
 * Se verifica contra una implementación independiente (node:crypto), no contra sí misma.
 */
const KEY_B64 = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const HOOK_SECRET = `v1,whsec_${KEY_B64}`;
const MH_SECRET = 'mhsec_test_secret_value_0123456789';
const NOW = 1_762_804_800;
const BODY = '{"user":{"id":"u1","email":"ana@ebim.pe"},"email_data":{"email_action_type":"invite"}}';

function nodeStandard(id: string, ts: string, body: string) {
  return `v1,${createHmac('sha256', Buffer.from(KEY_B64, 'base64')).update(`${id}.${ts}.${body}`).digest('base64')}`;
}
function nodeMailhub(ts: string, body: string, secret = MH_SECRET) {
  return `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
}

describe('Standard Webhooks (hook de Auth)', () => {
  it('acepta la firma calculada por una implementación independiente', async () => {
    const sig = nodeStandard('msg_1', String(NOW), BODY);
    expect(await signStandardWebhook(HOOK_SECRET, 'msg_1', String(NOW), BODY)).toBe(sig);
    expect(await verifyStandardWebhook(HOOK_SECRET, { id: 'msg_1', timestamp: String(NOW), signature: sig }, BODY, NOW)).toEqual({ ok: true });
  });

  it('acepta si UNA de varias firmas coincide (rotación)', async () => {
    const sig = `v1,AAAA ${nodeStandard('msg_1', String(NOW), BODY)}`;
    expect((await verifyStandardWebhook(HOOK_SECRET, { id: 'msg_1', timestamp: String(NOW), signature: sig }, BODY, NOW)).ok).toBe(true);
  });

  it('rechaza cuerpo alterado, id distinto, fuera de ventana y cabeceras faltantes', async () => {
    const sig = nodeStandard('msg_1', String(NOW), BODY);
    const h = { id: 'msg_1', timestamp: String(NOW), signature: sig };
    expect(await verifyStandardWebhook(HOOK_SECRET, h, `${BODY} `, NOW)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(await verifyStandardWebhook(HOOK_SECRET, { ...h, id: 'msg_2' }, BODY, NOW)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(await verifyStandardWebhook(HOOK_SECRET, h, BODY, NOW + 301)).toEqual({ ok: false, reason: 'STALE_TIMESTAMP' });
    expect(await verifyStandardWebhook(HOOK_SECRET, h, BODY, NOW - 301)).toEqual({ ok: false, reason: 'STALE_TIMESTAMP' });
    expect(await verifyStandardWebhook(HOOK_SECRET, { ...h, signature: null }, BODY, NOW)).toEqual({ ok: false, reason: 'MISSING_HEADERS' });
  });

  it('el secreto se acepta con o sin prefijo y se rechaza si es corto', () => {
    expect(standardWebhookKey(HOOK_SECRET)?.length).toBe(32);
    expect(standardWebhookKey(`whsec_${KEY_B64}`)?.length).toBe(32);
    expect(standardWebhookKey(KEY_B64)?.length).toBe(32);
    expect(standardWebhookKey('v1,whsec_')).toBeNull();
    expect(standardWebhookKey('v1,whsec_YWJj')).toBeNull();
  });
});

describe('Firma de MailHub (callbacks)', () => {
  it('acepta la firma de MailHub y la de rotación', async () => {
    const ts = String(NOW);
    expect(await signMailhub(MH_SECRET, ts, BODY)).toBe(nodeMailhub(ts, BODY));
    const both = `${nodeMailhub(ts, BODY, 'mhsec_otro')},${nodeMailhub(ts, BODY)}`;
    expect((await verifyMailhubSignature(MH_SECRET, { timestamp: ts, signature: both }, BODY, NOW)).ok).toBe(true);
  });

  it('rechaza firma de otro secreto, replay fuera de 300 s y timestamp no numérico', async () => {
    const ts = String(NOW);
    expect(await verifyMailhubSignature(MH_SECRET, { timestamp: ts, signature: nodeMailhub(ts, BODY, 'mhsec_otro') }, BODY, NOW)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(await verifyMailhubSignature(MH_SECRET, { timestamp: ts, signature: nodeMailhub(ts, BODY) }, BODY, NOW + 600)).toEqual({ ok: false, reason: 'STALE_TIMESTAMP' });
    expect(await verifyMailhubSignature(MH_SECRET, { timestamp: '17e8', signature: nodeMailhub('17e8', BODY) }, BODY, NOW)).toEqual({ ok: false, reason: 'STALE_TIMESTAMP' });
    expect(await verifyMailhubSignature('', { timestamp: ts, signature: nodeMailhub(ts, BODY) }, BODY, NOW)).toEqual({ ok: false, reason: 'BAD_SECRET' });
  });

  it('comparación en tiempo constante sin cortocircuito por longitud', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
