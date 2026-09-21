/**
 * Codec EWM_V1 — contrato de provisioning propio de EWM.
 *
 * Stub hasta completar el codec: todos sus métodos fallan cerrado.
 */
import type { ContractCodec } from '../types.ts';
import { ProvisioningError } from '../types.ts';

function notImplemented(): never {
  throw new ProvisioningError('ADAPTER_NOT_IMPLEMENTED', 'El codec EWM_V1 todavía no está implementado');
}

export const EWM_V1_CODEC: ContractCodec = {
  key: 'EWM_V1',
  capabilities: ['PROVISION'],
  validateInput: notImplemented,
  buildCreateBody: notImplemented,
  pathParams: notImplemented,
  parseResponse: notImplemented,
};
