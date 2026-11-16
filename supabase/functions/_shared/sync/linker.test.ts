import { describe, it, expect, vi, beforeAll } from 'vitest';
import { hasTenantLink, linkPathTemplate, needsAppLink, requestAppLink } from './linker';
import type { SyncPlanLink, SyncPlanTarget } from './types';

/*
 * Vínculo en la app de un alta manual (TENANT_INVENTORY_CONTRACT.md §8):
 *   · PUT {inventory_path}/{controlPlaneTenantId}/link con el scope propio y el
 *     contrato tenant-inventory.v1; un token por petición;
 *   · LINKED solo si la app responde 200 hablando del MISMO tenant e id externo;
 *   · cualquier otra respuesta es FAILED con un código estable;
 *   · sin scope de vínculo o sin id externo, ninguna llamada.
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

function target(integration: Partial<SyncPlanTarget['integration']> = {}): SyncPlanTarget {
  return {
    product: { id: 'p', code: 'fixture', short_name: 'Fixture' },
    deployment: { id: 'd', code: 'fixture-dev', environment: 'DEV', base_url: 'http://127.0.0.1:54999/platform', timeout_ms: 2000, retry_count: 0, enabled: true },
    integration: {
      id: 'i', code: 'fixture-m2m', type: 'HTTP_M2M', enabled: true, adapter_key: 'GENERIC', capabilities: ['PROVISION'],
      issuer: 'masteradmin.ebim', audience: 'fixture.ebim', subject: 'masteradmin-provisioning', algorithm: 'ES256',
      token_ttl_seconds: 120, lifecycle_path: null, lifecycle_read_scope: null,
      inventory_path: '/tenants', inventory_read_scope: 'fixture:tenants:list', tenant_link_scope: 'fixture:tenants:link',
      allowed_hosts: [], ...integration,
    },
    credential: { id: 'c', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: SECRET_REF },
    links: [],
  };
}

const LINK: SyncPlanLink = {
  mapping_id: 'm1', tenant_id: TENANT, request_id: 'r1', external_tenant_id: '42',
  external_organization_id: null, external_company_id: null, expected_state: 'ACTIVE', registered_manually: true, app_link_status: null,
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function deps(fetchImpl: ReturnType<typeof vi.fn>) {
  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    secretResolver: (ref: string) => (ref === SECRET_REF ? pem : undefined),
    sleep: async () => undefined,
    uuid: () => '11111111-1111-4111-8111-111111111111',
  };
}

function scopeOf(init: RequestInit): string {
  const token = String((init.headers as Record<string, string>).authorization).slice(7);
  return JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).scope;
}

describe('requestAppLink', () => {
  it('PUT a la ruta del vínculo con el scope propio, el contrato y el id externo', async () => {
    const fetchImpl = vi.fn(async () => response(200, {
      contract: 'tenant-inventory.v1', productCode: 'fixture', environment: 'DEV',
      controlPlaneTenantId: TENANT, externalTenantId: '42', status: 'LINKED',
    }));
    const r = await requestAppLink(target(), LINK, { id: null, role: 'SERVER' }, deps(fetchImpl));
    expect(r).toEqual({ outcome: 'LINKED', httpStatus: 200, errorCode: null });
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:54999/platform/tenants/${TENANT}/link`);
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['x-masteradmin-contract']).toBe('tenant-inventory.v1');
    expect(JSON.parse(String(init.body))).toEqual({ externalTenantId: '42', requestId: '11111111-1111-4111-8111-111111111111' });
    expect(scopeOf(init)).toContain('fixture:tenants:link');
  });

  it('ALREADY_LINKED también es LINKED; un 200 de otro tenant no', async () => {
    const ok = vi.fn(async () => response(200, { contract: 'tenant-inventory.v1', controlPlaneTenantId: TENANT, externalTenantId: '42', status: 'ALREADY_LINKED' }));
    expect((await requestAppLink(target(), LINK, { id: null, role: 'SERVER' }, deps(ok))).outcome).toBe('LINKED');
    const other = vi.fn(async () => response(200, { contract: 'tenant-inventory.v1', controlPlaneTenantId: TENANT, externalTenantId: '43', status: 'LINKED' }));
    expect(await requestAppLink(target(), LINK, { id: null, role: 'SERVER' }, deps(other))).toMatchObject({ outcome: 'FAILED', errorCode: 'RESPONSE_INVALID' });
  });

  it('los errores de la app quedan con su código estable', async () => {
    for (const [status, code] of [[404, 'EXTERNAL_TENANT_NOT_FOUND'], [409, 'LINK_CONFLICT'], [503, 'TENANT_LINK_NOT_CONFIGURED']] as const) {
      const f = vi.fn(async () => response(status, { error: code }));
      expect(await requestAppLink(target(), LINK, { id: null, role: 'SERVER' }, deps(f))).toEqual({ outcome: 'FAILED', httpStatus: status, errorCode: code });
    }
    const html = vi.fn(async () => new Response('<html>', { status: 404 }));
    expect((await requestAppLink(target(), LINK, { id: null, role: 'SERVER' }, deps(html))).errorCode).toBe('HTTP_404');
  });

  it('sin scope de vínculo o sin id externo no llama a nadie', async () => {
    const f = vi.fn();
    expect(hasTenantLink(target({ tenant_link_scope: null }))).toBe(false);
    expect((await requestAppLink(target({ tenant_link_scope: null }), LINK, { id: null, role: 'SERVER' }, deps(f))).errorCode).toBe('TENANT_LINK_NOT_CONFIGURED');
    expect((await requestAppLink(target(), { ...LINK, external_tenant_id: null }, { id: null, role: 'SERVER' }, deps(f))).errorCode).toBe('EXTERNAL_ID_MISSING');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('needsAppLink / linkPathTemplate', () => {
  it('solo altas manuales con id externo y sin vínculo confirmado', () => {
    expect(needsAppLink(LINK)).toBe(true);
    expect(needsAppLink({ ...LINK, app_link_status: 'FAILED' })).toBe(true);
    expect(needsAppLink({ ...LINK, app_link_status: 'LINKED' })).toBe(false);
    expect(needsAppLink({ ...LINK, registered_manually: false })).toBe(false);
    expect(needsAppLink({ ...LINK, external_tenant_id: null })).toBe(false);
  });

  it('la ruta cuelga de la del inventario', () => {
    expect(linkPathTemplate('/tenants')).toBe('/tenants/{controlPlaneTenantId}/link');
    expect(linkPathTemplate('/internal/platform/v1/tenants/')).toBe('/internal/platform/v1/tenants/{controlPlaneTenantId}/link');
  });
});
