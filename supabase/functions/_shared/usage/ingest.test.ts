import { describe, it, expect, vi, beforeAll } from 'vitest';
import { handleUsageIngest, type IngestDeps, type IngestRequest, type IngestCredential } from './ingest';
import { USAGE_AUDIENCE, USAGE_SCHEMA, USAGE_SCOPE, MAX_BODY_BYTES, MAX_EVENTS } from './types';

/*
 * Ingest firmado de uso (spec §11.3, plan MA-51).
 *
 * Lo que se fija aquí:
 *   · el ingest está APAGADO por defecto (D-12): flag global off → 503
 *     USAGE_INGEST_DISABLED, antes de mirar el token;
 *   · JWT ES256 firmado por el SaaS con su clave (la pública la resuelve
 *     MasterAdmin por referencia), aud=masteradmin.ebim, scope usage:ingest,
 *     TTL ≤ 300 s, jti de un solo uso consumido DESPUÉS de verificar la firma;
 *   · lote ≤ 500 eventos y ≤ 256 KB; ambiente del cuerpo = ambiente de la
 *     credencial; producto = el de la credencial (nunca el del cuerpo);
 *   · la respuesta es por evento y no filtra detalles internos.
 */

const NOW = 1_790_000_000; // segundos
const ISSUER = 'eexpense.ebim';
let keys: CryptoKeyPair;
let otherKeys: CryptoKeyPair;
let publicJwk: JsonWebKey;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const enc = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

async function sign(claims: Record<string, unknown>, key: CryptoKey = keys.privateKey, header: Record<string, unknown> = { alg: 'ES256', typ: 'JWT' }) {
  const input = `${enc(header)}.${enc(claims)}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

function claims(over: Record<string, unknown> = {}) {
  return { iss: ISSUER, aud: USAGE_AUDIENCE, scope: USAGE_SCOPE, iat: NOW - 10, exp: NOW + 200, jti: crypto.randomUUID(), ...over };
}

const EVENT = {
  eventId: '7f000000-0000-4000-8000-000000000001',
  meterCode: 'eexpense.ai.calls',
  quantity: 1,
  unit: 'call',
  occurredAt: '2026-10-05T10:00:00Z',
  controlPlaneTenantId: '50000000-0000-4000-a000-000000000001',
};

function body(over: Record<string, unknown> = {}) {
  return JSON.stringify({ schema: USAGE_SCHEMA, environment: 'DEV', batchId: '6f000000-0000-4000-8000-000000000001', events: [EVENT], ...over });
}

function credential(over: Partial<IngestCredential> = {}): IngestCredential {
  return {
    productCode: 'eexpense', environment: 'DEV', audience: USAGE_AUDIENCE, algorithm: 'ES256', kid: null,
    publicKeyRef: 'EEXPENSE_DEV_USAGE_PUBLIC_JWK', credentialEnabled: true, productIngestEnabled: true, ...over,
  };
}

function deps(over: Partial<IngestDeps> = {}): IngestDeps & { ingest: ReturnType<typeof vi.fn>; consumeJti: ReturnType<typeof vi.fn> } {
  const used = new Set<string>();
  return {
    enabled: true,
    nowSeconds: () => NOW,
    resolveCredential: vi.fn(async (iss: string) => (iss === ISSUER ? credential() : null)),
    resolvePublicKey: vi.fn((ref: string) => (ref === 'EEXPENSE_DEV_USAGE_PUBLIC_JWK' ? JSON.stringify(publicJwk) : undefined)),
    consumeJti: vi.fn(async (iss: string, jti: string) => {
      const k = `${iss}:${jti}`;
      if (used.has(k)) return false;
      used.add(k);
      return true;
    }),
    ingest: vi.fn(async (_p: string, _e: string, events: unknown[]) => ({
      results: events.map((e) => ({ eventId: (e as { eventId: string }).eventId, status: 'ACCEPTED' })),
      accepted: events.length, duplicate: 0, rejected: 0,
    })),
    ...over,
  } as never;
}

async function req(token: string | null, text = body(), headers: Record<string, string> = {}): Promise<IngestRequest> {
  return {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }),
    bodyText: text,
  };
}

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  otherKeys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
});

describe('usage-ingest: interruptores (D-12)', () => {
  it('flag global apagado → 503 USAGE_INGEST_DISABLED sin tocar credenciales ni base', async () => {
    const d = deps({ enabled: false });
    const res = await handleUsageIngest(await req(await sign(claims())), d);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'USAGE_INGEST_DISABLED' });
    expect(d.resolveCredential).not.toHaveBeenCalled();
    expect(d.ingest).not.toHaveBeenCalled();
  });

  it('kill-switch del producto apagado → 503 USAGE_INGEST_DISABLED y el jti no se consume', async () => {
    const d = deps({ resolveCredential: vi.fn(async () => credential({ productIngestEnabled: false })) });
    const res = await handleUsageIngest(await req(await sign(claims())), d);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'USAGE_INGEST_DISABLED' });
    expect(d.consumeJti).not.toHaveBeenCalled();
  });

  it('credencial deshabilitada → 403 CREDENTIAL_DISABLED', async () => {
    const d = deps({ resolveCredential: vi.fn(async () => credential({ credentialEnabled: false })) });
    const res = await handleUsageIngest(await req(await sign(claims())), d);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'CREDENTIAL_DISABLED' });
  });
});

describe('usage-ingest: transporte', () => {
  it('solo POST', async () => {
    const r = await req(await sign(claims()));
    const res = await handleUsageIngest({ ...r, method: 'GET' }, deps());
    expect(res.status).toBe(405);
  });

  it('solo application/json', async () => {
    const res = await handleUsageIngest(await req(await sign(claims()), body(), { 'content-type': 'text/plain' }), deps());
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('> 256 KB → 413 PAYLOAD_TOO_LARGE (antes de parsear)', async () => {
    const big = body({ padding: 'x'.repeat(MAX_BODY_BYTES) });
    const d = deps();
    const res = await handleUsageIngest(await req(await sign(claims()), big), d);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'PAYLOAD_TOO_LARGE' });
    expect(d.consumeJti).not.toHaveBeenCalled();
  });

  it('> 500 eventos → 400 BATCH_TOO_LARGE sin llegar a la base', async () => {
    const events = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => ({ ...EVENT, eventId: `7f000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    const d = deps();
    const res = await handleUsageIngest(await req(await sign(claims()), body({ events })), d);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'BATCH_TOO_LARGE' });
    expect(d.ingest).not.toHaveBeenCalled();
  });
});

