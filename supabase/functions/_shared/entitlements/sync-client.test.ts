import { describe, it, expect, vi, beforeAll } from 'vitest';
import { classifyPutResponse, EntitlementSyncClient, type EntitlementDeliveryContext } from './sync-client';
import { buildSnapshot } from './snapshot';
import { canonicalize } from './jcs';
import type { EntitlementSnapshot } from './types';

/*
 * Cliente M2M de sincronización (plan MA-35, spec §8.1–§8.3).
 *
 * Reusa url-guard, retry y m2m de provisioning SIN modificarlos, pero con los
 * scopes nuevos `<product>:entitlements:write/read` y un token NUEVO por
 * intento: los receptores registran el `jti` como de un solo uso en estas
 * rutas, así que reintentar con el mismo token sería un 401 garantizado.
 */

const TENANT = '00000000-0000-4ccc-8000-000000000001';
const SECRET_REF = 'LOCAL_FIXTURE_M2M_PRIVATE_KEY';
let pem = '';

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  for (const b of pkcs8) bin += String.fromCharCode(b);
  pem = `-----BEGIN ${'PRIVATE'} KEY-----\n${btoa(bin)}\n-----END ${'PRIVATE'} KEY-----`;
});

function ctx(overrides: Partial<EntitlementDeliveryContext['deployment']> = {}): EntitlementDeliveryContext {
  return {
    tenant: { controlPlaneTenantId: TENANT, productCode: 'fixture' },
    push_enabled: true,
    enrollment: 'SHADOW',
    deployment: { id: 'd', environment: 'DEV', base_url: 'http://127.0.0.1:54999/platform', timeout_ms: 2000, retry_count: 2, ...overrides },
    integration: {
      id: 'i',
      type: 'HTTP_M2M',
      issuer: 'masteradmin.ebim',
      audience: 'fixture.ebim',
      subject: 'masteradmin-provisioning',
      algorithm: 'ES256',
      token_ttl_seconds: 120,
      entitlements_path: '/tenants/{controlPlaneTenantId}/entitlements',
      entitlements_manifest_path: '/entitlements/manifest',
      entitlements_write_scope: 'fixture:entitlements:write',
      entitlements_read_scope: 'fixture:entitlements:read',
      allowed_hosts: [],
    },
    credential: { id: 'c', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: SECRET_REF },
  };
}

async function snapshot(overrides: Record<string, unknown> = {}): Promise<EntitlementSnapshot> {
  return buildSnapshot({
    environment: 'DEV',
    controlPlaneTenantId: TENANT,
    productCode: 'fixture',
    external: { tenantId: 'ext-1', organizationId: null, companyIds: [] },
    snapshotVersion: 4,
    previousVersion: 3,
    effectiveAt: '2026-10-01T00:00:00Z',
    issuedAt: '2026-10-01T00:00:01Z',
    appActive: true,
    planCode: null,
    registry: [{ code: 'fixture.reports', kind: 'FEATURE', isBaseline: false, scopeLevel: 'TENANT', unit: null, meterCode: null, status: 'ACTIVE' }],
    granted: [{ code: 'fixture.reports', value: null, enforcement: null, included: null, sources: ['PLAN'], companyIds: null }],
    allowancePeriod: { start: '2026-10-01', end: '2026-10-31' },
    aiCredits: { weights: [], weightsVersion: 0 },
    correlationId: '00000000-0000-4ccc-8000-0000000000c4',
    ...overrides,
  });
}

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function claimsOf(init: RequestInit | undefined): Record<string, unknown> {
  const auth = (init?.headers as Record<string, string>).authorization;
  const payload = auth.replace(/^Bearer /, '').split('.')[1];
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
}

function client(fetchImpl: typeof fetch, secret = true) {
  const resolver = vi.fn((ref: string) => (secret && ref === SECRET_REF ? pem : undefined));
  return { client: new EntitlementSyncClient({ fetchImpl, secretResolver: resolver, sleep: async () => {} }), resolver };
}

const ACTOR = { id: null, role: 'SERVER' };

