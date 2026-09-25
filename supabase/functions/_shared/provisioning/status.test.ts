import { describe, it, expect } from 'vitest';
import { summarizeStatus } from './status';
import type { AdapterOutcome } from './types';

/*
 * GET_STATUS: resumen de la consulta remota frente al mapping guardado.
 * No conoce ningún código de ningún producto: sólo los propaga.
 */

const MAPPING = {
  external_tenant_id: 'co-1',
  external_organization_id: 'org-1',
  external_company_id: 'co-1',
};

function success(overrides: Partial<{ t: string; o: string; c: string }> = {}): AdapterOutcome {
  return {
    ok: true,
    attempts: 1,
    httpStatus: 200,
    result: {
      status: 'ACTIVE',
      externalTenantId: overrides.t ?? 'co-1',
      externalOrganizationId: overrides.o ?? 'org-1',
      externalCompanyId: overrides.c ?? 'co-1',
      resources: { adminProvisioningStatus: 'PREPROVISIONED' },
      rawReference: 'prov-1',
      replayed: false,
    },
  };
}

function failure(httpStatus: number | null, code: string): AdapterOutcome {
  return {
    ok: false,
    attempts: 1,
    failure: { code, message: 'x', httpStatus, retryable: false, detail: {} },
  };
}

describe('summarizeStatus', () => {
  it('éxito con los tres ids iguales → found y mapping_consistent', () => {
    expect(summarizeStatus(success(), MAPPING)).toEqual({
      found: true,
      remote: {
        status: 'ACTIVE',
        externalTenantId: 'co-1',
        externalOrganizationId: 'org-1',
        externalCompanyId: 'co-1',
        resources: { adminProvisioningStatus: 'PREPROVISIONED' },
      },
      mapping_consistent: true,
      provider_http_status: 200,
      provider_code: null,
    });
  });

  it.each([
    ['tenant', { t: 'otro' }],
    ['organización', { o: 'otra' }],
    ['sociedad', { c: 'otra' }],
  ])('éxito con %s distinto → mapping_consistent false', (_n, o) => {
    expect(summarizeStatus(success(o), MAPPING).mapping_consistent).toBe(false);
  });

  it('éxito sin mapping guardado → mapping_consistent false', () => {
    expect(summarizeStatus(success(), null).mapping_consistent).toBe(false);
  });

  it('404 RFC 7807 → found:false y provider_code del proveedor', () => {
    expect(summarizeStatus(failure(404, 'RESOURCE_NOT_FOUND'), null)).toEqual({
      found: false,
      remote: null,
      mapping_consistent: true,
      provider_http_status: 404,
      provider_code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('404 sin código → PROVIDER_NOT_FOUND propagado, y con mapping no es consistente', () => {
    const summary = summarizeStatus(failure(404, 'PROVIDER_NOT_FOUND'), MAPPING);
    expect(summary.found).toBe(false);
    expect(summary.provider_code).toBe('PROVIDER_NOT_FOUND');
    expect(summary.mapping_consistent).toBe(false);
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'ACCESS_DENIED'],
    [null, 'PRIVATE_KEY_INVALID'],
  ])('%s → falla propagada con su código', (status, code) => {
    const summary = summarizeStatus(failure(status, code), MAPPING);
    expect(summary.found).toBe(false);
    expect(summary.error).toBe('CONSULTA_FALLIDA');
    expect(summary.provider_code).toBe(code);
    expect(summary.provider_http_status).toBe(status);
  });

  it('la salida nunca lleva token, authorization ni body', () => {
    for (const outcome of [success(), failure(404, 'RESOURCE_NOT_FOUND'), failure(401, 'UNAUTHENTICATED')]) {
      const text = JSON.stringify(summarizeStatus(outcome, MAPPING)).toLowerCase();
      expect(text).not.toContain('token');
      expect(text).not.toContain('authorization');
      expect(text).not.toContain('"body"');
    }
  });
});
