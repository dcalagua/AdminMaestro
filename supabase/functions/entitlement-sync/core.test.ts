import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isServerCall, parseJobRequest, runIssue, runJob, runPush, runRegistryVerify, runVerify } from './core';
import type { ClaimedPush, SyncStore } from '../_shared/entitlements/sync-store';
import type { EntitlementSyncClient } from '../_shared/entitlements/sync-client';
import type { EntitlementSnapshot } from '../_shared/entitlements/types';

/*
 * Jobs entitlement-push / entitlement-verify / registry-verify (spec §9, plan MA-37).
 *
 * Lo que se fija aquí:
 *   · push toma trabajo SOLO por claim (FOR UPDATE SKIP LOCKED en la base): dos
 *     workers concurrentes nunca empujan el mismo tenant;
 *   · verify usa SOLO el GET y solo record_entitlement_verify_result puede
 *     producir IN_SYNC;
 *   · registry-verify registra el drift que devuelve la base;
 *   · un fallo en un tenant no detiene el lote;
 *   · nunca se escribe en la base de un SaaS (no hay cliente de base del SaaS).
 */

const DOC = { snapshotVersion: 1, checksum: `sha256:${'c'.repeat(64)}` } as unknown as EntitlementSnapshot;
function claimed(t: string): ClaimedPush {
  return { tenant_id: t, saas_product_id: 'p', snapshot_version: 1, checksum: DOC.checksum, document: DOC, attempt: 1 };
}

function store(overrides: Partial<Record<keyof SyncStore, unknown>> = {}) {
  const base: Record<string, unknown> = {
    refresh: vi.fn(async () => 'PENDING_PUSH'),
    issue: vi.fn(async () => ({ issued: true, version: 1, checksum: DOC.checksum })),
    issueCandidates: vi.fn(async () => []),
    claimPushes: vi.fn(async () => []),
    claimPushFor: vi.fn(async () => null),
    recordPush: vi.fn(async () => 'AWAITING_VERIFY'),
    claimVerifications: vi.fn(async () => []),
    claimVerifyFor: vi.fn(async () => false),
    recordVerify: vi.fn(async () => 'IN_SYNC'),
    deliveryContext: vi.fn(async () => ({ tenant: { controlPlaneTenantId: 't', productCode: 'x' } })),
    registryTargets: vi.fn(async () => []),
    recordRegistryCheck: vi.fn(async () => false),
    completeScheduledCancellations: vi.fn(async () => 0),
    ...overrides,
  };
  return base as unknown as SyncStore & Record<keyof SyncStore, ReturnType<typeof vi.fn>>;
}

function client() {
  return {
    pushSnapshot: vi.fn(async () => ({
      result: 'APPLIED', httpStatus: 200, errorCode: null, appliedVersion: 1, appliedChecksum: DOC.checksum,
      status: 'APPLIED', unknownCapabilities: [], attempts: 1,
    })),
    getApplied: vi.fn(async () => ({
      result: 'OBSERVED', httpStatus: 200, errorCode: null, appliedVersion: 1, appliedChecksum: DOC.checksum,
      status: 'APPLIED', unknownCapabilities: [], enforcementMode: 'SHADOW', attempts: 1,
    })),
    getManifest: vi.fn(async () => ({ ok: true, manifestVersion: 'm-1', activeCodes: ['x.a', 'x.b'], attempts: 1 })),
  } as unknown as EntitlementSyncClient & Record<'pushSnapshot' | 'getApplied' | 'getManifest', ReturnType<typeof vi.fn>>;
}

