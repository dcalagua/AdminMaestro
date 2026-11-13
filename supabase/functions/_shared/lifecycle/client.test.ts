import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  buildLifecycleBody,
  classifyLifecycleResponse,
  LifecycleClient,
  type LifecycleDeliveryContext,
  type LifecycleDesired,
} from './client';

/*
 * Cliente M2M del contrato lifecycle.v1 (docs/platform-provisioning/LIFECYCLE_CONTRACT.md).
 *
 * Lo que se fija aquí:
 *   · el cuerpo exacto del PUT (contrato §3) y la clave de idempotencia por versión;
 *   · scope `lifecycle_write_scope`, nunca los de alta ni entitlements;
 *   · un token NUEVO por intento (jti de un solo uso en el receptor);
 *   · la clasificación de respuestas (§4): un 2xx que no confirma lo enviado no
 *     cuenta; 409 STALE/CONFLICT; 5xx reintentable; 4xx rechazo;
 *   · sin canal configurado no se firma nada (NOT_CONFIGURED).
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

function ctx(integration: Partial<NonNullable<LifecycleDeliveryContext['integration']>> = {}): LifecycleDeliveryContext {
  return {
    tenant: { controlPlaneTenantId: TENANT, productCode: 'fixture' },
    deployment: { id: 'd', environment: 'DEV', base_url: 'http://127.0.0.1:54999/platform', timeout_ms: 2000, retry_count: 2 },
    integration: {
      id: 'i',
      type: 'HTTP_M2M',
      issuer: 'masteradmin.ebim',
      audience: 'fixture.ebim',
      subject: 'masteradmin-provisioning',
      algorithm: 'ES256',
      token_ttl_seconds: 120,
      lifecycle_path: '/tenants/{controlPlaneTenantId}/lifecycle',
      lifecycle_write_scope: 'fixture:lifecycle:write',
      lifecycle_read_scope: 'fixture:lifecycle:read',
      allowed_hosts: [],
      ...integration,
    },
    credential: { id: 'c', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: SECRET_REF },
  };
}

const SUSPEND: LifecycleDesired = { version: 3, state: 'SUSPENDED', reason: 'NON_PAYMENT', effectiveAt: '2026-10-13T11:00:00Z' };

function response(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function applied(overrides: Record<string, unknown> = {}) {
  return {
    controlPlaneTenantId: TENANT, productCode: 'fixture', appliedVersion: 3, state: 'SUSPENDED',
    reason: 'NON_PAYMENT', appliedAt: '2026-10-13T11:00:02Z', replayed: false, ...overrides,
  };
}

function claimsOf(init: RequestInit | undefined): Record<string, unknown> {
  const auth = (init?.headers as Record<string, string>).authorization;
  const payload = auth.replace(/^Bearer /, '').split('.')[1];
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
}

function client(fetchImpl: typeof fetch, secret = true) {
  const resolver = vi.fn((ref: string) => (secret && ref === SECRET_REF ? pem : undefined));
  const c = new LifecycleClient({ fetchImpl, secretResolver: resolver, sleep: async () => {}, uuid: () => 'corr-1' });
  return { client: c, resolver };
}

const ACTOR = { id: null, role: 'SERVER' };

describe('buildLifecycleBody', () => {
  it('arma el cuerpo exacto del contrato §3, con la clave de idempotencia por versión', () => {
    expect(buildLifecycleBody(ctx(), SUSPEND, 'corr-1')).toEqual({
      contract: 'lifecycle.v1',
      controlPlaneTenantId: TENANT,
      productCode: 'fixture',
      environment: 'DEV',
      version: 3,
      state: 'SUSPENDED',
      reason: 'NON_PAYMENT',
      effectiveAt: '2026-10-13T11:00:00Z',
      idempotencyKey: `lifecycle:${TENANT}:fixture:3`,
      correlationId: 'corr-1',
    });
  });

  it('con ACTIVE la causa viaja como null', () => {
    const body = buildLifecycleBody(ctx(), { ...SUSPEND, state: 'ACTIVE', reason: 'MANUAL' }, 'c');
    expect(body.reason).toBeNull();
  });
});

describe('classifyLifecycleResponse', () => {
  const sent = { controlPlaneTenantId: TENANT, productCode: 'fixture', version: 3, state: 'SUSPENDED' as const };

  it('200 que confirma lo enviado → APPLIED; con replayed → REPLAYED', () => {
    expect(classifyLifecycleResponse(200, applied(), sent).result).toBe('APPLIED');
    expect(classifyLifecycleResponse(200, applied({ replayed: true }), sent).result).toBe('REPLAYED');
  });

  it('un 200 que no confirma versión, estado o tenant no es una confirmación', () => {
    expect(classifyLifecycleResponse(200, applied({ appliedVersion: 2 }), sent)).toMatchObject({ result: 'REJECTED', errorCode: 'RESPONSE_INVALID' });
    expect(classifyLifecycleResponse(200, applied({ state: 'ACTIVE' }), sent).result).toBe('REJECTED');
    expect(classifyLifecycleResponse(200, applied({ controlPlaneTenantId: 'otro' }), sent).result).toBe('REJECTED');
    expect(classifyLifecycleResponse(200, null, sent).result).toBe('REJECTED');
  });

  it('409 STALE_LIFECYCLE / VERSION_CONFLICT devuelven la versión que tiene la app', () => {
    expect(classifyLifecycleResponse(409, { error: 'STALE_LIFECYCLE', appliedVersion: 5 }, sent))
      .toMatchObject({ result: 'STALE', appliedVersion: 5, errorCode: 'STALE_LIFECYCLE' });
    expect(classifyLifecycleResponse(409, { error: 'VERSION_CONFLICT', appliedVersion: 3 }, sent))
      .toMatchObject({ result: 'CONFLICT', appliedVersion: 3 });
  });

  it('5xx/429 reintentable; 4xx rechazo con el código estable o HTTP_<n>', () => {
    expect(classifyLifecycleResponse(503, null, sent)).toMatchObject({ result: 'RETRYABLE', errorCode: 'HTTP_503' });
    expect(classifyLifecycleResponse(429, null, sent).result).toBe('RETRYABLE');
    expect(classifyLifecycleResponse(404, { error: 'TENANT_NOT_PROVISIONED' }, sent))
      .toMatchObject({ result: 'REJECTED', errorCode: 'TENANT_NOT_PROVISIONED' });
    expect(classifyLifecycleResponse(400, { error: 'texto <html> libre' }, sent).errorCode).toBe('HTTP_400');
  });
});

describe('LifecycleClient.putState', () => {
  it('PUT a la ruta del tenant con scope lifecycle, cabeceras del contrato y el cuerpo exacto', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response(200, applied()));
    const { client: c } = client(fetchImpl as unknown as typeof fetch);
    const out = await c.putState(ctx(), SUSPEND, ACTOR);
    expect(out).toMatchObject({ result: 'APPLIED', httpStatus: 200, appliedVersion: 3, state: 'SUSPENDED', attempts: 1 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`http://127.0.0.1:54999/platform/tenants/${TENANT}/lifecycle`);
    expect(init?.method).toBe('PUT');
    expect(init?.redirect).toBe('manual');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-masteradmin-contract']).toBe('lifecycle.v1');
    expect(headers['idempotency-key']).toBe(`lifecycle:${TENANT}:fixture:3`);
    expect(JSON.parse(String(init?.body))).toMatchObject({ version: 3, state: 'SUSPENDED', reason: 'NON_PAYMENT' });
    const claims = claimsOf(init);
    expect(claims.scope).toBe('fixture:lifecycle:write');
    expect(claims.aud).toBe('fixture.ebim');
  });

  it('un token NUEVO por intento: 503 y luego 200 → dos jti distintos', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(503, null))
      .mockResolvedValueOnce(response(200, applied()));
    const { client: c } = client(fetchImpl as unknown as typeof fetch);
    const out = await c.putState(ctx(), SUSPEND, ACTOR);
    expect(out).toMatchObject({ result: 'APPLIED', attempts: 2 });
    const jtis = fetchImpl.mock.calls.map(([, init]) => claimsOf(init as RequestInit).jti);
    expect(new Set(jtis).size).toBe(2);
  });

  it('una redirección no se sigue', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    const { client: c } = client(fetchImpl as unknown as typeof fetch);
    expect(await c.putState(ctx(), SUSPEND, ACTOR)).toMatchObject({ result: 'REJECTED', errorCode: 'REDIRECT_BLOCKED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sin canal lifecycle en la integración no se firma ni se llama', async () => {
    const fetchImpl = vi.fn();
    const { client: c, resolver } = client(fetchImpl as unknown as typeof fetch);
    expect(await c.putState(ctx({ lifecycle_path: null }), SUSPEND, ACTOR))
      .toMatchObject({ result: 'NOT_CONFIGURED', errorCode: 'LIFECYCLE_NOT_CONFIGURED', attempts: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('un destino fuera de la política SSRF se rechaza antes de resolver el secreto', async () => {
    const fetchImpl = vi.fn();
    const { client: c, resolver } = client(fetchImpl as unknown as typeof fetch);
    const bad = ctx();
    bad.deployment = { ...bad.deployment!, environment: 'PRD', base_url: 'http://169.254.169.254' };
    const out = await c.putState(bad, SUSPEND, ACTOR);
    expect(out.result).toBe('REJECTED');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('red caída en todos los intentos → RETRYABLE / PROVIDER_UNREACHABLE', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const { client: c } = client(fetchImpl as unknown as typeof fetch);
    expect(await c.putState(ctx(), SUSPEND, ACTOR)).toMatchObject({ result: 'RETRYABLE', errorCode: 'PROVIDER_UNREACHABLE', attempts: 3 });
  });
});