describe('usage-ingest: JWT del SaaS', () => {
  it('sin token → 401 TOKEN_MISSING', async () => {
    const res = await handleUsageIngest(await req(null), deps());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'TOKEN_MISSING' });
  });

  it('emisor desconocido → 401 ISSUER_UNKNOWN', async () => {
    const res = await handleUsageIngest(await req(await sign(claims({ iss: 'otro.ebim' }))), deps());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'ISSUER_UNKNOWN' });
  });

  it('firma con otra clave → 401 SIGNATURE_INVALID', async () => {
    const res = await handleUsageIngest(await req(await sign(claims(), otherKeys.privateKey)), deps());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'SIGNATURE_INVALID' });
  });

  it.each([
    [{ alg: 'HS256', typ: 'JWT' }],
    [{ alg: 'none', typ: 'JWT' }],
    [{ alg: 'RS256', typ: 'JWT' }],
  ])('algoritmo distinto de ES256 (%o) → 401 ALGORITHM_NOT_ALLOWED', async (header) => {
    const res = await handleUsageIngest(await req(await sign(claims(), keys.privateKey, header)), deps());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'ALGORITHM_NOT_ALLOWED' });
  });

  it('aud distinta → 401 AUDIENCE_INVALID', async () => {
    const res = await handleUsageIngest(await req(await sign(claims({ aud: 'eexpense.ebim' }))), deps());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'AUDIENCE_INVALID' });
  });

  it('sin scope usage:ingest → 403 SCOPE_MISSING', async () => {
    const res = await handleUsageIngest(await req(await sign(claims({ scope: 'eexpense:entitlements:read' }))), deps());
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'SCOPE_MISSING' });
  });

  it('scope como lista separada por espacios también vale', async () => {
    const res = await handleUsageIngest(await req(await sign(claims({ scope: `other:x ${USAGE_SCOPE}` }))), deps());
    expect(res.status).toBe(200);
  });

  it('vencido → 401 TOKEN_EXPIRED', async () => {
    const res = await handleUsageIngest(await req(await sign(claims({ iat: NOW - 400, exp: NOW - 100 }))), deps());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'TOKEN_EXPIRED' });
  });

  it('TTL > 300 s → 401 TOKEN_TTL_TOO_LONG', async () => {
    const res = await handleUsageIngest(await req(await sign(claims({ iat: NOW, exp: NOW + 301 }))), deps());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'TOKEN_TTL_TOO_LONG' });
  });

  it('iat en el futuro más allá del skew → 401 TOKEN_NOT_YET_VALID', async () => {
    const res = await handleUsageIngest(await req(await sign(claims({ iat: NOW + 120, exp: NOW + 300 }))), deps());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'TOKEN_NOT_YET_VALID' });
  });

  it('sin jti → 401 TOKEN_INVALID', async () => {
    const c = claims();
    delete (c as Record<string, unknown>).jti;
    const res = await handleUsageIngest(await req(await sign(c)), deps());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'TOKEN_INVALID' });
  });

  it('jti de un solo uso: segundo uso → 401 JTI_REPLAYED', async () => {
    const d = deps();
    const token = await sign(claims());
    expect((await handleUsageIngest(await req(token), d)).status).toBe(200);
    const again = await handleUsageIngest(await req(token), d);
    expect(again.status).toBe(401);
    expect(again.body).toEqual({ error: 'JTI_REPLAYED' });
    expect(d.ingest).toHaveBeenCalledTimes(1);
  });

  it('una firma inválida no consume el jti (no se queman jti ajenos)', async () => {
    const d = deps();
    await handleUsageIngest(await req(await sign(claims({ jti: 'fijo' }), otherKeys.privateKey)), d);
    expect(d.consumeJti).not.toHaveBeenCalled();
  });

  it('la referencia de clave sin valor en el entorno → 503 CREDENTIAL_NOT_CONFIGURED', async () => {
    const res = await handleUsageIngest(await req(await sign(claims())), deps({ resolvePublicKey: () => undefined }));
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'CREDENTIAL_NOT_CONFIGURED' });
  });

  it('una JWK PRIVADA en la referencia se rechaza (misconfiguración) → 503 CREDENTIAL_NOT_CONFIGURED', async () => {
    const priv = await crypto.subtle.exportKey('jwk', keys.privateKey);
    const res = await handleUsageIngest(await req(await sign(claims())), deps({ resolvePublicKey: () => JSON.stringify(priv) }));
    expect(res.status).toBe(503);
  });

  it('acepta la clave pública en PEM SPKI', async () => {
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
    let s = '';
    for (const b of spki) s += String.fromCharCode(b);
    const pem = `-----BEGIN PUBLIC KEY-----\n${btoa(s)}\n-----END PUBLIC KEY-----`;
    const res = await handleUsageIngest(await req(await sign(claims())), deps({ resolvePublicKey: () => pem }));
    expect(res.status).toBe(200);
  });
});