describe('runPush', () => {
  it('solo empuja lo reclamado por claim, con el lease y el tamaño de lote pedidos', async () => {
    const s = store({ claimPushes: vi.fn(async () => [claimed('t1'), claimed('t2')]) });
    const c = client();
    const out = await runPush({ store: s, client: c, worker: 'w1' }, { limit: 7, leaseSeconds: 90 });
    expect(s.claimPushes).toHaveBeenCalledWith('w1', 7, 90);
    expect(c.pushSnapshot).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ claimed: 2, results: [
      { tenant_id: 't1', saas_product_id: 'p', state: 'AWAITING_VERIFY', result: 'APPLIED', errorCode: null },
      { tenant_id: 't2', saas_product_id: 'p', state: 'AWAITING_VERIFY', result: 'APPLIED', errorCode: null },
    ] });
  });

  it('SKIP LOCKED simulado: dos workers concurrentes no empujan el mismo tenant', async () => {
    const queue = [claimed('t1'), claimed('t2'), claimed('t3')];
    const claim = vi.fn(async (_w: string, limit: number) => queue.splice(0, limit));
    const s = store({ claimPushes: claim });
    const c = client();
    await Promise.all([
      runPush({ store: s, client: c, worker: 'a' }, { limit: 2, leaseSeconds: 60 }),
      runPush({ store: s, client: c, worker: 'b' }, { limit: 2, leaseSeconds: 60 }),
    ]);
    const tenants = c.pushSnapshot.mock.calls.map((call) => ((call as unknown[])[1] as EntitlementSnapshot) && (call as unknown[]));
    expect(tenants).toHaveLength(3);
    expect(s.recordPush.mock.calls.map((call) => call[0]).sort()).toEqual(['t1', 't2', 't3']);
  });

  it('un error de registro en un tenant no detiene el lote', async () => {
    const s = store({
      claimPushes: vi.fn(async () => [claimed('t1'), claimed('t2')]),
      recordPush: vi.fn().mockRejectedValueOnce(Object.assign(new Error('LEASE_PERDIDO: x'), { code: 'LEASE_PERDIDO' })).mockResolvedValueOnce('AWAITING_VERIFY'),
    });
    const out = await runPush({ store: s, client: client(), worker: 'w' }, { limit: 10, leaseSeconds: 60 });
    expect(out.results.map((r) => r.state)).toEqual(['ERROR', 'AWAITING_VERIFY']);
    expect(out.results[0].errorCode).toBe('LEASE_PERDIDO');
  });
});

