import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chunkUsageEvents,
  classifyBatchResponse,
  importSenderPrivateKey,
  internalFromProvider,
  MAX_BODY_BYTES,
  nextBackoffSeconds,
  sendUsageBatch,
  signUsageToken,
  UsageEventInvalid,
  validateUsageEvent,
  type UsageEvent,
} from './reference-sender';
import { handleUsageIngest, type IngestDeps } from '../../../supabase/functions/_shared/usage/ingest';

/*
 * FIX-USG-v1: el emisor de referencia y el receptor real de MasterAdmin hablan
 * el mismo contrato. Este test no entra en CHECKSUMS.sha256.
 */

const DIR = __dirname;
const json = (rel: string) => JSON.parse(readFileSync(join(DIR, rel), 'utf8'));

const FIX_USG_V1_SHA256 = '9f77d3cd692a52287d1af20b766d3a6024d3f4485de664460de035245ba7d6e1';

describe('FIX-USG-v1: integridad', () => {
  it('CHECKSUMS.sha256 cubre cada archivo y su hash es el publicado', () => {
    const lines = readFileSync(join(DIR, 'CHECKSUMS.sha256'), 'utf8').trim().split('\n');
    for (const line of lines) {
      const [hash, file] = line.split(/\s+/);
      expect(createHash('sha256').update(readFileSync(join(DIR, file))).digest('hex'), file).toBe(hash);
    }
    expect(createHash('sha256').update(readFileSync(join(DIR, 'CHECKSUMS.sha256'))).digest('hex')).toBe(FIX_USG_V1_SHA256);
  });
});

describe('validación en origen', () => {
  const setup = json('fixtures/setup.json');
  const negativeMeters = new Set(setup.meters.filter((m: { allowsNegative: boolean }) => m.allowsNegative).map((m: { code: string }) => m.code));
  const batch = json('fixtures/ingest-batch.json');
  const expected = json('expected/ingest-results.json');

  it('los eventos que el receptor rechaza por forma también los rechaza el emisor', () => {
    batch.events.forEach((ev: UsageEvent, i: number) => {
      const exp = expected.results[i];
      const run = () => validateUsageEvent(ev, { allowsNegative: negativeMeters.has(ev.meterCode) });
      if (['INVALID_EVENT', 'NEGATIVE_QUANTITY', 'INTERNAL_METADATA_INVALID'].includes(exp.code)) {
        // INVALID_EVENT por campo extra: el emisor tipado no lo produce; el resto se detecta en origen.
        if (exp.name === 'rejected-extra-field') return;
        expect(run, exp.name).toThrow(UsageEventInvalid);
      } else if (!['CONFLICT', 'UNKNOWN_METER', 'UNIT_MISMATCH', 'TENANT_NOT_MAPPED_FOR_PRODUCT', 'OCCURRED_AT_IN_FUTURE'].includes(exp.code)) {
        expect(run, exp.name).not.toThrow();
      }
    });
  });

  it('internalFromProvider nunca inventa tokens', () => {
    expect(internalFromProvider({ provider: 'deepgram', model: 'nova' })).toEqual({ provider: 'deepgram', model: 'nova' });
    expect(internalFromProvider({ provider: 'anthropic', inputTokens: 10, outputTokens: undefined, cacheTokens: null })).toEqual({
      provider: 'anthropic', inputTokens: 10,
    });
    expect(internalFromProvider({ inputTokens: -1, outputTokens: 1.5, latencyMs: '3' })).toBeUndefined();
    expect(internalFromProvider({})).toBeUndefined();
  });

  it('rechaza cantidades no finitas, > 6 decimales y negativas sin allowsNegative', () => {
    const ok: UsageEvent = { eventId: crypto.randomUUID(), meterCode: 'x.ai.calls', quantity: 1, unit: 'call', occurredAt: '2026-10-01T00:00:00Z', controlPlaneTenantId: crypto.randomUUID() };
    expect(() => validateUsageEvent(ok)).not.toThrow();
    for (const q of [Number.NaN, Number.POSITIVE_INFINITY, 0.1234567, 1e14]) {
      expect(() => validateUsageEvent({ ...ok, quantity: q })).toThrow('QUANTITY_INVALID');
    }
    expect(() => validateUsageEvent({ ...ok, quantity: -1 })).toThrow('NEGATIVE_QUANTITY');
    expect(() => validateUsageEvent({ ...ok, quantity: -1 }, { allowsNegative: true })).not.toThrow();
    expect(() => validateUsageEvent({ ...ok, controlPlaneTenantId: '' })).toThrow('TENANT_REQUIRED');
  });
});

