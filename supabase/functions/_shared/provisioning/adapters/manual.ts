/**
 * Adaptador MANUAL.
 *
 * Para SaaS que todavía no exponen API de provisioning y para dedicados cuya
 * alta física la hace una persona. No es un adaptador degradado: es el
 * reconocimiento explícito de que parte de la suite se opera a mano hoy, y de
 * que eso debe quedar igual de registrado, auditado y visible que lo automático.
 *
 * Su `provision()` FALLA a propósito, con un código que explica el camino
 * correcto. Un adaptador manual que devolviera "éxito" sin que nadie hubiera
 * creado nada sería exactamente el tipo de mentira que este subsistema existe
 * para evitar.
 */
import type {
  AdapterOutcome,
  ProvisioningAdapter,
  ProvisioningContext,
} from '../types.ts';

export class ManualAdapter implements ProvisioningAdapter {
  readonly type = 'MANUAL' as const;

  provision(_context: ProvisioningContext): Promise<AdapterOutcome> {
    return Promise.resolve({
      ok: false,
      attempts: 0,
      failure: {
        code: 'MANUAL_REGISTRATION_REQUIRED',
        message:
          'Esta integración es MANUAL: el alta la realiza una persona en el producto y se ' +
          'registra con «Registrar manualmente», indicando el identificador externo.',
        httpStatus: null,
        retryable: false,
        detail: { adapter: 'MANUAL' },
      },
    });
  }

  getStatus(_context: ProvisioningContext): Promise<AdapterOutcome> {
    return Promise.resolve({
      ok: false,
      attempts: 0,
      failure: {
        code: 'MANUAL_STATUS_UNAVAILABLE',
        message: 'Una integración MANUAL no expone consulta de estado remota',
        httpStatus: null,
        retryable: false,
        detail: { adapter: 'MANUAL' },
      },
    });
  }
}
