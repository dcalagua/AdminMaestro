import { describe, it, expect } from 'vitest';
import { evaluateReplayCertification } from './replay';
import type { AdapterOutcome } from './types';

const MAPPING = { external_tenant_id: 'co-1', external_organization_id: 'org-1', external_company_id: 'co-1' };
const FP = 'a'.repeat(64);

function ok(httpStatus: number, replayed: boolean, tenant = 'co-1'): AdapterOutcome {
  return {
    ok: true,
    attempts: 1,
    httpStatus,
    result: {
      status: 'ACTIVE',
      externalTenantId: tenant,
      externalOrganizationId: 'org-1',
      externalCompanyId: tenant,
      resources: {},
      rawReference: 'prov-1',
      replayed,
    },
  };
}

describe('evaluateReplayCertification · antes de llamar', () => {
  it('sin huella registrada → no se llama', () => {
    expect(
      evaluateReplayCertification({ expectedFingerprint: null, actualFingerprint: FP, mapping: MAPPING }),
    ).toEqual({ call: false, error: 'REPLAY_FINGERPRINT_MISSING' });
  });

  it('R1 · huella distinta → REPLAY_BODY_DRIFT sin llamar', () => {
    expect(
      evaluateReplayCertification({ expectedFingerprint: FP, actualFingerprint: 'b'.repeat(64), mapping: MAPPING }),
    ).toEqual({ call: false, error: 'REPLAY_BODY_DRIFT' });
  });

  it('huellas iguales → se llama', () => {
    expect(
      evaluateReplayCertification({ expectedFingerprint: FP, actualFingerprint: FP, mapping: MAPPING }),
    ).toEqual({ call: true });
  });
});

describe('evaluateReplayCertification · veredicto', () => {
  const base = { expectedFingerprint: FP, actualFingerprint: FP, mapping: MAPPING };

  it('200 + replayed:true + ids = mapping → certificado', () => {
    expect(evaluateReplayCertification({ ...base, outcome: ok(200, true) })).toEqual({
      certified: true,
      duplicate: false,
      reason: null,
      provider_http_status: 200,
      replayed: true,
      identifiers_match: true,
    });
  });

  it('201 → duplicado del lado del proveedor', () => {
    expect(evaluateReplayCertification({ ...base, outcome: ok(201, false) })).toMatchObject({
      certified: false,
      duplicate: true,
      reason: 'PROVIDER_CREATED_AGAIN',
    });
  });

  it('200 con replayed:false → no reconocido como replay', () => {
    expect(evaluateReplayCertification({ ...base, outcome: ok(200, false) })).toMatchObject({
      certified: false,
      reason: 'REPLAY_NOT_ACKNOWLEDGED',
    });
  });

  it('externalTenantId distinto del mapping → IDENTIFIERS_MISMATCH', () => {
    expect(evaluateReplayCertification({ ...base, outcome: ok(200, true, 'co-2') })).toMatchObject({
      certified: false,
      reason: 'IDENTIFIERS_MISMATCH',
      identifiers_match: false,
    });
  });

  it('outcome fallido → su código', () => {
    const failed: AdapterOutcome = {
      ok: false,
      attempts: 1,
      failure: { code: 'IDEMPOTENCY_CONFLICT', message: 'x', httpStatus: 409, retryable: false, detail: {} },
    };
    expect(evaluateReplayCertification({ ...base, outcome: failed })).toEqual({
      certified: false,
      duplicate: false,
      reason: 'IDEMPOTENCY_CONFLICT',
      provider_http_status: 409,
      replayed: null,
      identifiers_match: false,
    });
  });
});
