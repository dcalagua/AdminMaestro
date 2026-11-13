import { describe, expect, it, vi } from 'vitest';
import { buildSendBody, nextRetryDelaySeconds, parseMailhubConfig, sendViaMailhub } from './mailhub';

const CFG = { functionsUrl: 'https://mh.supabase.co/functions/v1', apiKey: 'mh_qas_abc_def' };
const REQ = {
  to: ['ana@ebim.pe'],
  templateKey: 'masteradmin-pago-confirmado',
  variables: { numero: 'INV-1' },
  idempotencyKey: 'masteradmin-payment-confirmed-p1',
  referenceId: 'INV-1',
  metadata: { outboxId: 'o1' },
};

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('parseMailhubConfig', () => {
  it('exige https y un token mh_<env>_', () => {
    expect(parseMailhubConfig((n) => ({ MAILHUB_FUNCTIONS_URL: 'https://x.supabase.co/functions/v1/', MAILHUB_API_KEY: 'mh_qas_1_2' })[n])).toEqual({
      functionsUrl: 'https://x.supabase.co/functions/v1',
      apiKey: 'mh_qas_1_2',
    });
    expect(parseMailhubConfig((n) => ({ MAILHUB_FUNCTIONS_URL: 'http://x.com', MAILHUB_API_KEY: 'mh_qas_1' })[n])).toBeNull();
    expect(parseMailhubConfig((n) => ({ MAILHUB_FUNCTIONS_URL: 'https://x.com', MAILHUB_API_KEY: 'otro' })[n])).toBeNull();
  });
});

describe('sendViaMailhub', () => {
  it('POST con X-MailHub-Key, x-region us-east-1, plantilla y sin `from`', async () => {
    const fetchMock = vi.fn(async () => response(202, { emailId: 'em-1', status: 'queued' }));
    const r = await sendViaMailhub(CFG, REQ, fetchMock);
    expect(r).toEqual({ ok: true, emailId: 'em-1', status: 'queued', replayed: false, suppressed: [] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://mh.supabase.co/functions/v1/mailhub-send');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-mailhub-key']).toBe('mh_qas_abc_def');
    expect(headers['x-region']).toBe('us-east-1');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ to: ['ana@ebim.pe'], content: { type: 'template', templateKey: 'masteradmin-pago-confirmado' }, idempotencyKey: REQ.idempotencyKey });
    expect(body).not.toHaveProperty('from');
    expect(body.metadata).toMatchObject({ source: 'masteradmin', outboxId: 'o1' });
  });

  it('replay idempotente y destinatarios suprimidos', async () => {
    const r = await sendViaMailhub(CFG, REQ, async () =>
      response(202, { emailId: 'em-1', status: 'queued', suppressedRecipients: ['ana@ebim.pe'] }, { 'Idempotent-Replayed': 'true' }),
    );
    expect(r).toMatchObject({ ok: true, replayed: true, suppressed: ['ana@ebim.pe'] });
  });

  it.each([
    [429, 'rate_limited', true],
    [500, 'internal_error', true],
    [503, 'unavailable', true],
    [409, 'idempotency_conflict', false],
    [422, 'template_variables_missing', false],
    [401, 'invalid_token', false],
  ])('HTTP %i (%s) → reintentable=%s', async (status, code, retryable) => {
    const r = await sendViaMailhub(CFG, REQ, async () => response(status, { error: { code, message: 'x' } }));
    expect(r).toMatchObject({ ok: false, retryable, httpStatus: status, code });
  });

  it('red caída o timeout: reintentable', async () => {
    const down = await sendViaMailhub(CFG, REQ, async () => {
      throw new TypeError('fetch failed');
    });
    expect(down).toMatchObject({ ok: false, retryable: true, code: 'network_error' });
    const slow = await sendViaMailhub(
      CFG,
      REQ,
      (_u, init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
      10,
    );
    expect(slow).toMatchObject({ ok: false, retryable: true, code: 'timeout' });
  });

  it('metadatos: escalares, ≤ 20 claves, sin objetos', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    const body = buildSendBody({ ...REQ, metadata: { ...many, obj: { a: 1 } as unknown as string } });
    expect(Object.keys(body.metadata as object).length).toBe(20);
    expect(body.metadata).not.toHaveProperty('obj');
  });

  it('backoff exponencial con tope de 6 h', () => {
    expect([1, 2, 3, 4].map(nextRetryDelaySeconds)).toEqual([60, 120, 240, 480]);
    expect(nextRetryDelaySeconds(30)).toBe(21600);
  });
});
