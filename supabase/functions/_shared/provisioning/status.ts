/**
 * GET_STATUS — resumen de la consulta remota.
 *
 * Es de SÓLO LECTURA: compara lo que el producto dice con el mapping que tiene
 * MasterAdmin y lo informa. No reconcilia ni cambia el estado de la solicitud.
 *
 * No conoce ningún código de ningún producto. Un 404 se reporta como «no
 * encontrado» con el código que haya normalizado `errors.ts` (el del proveedor
 * si respondió RFC 7807, `PROVIDER_NOT_FOUND` si no): distinguirlos es cosa de
 * quien lee el resultado.
 */
import type { AdapterOutcome, ProvisioningSource } from './types.ts';

export interface StatusSummary {
  found: boolean;
  remote: {
    status: string;
    externalTenantId: string;
    externalOrganizationId: string | null;
    externalCompanyId: string | null;
    resources: Record<string, unknown>;
  } | null;
  mapping_consistent: boolean;
  provider_http_status: number | null;
  provider_code: string | null;
  error?: 'CONSULTA_FALLIDA';
  message?: string;
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null)?.toLowerCase() === (b ?? null)?.toLowerCase();
}

export function summarizeStatus(
  outcome: AdapterOutcome,
  mapping: ProvisioningSource['mapping'],
): StatusSummary {
  if (outcome.ok) {
    const r = outcome.result;
    return {
      found: true,
      remote: {
        status: r.status,
        externalTenantId: r.externalTenantId,
        externalOrganizationId: r.externalOrganizationId,
        externalCompanyId: r.externalCompanyId,
        resources: r.resources,
      },
      mapping_consistent:
        mapping !== null &&
        same(mapping.external_tenant_id, r.externalTenantId) &&
        same(mapping.external_organization_id, r.externalOrganizationId) &&
        same(mapping.external_company_id, r.externalCompanyId),
      provider_http_status: outcome.httpStatus ?? null,
      provider_code: null,
    };
  }

  const { failure } = outcome;
  if (failure.httpStatus === 404) {
    // Coherente sólo si MasterAdmin tampoco tiene mapping.
    return {
      found: false,
      remote: null,
      mapping_consistent: mapping === null,
      provider_http_status: 404,
      provider_code: failure.code,
    };
  }

  return {
    found: false,
    remote: null,
    mapping_consistent: false,
    provider_http_status: failure.httpStatus,
    provider_code: failure.code,
    error: 'CONSULTA_FALLIDA',
    message: failure.message,
  };
}
