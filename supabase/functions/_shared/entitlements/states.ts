/**
 * Estados de sincronización deseado/aplicado (spec §9).
 *
 * Funciones puras, espejo EXACTO de las funciones SQL de
 * `20260930000200_ccp_entitlement_sync_state.sql`:
 *
 *   verifyVerdict           ↔ platform.entitlement_verify_verdict
 *   pushTransition          ↔ platform.entitlement_push_transition
 *   verifyFailureTransition ↔ platform.entitlement_verify_failure_transition
 *   isPushable              ↔ platform.entitlement_is_pushable
 *   retryDelaySeconds       ↔ platform.entitlement_retry_delay
 *
 * La base es la autoridad (las transiciones se aplican allí, con lease y
 * bitácora); este módulo existe para que el job y la UI razonen igual y para
 * que `sync-state-cases.json` se pruebe en los dos runtimes.
 *
 * Regla que no se negocia: la respuesta de un PUT nunca produce IN_SYNC. Solo
 * el GET aplicado lo demuestra (spec §8.3, §19).
 */
import type { AppliedStatus } from './types.ts';

export const SYNC_STATES = [
  'NOT_PROVISIONED',
  'NOT_ENROLLED',
  'PENDING_PUSH',
  'PUSHING',
  'AWAITING_VERIFY',
  'IN_SYNC',
  'IN_SYNC_WITH_WARNINGS',
  'DRIFT_BEHIND',
  'DRIFT_CHECKSUM',
  'DRIFT_AHEAD',
  'REJECTED',
  'UNREACHABLE',
  'REGISTRY_DRIFT',
] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export const MAX_SYNC_FAILURES = 5;
const RETRY_BASE_SECONDS = 60;
const RETRY_CAP_SECONDS = 3600;

/** Clasificación de un PUT (la produce sync-client.ts). */
export type PushResultKind =
  | 'APPLIED'
  | 'REPLAYED'
  | 'STALE'
  | 'CONFLICT'
  | 'REJECTED'
  | 'INVALID_SNAPSHOT'
  | 'RETRYABLE';

export interface Transition {
  state: SyncState;
  failures: number;
}

function assertFailures(failures: number): void {
  if (!Number.isInteger(failures) || failures < 0) throw new RangeError('failures debe ser un entero ≥ 0');
}

export function verifyVerdict(
  desired: { version: number | null; checksum: string | null },
  observed: { appliedVersion: number | null; appliedChecksum: string | null; status: AppliedStatus },
  registryDrift: boolean,
): SyncState {
  const applied = observed.status === 'NONE' ? null : observed.appliedVersion;
  const want = desired.version ?? 0;
  if (applied === null || applied < want) return 'DRIFT_BEHIND';
  if (applied > want) return 'DRIFT_AHEAD';
  if (observed.appliedChecksum !== desired.checksum) return 'DRIFT_CHECKSUM';
  if (registryDrift) return 'REGISTRY_DRIFT';
  return observed.status === 'APPLIED_WITH_WARNINGS' ? 'IN_SYNC_WITH_WARNINGS' : 'IN_SYNC';
}

export function pushTransition(result: PushResultKind, failures: number): Transition {
  assertFailures(failures);
  switch (result) {
    case 'APPLIED':
    case 'REPLAYED':
      return { state: 'AWAITING_VERIFY', failures: 0 };
    case 'STALE':
      return { state: 'DRIFT_AHEAD', failures };
    case 'CONFLICT':
      return { state: 'DRIFT_CHECKSUM', failures };
    case 'REJECTED':
    case 'INVALID_SNAPSHOT':
      return { state: 'REJECTED', failures };
    case 'RETRYABLE': {
      const next = failures + 1;
      return { state: next >= MAX_SYNC_FAILURES ? 'UNREACHABLE' : 'PENDING_PUSH', failures: next };
    }
    default:
      throw new RangeError(`Resultado de push desconocido: ${String(result)}`);
  }
}

export function verifyFailureTransition(
  current: SyncState,
  result: 'RETRYABLE' | 'REJECTED',
  failures: number,
): Transition {
  assertFailures(failures);
  if (result === 'REJECTED') return { state: 'REJECTED', failures };
  const next = failures + 1;
  return { state: next >= MAX_SYNC_FAILURES ? 'UNREACHABLE' : current, failures: next };
}

export function isPushable(state: SyncState, failures: number): boolean {
  if (state === 'PENDING_PUSH' || state === 'UNREACHABLE') return true;
  if (state === 'DRIFT_BEHIND') return failures < MAX_SYNC_FAILURES;
  return false;
}

export function retryDelaySeconds(failures: number): number {
  const exponent = Math.max(0, Math.min(failures, 20) - 1);
  return Math.min(RETRY_BASE_SECONDS * 2 ** exponent, RETRY_CAP_SECONDS);
}
