import { describe, it, expect, vi } from 'vitest';
import { pushClaimed, readTenantNow, syncTenantNow, verifyClaimed } from './sync-flow';
import type { ClaimedPush, SyncStore } from './sync-store';
import type { EntitlementSyncClient, PushOutcome, VerifyOutcome } from './sync-client';
import type { EntitlementSnapshot } from './types';

/*
 * Flujo push → registro → GET → registro (spec §8, §9). Lo usan el orquestador
 * (SYNC_ENTITLEMENTS / GET_ENTITLEMENTS) y el job entitlement-sync.
 *
 * Invariantes: todo lease que se reclama se cierra con un record_*; la base es
 * la que decide el estado; nunca se escribe en el SaaS más que por el PUT.
 */

const T = '00000000-0000-4ccc-8000-000000000001';
const P = '20000000-0000-4000-a000-000000000001';
const ACTOR = { id: 'u1', role: 'EBIM_PRODUCT_ADMIN' };
const DOC = { snapshotVersion: 2, checksum: `sha256:${'b'.repeat(64)}` } as unknown as EntitlementSnapshot;
const CLAIMED: ClaimedPush = { tenant_id: T, saas_product_id: P, snapshot_version: 2, checksum: DOC.checksum, document: DOC, attempt: 1 };
const CTX = { tenant: { controlPlaneTenantId: T, productCode: 'esupplier' } } as never;

function fakeStore(overrides: Partial<Record<keyof SyncStore, unknown>> = {}) {
  const base: Record<string, unknown> = {
    refresh: vi.fn(async () => 'PENDING_PUSH'),
    issue: vi.fn(async () => ({ issued: true, version: 2, checksum: DOC.checksum })),
    issueCandidates: vi.fn(async () => []),
    claimPushes: vi.fn(async () => []),
    claimPushFor: vi.fn(async () => CLAIMED),
    recordPush: vi.fn(async () => 'AWAITING_VERIFY'),
    claimVerifications: vi.fn(async () => []),
    claimVerifyFor: vi.fn(async () => true),
    recordVerify: vi.fn(async () => 'IN_SYNC'),
    deliveryContext: vi.fn(async () => CTX),
    registryTargets: vi.fn(async () => []),
    recordRegistryCheck: vi.fn(async () => false),
    completeScheduledCancellations: vi.fn(async () => 0),
    ...overrides,
  };
  return base as unknown as SyncStore & Record<keyof SyncStore, ReturnType<typeof vi.fn>>;
}

const APPLIED: PushOutcome = {
  result: 'APPLIED', httpStatus: 200, errorCode: null, appliedVersion: 2, appliedChecksum: DOC.checksum,
  status: 'APPLIED', unknownCapabilities: [], attempts: 1,
};
const OBSERVED: VerifyOutcome = {
  result: 'OBSERVED', httpStatus: 200, errorCode: null, appliedVersion: 2, appliedChecksum: DOC.checksum,
  status: 'APPLIED', unknownCapabilities: [], enforcementMode: 'SHADOW', attempts: 1,
};

function fakeClient(push: PushOutcome | Error = APPLIED, verify: VerifyOutcome | Error = OBSERVED) {
  return {
    pushSnapshot: vi.fn(async () => {
      if (push instanceof Error) throw push;
      return push;
    }),
    getApplied: vi.fn(async () => {
      if (verify instanceof Error) throw verify;
      return verify;
    }),
    getManifest: vi.fn(),
  } as unknown as EntitlementSyncClient & Record<'pushSnapshot' | 'getApplied', ReturnType<typeof vi.fn>>;
}

describe('pushClaimed', () => {
  it('empuja EXACTAMENTE el documento reclamado y registra el resultado sin el contador de intentos', async () => {
    const store = fakeStore();
    const client = fakeClient();
    const out = await pushClaimed(store, client, CLAIMED, 'w', ACTOR);
    expect(client.pushSnapshot).toHaveBeenCalledWith(CTX, DOC, ACTOR);
    expect(store.recordPush).toHaveBeenCalledWith(T, P, 'w', 2, {
      result: 'APPLIED', httpStatus: 200, errorCode: null, appliedVersion: 2, appliedChecksum: DOC.checksum,
      status: 'APPLIED', unknownCapabilities: [],
    });
    expect(out).toEqual({ state: 'AWAITING_VERIFY', push: APPLIED });
  });

  it('sin contexto de entrega: cierra el lease como REJECTED CONTEXT_UNAVAILABLE, sin llamar al SaaS', async () => {
    const store = fakeStore({ deliveryContext: vi.fn(async () => { throw new Error('boom'); }) });
    const client = fakeClient();
    await pushClaimed(store, client, CLAIMED, 'w', ACTOR);
    expect(client.pushSnapshot).not.toHaveBeenCalled();
    expect(store.recordPush.mock.calls[0][4]).toMatchObject({ result: 'REJECTED', errorCode: 'CONTEXT_UNAVAILABLE' });
  });

  it('un fallo inesperado del cliente cierra el lease como RETRYABLE CLIENT_ERROR (no queda PUSHING)', async () => {
    const store = fakeStore();
    await pushClaimed(store, fakeClient(new Error('bug')), CLAIMED, 'w', ACTOR);
    expect(store.recordPush.mock.calls[0][4]).toMatchObject({ result: 'RETRYABLE', errorCode: 'CLIENT_ERROR' });
  });
});

