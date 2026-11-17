import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  buildTrialBody,
  classifyTrialResponse,
  toTrialIso,
  TrialClient,
  type TrialDeliveryContext,
  type TrialDesired,
} from './client';
import { runTrial, type TrialStore } from './job';

/*
 * Cliente M2M del contrato trial.v1 (docs/platform-provisioning/TRIAL_CONTRACT.md).
 *
 * Lo que se fija aquí:
 *   · el cuerpo exacto del PUT (contrato §3) y la fecha en ISO-8601 UTC sin ms;
 *   · `endsAt: null` cuando la prueba se convirtió;
 *   · scope `trial_write_scope` (en eChange `echange:lifecycle:write`) y la
 *     cabecera `X-MasterAdmin-Contract: trial.v1`;
 *   · la clasificación de respuestas (§4): un 2xx que no confirma lo enviado no
 *     cuenta; 5xx reintentable; 4xx rechazo con su código;
 *   · sin canal configurado no se firma nada (NOT_CONFIGURED).
 */

const TENANT = '00000000-0000-4ccc-8000-000000000061';
const SECRET_REF = 'LOCAL_FIXTURE_M2M_PRIVATE_KEY';
let pem = '';

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  for (const b of pkcs8) bin += String.fromCharCode(b);
  pem = `-----BEGIN ${'PRIVATE'} KEY-----\n${btoa(bin)}\n-----END ${'PRIVATE'} KEY-----`;
});

function ctx(integration: Partial<NonNullable<TrialDeliveryContext['integration']>> = {}): TrialDeliveryContext {
  return {
    tenant: { controlPlaneTenantId: TENANT, productCode: 'echange' },
    deployment: { id: 'd', environment: 'DEV', base_url: 'http://127.0.0.1:54999/functions/v1/platform-provisioning', timeout_ms: 2000, retry_count: 2 },
    integration: {
      id: 'i',
      type: 'HTTP_M2M',
      issuer: 'masteradmin.ebim',
      audience: 'echange.ebim',
      subject: 'masteradmin-provisioning',
      algorithm: 'ES256',
      token_ttl_seconds: 120,
      trial_path: '/tenants/{controlPlaneTenantId}/trial',
      trial_write_scope: 'echange:lifecycle:write',
      allowed_hosts: [],
      ...integration,
    },
    credential: { id: 'c', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: SECRET_REF },
  };
}

// Así llega un timestamptz desde PostgREST.
const EXTEND: TrialDesired = { endsAt: '2026-11-24T15:04:05+00:00', reason: 'EXTENDED' };
const CONVERT: TrialDesired = { endsAt: null, reason: 'CONVERTED' };

