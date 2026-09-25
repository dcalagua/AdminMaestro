import { describe, it, expect, vi } from 'vitest';
import { HttpM2mAdapter } from './http-m2m';
import type { ProvisioningContext } from '../types';

/*
 * CONTRATO GENERIC CONGELADO (Task 1 del plan EWM).
 * Esta prueba se escribió contra el código ANTERIOR al refactor de codecs.
 * Si falla, el refactor cambió el contrato genérico: HARD STOP H1.
 * NO se actualiza para acomodar un cambio.
 */

const FIXED_NOW = new Date('2026-09-21T12:00:00.000Z');

async function fixedEcKeyPem(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  // secrets-scan:allow plantilla PEM de una clave GENERADA EN MEMORIA en este test
  return `-----BEGIN PRIVATE KEY-----\n${b64.replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----`;
}
const KEY = await fixedEcKeyPem();

const REQUEST_ID = '9a000000-0000-4000-a000-000000000001';
const CORRELATION_ID = '11111111-2222-4333-8444-555555555555';

function genericContext(): ProvisioningContext {
  return {
    request: {
      id: REQUEST_ID,
      status: 'READY_TO_PROVISION',
      idempotency_key: 'ma-prov-v1-golden',
      correlation_id: CORRELATION_ID,
      attempt_count: 0,
      max_attempts: 3,
      request_version: 1,
      environment: 'QAS',
      policy: 'MANUAL',
      requested_by: 'u1',
      subscription_id: null,
    },
    product: { id: 'p1', code: 'producto', short_name: 'Producto' },
    deployment: {
      id: 'd1',
      code: 'producto-shared-qas',
      deployment_mode: 'SHARED',
      environment: 'QAS',
      base_url: 'https://producto-qas.example.com',
      timeout_ms: 2000,
      retry_count: 2,
      status: 'READY',
      enabled: true,
      health_status: 'HEALTHY',
    },
    integration: {
      id: 'i1',
      code: 'producto-provisioning-v1',
      type: 'HTTP_M2M',
      contract_version: 'v1',
      status: 'READY',
      enabled: true,
      issuer: 'masteradmin.ebim',
      audience: 'producto.ebim',
      subject: 'masteradmin-provisioning',
      algorithm: 'ES256',
      token_ttl_seconds: 300,
      create_scope: 'provisioning:tenant:create',
      read_scope: 'provisioning:tenant:read',
      additional_scopes: ['extra:scope'],
      create_path_template: '/internal/platform/v1/tenants/{tenantCode}/create',
      status_path_template: '/internal/platform/v1/tenants/{externalTenantId}',
      health_path_template: null,
      allowed_hosts: [],
    },
    credential: {
      id: 'c1',
      code: 'producto-qas-m2m',
      type: 'M2M_ASYMMETRIC_JWT',
      enabled: true,
      algorithm: 'ES256',
      token_ttl_seconds: 300,
      secret_ref: 'PRODUCTO_QAS_M2M_PRIVATE_KEY',
      public_key_ref: null,
    },
    payload: {
      tenantCode: 'alpha-ewm',
      tenantName: 'Alpha · Producto',
      adminEmail: 'admin@alpha.ebim.test',
      tenantType: 'PRODUCTION',
      environment: 'QAS',
      deploymentMode: 'SHARED',
      organization: {
        code: 'empresa-directa-alpha',
        legalName: 'Alpha S.A.C.',
        displayName: 'Alpha',
        countryCode: 'PE',
        taxId: '20500000004',
      },
      company: { code: 'ALPHA-01', name: 'Alpha', countryCode: 'PE', currency: 'PEN', taxId: '20500000004' },
      plan: { code: 'plan-std', name: 'Standard' },
      masterAdmin: {
        tenantId: '50000000-0000-4000-a000-000000000008',
        productCode: 'producto',
        requestId: REQUEST_ID,
        correlationId: CORRELATION_ID,
        contractVersion: 'v1',
      },
    },
    actor: { id: 'u1', role: 'TECH_LEAD' },
  };
}

function adapterWith(fetchImpl: typeof fetch) {
  return new HttpM2mAdapter({
    fetchImpl,
    secretResolver: (ref) => (ref === 'PRODUCTO_QAS_M2M_PRIVATE_KEY' ? KEY : undefined),
    sleep: () => Promise.resolve(),
    now: () => FIXED_NOW,
  });
}

