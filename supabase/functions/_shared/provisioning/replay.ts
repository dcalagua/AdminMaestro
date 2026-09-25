/**
 * Certificación de replay — veredicto puro.
 *
 * Demuestra que el producto reconoce como repetición (`200`, `replayed:true`)
 * la MISMA petición con la MISMA clave de idempotencia, sin crear nada nuevo.
 * No cambia el estado de la solicitud ni su mapping: es evidencia, no una
 * operación de negocio.
 *
 * Antes de llamar se compara la huella del cuerpo reconstruido con la del envío
 * que terminó en éxito. Si difieren, el producto respondería
 * `IDEMPOTENCY_CONFLICT`, así que no se llama.
 */
import type { AdapterOutcome, ProvisioningSource } from './types.ts';

export type ReplayPrecheck =
  | { call: true }
  | { call: false; error: 'REPLAY_FINGERPRINT_MISSING' | 'REPLAY_BODY_DRIFT' };

export interface ReplayVerdict {
  certified: boolean;
  duplicate: boolean;
  reason: string | null;
  provider_http_status: number | null;
  replayed: boolean | null;
  identifiers_match: boolean;
}

export interface ReplayInput {
  expectedFingerprint: string | null;
  actualFingerprint: string;
  mapping: ProvisioningSource['mapping'];
  outcome?: AdapterOutcome;
}

export function evaluateReplayCertification(input: ReplayInput & { outcome: AdapterOutcome }): ReplayVerdict;
export function evaluateReplayCertification(input: ReplayInput): ReplayPrecheck | ReplayVerdict;
export function evaluateReplayCertification(input: ReplayInput): ReplayPrecheck | ReplayVerdict {
  const { expectedFingerprint, actualFingerprint, mapping, outcome } = input;

  if (!outcome) {
    if (!expectedFingerprint) return { call: false, error: 'REPLAY_FINGERPRINT_MISSING' };
    if (expectedFingerprint !== actualFingerprint) return { call: false, error: 'REPLAY_BODY_DRIFT' };
    return { call: true };
  }

  if (!outcome.ok) {
    return {
      certified: false,
      duplicate: false,
      reason: outcome.failure.code,
      provider_http_status: outcome.failure.httpStatus,
      replayed: null,
      identifiers_match: false,
    };
  }

  const r = outcome.result;
  const httpStatus = outcome.httpStatus ?? null;
  const replayed = r.replayed ?? null;
  const identifiersMatch =
    mapping !== null &&
    mapping.external_tenant_id === r.externalTenantId &&
    mapping.external_organization_id === r.externalOrganizationId &&
    mapping.external_company_id === r.externalCompanyId;

  const verdict = (certified: boolean, duplicate: boolean, reason: string | null): ReplayVerdict => ({
    certified,
    duplicate,
    reason,
    provider_http_status: httpStatus,
    replayed,
    identifiers_match: identifiersMatch,
  });

  // Un 201 en un replay es un SEGUNDO alta del lado del proveedor.
  if (httpStatus === 201) return verdict(false, true, 'PROVIDER_CREATED_AGAIN');
  if (httpStatus !== 200 || replayed !== true) return verdict(false, false, 'REPLAY_NOT_ACKNOWLEDGED');
  if (!identifiersMatch) return verdict(false, false, 'IDENTIFIERS_MISMATCH');
  return verdict(true, false, null);
}
