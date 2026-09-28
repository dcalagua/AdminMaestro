import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRpcSyncStore, SyncStoreError, type RpcClient } from './sync-store';

/*
 * El puerto llama a cada RPC con los nombres de parámetro EXACTOS de su firma
 * SQL. PostgREST resuelve la función por nombre de argumentos: un nombre mal
 * escrito no es un error de tipos, es un 404 en producción. Aquí se contrasta
 * contra el texto de las migraciones.
 */

const MIGRATIONS = readdirSync(resolve(process.cwd(), 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(resolve(process.cwd(), 'supabase/migrations', f), 'utf8'))
  .join('\n');

/** Nombres de parámetros de la ÚLTIMA definición de platform.<fn>(…) en las migraciones. */
function sqlParams(fn: string): string[] {
  const re = new RegExp(`create or replace function platform\\.${fn}\\(([^)]*)\\)`, 'g');
  const matches = [...MIGRATIONS.matchAll(re)];
  expect(matches.length, `no existe platform.${fn}`).toBeGreaterThan(0);
  const args = matches[matches.length - 1][1];
  return args
    .split(',')
    .map((a) => a.trim().split(/\s+/)[0])
    .filter((a) => a.startsWith('p_'));
}

function recorder(data: unknown = null, error: { message: string } | null = null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client: RpcClient = {
    rpc: (fn, args = {}) => {
      calls.push({ fn, args });
      return Promise.resolve({ data, error });
    },
  };
  return { calls, store: createRpcSyncStore(client) };
}

describe('createRpcSyncStore — nombres de RPC y parámetros = firmas SQL', () => {
  const T = 't';
  const P = 'p';
  const cases: [string, (s: ReturnType<typeof createRpcSyncStore>) => Promise<unknown>][] = [
    ['refresh_entitlement_sync_state', (s) => s.refresh(T, P)],
    ['issue_entitlement_snapshot', (s) => s.issue(T, P)],
    ['entitlement_issue_candidates', (s) => s.issueCandidates(10, true)],
    ['claim_entitlement_pushes', (s) => s.claimPushes('w', 10, 60)],
    ['claim_entitlement_push_for', (s) => s.claimPushFor(T, P, 'w', 60)],
    ['record_entitlement_push_result', (s) => s.recordPush(T, P, 'w', 1, { result: 'APPLIED' })],
    ['claim_entitlement_verifications', (s) => s.claimVerifications('w', 10, 60, '6 hours')],
    ['claim_entitlement_verification_for', (s) => s.claimVerifyFor(T, P, 'w', 60)],
    ['record_entitlement_verify_result', (s) => s.recordVerify(T, P, 'w', { result: 'OBSERVED' })],
    ['entitlement_delivery_context', (s) => s.deliveryContext(T, P)],
    ['entitlement_registry_targets', (s) => s.registryTargets()],
    ['record_entitlement_registry_check', (s) => s.recordRegistryCheck(P, 'm', ['a.b'])],
    ['complete_scheduled_addon_cancellations', (s) => s.completeScheduledCancellations()],
  ];

  it.each(cases)('%s', async (fn, invoke) => {
    const { calls, store } = recorder([]);
    await invoke(store);
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe(fn);
    const sent = Object.keys(calls[0].args).sort();
    const declared = sqlParams(fn);
    // Todo lo enviado existe en la firma; lo omitido tiene default en SQL.
    for (const name of sent) expect(declared, `${fn}: ${name}`).toContain(name);
  });
});

describe('createRpcSyncStore — resultados y errores', () => {
  it('claimPushFor devuelve la primera fila o null', async () => {
    expect(await recorder([]).store.claimPushFor('t', 'p', 'w', 60)).toBeNull();
    expect(await recorder([{ snapshot_version: 3 }]).store.claimPushFor('t', 'p', 'w', 60)).toEqual({ snapshot_version: 3 });
  });

  it('las listas nulas se normalizan a vacío', async () => {
    const { store } = recorder(null);
    expect(await store.claimPushes('w', 1, 60)).toEqual([]);
    expect(await store.claimVerifications('w', 1, 60, '1 hour')).toEqual([]);
    expect(await store.issueCandidates(1, false)).toEqual([]);
    expect(await store.registryTargets()).toEqual([]);
  });

  it('un error de la base se convierte en SyncStoreError con el código del raise', async () => {
    const { store } = recorder(null, { message: 'TENANT_NO_APROVISIONADO: sin mapping ACTIVE para el tenant x' });
    await expect(store.issue('t', 'p')).rejects.toMatchObject({ name: 'SyncStoreError', code: 'TENANT_NO_APROVISIONADO' });
    expect(new SyncStoreError('x', 'algo raro sin prefijo').code).toBe('DB_ERROR');
  });
});
