import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readLeads, runLeadSync, LEADS_CONTRACT, type LeadSyncStore, type LeadSyncTarget } from './core';

/*
 * lead-sync (leads.v1, migración 20261025000100). Lo que se fija aquí:
 *   · solo GET, con el scope propio del canal y desde el cursor guardado;
 *   · pagina mientras la app diga que hay más, y guarda el cursor para retomar;
 *   · sin canal anunciado no llama a nadie;
 *   · un destino que falla deja su código y no detiene a los demás.
 */

const SECRET_REF = 'LOCAL_FIXTURE_M2M_PRIVATE_KEY';
let pem = '';

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  for (const b of pkcs8) bin += String.fromCharCode(b);
  pem = `-----BEGIN ${'PRIVATE'} KEY-----\n${btoa(bin)}\n-----END ${'PRIVATE'} KEY-----`;
});

function target(over: Partial<LeadSyncTarget['integration']> = {}, cursor: string | null = null, id = 'd1'): LeadSyncTarget {
  return {
    product: { id: 'p', code: 'fixture', short_name: 'Fixture' },
    deployment: { id, code: `fixture-${id}`, environment: 'DEV', base_url: 'http://127.0.0.1:54999/platform', timeout_ms: 2000, retry_count: 0, enabled: true },
    integration: {
      id: 'i', code: 'fixture-m2m', type: 'HTTP_M2M', enabled: true, adapter_key: 'GENERIC', capabilities: [],
      issuer: 'masteradmin.ebim', audience: 'fixture.ebim', subject: 'masteradmin-provisioning', algorithm: 'ES256',
      token_ttl_seconds: 120, lifecycle_path: null, lifecycle_read_scope: null, inventory_path: null, inventory_read_scope: null,
      leads_path: '/leads', leads_read_scope: 'fixture:leads:read', allowed_hosts: [], ...over,
    },
    credential: { id: 'c', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: SECRET_REF },
    links: [],
    cursor,
  };
}

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = (items: unknown[], nextCursor: string | null, resumeCursor: string | null) =>
  ok({ contractVersion: LEADS_CONTRACT, productCode: 'fixture', environment: 'DEV', items, nextCursor, resumeCursor });

const deps = (fetchImpl: ReturnType<typeof vi.fn>) => ({
  fetchImpl: fetchImpl as unknown as typeof fetch,
  secretResolver: (ref: string) => (ref === SECRET_REF ? pem : undefined),
  sleep: async () => undefined,
});
const ACTOR = { id: null, role: 'SERVER' };

function scopeOf(init: RequestInit): string {
  const token = (init.headers as Record<string, string>).authorization!.split(' ')[1]!;
  return JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).scope;
}

describe('readLeads', () => {
  it('GET con el scope propio, desde el cursor guardado, y devuelve el cursor para retomar', async () => {
    const f = vi.fn(async () => page([{ externalId: 'a' }], null, 'C2'));
    const r = await readLeads(target({}, 'C1'), ACTOR, deps(f));
    expect(r).toEqual({ items: [{ externalId: 'a' }], cursor: 'C2', errorCode: null });
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect(new URL(url).pathname).toBe('/platform/leads');
    expect(new URL(url).searchParams.get('after')).toBe('C1');
    expect(scopeOf(init)).toContain('fixture:leads:read');
  });

  it('pagina mientras haya nextCursor', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(page([{ externalId: 'a' }], 'N1', 'N1'))
      .mockResolvedValueOnce(page([{ externalId: 'b' }], null, 'N2'));
    const r = await readLeads(target(), ACTOR, deps(f));
    expect(r.items).toHaveLength(2);
    expect(r.cursor).toBe('N2');
    expect(new URL(f.mock.calls[1]![0] as string).searchParams.get('after')).toBe('N1');
  });

  it('sin canal anunciado no llama a nadie', async () => {
    const f = vi.fn();
    const r = await readLeads(target({ leads_path: null, leads_read_scope: null }), ACTOR, deps(f));
    expect(r.errorCode).toBe('LEADS_NOT_CONFIGURED');
    expect(f).not.toHaveBeenCalled();
  });

  it('el código de la app se conserva; una respuesta sin contrato es INVALID_RESPONSE', async () => {
    expect((await readLeads(target(), ACTOR, deps(vi.fn(async () => ok({ error: 'LEADS_NOT_CONFIGURED' }, 503))))).errorCode).toBe('LEADS_NOT_CONFIGURED');
    expect((await readLeads(target(), ACTOR, deps(vi.fn(async () => ok({ hola: 1 }))))).errorCode).toBe('INVALID_RESPONSE');
  });
});

describe('runLeadSync', () => {
  it('un destino que falla no detiene a los demás; cada uno registra lo suyo', async () => {
    const record = vi.fn(async (_t: string, items: unknown[]) => ({ received: items.length, new: items.length }));
    const store: LeadSyncStore = {
      plan: async () => [target({}, null, 'd1'), target({}, null, 'd2')],
      record,
    };
    const f = vi.fn()
      .mockResolvedValueOnce(ok({ error: 'UNAUTHENTICATED' }, 401))
      .mockResolvedValueOnce(page([{ externalId: 'a' }], null, 'C'));
    const out = await runLeadSync({ store, ...deps(f) }, ACTOR);
    expect(out.targets.map((t) => t.errorCode)).toEqual(['UNAUTHENTICATED', null]);
    expect(record).toHaveBeenCalledWith('d1', [], null, 'UNAUTHENTICATED');
    expect(record).toHaveBeenCalledWith('d2', [{ externalId: 'a' }], 'C', null);
    expect(out.targets[1]).toMatchObject({ received: 1, new: 1 });
  });
});
