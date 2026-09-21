/**
 * Codec GENERIC — el estándar EBIM v1.
 *
 * Son las tres expresiones que antes vivían dentro de `HttpM2mAdapter`,
 * movidas sin reescribir: el cuerpo es el `payload` estándar, los marcadores son
 * `{externalTenantId}` y `{tenantCode}`, y la respuesta la lee
 * `parseProvisioningResponse`. La prueba dorada
 * `http-m2m.generic-golden.test.ts` es la que garantiza que siguen siendo las
 * mismas.
 */
import type { ContractCodec } from '../types.ts';
import { parseProvisioningResponse } from '../response.ts';

export const GENERIC_CODEC: ContractCodec = {
  key: 'GENERIC',
  capabilities: ['PROVISION'],
  validateInput: () => [],
  buildCreateBody: (context) => context.payload,
  pathParams: (context) => {
    const params: Record<string, string> = {
      externalTenantId: context.request.id,
      tenantCode: context.payload.tenantCode,
    };
    // Marcador nuevo y opcional: ninguna plantilla existente lo referencia, así
    // que añadirlo no cambia ninguna URL que ya se construyera.
    const cp = context.source?.tenant.id ?? context.payload.masterAdmin?.tenantId;
    if (typeof cp === 'string' && cp !== '') params.controlPlaneTenantId = cp;
    return params;
  },
  parseResponse: (body) => parseProvisioningResponse(body),
};