describe('verifyClaimed', () => {
  it('registra la observación del GET', async () => {
    const store = fakeStore();
    const out = await verifyClaimed(store, fakeClient(), T, P, 'w', ACTOR);
    expect(store.recordVerify).toHaveBeenCalledWith(T, P, 'w', {
      result: 'OBSERVED', httpStatus: 200, errorCode: null, appliedVersion: 2, appliedChecksum: DOC.checksum,
      status: 'APPLIED', unknownCapabilities: [],
    });
    expect(out.state).toBe('IN_SYNC');
  });

  it('sin contexto: REJECTED CONTEXT_UNAVAILABLE; con error del cliente: RETRYABLE', async () => {
    const s1 = fakeStore({ deliveryContext: vi.fn(async () => { throw new Error('x'); }) });
    await verifyClaimed(s1, fakeClient(), T, P, 'w', ACTOR);
    expect(s1.recordVerify.mock.calls[0][3]).toMatchObject({ result: 'REJECTED', errorCode: 'CONTEXT_UNAVAILABLE' });
    const s2 = fakeStore();
    await verifyClaimed(s2, fakeClient(APPLIED, new Error('bug')), T, P, 'w', ACTOR);
    expect(s2.recordVerify.mock.calls[0][3]).toMatchObject({ result: 'RETRYABLE', errorCode: 'CLIENT_ERROR' });
  });
});

describe('syncTenantNow (SYNC_ENTITLEMENTS)', () => {
  it('refresca puertas → emite → push → GET; el estado final lo decide el GET', async () => {
    const store = fakeStore();
    const client = fakeClient();
    const out = await syncTenantNow(store, client, T, P, ACTOR, 'orq-1');
    const order = ['refresh', 'issue', 'claimPushFor', 'recordPush', 'claimVerifyFor', 'recordVerify'].map(
      (m) => store[m as keyof SyncStore].mock.invocationCallOrder[0],
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(out).toMatchObject({
      tenant_id: T, state: 'IN_SYNC', issued: true, desired_version: 2,
      push: { result: 'APPLIED', errorCode: null, httpStatus: 200 },
      verify: { result: 'OBSERVED', appliedVersion: 2, status: 'APPLIED' },
    });
  });

  it('NOT_PROVISIONED: no emite ni llama al SaaS', async () => {
    const store = fakeStore({ refresh: vi.fn(async () => 'NOT_PROVISIONED') });
    const client = fakeClient();
    expect(await syncTenantNow(store, client, T, P, ACTOR, 'o')).toMatchObject({ state: 'NOT_PROVISIONED', skipped: 'NOT_PROVISIONED' });
    expect(store.issue).not.toHaveBeenCalled();
    expect(client.pushSnapshot).not.toHaveBeenCalled();
  });

  it('NOT_ENROLLED: emite (lo deseado queda al día) pero no empuja', async () => {
    const store = fakeStore({ refresh: vi.fn(async () => 'NOT_ENROLLED') });
    const client = fakeClient();
    expect(await syncTenantNow(store, client, T, P, ACTOR, 'o')).toMatchObject({ state: 'NOT_ENROLLED', skipped: 'NOT_ENROLLED', issued: true });
    expect(store.claimPushFor).not.toHaveBeenCalled();
    expect(client.pushSnapshot).not.toHaveBeenCalled();
  });

  it('sin push posible (incidente o kill-switch): no empuja pero sí verifica', async () => {
    const store = fakeStore({ claimPushFor: vi.fn(async () => null) });
    const client = fakeClient();
    const out = await syncTenantNow(store, client, T, P, ACTOR, 'o');
    expect(client.pushSnapshot).not.toHaveBeenCalled();
    expect(client.getApplied).toHaveBeenCalled();
    expect(out.push).toBeUndefined();
    expect(out.state).toBe('IN_SYNC');
  });

  it('push rechazado: no verifica si la base no concede el lease', async () => {
    const store = fakeStore({
      recordPush: vi.fn(async () => 'REJECTED'),
      claimVerifyFor: vi.fn(async () => false),
    });
    const client = fakeClient({ ...APPLIED, result: 'REJECTED', httpStatus: 403, errorCode: 'INSUFFICIENT_SCOPE' });
    const out = await syncTenantNow(store, client, T, P, ACTOR, 'o');
    expect(client.getApplied).not.toHaveBeenCalled();
    expect(out).toMatchObject({ state: 'REJECTED', push: { result: 'REJECTED', errorCode: 'INSUFFICIENT_SCOPE' } });
  });
});

describe('readTenantNow (GET_ENTITLEMENTS)', () => {
  it('solo GET: no emite ni empuja', async () => {
    const store = fakeStore();
    const client = fakeClient();
    const out = await readTenantNow(store, client, T, P, ACTOR, 'o');
    expect(store.issue).not.toHaveBeenCalled();
    expect(client.pushSnapshot).not.toHaveBeenCalled();
    expect(out).toMatchObject({ state: 'IN_SYNC', verify: { result: 'OBSERVED' } });
  });

  it('sin lease de verificación devuelve el estado actual sin llamar al SaaS', async () => {
    const store = fakeStore({ claimVerifyFor: vi.fn(async () => false) });
    const client = fakeClient();
    const out = await readTenantNow(store, client, T, P, ACTOR, 'o');
    expect(client.getApplied).not.toHaveBeenCalled();
    expect(out).toMatchObject({ state: 'PENDING_PUSH', skipped: 'VERIFY_NOT_AVAILABLE' });
  });
});
