import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { httpStatusFor, isServerCall, observeLink, observeTarget, runTenantSync, targetBlocker, type TenantSyncStore } from './core';
import type { SyncPlanLink, SyncPlanTarget } from '../_shared/sync/types';
import type { AdapterOutcome, ProvisioningAdapter, ProvisioningContext } from '../_shared/provisioning/types';

/*
 * Edge Function tenant-sync (migración 20261021000100).
 *
 * Lo que se fija aquí:
 *   · existencia por GET_STATUS si la integración lo declara (base Y codec);
 *     si no, por lifecycle.v1; el estado operativo siempre por lifecycle.v1;
 *   · un vínculo que GET_STATUS ya dio por inexistente no se vuelve a consultar;
 *   · destinos sin URL o sin credencial no llaman a nadie y lo dicen;
 *   · un destino que falla no detiene a los demás y la corrida SIEMPRE se cierra;
 *   · la función nunca escribe en una app: solo GET.
 */

const T1 = '00000000-0000-4ccc-8000-000000000001';
const T2 = '00000000-0000-4ccc-8000-000000000002';

function link(n: number, extra: Partial<SyncPlanLink> = {}): SyncPlanLink {
  return {
    mapping_id: `m${n}`, tenant_id: n === 1 ? T1 : T2, request_id: `r${n}`, external_tenant_id: `ext-${n}`,
    external_organization_id: null, external_company_id: null, expected_state: 'ACTIVE', ...extra,
  };
}

function target(over: { integration?: Partial<SyncPlanTarget['integration']>; deployment?: Partial<SyncPlanTarget['deployment']>; links?: SyncPlanLink[]; credential?: SyncPlanTarget['credential'] } = {}): SyncPlanTarget {
  return {
    product: { id: 'p', code: 'fixture', short_name: 'Fixture' },
    deployment: { id: 'd1', code: 'fixture-dev', environment: 'DEV', base_url: 'http://127.0.0.1:54999', timeout_ms: 2000, retry_count: 0, enabled: true, ...over.deployment },
    integration: {
      id: 'i', code: 'fixture-m2m', type: 'HTTP_M2M', enabled: true, adapter_key: 'GENERIC', capabilities: ['PROVISION'],
      issuer: 'masteradmin.ebim', audience: 'fixture.ebim', subject: 'masteradmin-provisioning', algorithm: 'ES256',
      token_ttl_seconds: 120, lifecycle_path: null, lifecycle_read_scope: null, inventory_path: null,
      inventory_read_scope: null, allowed_hosts: [], ...over.integration,
    },
    credential: over.credential === undefined
      ? { id: 'c', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: 'NOPE' }
      : over.credential,
    links: over.links ?? [link(1), link(2)],
  };
}

function ctxFor(requestId: string): Omit<ProvisioningContext, 'actor'> {
  return {
    request: { id: requestId, environment: 'DEV' } as ProvisioningContext['request'],
    adapter: { key: 'EWM_V1', capabilities: ['PROVISION', 'GET_STATUS'] },
    source: { mapping: { external_tenant_id: `ext-${requestId.slice(1)}`, external_organization_id: null, external_company_id: null } } as ProvisioningContext['source'],
  } as Omit<ProvisioningContext, 'actor'>;
}

function store(over: Partial<Record<keyof TenantSyncStore, unknown>> = {}) {
  return {
    begin: vi.fn(async () => 'run-1'),
    plan: vi.fn(async () => []),
    executionContext: vi.fn(async (id: string) => ctxFor(id)),
    recordTarget: vi.fn(async (_r: string, t: string) => ({
      deployment_target_id: t, outcome: 'OK', links_total: 0, links_broken: 0, links_state_mismatch: 0,
      inventory_status: 'NOT_AVAILABLE', inventory_unknown: 0, findings_opened: 1, findings_closed: 0,
    })),
    finish: vi.fn(async () => ({ run_id: 'run-1', status: 'COMPLETED', targets_checked: 1, findings_opened: 1, findings_closed: 0 })),
    ...over,
  } as unknown as TenantSyncStore & Record<keyof TenantSyncStore, ReturnType<typeof vi.fn>>;
}