const decode = (seg: string) => JSON.parse(Buffer.from(seg, 'base64url').toString()) as Record<string, unknown>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const OK_BODY = {
  status: 'ACTIVE',
  externalTenantId: 'ext-1',
  externalOrganizationId: 'org-1',
  externalCompanyId: 'co-1',
  resources: { initialWarehouseId: 'WH-01', nested: { x: 1 } },
  rawReference: 'op-1',
  extra: 'ignored',
};

type Call = { url: string; init: RequestInit };

function spy(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('sin respuesta programada');
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** Texto EXACTO del cuerpo GENERIC para `genericContext()`. */
const GENERIC_BODY_LITERAL =
  '{"tenantCode":"alpha-ewm","tenantName":"Alpha · Producto","adminEmail":"admin@alpha.ebim.test",' +
  '"tenantType":"PRODUCTION","environment":"QAS","deploymentMode":"SHARED",' +
  '"organization":{"code":"empresa-directa-alpha","legalName":"Alpha S.A.C.","displayName":"Alpha","countryCode":"PE","taxId":"20500000004"},' +
  '"company":{"code":"ALPHA-01","name":"Alpha","countryCode":"PE","currency":"PEN","taxId":"20500000004"},' +
  '"plan":{"code":"plan-std","name":"Standard"},' +
  '"masterAdmin":{"tenantId":"50000000-0000-4000-a000-000000000008","productCode":"producto",' +
  '"requestId":"9a000000-0000-4000-a000-000000000001","correlationId":"11111111-2222-4333-8444-555555555555","contractVersion":"v1"}}';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('GENERIC golden — contrato congelado', () => {
  it('1. URL y método de creación', async () => {
    const { fetchImpl, calls } = spy([jsonResponse(201, OK_BODY)]);
    await adapterWith(fetchImpl).provision(genericContext());
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://producto-qas.example.com/internal/platform/v1/tenants/alpha-ewm/create');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.redirect).toBe('manual');
  });

  it('2. cabeceras exactas y en el mismo orden', async () => {
    const { fetchImpl, calls } = spy([jsonResponse(201, OK_BODY)]);
    await adapterWith(fetchImpl).provision(genericContext());
    const headers = calls[0].init.headers as Record<string, string>;
    expect(Object.keys(headers)).toEqual([
      'authorization',
      'content-type',
      'accept',
      'x-correlation-id',
      'idempotency-key',
      'x-masteradmin-contract',
    ]);
    const { authorization, ...rest } = headers;
    expect(authorization.startsWith('Bearer ')).toBe(true);
    expect(rest).toEqual({
      'content-type': 'application/json',
      accept: 'application/json',
      'x-correlation-id': '11111111-2222-4333-8444-555555555555',
      'idempotency-key': 'ma-prov-v1-golden',
      'x-masteradmin-contract': 'v1',
    });
  });

  it('3. cuerpo exacto', async () => {
    const { fetchImpl, calls } = spy([jsonResponse(201, OK_BODY)]);
    await adapterWith(fetchImpl).provision(genericContext());
    expect(calls[0].init.body).toBe(JSON.stringify(genericContext().payload));
    expect(calls[0].init.body).toBe(GENERIC_BODY_LITERAL);
  });

  it('4. claims y cabecera JOSE', async () => {
    const { fetchImpl, calls } = spy([jsonResponse(201, OK_BODY)]);
    await adapterWith(fetchImpl).provision(genericContext());
    const token = (calls[0].init.headers as Record<string, string>).authorization.slice('Bearer '.length);
    const [h, p, s] = token.split('.');
    expect(decode(h)).toEqual({ alg: 'ES256', typ: 'JWT' });
    const { jti, ...claims } = decode(p);
    expect(claims).toEqual({
      iss: 'masteradmin.ebim',
      aud: 'producto.ebim',
      sub: 'masteradmin-provisioning',
      iat: 1789992000,
      exp: 1789992300,
      scope: 'provisioning:tenant:create extra:scope',
      actor_id: 'u1',
      actor_role: 'TECH_LEAD',
      correlation_id: '11111111-2222-4333-8444-555555555555',
    });
    expect(String(jti)).toMatch(UUID_RE);
    expect(s.length).toBeGreaterThan(0);
  });

  it('5. getStatus: GET sin cuerpo, {externalTenantId} = request.id, scope de lectura', async () => {
    const { fetchImpl, calls } = spy([jsonResponse(200, OK_BODY)]);
    await adapterWith(fetchImpl).getStatus(genericContext());
    expect(calls[0].url).toBe(
      'https://producto-qas.example.com/internal/platform/v1/tenants/9a000000-0000-4000-a000-000000000001',
    );
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
    const token = (calls[0].init.headers as Record<string, string>).authorization.slice('Bearer '.length);
    expect(decode(token.split('.')[1]).scope).toBe('provisioning:tenant:read extra:scope');
  });

  it('6. respuesta 201 normalizada', async () => {
    const { fetchImpl } = spy([jsonResponse(201, OK_BODY)]);
    const outcome = await adapterWith(fetchImpl).provision(genericContext());
    expect(outcome.ok).toBe(true);
    expect(outcome.attempts).toBe(1);
    if (!outcome.ok) throw new Error('esperaba éxito');
    expect(outcome.result).toEqual({
      status: 'ACTIVE',
      externalTenantId: 'ext-1',
      externalOrganizationId: 'org-1',
      externalCompanyId: 'co-1',
      resources: { initialWarehouseId: 'WH-01' },
      rawReference: 'op-1',
    });
  });

  it('7. respuesta sin externalTenantId → PROVIDER_RESPONSE_INVALID', async () => {
    const { fetchImpl } = spy([jsonResponse(200, { ok: true })]);
    const outcome = await adapterWith(fetchImpl).provision(genericContext());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('esperaba fallo');
    expect(outcome.failure.code).toBe('PROVIDER_RESPONSE_INVALID');
  });

  it('8a. reintentos 503,503,201: misma clave y mismo cuerpo', async () => {
    const { fetchImpl, calls } = spy([
      jsonResponse(503, {}),
      jsonResponse(503, {}),
      jsonResponse(201, OK_BODY),
    ]);
    const outcome = await adapterWith(fetchImpl).provision(genericContext());
    expect(calls).toHaveLength(3);
    expect(outcome.attempts).toBe(3);
    expect(outcome.ok).toBe(true);
    for (const call of calls) {
      expect((call.init.headers as Record<string, string>)['idempotency-key']).toBe('ma-prov-v1-golden');
      expect(call.init.body).toBe(GENERIC_BODY_LITERAL);
    }
  });

  it('8b. 409 no se reintenta', async () => {
    const { fetchImpl, calls } = spy([jsonResponse(409, { code: 'CONFLICT' })]);
    const outcome = await adapterWith(fetchImpl).provision(genericContext());
    expect(calls).toHaveLength(1);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('esperaba fallo');
    expect(outcome.failure.retryable).toBe(false);
  });

  it('8c. red caída tres veces → PROVIDER_UNREACHABLE', async () => {
    const { fetchImpl, calls } = spy([
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
    ]);
    const outcome = await adapterWith(fetchImpl).provision(genericContext());
    expect(calls).toHaveLength(3);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('esperaba fallo');
    expect(outcome.failure.code).toBe('PROVIDER_UNREACHABLE');
  });

  it('9a. marcadores actuales {tenantCode} y {externalTenantId}', async () => {
    const ctx = genericContext();
    ctx.integration!.create_path_template = '/x/{tenantCode}/{externalTenantId}';
    const { fetchImpl, calls } = spy([jsonResponse(201, OK_BODY)]);
    await adapterWith(fetchImpl).provision(ctx);
    expect(calls[0].url).toBe(
      'https://producto-qas.example.com/x/alpha-ewm/9a000000-0000-4000-a000-000000000001',
    );
  });

  it('9b. marcador desconocido → PATH_TEMPLATE_INVALID sin llamar', async () => {
    const ctx = genericContext();
    ctx.integration!.create_path_template = '/x/{unknownKey}';
    const { fetchImpl, calls } = spy([jsonResponse(201, OK_BODY)]);
    const outcome = await adapterWith(fetchImpl).provision(ctx);
    expect(calls).toHaveLength(0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('esperaba fallo');
    expect(outcome.failure.code).toBe('PATH_TEMPLATE_INVALID');
  });
});