describe('usage-ingest: cuerpo', () => {
  it('schema desconocido → 400 SCHEMA_UNSUPPORTED', async () => {
    const res = await handleUsageIngest(await req(await sign(claims()), body({ schema: 'ebim.usage/v2' })), deps());
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'SCHEMA_UNSUPPORTED' });
  });

  it('ambiente distinto al de la credencial → 400 ENVIRONMENT_MISMATCH', async () => {
    const res = await handleUsageIngest(await req(await sign(claims()), body({ environment: 'QAS' })), deps());
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'ENVIRONMENT_MISMATCH' });
  });

  it('productCode en el cuerpo distinto al de la credencial → 400 PRODUCT_MISMATCH', async () => {
    const res = await handleUsageIngest(await req(await sign(claims()), body({ productCode: 'gmao' })), deps());
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'PRODUCT_MISMATCH' });
  });

  it('JSON inválido, events vacío o batchId no-uuid → 400 INVALID_BATCH', async () => {
    for (const text of ['{no json', body({ events: [] }), body({ batchId: 'x' }), body({ events: {} })]) {
      const res = await handleUsageIngest(await req(await sign(claims()), text), deps());
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'INVALID_BATCH' });
    }
  });

  it('delegación: el producto y el ambiente vienen de la credencial, el lote tal cual', async () => {
    const d = deps();
    const res = await handleUsageIngest(await req(await sign(claims())), d);
    expect(res.status).toBe(200);
    expect(d.ingest).toHaveBeenCalledWith('eexpense', 'DEV', [EVENT], '6f000000-0000-4000-8000-000000000001');
    expect(res.body).toEqual({
      schema: USAGE_SCHEMA, batchId: '6f000000-0000-4000-8000-000000000001',
      results: [{ eventId: EVENT.eventId, status: 'ACCEPTED' }], accepted: 1, duplicate: 0, rejected: 0,
    });
  });

  it('error de la base → 503 RETRYABLE sin detalles', async () => {
    const d = deps({ ingest: vi.fn(async () => { throw Object.assign(new Error('connection reset: host=db secret'), { code: 'XX000' }); }) });
    const res = await handleUsageIngest(await req(await sign(claims())), d);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'RETRYABLE' });
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