describe('lotes', () => {
  const ev = (n: number, pad = 0): UsageEvent => ({
    eventId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, meterCode: 'x.ai.calls', quantity: 1, unit: 'call',
    occurredAt: '2026-10-01T00:00:00Z', controlPlaneTenantId: '00000000-0000-4000-8000-000000000001',
    ...(pad ? { subjectRef: 's'.repeat(pad), externalCompanyId: 'c'.repeat(pad), internal: { provider: 'p'.repeat(100), model: 'm'.repeat(100) } } : {}),
  });
  let n = 0;
  const newId = () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;

  it('≤ 500 eventos por lote, orden estable', () => {
    const events = Array.from({ length: 1201 }, (_, i) => ev(i));
    const batches = chunkUsageEvents(events, { environment: 'DEV', productCode: 'x' }, newId);
    expect(batches.map((b) => b.events.length)).toEqual([500, 500, 201]);
    expect(batches.flatMap((b) => b.events)).toEqual(events);
  });

  it('≤ 256 KB por lote', () => {
    const events = Array.from({ length: 500 }, (_, i) => ev(i, 200));
    const batches = chunkUsageEvents(events, { environment: 'DEV', productCode: 'x' }, newId);
    for (const b of batches) expect(new TextEncoder().encode(JSON.stringify(b)).length).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(batches.length).toBeGreaterThan(1);
  });
});

describe('clasificación de respuestas (vectores)', () => {
  const vectors = json('expected/classification-vectors.json');
  it.each(vectors.vectors.map((v: { name: string }) => [v.name, v]))('%s', (_name, v) => {
    const vec = v as { batch: UsageEvent[]; response: { status: number | null; body: unknown }; expect: unknown };
    expect(classifyBatchResponse({ events: vec.batch }, vec.response.status, vec.response.body)).toEqual(vec.expect);
  });
  it('backoff', () => {
    for (const [attempt, seconds] of vectors.backoffSeconds.samples) expect(nextBackoffSeconds(attempt)).toBe(seconds);
  });
});

