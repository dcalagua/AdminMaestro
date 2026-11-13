import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fetchInventory, INVENTORY_CONTRACT, parseInventoryItem, readLifecycleState } from './readers';
import type { SyncPlanLink, SyncPlanTarget } from './types';

/*
 * Lectores de la sincronización de tenants (TENANT_INVENTORY_CONTRACT.md y
 * LIFECYCLE_CONTRACT.md §4). Lo que se fija aquí:
 *   · solo GET, con el scope de LECTURA del canal y un token por petición;
 *   · «no existe» solo cuando la app lo dice con su código (404 TENANT_NOT_PROVISIONED);
 *     un 404 sin código es «no se pudo verificar», nunca un vínculo roto;
 *   · el inventario pagina hasta `nextCursor: null`, valida contrato, producto y
 *     entorno, y queda INCOMPLETO ante un ítem inválido o un fallo a mitad;
 *   · sin canal anunciado: NOT_AVAILABLE y ninguna llamada.
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
    deployment: { id: 'd', code: 'fixture-dev', environment: 'DEV', base_url: 'http://127.0.0.1:54999/platform', timeout_ms: 2000, retry_count: 2, enabled: true },
    integration: {
      id: 'i', code: 'fixture-m2m', type: 'HTTP_M2M', enabled: true, adapter_key: 'GENERIC', capabilities: ['PROVISION'],
      issuer: 'masteradmin.ebim', audience: 'fixture.ebim', subject: 'masteradmin-provisioning', algorithm: 'ES256',
      token_ttl_seconds: 120,
      lifecycle_path: '/tenants/{controlPlaneTenantId}/lifecycle', lifecycle_read_scope: 'fixture:lifecycle:read',
      inventory_path: '/tenants', inventory_read_scope: 'fixture:tenants:list',
      allowed_hosts: [],
      ...integration,
    },
    credential: { id: 'c', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: SECRET_REF },
    links: [],
  };
}

const LINK: SyncPlanLink = {
  mapping_id: 'm1', tenant_id: TENANT, request_id: 'r1', external_tenant_id: 'ext-1',
  external_organization_id: null, external_company_id: null, expected_state: 'ACTIVE',
};

function response(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function deps(fetchImpl: ReturnType<typeof vi.fn>) {
  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    secretResolver: (ref: string) => (ref === SECRET_REF ? pem : undefined),
    sleep: async () => undefined,
  };
}

const ACTOR = { id: null, role: 'SERVER' };

function claimsOf(init: RequestInit): Record<string, unknown> {
  const auth = (init.headers as Record<string, string>).authorization!;
  const payload = auth.split(' ')[1]!.split('.')[1]!;
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
}

describe('readLifecycleState', () => {
  it('GET con el scope de lectura lifecycle; 200 ACTIVE/SUSPENDED confirma existencia y estado', async () => {
    const fetchImpl = vi.fn(async () => response(200, { controlPlaneTenantId: TENANT, productCode: 'fixture', state: 'SUSPENDED' }));
    const read = await readLifecycleState(target(), LINK, ACTOR, deps(fetchImpl));
    expect(read).toEqual({ exists: 'FOUND', state: 'SUSPENDED', httpStatus: 200, errorCode: null });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:54999/platform/tenants/${TENANT}/lifecycle`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(claimsOf(init).scope).toBe('fixture:lifecycle:read');
  });

  it('404 TENANT_NOT_PROVISIONED = no existe; 404 sin código = no verificado', async () => {
    const gone = await readLifecycleState(target(), LINK, ACTOR, deps(vi.fn(async () => response(404, { error: 'TENANT_NOT_PROVISIONED' }))));
    expect(gone.exists).toBe('NOT_FOUND');
    const proxy = await readLifecycleState(target(), LINK, ACTOR, deps(vi.fn(async () => response(404, undefined))));
    expect(proxy).toMatchObject({ exists: 'UNKNOWN', errorCode: 'HTTP_404' });
  });

  it('un 200 de otro tenant no confirma nada', async () => {
    const read = await readLifecycleState(
      target(), LINK, ACTOR,
      deps(vi.fn(async () => response(200, { controlPlaneTenantId: '00000000-0000-4ccc-8000-000000000999', state: 'ACTIVE' }))),
    );
    expect(read).toMatchObject({ exists: 'UNKNOWN', errorCode: 'RESPONSE_INVALID' });
  });

  it('sin canal o sin secreto no se llama a nadie', async () => {
    const fetchImpl = vi.fn();
    const none = await readLifecycleState(target({ lifecycle_path: null, lifecycle_read_scope: null }), LINK, ACTOR, deps(fetchImpl));
    expect(none.errorCode).toBe('LIFECYCLE_NOT_CONFIGURED');
    const noSecret = await readLifecycleState(target(), LINK, ACTOR, { ...deps(fetchImpl), secretResolver: () => undefined });
    expect(noSecret.errorCode).toBe('SECRET_NOT_AVAILABLE');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('una redirección es un error, no un salto', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    const read = await readLifecycleState(target(), LINK, ACTOR, deps(fetchImpl));
    expect(read.errorCode).toBe('REDIRECT_BLOCKED');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

function page(items: unknown[], nextCursor: string | null, extra: Record<string, unknown> = {}) {
  return response(200, { contract: INVENTORY_CONTRACT, productCode: 'fixture', environment: 'DEV', items, nextCursor, ...extra });
}

describe('fetchInventory', () => {
  it('sin canal anunciado: NOT_AVAILABLE y ninguna llamada', async () => {
    const fetchImpl = vi.fn();
    const inv = await fetchInventory(target({ inventory_path: null, inventory_read_scope: null }), ACTOR, deps(fetchImpl));
    expect(inv).toEqual({ status: 'NOT_AVAILABLE', complete: false, error_code: null, items: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pagina hasta nextCursor null, con limit y cursor en la query y el scope de inventario', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(page([{ externalTenantId: 'a', status: 'ACTIVE', name: 'A' }], 'c2'))
      .mockResolvedValueOnce(page([{ externalTenantId: 'b', status: 'SUSPENDED' }, { externalTenantId: 'A', status: 'ACTIVE' }], null));
    const inv = await fetchInventory(target(), ACTOR, deps(fetchImpl));
    expect(inv.status).toBe('AVAILABLE');
    expect(inv.complete).toBe(true);
    expect(inv.items.map((i) => i.externalTenantId)).toEqual(['a', 'b']);
    const urls = fetchImpl.mock.calls.map((c) => new URL(c[0] as string));
    expect(urls[0]!.searchParams.get('limit')).toBe('200');
    expect(urls[0]!.searchParams.get('cursor')).toBeNull();
    expect(urls[1]!.searchParams.get('cursor')).toBe('c2');
    expect(claimsOf(fetchImpl.mock.calls[0]![1] as RequestInit).scope).toBe('fixture:tenants:list');
  });

  it('valida contrato, producto y entorno', async () => {
    const wrongProduct = await fetchInventory(target(), ACTOR, deps(vi.fn(async () => page([], null, { productCode: 'otro' }))));
    expect(wrongProduct).toMatchObject({ status: 'FAILED', error_code: 'PRODUCT_MISMATCH' });
    const wrongEnv = await fetchInventory(target(), ACTOR, deps(vi.fn(async () => page([], null, { environment: 'PRD' }))));
    expect(wrongEnv.error_code).toBe('WRONG_ENVIRONMENT');
    const notContract = await fetchInventory(target(), ACTOR, deps(vi.fn(async () => response(200, { items: [] }))));
    expect(notContract.error_code).toBe('RESPONSE_INVALID');
  });

  it('un ítem inválido deja el inventario INCOMPLETO (avisa, pero no cierra ni da por roto nada)', async () => {
    const inv = await fetchInventory(
      target(), ACTOR,
      deps(vi.fn(async () => page([{ externalTenantId: 'a', status: 'ACTIVE' }, { externalTenantId: 'b', status: 'BORRADO' }], null))),
    );
    expect(inv).toMatchObject({ status: 'AVAILABLE', complete: false, error_code: 'INVENTORY_ITEM_INVALID' });
    expect(inv.items).toHaveLength(1);
  });

  it('un fallo a mitad conserva lo leído como incompleto; uno al principio es FAILED', async () => {
    const midway = vi.fn()
      .mockResolvedValueOnce(page([{ externalTenantId: 'a', status: 'ACTIVE' }], 'c2'))
      .mockResolvedValueOnce(response(500, { error: 'BOOM' }))
      .mockResolvedValueOnce(response(500, { error: 'BOOM' }));
    const inv = await fetchInventory(target(), ACTOR, deps(midway));
    expect(inv).toMatchObject({ status: 'AVAILABLE', complete: false, error_code: 'BOOM' });
    const first = await fetchInventory(target(), ACTOR, deps(vi.fn(async () => response(403, { error: 'SCOPE_MISSING' }))));
    expect(first).toEqual({ status: 'FAILED', complete: false, error_code: 'SCOPE_MISSING', items: [] });
  });

  it('un cursor que no avanza se rechaza (sin bucles infinitos)', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(page([{ externalTenantId: 'a', status: 'ACTIVE' }], 'same'))
      .mockResolvedValueOnce(page([{ externalTenantId: 'b', status: 'ACTIVE' }], 'same'));
    const inv = await fetchInventory(target(), ACTOR, deps(fetchImpl));
    expect(inv.complete).toBe(false);
    expect(inv.error_code).toBe('RESPONSE_INVALID');
  });
});

describe('parseInventoryItem', () => {
  it('normaliza y valida cada campo del contrato', () => {
    expect(parseInventoryItem({ externalTenantId: ' 46 ', controlPlaneTenantId: TENANT.toUpperCase(), status: 'INACTIVE', name: '' }))
      .toEqual({
        externalTenantId: '46', externalOrganizationId: null, externalCompanyId: null,
        controlPlaneTenantId: TENANT, code: null, name: null, status: 'INACTIVE',
      });
    expect(parseInventoryItem({ externalTenantId: 'x', status: 'ACTIVE', controlPlaneTenantId: 'no-uuid' })).toBeNull();
    expect(parseInventoryItem({ externalTenantId: 7, status: 'ACTIVE' })).toBeNull();
    expect(parseInventoryItem({ externalTenantId: 'x', status: 'ACTIVE', name: 'n'.repeat(301) })).toBeNull();
  });
});
