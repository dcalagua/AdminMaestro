import { describe, it, expect, vi } from 'vitest';
import { createRpcLifecycleStore, runLifecycle, type ClaimedLifecycle, type LifecycleStore } from './job';
import type { LifecycleClient } from './client';

/*
 * Job `lifecycle` (20261020000200): claim → PUT → record, un tenant a la vez,
 * y un fallo en uno no detiene el lote. Los parámetros de las RPCs son los de
 * la firma SQL exacta.
 */

function claimed(t: string, overrides: Partial<ClaimedLifecycle> = {}): ClaimedLifecycle {
  return {
    tenant_id: t, saas_product_id: 'p', desired_version: 2, desired_state: 'SUSPENDED',
    desired_reason: 'NON_PAYMENT', desired_at: '2026-10-13T11:00:00Z', ...overrides,
  };
}

function store(claims: ClaimedLifecycle[]) {
  return {
    claim: vi.fn(async () => claims),
    context: vi.fn(async (t: string) => ({ tenant: { controlPlaneTenantId: t, productCode: 'x' } })),
    record: vi.fn(async () => 'APPLIED'),
  } as unknown as LifecycleStore & Record<keyof LifecycleStore, ReturnType<typeof vi.fn>>;
}

function client(impl?: (t: string) => unknown) {
  return {
    putState: vi.fn(async (ctx: { tenant: { controlPlaneTenantId: string } }) => {
      if (impl) return impl(ctx.tenant.controlPlaneTenantId);
      return { result: 'APPLIED', httpStatus: 200, errorCode: null, appliedVersion: 2, state: 'SUSPENDED', attempts: 1 };
    }),
  } as unknown as LifecycleClient & { putState: ReturnType<typeof vi.fn> };
}

describe('runLifecycle', () => {
  it('reclama con el lease pedido, hace el PUT de la versión reclamada y registra el resultado', async () => {
    const s = store([claimed('t1')]);
    const c = client();
    const out = await runLifecycle({ store: s, client: c, worker: 'w1' }, { limit: 7 });
    expect(s.claim).toHaveBeenCalledWith('w1', 7, 120);
    expect(c.putState.mock.calls[0]![1]).toEqual({
      version: 2, state: 'SUSPENDED', reason: 'NON_PAYMENT', effectiveAt: '2026-10-13T11:00:00Z',
    });
    expect(s.record).toHaveBeenCalledWith('t1', 'w1', {
      version: 2, state: 'SUSPENDED', result: 'APPLIED', httpStatus: 200, errorCode: null, appliedVersion: 2,
    });
    expect(out).toEqual({ claimed: 1, results: [{ tenant_id: 't1', version: 2, state: 'SUSPENDED', result: 'APPLIED', errorCode: null }] });
  });

  it('un fallo en un tenant no detiene el lote (el lease vence y se reintenta)', async () => {
    const s = store([claimed('t1'), claimed('t2')]);
    s.context.mockImplementationOnce(async () => { throw Object.assign(new Error('x'), { code: 'TENANT_NO_APROVISIONADO' }); });
    const c = client();
    const out = await runLifecycle({ store: s, client: c, worker: 'w1' }, { limit: 5 });
    expect(out.results.map((r) => `${r.tenant_id}:${r.result}:${r.errorCode}`)).toEqual([
      't1:ERROR:TENANT_NO_APROVISIONADO', 't2:APPLIED:null',
    ]);
    expect(s.record).toHaveBeenCalledTimes(1);
  });

  it('un STALE se registra con la versión que tiene la app para re-emitir por encima', async () => {
    const s = store([claimed('t1')]);
    const c = client(() => ({ result: 'STALE', httpStatus: 409, errorCode: 'STALE_LIFECYCLE', appliedVersion: 9, state: 'ACTIVE', attempts: 1 }));
    await runLifecycle({ store: s, client: c, worker: 'w1' }, { limit: 5 });
    expect(s.record.mock.calls[0]![2]).toMatchObject({ result: 'STALE', appliedVersion: 9 });
  });
});

describe('createRpcLifecycleStore', () => {
  it('usa los nombres de parámetro exactos de las firmas SQL', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const s = createRpcLifecycleStore({ rpc });
    await s.claim('w', 3, 60);
    await s.context('t');
    await s.record('t', 'w', { version: 2, state: 'ACTIVE', result: 'RETRYABLE', httpStatus: 503, errorCode: 'HTTP_503', appliedVersion: null });
    expect(rpc.mock.calls).toEqual([
      ['claim_lifecycle_deliveries', { p_worker: 'w', p_limit: 3, p_lease_seconds: 60 }],
      ['lifecycle_delivery_context', { p_tenant_id: 't' }],
      ['record_lifecycle_delivery_result', {
        p_tenant_id: 't', p_worker: 'w', p_version: 2, p_state: 'ACTIVE', p_result: 'RETRYABLE',
        p_http_status: 503, p_error_code: 'HTTP_503', p_applied_version: null,
      }],
    ]);
  });

  it('un error de la base lleva el código estable del raise', async () => {
    const s = createRpcLifecycleStore({ rpc: async () => ({ data: null, error: { message: 'SOLO_SERVIDOR: x' } }) });
    await expect(s.claim('w', 1, 60)).rejects.toMatchObject({ code: 'SOLO_SERVIDOR' });
  });
});