describe('emisor de referencia ↔ receptor real de MasterAdmin', () => {
  let pem: string;
  let publicJwk: JsonWebKey;
  beforeAll(async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
    let s = '';
    for (const b of der) s += String.fromCharCode(b);
    pem = `-----BEGIN PRIVATE KEY-----\n${btoa(s)}\n-----END PRIVATE KEY-----`; // secrets-scan:allow clave efímera generada en el test
    publicJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  });

  function receiver(ingest = vi.fn()): { deps: IngestDeps; fetchImpl: typeof fetch } {
    const used = new Set<string>();
    const deps: IngestDeps = {
      enabled: true,
      nowSeconds: () => Math.floor(Date.now() / 1000),
      resolveCredential: async (iss) => iss === 'fixture.ebim' ? {
        productCode: 'fixture', environment: 'DEV', audience: 'masteradmin.ebim', algorithm: 'ES256', kid: null,
        publicKeyRef: 'FIXTURE_DEV_USAGE_PUBLIC_JWK', credentialEnabled: true, productIngestEnabled: true,
      } : null,
      resolvePublicKey: () => JSON.stringify(publicJwk),
      consumeJti: async (iss, jti) => (used.has(`${iss}:${jti}`) ? false : (used.add(`${iss}:${jti}`), true)),
      ingest,
    };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const res = await handleUsageIngest({ method: init.method ?? 'GET', headers: new Headers(init.headers), bodyText: String(init.body) }, deps);
      return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { deps, fetchImpl };
  }

  it('lote dorado: firma, envío y disposición por evento según expected/ingest-results.json', async () => {
    const batch = json('fixtures/ingest-batch.json');
    const expected = json('expected/ingest-results.json');
    const ingest = vi.fn(async () => ({
      results: expected.results.map((r: { eventId: string; status: string; code?: string }) => ({ eventId: r.eventId, status: r.status, ...(r.code ? { code: r.code } : {}) })),
      accepted: expected.accepted, duplicate: expected.duplicate, rejected: expected.rejected,
    }));
    const { fetchImpl } = receiver(ingest);
    const token = await signUsageToken({ issuer: 'fixture.ebim', privateKey: await importSenderPrivateKey(pem), nowSeconds: Math.floor(Date.now() / 1000) });
    const out = await sendUsageBatch({ endpoint: 'http://masteradmin.local/functions/v1/usage-ingest', batch, token, fetchImpl });
    expect(ingest).toHaveBeenCalledWith('fixture', 'DEV', batch.events, batch.batchId);
    const dead = out.filter((d) => d.outcome === 'DEAD').map((d) => d.code);
    expect(out.filter((d) => d.outcome === 'SENT')).toHaveLength(expected.accepted + expected.duplicate);
    expect(dead).toEqual(expected.results.filter((r: { status: string }) => r.status === 'REJECTED').map((r: { code: string }) => r.code));
  });

  it('reutilizar el token → JTI_REPLAYED → RETRY (el emisor firma uno nuevo por intento)', async () => {
    const ingest = vi.fn(async (_p: string, _e: string, evs: unknown[]) => ({
      results: (evs as UsageEvent[]).map((e) => ({ eventId: e.eventId, status: 'ACCEPTED' as const })), accepted: evs.length, duplicate: 0, rejected: 0,
    }));
    const { fetchImpl } = receiver(ingest);
    const key = await importSenderPrivateKey(pem);
    const batch = chunkUsageEvents([{ eventId: crypto.randomUUID(), meterCode: 'fixture.ai.calls', quantity: 1, unit: 'call', occurredAt: '2026-10-05T10:00:00Z', controlPlaneTenantId: crypto.randomUUID() }],
      { environment: 'DEV', productCode: 'fixture' }, () => crypto.randomUUID())[0];
    const token = await signUsageToken({ issuer: 'fixture.ebim', privateKey: key, nowSeconds: Math.floor(Date.now() / 1000) });
    expect((await sendUsageBatch({ endpoint: 'x', batch, token, fetchImpl }))[0].outcome).toBe('SENT');
    expect(await sendUsageBatch({ endpoint: 'x', batch, token, fetchImpl })).toEqual([{ eventId: batch.events[0].eventId, outcome: 'RETRY', code: 'JTI_REPLAYED' }]);
  });

  it('TTL > 300 s no se firma', async () => {
    await expect(signUsageToken({ issuer: 'fixture.ebim', privateKey: await importSenderPrivateKey(pem), nowSeconds: 0, ttlSeconds: 301 })).rejects.toThrow('TTL_INVALID');
  });

  it('cada código de expected/transport-errors.json es un error que el receptor puede devolver', () => {
    const src = readFileSync(join(DIR, '../../../supabase/functions/_shared/usage/ingest.ts'), 'utf8')
      + readFileSync(join(DIR, '../../../supabase/functions/_shared/usage/jwt-verify.ts'), 'utf8');
    for (const c of json('expected/transport-errors.json').cases) expect(src, c.error).toContain(`'${c.error}'`);
  });
});