describe('runVerify — solo el GET', () => {
  it('verifica lo reclamado sin empujar nada', async () => {
    const s = store({ claimVerifications: vi.fn(async () => [{ tenant_id: 't1', saas_product_id: 'p', state: 'AWAITING_VERIFY' }]) });
    const c = client();
    const out = await runVerify({ store: s, client: c, worker: 'v' }, { limit: 5, leaseSeconds: 60, resampleAfter: '6 hours' });
    expect(s.claimVerifications).toHaveBeenCalledWith('v', 5, 60, '6 hours');
    expect(c.pushSnapshot).not.toHaveBeenCalled();
    expect(c.getApplied).toHaveBeenCalledTimes(1);
    expect(out.results).toEqual([{ tenant_id: 't1', saas_product_id: 'p', state: 'IN_SYNC', result: 'OBSERVED', errorCode: null }]);
  });

  it('IN_SYNC solo sale de record_entitlement_verify_result', async () => {
    const src = readFileSync(resolve(process.cwd(), 'supabase/functions/entitlement-sync/core.ts'), 'utf8');
    expect(src).not.toMatch(/['"]IN_SYNC['"]/);
  });
});

describe('runRegistryVerify', () => {
  it('lee el manifiesto por integración y registra el drift que decide la base', async () => {
    const s = store({
      registryTargets: vi.fn(async () => [{ saas_product_id: 'p', product_integration_id: 'i', tenant_id: 't1' }]),
      recordRegistryCheck: vi.fn(async () => true),
    });
    const c = client();
    const out = await runRegistryVerify({ store: s, client: c, worker: 'r' });
    expect(s.recordRegistryCheck).toHaveBeenCalledWith('p', 'm-1', ['x.a', 'x.b']);
    expect(out.results).toEqual([{ saas_product_id: 'p', product_integration_id: 'i', drift: true, errorCode: null }]);
  });

  it('si el manifiesto no se puede leer NO se registra un check (no se inventa drift ni ausencia de drift)', async () => {
    const s = store({ registryTargets: vi.fn(async () => [{ saas_product_id: 'p', product_integration_id: 'i', tenant_id: 't1' }]) });
    const c = client();
    c.getManifest.mockResolvedValueOnce({ ok: false, errorCode: 'PROVIDER_TIMEOUT', httpStatus: null, retryable: true, attempts: 3 });
    const out = await runRegistryVerify({ store: s, client: c, worker: 'r' });
    expect(s.recordRegistryCheck).not.toHaveBeenCalled();
    expect(out.results).toEqual([{ saas_product_id: 'p', product_integration_id: 'i', drift: null, errorCode: 'PROVIDER_TIMEOUT' }]);
  });
});

describe('runIssue', () => {
  it('barrido: cierra bajas programadas y emite para cada candidato; cuenta emitidos e iguales', async () => {
    const s = store({
      issueCandidates: vi.fn(async () => [{ tenant_id: 't1', saas_product_id: 'p' }, { tenant_id: 't2', saas_product_id: 'p' }]),
      issue: vi.fn().mockResolvedValueOnce({ issued: true, version: 2, checksum: 'x' }).mockResolvedValueOnce({ issued: false, version: 1, checksum: 'y' }),
      completeScheduledCancellations: vi.fn(async () => 3),
    });
    const out = await runIssue({ store: s, client: client(), worker: 'i' }, { limit: 50, sweep: true });
    expect(s.completeScheduledCancellations).toHaveBeenCalledTimes(1);
    expect(s.issueCandidates).toHaveBeenCalledWith(50, true);
    expect(out).toEqual({ cancellationsClosed: 3, candidates: 2, issued: 1, unchanged: 1, errors: [] });
  });

  it('sin barrido no cierra bajas; un error por tenant se reporta con su código', async () => {
    const s = store({
      issueCandidates: vi.fn(async () => [{ tenant_id: 't1', saas_product_id: 'p' }]),
      issue: vi.fn(async () => { throw Object.assign(new Error('TENANT_NO_APROVISIONADO: x'), { code: 'TENANT_NO_APROVISIONADO' }); }),
    });
    const out = await runIssue({ store: s, client: client(), worker: 'i' }, { limit: 10, sweep: false });
    expect(s.completeScheduledCancellations).not.toHaveBeenCalled();
    expect(out.errors).toEqual([{ tenant_id: 't1', saas_product_id: 'p', errorCode: 'TENANT_NO_APROVISIONADO' }]);
  });
});

describe('runJob y entrada HTTP', () => {
  it('"all" corre issue → push → verify → registry-verify en ese orden', async () => {
    const s = store();
    await runJob({ store: s, client: client(), worker: 'w' }, parseJobRequest({ job: 'all' }));
    const order = ['issueCandidates', 'claimPushes', 'claimVerifications', 'registryTargets'].map(
      (m) => s[m as keyof SyncStore].mock.invocationCallOrder[0],
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it.each([
    [{}, { job: 'all', sweep: false, limit: 20 }],
    [{ job: 'push', limit: 5 }, { job: 'push', sweep: false, limit: 5 }],
    [{ job: 'issue', sweep: true }, { job: 'issue', sweep: true, limit: 20 }],
  ])('parseJobRequest(%j)', (raw, expected) => {
    expect(parseJobRequest(raw)).toEqual(expected);
  });

  it.each([[{ job: 'drop' }], [{ limit: 0 }], [{ limit: 1000 }], [{ sweep: 'yes' }], [null]])('rechaza %j', (raw) => {
    expect(() => parseJobRequest(raw)).toThrow(/PETICION_INVALIDA/);
  });

  it('solo el canal servidor: la clave de servicio en x-provisioning-secret, comparada en tiempo constante', () => {
    expect(isServerCall('k-123', 'k-123')).toBe(true);
    expect(isServerCall('k-124', 'k-123')).toBe(false);
    expect(isServerCall(null, 'k-123')).toBe(false);
    expect(isServerCall('', '')).toBe(false);
  });

  it('el job nunca abre un cliente de base contra un SaaS', () => {
    const core = readFileSync(resolve(process.cwd(), 'supabase/functions/entitlement-sync/core.ts'), 'utf8');
    const index = readFileSync(resolve(process.cwd(), 'supabase/functions/entitlement-sync/index.ts'), 'utf8');
    expect(core).not.toMatch(/createClient|supabase-js/);
    expect(index.match(/createClient\(/g)).toHaveLength(1);
    expect(index).toMatch(/createClient\(supabaseUrl, serviceKey/);
  });
});
