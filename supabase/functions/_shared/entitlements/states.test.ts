import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MAX_SYNC_FAILURES,
  SYNC_STATES,
  isPushable,
  pushTransition,
  retryDelaySeconds,
  verifyFailureTransition,
  verifyVerdict,
  type PushResultKind,
  type SyncState,
} from './states';

/*
 * Estados de sincronización deseado/aplicado (spec §9, plan MA-33).
 *
 * `sync-state-cases.json` es la tabla única de transiciones: la ejecuta este
 * test contra la función pura de TS y el pgTAP 36 contra las funciones SQL. El
 * último bloque comprueba que el pgTAP no se quedó atrás.
 */

const CASES = JSON.parse(
  readFileSync(resolve(process.cwd(), 'supabase/functions/_shared/entitlements/sync-state-cases.json'), 'utf8'),
) as {
  maxFailures: number;
  verify: {
    id: string;
    desiredVersion: number | null;
    desiredChecksum: string | null;
    appliedVersion: number | null;
    appliedChecksum: string | null;
    appliedStatus: 'NONE' | 'APPLIED' | 'APPLIED_WITH_WARNINGS';
    registryDrift: boolean;
    expected: SyncState;
  }[];
  push: { id: string; result: PushResultKind; failuresBefore: number; expected: SyncState; failuresAfter: number }[];
  verifyFailure: {
    id: string;
    state: SyncState;
    result: 'RETRYABLE' | 'REJECTED';
    failuresBefore: number;
    expected: SyncState;
    failuresAfter: number;
  }[];
  pushable: { state: SyncState; failures: number; pushable: boolean }[];
  retryDelaySeconds: { failures: number; seconds: number }[];
};

describe('estados', () => {
  it('son exactamente los 13 de la spec §9', () => {
    expect([...SYNC_STATES].sort()).toEqual(
      [
        'NOT_PROVISIONED', 'NOT_ENROLLED', 'PENDING_PUSH', 'PUSHING', 'AWAITING_VERIFY', 'IN_SYNC',
        'IN_SYNC_WITH_WARNINGS', 'DRIFT_BEHIND', 'DRIFT_CHECKSUM', 'DRIFT_AHEAD', 'REJECTED', 'UNREACHABLE',
        'REGISTRY_DRIFT',
      ].sort(),
    );
    expect(MAX_SYNC_FAILURES).toBe(CASES.maxFailures);
  });
});

describe('verifyVerdict — solo el GET decide IN_SYNC', () => {
  it.each(CASES.verify.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(
      verifyVerdict(
        { version: c.desiredVersion, checksum: c.desiredChecksum },
        { appliedVersion: c.appliedVersion, appliedChecksum: c.appliedChecksum, status: c.appliedStatus },
        c.registryDrift,
      ),
    ).toBe(c.expected);
  });
});

describe('pushTransition — la respuesta del PUT nunca es IN_SYNC', () => {
  it.each(CASES.push.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(pushTransition(c.result, c.failuresBefore)).toEqual({ state: c.expected, failures: c.failuresAfter });
  });

  it('ningún resultado de push produce IN_SYNC', () => {
    for (const r of ['APPLIED', 'REPLAYED', 'STALE', 'CONFLICT', 'REJECTED', 'INVALID_SNAPSHOT', 'RETRYABLE'] as const) {
      expect(pushTransition(r, 0).state).not.toMatch(/^IN_SYNC/);
    }
  });
});

describe('verifyFailureTransition', () => {
  it.each(CASES.verifyFailure.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(verifyFailureTransition(c.state, c.result, c.failuresBefore)).toEqual({
      state: c.expected,
      failures: c.failuresAfter,
    });
  });
});

describe('isPushable — DRIFT_AHEAD y DRIFT_CHECKSUM no se empujan solos', () => {
  it.each(CASES.pushable.map((c) => [`${c.state}/${c.failures}`, c] as const))('%s', (_id, c) => {
    expect(isPushable(c.state, c.failures)).toBe(c.pushable);
  });
});

describe('retryDelaySeconds — backoff exponencial con techo de 1 h', () => {
  it.each(CASES.retryDelaySeconds.map((c) => [c.failures, c.seconds] as const))('%i fallos → %i s', (f, s) => {
    expect(retryDelaySeconds(f)).toBe(s);
  });
});

describe('espejo SQL', () => {
  it('el pgTAP 36 contiene cada caso de la tabla', () => {
    const pgtap = readFileSync(resolve(process.cwd(), 'supabase/tests/36_ccp_entitlement_sync_state.test.sql'), 'utf8');
    for (const c of [...CASES.verify, ...CASES.push, ...CASES.verifyFailure]) {
      expect(pgtap, `falta el caso ${c.id} en el pgTAP 36`).toContain(`'${c.id}'`);
    }
  });
});