function response(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function applied(overrides: Record<string, unknown> = {}) {
  return { controlPlaneTenantId: TENANT, endsAt: '2026-11-24T15:04:05Z', state: 'TRIAL', appliedAt: '2026-11-17T12:00:00Z', ...overrides };
}

function claimsOf(init: RequestInit | undefined): Record<string, unknown> {
  const auth = (init?.headers as Record<string, string>).authorization;
  const payload = auth.replace(/^Bearer /, '').split('.')[1];
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
}

function client(fetchImpl: typeof fetch, secret = true) {
  const resolver = vi.fn((ref: string) => (secret && ref === SECRET_REF ? pem : undefined));
  const c = new TrialClient({ fetchImpl, secretResolver: resolver, sleep: async () => {}, uuid: () => 'corr-1' });
  return { client: c, resolver };
}

const ACTOR = { id: null, role: 'SERVER' };

describe('toTrialIso', () => {
  it('normaliza a ISO-8601 UTC sin milisegundos, igual que platform.trial_iso_utc', () => {
    expect(toTrialIso('2026-11-24T10:04:05.678-05:00')).toBe('2026-11-24T15:04:05Z');
    expect(toTrialIso(null)).toBeNull();
  });
});

describe('buildTrialBody', () => {
  it('arma el cuerpo exacto del contrato §3', () => {
    expect(buildTrialBody(ctx(), EXTEND)).toEqual({
      contractVersion: 'trial.v1',
      productCode: 'echange',
      controlPlaneTenantId: TENANT,
      endsAt: '2026-11-24T15:04:05Z',
      reason: 'EXTENDED',
    });
  });

  it('convertida: endsAt viaja como null', () => {
    expect(buildTrialBody(ctx(), CONVERT)).toMatchObject({ endsAt: null, reason: 'CONVERTED' });
    // Aunque llegara una fecha, CONVERTED manda «sin vencimiento».
    expect(buildTrialBody(ctx(), { endsAt: '2026-11-24T15:04:05Z', reason: 'CONVERTED' }).endsAt).toBeNull();
  });
});

describe('classifyTrialResponse', () => {
  const sent = { controlPlaneTenantId: TENANT, endsAt: '2026-11-24T15:04:05Z' };

  it('200 que confirma tenant y fecha → APPLIED con el estado de la app', () => {
    expect(classifyTrialResponse(200, applied(), sent)).toMatchObject({ result: 'APPLIED', state: 'TRIAL' });
    // La misma fecha con milisegundos o con otro huso sigue siendo la misma.
    expect(classifyTrialResponse(200, applied({ endsAt: '2026-11-24T10:04:05.000-05:00' }), sent).result).toBe('APPLIED');
    expect(classifyTrialResponse(200, applied({ endsAt: null, state: 'CONVERTED' }), { ...sent, endsAt: null }))
      .toMatchObject({ result: 'APPLIED', state: 'CONVERTED' });
  });

  it('un 200 que no confirma lo enviado no es una confirmación', () => {
    expect(classifyTrialResponse(200, applied({ endsAt: '2026-11-25T15:04:05Z' }), sent))
      .toMatchObject({ result: 'REJECTED', errorCode: 'RESPONSE_INVALID' });
    expect(classifyTrialResponse(200, applied({ controlPlaneTenantId: 'otro' }), sent).result).toBe('REJECTED');
    expect(classifyTrialResponse(200, applied({ state: 'DESCONOCIDO' }), sent).result).toBe('REJECTED');
    expect(classifyTrialResponse(200, applied({ endsAt: null }), sent).result).toBe('REJECTED');
    expect(classifyTrialResponse(200, null, sent).result).toBe('REJECTED');
  });

  it('errores del contrato: 400/404 rechazo con su código; 503 reintentable', () => {
    expect(classifyTrialResponse(400, { error: 'INVALID_TRIAL' }, sent)).toMatchObject({ result: 'REJECTED', errorCode: 'INVALID_TRIAL' });
    expect(classifyTrialResponse(404, { error: 'TENANT_NOT_PROVISIONED' }, sent))
      .toMatchObject({ result: 'REJECTED', errorCode: 'TENANT_NOT_PROVISIONED' });
    expect(classifyTrialResponse(503, { error: 'TRIAL_NOT_CONFIGURED' }, sent))
      .toMatchObject({ result: 'RETRYABLE', errorCode: 'TRIAL_NOT_CONFIGURED' });
    expect(classifyTrialResponse(403, { error: 'texto <html> libre' }, sent).errorCode).toBe('HTTP_403');
  });
});

describe('TrialClient.putTrial', () => {
  it('PUT a /tenants/{id}/trial con scope de escritura, cabecera del contrato y el cuerpo exacto', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response(200, applied()));
    const { client: c } = client(fetchImpl as unknown as typeof fetch);
    const out = await c.putTrial(ctx(), EXTEND, ACTOR);
    expect(out).toMatchObject({ result: 'APPLIED', httpStatus: 200, state: 'TRIAL', attempts: 1 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`http://127.0.0.1:54999/functions/v1/platform-provisioning/tenants/${TENANT}/trial`);
    expect(init?.method).toBe('PUT');
    expect(init?.redirect).toBe('manual');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-masteradmin-contract']).toBe('trial.v1');
    expect(headers['content-type']).toBe('application/json');
    expect(headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(JSON.parse(String(init?.body))).toEqual({
      contractVersion: 'trial.v1',
      productCode: 'echange',
      controlPlaneTenantId: TENANT,
      endsAt: '2026-11-24T15:04:05Z',
      reason: 'EXTENDED',
    });
    const claims = claimsOf(init);
    expect(claims.scope).toBe('echange:lifecycle:write');
    expect(claims.aud).toBe('echange.ebim');
    expect(claims.iss).toBe('masteradmin.ebim');
  });

  it('convertida: el PUT lleva endsAt null y la app responde CONVERTED', async () => {
    const fetchImpl = vi.fn(async () => response(200, applied({ endsAt: null, state: 'CONVERTED' })));
    const { client: c } = client(fetchImpl as unknown as typeof fetch);
    expect(await c.putTrial(ctx(), CONVERT, ACTOR)).toMatchObject({ result: 'APPLIED', state: 'CONVERTED' });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toMatchObject({ endsAt: null, reason: 'CONVERTED' });
  });

  it('un token NUEVO por intento: 503 y luego 200 → dos jti distintos', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(503, null))
      .mockResolvedValueOnce(response(200, applied()));
    const { client: c } = client(fetchImpl as unknown as typeof fetch);
    expect(await c.putTrial(ctx(), EXTEND, ACTOR)).toMatchObject({ result: 'APPLIED', attempts: 2 });
    const jtis = fetchImpl.mock.calls.map(([, init]) => claimsOf(init as RequestInit).jti);
    expect(new Set(jtis).size).toBe(2);
  });

  it('una redirección no se sigue', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    const { client: c } = client(fetchImpl as unknown as typeof fetch);
    expect(await c.putTrial(ctx(), EXTEND, ACTOR)).toMatchObject({ result: 'REJECTED', errorCode: 'REDIRECT_BLOCKED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sin canal trial.v1 en la integración no se firma ni se llama', async () => {
    const fetchImpl = vi.fn();
    const { client: c, resolver } = client(fetchImpl as unknown as typeof fetch);
    expect(await c.putTrial(ctx({ trial_path: null }), EXTEND, ACTOR))
      .toMatchObject({ result: 'NOT_CONFIGURED', errorCode: 'TRIAL_NOT_CONFIGURED', attempts: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('un destino fuera de la política SSRF se rechaza antes de resolver el secreto', async () => {
    const fetchImpl = vi.fn();
    const { client: c, resolver } = client(fetchImpl as unknown as typeof fetch);
    const bad = ctx();
    bad.deployment = { ...bad.deployment!, environment: 'PRD', base_url: 'http://169.254.169.254' };
    expect((await c.putTrial(bad, EXTEND, ACTOR)).result).toBe('REJECTED');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('runTrial', () => {
  it('reclama, envía y registra con la versión reclamada y el estado de la app', async () => {
    const store: TrialStore = {
      claim: vi.fn(async () => [{
        tenant_id: TENANT, saas_product_id: 'p', desired_version: 2,
        desired_ends_at: '2026-11-24T15:04:05+00:00', desired_reason: 'EXTENDED' as const, desired_at: '2026-11-17T12:00:00Z',
      }]),
      context: vi.fn(async () => ctx()),
      record: vi.fn(async () => 'APPLIED'),
    };
    const fetchImpl = vi.fn(async () => response(200, applied()));
    const { client: c } = client(fetchImpl as unknown as typeof fetch);
    const out = await runTrial({ store, client: c, worker: 'w' }, { limit: 5 });
    expect(store.claim).toHaveBeenCalledWith('w', 5, 120);
    expect(store.record).toHaveBeenCalledWith(TENANT, 'w', {
      version: 2, result: 'APPLIED', httpStatus: 200, errorCode: null, state: 'TRIAL',
    });
    expect(out).toEqual({ claimed: 1, results: [{ tenant_id: TENANT, version: 2, reason: 'EXTENDED', result: 'APPLIED', errorCode: null }] });
  });
});