function adapter(outcomes: Record<string, AdapterOutcome>): ProvisioningAdapter {
  return {
    type: 'HTTP_M2M',
    capabilities: ['PROVISION', 'GET_STATUS'],
    provision: vi.fn(),
    getStatus: vi.fn(async (ctx: ProvisioningContext) => outcomes[ctx.request.id]!),
  } as unknown as ProvisioningAdapter;
}

const found = (id: string): AdapterOutcome => ({
  ok: true, attempts: 1, httpStatus: 200,
  result: { status: 'ACTIVE', externalTenantId: id, externalOrganizationId: null, externalCompanyId: null, resources: {}, rawReference: null },
});
const notFound: AdapterOutcome = {
  ok: false, attempts: 1,
  failure: { code: 'TENANT_NOT_FOUND', message: 'x', httpStatus: 404, retryable: false, detail: {} },
};

const ACTOR = { id: null, role: 'SERVER' };

describe('observeLink / observeTarget', () => {
  it('GET_STATUS decide la existencia; un 404 marca NOT_FOUND sin consultar el estado', async () => {
    const fetchImpl = vi.fn();
    const t = target({ integration: { capabilities: ['PROVISION', 'GET_STATUS'], lifecycle_path: '/tenants/{controlPlaneTenantId}/lifecycle', lifecycle_read_scope: 'fixture:lifecycle:read' } });
    const deps = { store: store(), secretResolver: () => undefined, fetchImpl: fetchImpl as unknown as typeof fetch, adapterFor: () => adapter({ r1: found('ext-1'), r2: notFound }) };
    const obs = await observeTarget(t, deps, ACTOR);
    expect(obs.verify_methods).toEqual(['GET_STATUS', 'LIFECYCLE']);
    expect(obs.links[1]).toMatchObject({ mapping_id: 'm2', exists: 'NOT_FOUND', http_status: 404 });
    expect(obs.links[0]).toMatchObject({ mapping_id: 'm1', exists: 'FOUND', ids_match: true });
    // El vínculo 1 intentó leer lifecycle (sin secreto → no hay estado, pero sigue FOUND); el 2 no.
    expect(obs.links[0]!.app_state).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('la capacidad efectiva exige base Y codec: sin GET_STATUS en la base no se consulta', async () => {
    const st = store({ executionContext: vi.fn(async () => ({ ...ctxFor('r1'), adapter: { key: 'GENERIC', capabilities: ['PROVISION'] } })) });
    const a = adapter({ r1: found('ext-1') });
    const obs = await observeLink(target({ integration: { capabilities: ['GET_STATUS'] } }), link(1), { store: st, secretResolver: () => undefined, adapterFor: () => a }, ACTOR);
    expect(obs).toMatchObject({ exists: 'UNKNOWN', error_code: 'CAPACIDAD_NO_SOPORTADA' });
    expect(a.getStatus).not.toHaveBeenCalled();
  });

  it('sin GET_STATUS ni lifecycle ni inventario: nada que comprobar, sin error', async () => {
    const obs = await observeTarget(target(), { store: store(), secretResolver: () => undefined }, ACTOR);
    expect(obs.verify_methods).toEqual([]);
    expect(obs.error_code).toBeNull();
    expect(obs.links.every((l) => l.exists === 'UNKNOWN')).toBe(true);
    expect(obs.inventory.status).toBe('NOT_AVAILABLE');
  });

  it('un destino sin URL o sin credencial usable no llama a nadie y lo dice', async () => {
    const withChannels = { lifecycle_path: '/x/{controlPlaneTenantId}', lifecycle_read_scope: 'fixture:lifecycle:read', inventory_path: '/tenants', inventory_read_scope: 'fixture:tenants:list' };
    expect(targetBlocker(target({ deployment: { base_url: null } }))).toBe('DEPLOYMENT_WITHOUT_URL');
    expect(targetBlocker(target({ credential: null }))).toBe('CREDENTIAL_NOT_USABLE');
    expect(targetBlocker(target({ integration: { enabled: false } }))).toBe('INTEGRATION_DISABLED');
    expect(targetBlocker(target({ integration: { type: 'MANUAL' } }))).toBeNull();
    const fetchImpl = vi.fn();
    const obs = await observeTarget(
      target({ deployment: { base_url: null }, integration: withChannels }),
      { store: store(), secretResolver: () => undefined, fetchImpl: fetchImpl as unknown as typeof fetch },
      ACTOR,
    );
    expect(obs.error_code).toBe('DEPLOYMENT_WITHOUT_URL');
    expect(obs.inventory).toMatchObject({ status: 'FAILED', error_code: 'DEPLOYMENT_WITHOUT_URL' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('si todos los vínculos fallan por lo mismo, ese es el error del destino', async () => {
    const t = target({ integration: { lifecycle_path: '/tenants/{controlPlaneTenantId}/lifecycle', lifecycle_read_scope: 'fixture:lifecycle:read' } });
    const obs = await observeTarget(t, { store: store(), secretResolver: () => undefined }, ACTOR);
    expect(obs.error_code).toBe('SECRET_NOT_AVAILABLE');
  });
});

describe('runTenantSync', () => {
  it('abre, recorre cada destino, registra y cierra; un fallo en un destino no detiene a los demás', async () => {
    const st = store({
      plan: vi.fn(async () => [target({ deployment: { id: 'd1', code: 'a' } }), target({ deployment: { id: 'd2', code: 'b' } })]),
      recordTarget: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'RESULTADO_DUPLICADO' }))
        .mockResolvedValueOnce({ outcome: 'WITH_FINDINGS', findings_opened: 2, findings_closed: 0 }),
    });
    const summary = await runTenantSync({ store: st, secretResolver: () => undefined }, { trigger: 'MANUAL', actor: { id: 'u1', role: 'PLATFORM' } });
    expect(st.begin).toHaveBeenCalledWith('MANUAL', 'u1');
    expect(st.recordTarget).toHaveBeenCalledTimes(2);
    expect(st.finish).toHaveBeenCalledWith('run-1', null, 2);
    expect(summary.targets.map((t) => `${t.deployment_code}:${t.outcome}`)).toEqual(['a:NOT_RECORDED', 'b:WITH_FINDINGS']);
    expect(summary.targets[0]!.error_code).toBe('RESULTADO_DUPLICADO');
  });

  it('una corrida programada no lleva persona; si el plan falla, la corrida se cierra igual', async () => {
    const st = store({ plan: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'SOLO_SERVIDOR' }); }) });
    await expect(runTenantSync({ store: st, secretResolver: () => undefined }, { trigger: 'SCHEDULED', actor: ACTOR })).rejects.toThrow();
    expect(st.begin).toHaveBeenCalledWith('SCHEDULED', null);
    expect(st.finish).toHaveBeenCalledWith('run-1', 'SOLO_SERVIDOR', 0);
  });

  it('una corrida en curso se informa como conflicto', () => {
    expect(httpStatusFor('SINCRONIZACION_EN_CURSO')).toBe(409);
    expect(httpStatusFor('ERROR_INTERNO')).toBe(500);
  });
});

describe('canal servidor', () => {
  it('compara la clave en tiempo constante y rechaza vacíos', () => {
    expect(isServerCall('abc', 'abc')).toBe(true);
    expect(isServerCall('abd', 'abc')).toBe(false);
    expect(isServerCall('', 'abc')).toBe(false);
    expect(isServerCall(null, 'abc')).toBe(false);
  });

  it('el código de la función nunca usa un verbo de escritura contra una app', () => {
    const files = ['./core.ts', '../_shared/sync/m2m-get.ts', '../_shared/sync/readers.ts'];
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, f), 'utf8');
      expect(src).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
      expect(src).not.toMatch(/\.provision\(/);
    }
  });
});