describe('pushSnapshot — petición', () => {
  it('PUT con el cuerpo JCS exacto y los headers del contrato entitlements.v1', async () => {
    const s = await snapshot();
    const fetchImpl = vi.fn(async () =>
      response(200, { appliedVersion: 4, appliedChecksum: s.checksum, appliedAt: '2026-10-01T00:00:02Z', status: 'APPLIED', unknownCapabilities: [], replayed: false }),
    );
    const out = await client(fetchImpl as unknown as typeof fetch).client.pushSnapshot(ctx(), s, ACTOR);
    expect(out).toMatchObject({ result: 'APPLIED', httpStatus: 200, appliedVersion: 4, appliedChecksum: s.checksum, attempts: 1 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:54999/platform/tenants/${TENANT}/entitlements`);
    expect(init.method).toBe('PUT');
    expect(init.redirect).toBe('manual');
    expect(init.body).toBe(canonicalize(s));
    const headers = init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe(s.idempotencyKey);
    expect(headers['x-correlation-id']).toBe(s.correlationId);
    expect(headers['x-masteradmin-contract']).toBe('entitlements.v1');
  });

  it('el token lleva SOLO el scope de escritura de entitlements, con iss/aud/sub de la integración', async () => {
    const s = await snapshot();
    const fetchImpl = vi.fn(async () => response(200, { appliedVersion: 4, appliedChecksum: s.checksum, appliedAt: 'x', status: 'APPLIED', unknownCapabilities: [], replayed: false }));
    await client(fetchImpl as unknown as typeof fetch).client.pushSnapshot(ctx(), s, ACTOR);
    const claims = claimsOf((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]);
    expect(claims).toMatchObject({ iss: 'masteradmin.ebim', aud: 'fixture.ebim', sub: 'masteradmin-provisioning', scope: 'fixture:entitlements:write' });
    expect(claims.correlation_id).toBe(s.correlationId);
    expect(Number(claims.exp) - Number(claims.iat)).toBeLessThanOrEqual(300);
  });

  it('cada reintento firma un token nuevo (jti distinto): el receptor los trata como de un solo uso', async () => {
    const s = await snapshot();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(503, { error: 'UNAVAILABLE' }))
      .mockResolvedValueOnce(response(200, { appliedVersion: 4, appliedChecksum: s.checksum, appliedAt: 'x', status: 'APPLIED', unknownCapabilities: [], replayed: false }));
    const out = await client(fetchImpl as unknown as typeof fetch).client.pushSnapshot(ctx(), s, ACTOR);
    expect(out).toMatchObject({ result: 'APPLIED', attempts: 2 });
    const jtis = fetchImpl.mock.calls.map((c) => claimsOf((c as unknown as [string, RequestInit])[1]).jti);
    expect(new Set(jtis).size).toBe(2);
    const keys = fetchImpl.mock.calls.map((c) => ((c as unknown as [string, RequestInit])[1].headers as Record<string, string>)['idempotency-key']);
    expect(new Set(keys).size).toBe(1);
  });
});

describe('pushSnapshot — verificación previa (nada sale sin estar sano)', () => {
  it('un snapshot alterado no se envía ni se firma', async () => {
    const s = { ...(await snapshot()), appActive: false };
    const fetchImpl = vi.fn();
    const { client: c, resolver } = client(fetchImpl as unknown as typeof fetch);
    const out = await c.pushSnapshot(ctx(), s, ACTOR);
    expect(out).toMatchObject({ result: 'INVALID_SNAPSHOT', errorCode: 'CHECKSUM_MISMATCH', httpStatus: null });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('snapshot de otro tenant, producto o ambiente que el contexto → INVALID_SNAPSHOT', async () => {
    const fetchImpl = vi.fn();
    const { client: c } = client(fetchImpl as unknown as typeof fetch);
    const other = await snapshot({ controlPlaneTenantId: '00000000-0000-4ccc-8000-000000000002' });
    expect(await c.pushSnapshot(ctx(), other, ACTOR)).toMatchObject({ result: 'INVALID_SNAPSHOT', errorCode: 'SNAPSHOT_CONTEXT_MISMATCH' });
    const qas = await snapshot({ environment: 'QAS' });
    expect(await c.pushSnapshot(ctx(), qas, ACTOR)).toMatchObject({ result: 'INVALID_SNAPSHOT', errorCode: 'SNAPSHOT_CONTEXT_MISMATCH' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('destino inseguro (QAS por http) → REJECTED sin llamar ni firmar', async () => {
    const s = await snapshot({ environment: 'QAS' });
    const fetchImpl = vi.fn();
    const { client: c, resolver } = client(fetchImpl as unknown as typeof fetch);
    const out = await c.pushSnapshot(ctx({ environment: 'QAS', base_url: 'http://esupplier-qas.example.com' }), s, ACTOR);
    expect(out).toMatchObject({ result: 'REJECTED', errorCode: 'BASE_URL_INSECURE' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('secreto no disponible → REJECTED SECRET_NOT_AVAILABLE, sin llamada', async () => {
    const fetchImpl = vi.fn();
    const out = await client(fetchImpl as unknown as typeof fetch, false).client.pushSnapshot(ctx(), await snapshot(), ACTOR);
    expect(out).toMatchObject({ result: 'REJECTED', errorCode: 'SECRET_NOT_AVAILABLE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('integración sin ruta o scope de entitlements → REJECTED ENTITLEMENTS_NOT_CONFIGURED', async () => {
    const c0 = ctx();
    c0.integration!.entitlements_write_scope = null;
    const fetchImpl = vi.fn();
    expect(await client(fetchImpl as unknown as typeof fetch).client.pushSnapshot(c0, await snapshot(), ACTOR)).toMatchObject({
      result: 'REJECTED',
      errorCode: 'ENTITLEMENTS_NOT_CONFIGURED',
    });
  });
});

describe('pushSnapshot — clasificación de respuestas', () => {
  it.each([
    [200, { appliedVersion: 4, appliedChecksum: 'x', appliedAt: 'x', status: 'APPLIED', unknownCapabilities: [], replayed: true }, 'REPLAYED', null],
    [200, { appliedVersion: 4, appliedChecksum: 'x', appliedAt: 'x', status: 'APPLIED_WITH_WARNINGS', unknownCapabilities: ['fixture.ghost'], replayed: false }, 'APPLIED', null],
    [409, { error: 'STALE_SNAPSHOT', message: 'm', appliedVersion: 9 }, 'STALE', 'STALE_SNAPSHOT'],
    [409, { error: 'VERSION_CONFLICT', message: 'm' }, 'CONFLICT', 'VERSION_CONFLICT'],
    [409, { error: 'OTRA_COSA', message: 'm' }, 'REJECTED', 'OTRA_COSA'],
    [422, { error: 'CHECKSUM_MISMATCH', message: 'm' }, 'REJECTED', 'CHECKSUM_MISMATCH'],
    [422, { error: 'ENVIRONMENT_MISMATCH', message: 'm' }, 'REJECTED', 'ENVIRONMENT_MISMATCH'],
    [404, { error: 'TENANT_NOT_PROVISIONED', message: 'm' }, 'REJECTED', 'TENANT_NOT_PROVISIONED'],
    [403, { error: 'INSUFFICIENT_SCOPE', message: 'm' }, 'REJECTED', 'INSUFFICIENT_SCOPE'],
    [401, { error: 'JTI_REPLAYED', message: 'm' }, 'REJECTED', 'JTI_REPLAYED'],
    [413, { error: 'SNAPSHOT_TOO_LARGE', message: 'm' }, 'REJECTED', 'SNAPSHOT_TOO_LARGE'],
    [422, '<html>proxy</html>', 'REJECTED', 'HTTP_422'],
    [422, { error: 'texto libre <script>' }, 'REJECTED', 'HTTP_422'],
    [503, { error: 'UNAVAILABLE' }, 'RETRYABLE', 'UNAVAILABLE'],
    [429, {}, 'RETRYABLE', 'HTTP_429'],
  ] as const)('%i %j → %s', (status, body, result, code) => {
    const parsed = typeof body === 'string' ? null : body;
    expect(classifyPutResponse(status, parsed)).toMatchObject({ result, errorCode: code });
  });

  it('agota los reintentos con 503 → RETRYABLE con los intentos hechos', async () => {
    const fetchImpl = vi.fn(async () => response(503, { error: 'UNAVAILABLE' }));
    const out = await client(fetchImpl as unknown as typeof fetch).client.pushSnapshot(ctx(), await snapshot(), ACTOR);
    expect(out).toMatchObject({ result: 'RETRYABLE', httpStatus: 503, attempts: 3 });
  });

  it('un 409 no se reintenta', async () => {
    const fetchImpl = vi.fn(async () => response(409, { error: 'VERSION_CONFLICT', message: 'm' }));
    const out = await client(fetchImpl as unknown as typeof fetch).client.pushSnapshot(ctx(), await snapshot(), ACTOR);
    expect(out).toMatchObject({ result: 'CONFLICT', attempts: 1 });
  });

  it('error de red → reintenta y termina RETRYABLE PROVIDER_UNREACHABLE', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const out = await client(fetchImpl as unknown as typeof fetch).client.pushSnapshot(ctx(), await snapshot(), ACTOR);
    expect(out).toMatchObject({ result: 'RETRYABLE', errorCode: 'PROVIDER_UNREACHABLE', httpStatus: null, attempts: 3 });
  });

  it('una redirección no se sigue en un PUT: REJECTED REDIRECT_BLOCKED', async () => {
    const fetchImpl = vi.fn(async () => response(307, undefined, { location: 'http://169.254.169.254/' }));
    const out = await client(fetchImpl as unknown as typeof fetch).client.pushSnapshot(ctx(), await snapshot(), ACTOR);
    expect(out).toMatchObject({ result: 'REJECTED', errorCode: 'REDIRECT_BLOCKED', attempts: 1 });
  });
});

describe('getApplied — la única prueba de sincronización', () => {
  const ok = {
    controlPlaneTenantId: TENANT,
    productCode: 'fixture',
    appliedVersion: 4,
    appliedChecksum: `sha256:${'a'.repeat(64)}`,
    appliedAt: '2026-10-01T00:00:02Z',
    status: 'APPLIED',
    unknownCapabilities: [],
    enforcementMode: 'SHADOW',
  };

  it('GET con el scope de LECTURA; devuelve lo aplicado', async () => {
    const fetchImpl = vi.fn(async () => response(200, ok));
    const out = await client(fetchImpl as unknown as typeof fetch).client.getApplied(ctx(), ACTOR);
    expect(out).toMatchObject({ result: 'OBSERVED', appliedVersion: 4, status: 'APPLIED', enforcementMode: 'SHADOW' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:54999/platform/tenants/${TENANT}/entitlements`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(claimsOf(init).scope).toBe('fixture:entitlements:read');
  });

  it('NONE (nunca sincronizado) es una observación válida', async () => {
    const fetchImpl = vi.fn(async () => response(200, { ...ok, appliedVersion: null, appliedChecksum: null, appliedAt: null, status: 'NONE' }));
    expect(await client(fetchImpl as unknown as typeof fetch).client.getApplied(ctx(), ACTOR)).toMatchObject({ result: 'OBSERVED', status: 'NONE' });
  });

  it.each([
    ['otro tenant', { ...ok, controlPlaneTenantId: '00000000-0000-4ccc-8000-000000000009' }],
    ['estado inventado', { ...ok, status: 'OK' }],
    ['versión no entera', { ...ok, appliedVersion: '4' }],
    ['modo desconocido', { ...ok, enforcementMode: 'FULL' }],
  ])('respuesta inválida (%s) → REJECTED GET_RESPONSE_INVALID', async (_l, body) => {
    const fetchImpl = vi.fn(async () => response(200, body));
    expect(await client(fetchImpl as unknown as typeof fetch).client.getApplied(ctx(), ACTOR)).toMatchObject({
      result: 'REJECTED',
      errorCode: 'GET_RESPONSE_INVALID',
    });
  });

  it('404 → REJECTED; 503 → RETRYABLE', async () => {
    const f404 = vi.fn(async () => response(404, { error: 'TENANT_NOT_PROVISIONED', message: 'm' }));
    expect(await client(f404 as unknown as typeof fetch).client.getApplied(ctx(), ACTOR)).toMatchObject({ result: 'REJECTED', errorCode: 'TENANT_NOT_PROVISIONED' });
    const f503 = vi.fn(async () => response(503, {}));
    expect(await client(f503 as unknown as typeof fetch).client.getApplied(ctx(), ACTOR)).toMatchObject({ result: 'RETRYABLE', httpStatus: 503 });
  });
});

describe('getManifest', () => {
  it('lee el manifiesto con el scope de lectura y devuelve los códigos ACTIVE', async () => {
    const fetchImpl = vi.fn(async () =>
      response(200, {
        schema: 'ebim.capabilities/v1',
        productCode: 'fixture',
        manifestVersion: '2026.10.1',
        capabilities: [
          { code: 'fixture.reports', name: 'R', kind: 'FEATURE', status: 'ACTIVE' },
          { code: 'fixture.beta', name: 'B', kind: 'FEATURE', status: 'DRAFT' },
        ],
      }),
    );
    const out = await client(fetchImpl as unknown as typeof fetch).client.getManifest(ctx(), ACTOR);
    expect(out).toEqual({ ok: true, manifestVersion: '2026.10.1', activeCodes: ['fixture.reports'], attempts: 1 });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('http://127.0.0.1:54999/platform/entitlements/manifest');
  });

  it('manifiesto de otro producto → error', async () => {
    const fetchImpl = vi.fn(async () => response(200, { schema: 'ebim.capabilities/v1', productCode: 'otro', manifestVersion: '1', capabilities: [] }));
    expect(await client(fetchImpl as unknown as typeof fetch).client.getManifest(ctx(), ACTOR)).toMatchObject({ ok: false, errorCode: 'MANIFEST_INVALID' });
  });
});
