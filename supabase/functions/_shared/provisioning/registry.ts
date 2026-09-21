/**
 * Registro de adaptadores.
 *
 * UN solo sitio decide qué implementación atiende a un producto. La alternativa
 * —`if (product === 'EWM')` repartido por la aplicación— tiene un coste
 * conocido: el día que hay cinco productos, hay cinco ramas en doce archivos y
 * ninguna está toda en el mismo sitio.
 *
 * Aquí la clave es el TIPO DE INTEGRACIÓN, nunca el producto. Añadir el sexto
 * SaaS de la suite es una fila de configuración, no una rama de código.
 */
import type {
  AdapterKey,
  AdapterType,
  ContractCodec,
  ProvisioningAdapter,
  ProvisioningEnvironment,
  SecretResolver,
} from './types.ts';
import { ProvisioningError } from './types.ts';
import { HttpM2mAdapter } from './adapters/http-m2m.ts';
import { ManualAdapter } from './adapters/manual.ts';
import { MockAdapter } from './adapters/mock.ts';
import { GENERIC_CODEC } from './adapters/generic.ts';
import { EWM_V1_CODEC } from './adapters/ewm-v1.ts';

export interface RegistryDeps {
  secretResolver: SecretResolver;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/** Tipos implementados HOY. EDGE_FUNCTION está reservado, no implementado. */
export const IMPLEMENTED_ADAPTERS: readonly AdapterType[] = ['HTTP_M2M', 'MANUAL', 'MOCK'];

/**
 * Codecs de contrato COMPILADOS. Es un registro estático a propósito: nada que
 * venga de la base se evalúa ni se carga dinámicamente. La columna
 * `product_integrations.adapter_key` sólo elige una de estas entradas.
 */
export const CONTRACT_CODECS: Readonly<Record<AdapterKey, ContractCodec>> = {
  GENERIC: GENERIC_CODEC,
  EWM_V1: EWM_V1_CODEC,
};

/** Tipos que sólo pueden ejecutarse en DEV. */
export const DEV_ONLY_ADAPTERS: readonly AdapterType[] = ['MOCK'];

export function isAdapterAllowedInEnvironment(
  type: AdapterType,
  environment: ProvisioningEnvironment,
): boolean {
  if (DEV_ONLY_ADAPTERS.includes(type)) return environment === 'DEV';
  return true;
}

/**
 * Resuelve el adaptador.
 *
 * El guard de ambiente va ANTES de instanciar nada: un MOCK fuera de DEV no
 * llega ni a construirse, así que no hay ninguna ruta por la que pueda acabar
 * ejecutándose por descuido.
 */
export function resolveAdapter(
  type: AdapterType,
  environment: ProvisioningEnvironment,
  deps: RegistryDeps,
  adapterKey: AdapterKey = 'GENERIC',
): ProvisioningAdapter {
  if (!isAdapterAllowedInEnvironment(type, environment)) {
    throw new ProvisioningError(
      'MOCK_NOT_ALLOWED_IN_ENVIRONMENT',
      `El adaptador ${type} sólo está permitido en DEV; el destino es de ${environment}`,
      null,
      false,
      { adapter_type: type, environment },
    );
  }

  // Un codec distinto de GENERIC sólo tiene sentido sobre HTTP_M2M (la base
  // lo impide además con `product_integrations_adapter_ck`), y sólo si está
  // compilado en este módulo.
  if (adapterKey !== 'GENERIC' && type !== 'HTTP_M2M') {
    throw new ProvisioningError(
      'ADAPTER_NOT_IMPLEMENTED',
      `El contrato ${String(adapterKey)} sólo se admite sobre integraciones HTTP_M2M`,
      null,
      false,
      { adapter_type: type, adapter_key: String(adapterKey) },
    );
  }
  if (!Object.prototype.hasOwnProperty.call(CONTRACT_CODECS, adapterKey)) {
    throw new ProvisioningError(
      'ADAPTER_NOT_IMPLEMENTED',
      `Contrato de integración desconocido: ${String(adapterKey)}`,
      null,
      false,
      { adapter_key: String(adapterKey) },
    );
  }

  switch (type) {
    case 'HTTP_M2M':
      return new HttpM2mAdapter(
        {
          secretResolver: deps.secretResolver,
          fetchImpl: deps.fetchImpl,
          sleep: deps.sleep,
          now: deps.now,
        },
        CONTRACT_CODECS[adapterKey],
      );
    case 'MANUAL':
      return new ManualAdapter();
    case 'MOCK':
      return new MockAdapter();
    case 'EDGE_FUNCTION':
      // Reservado a propósito. El enum lo contempla para que el modelo no tenga
      // que migrarse el día que haga falta, pero implementarlo sin un contrato
      // acordado sería inventar semántica que después habría que romper.
      throw new ProvisioningError(
        'ADAPTER_NOT_IMPLEMENTED',
        'El adaptador EDGE_FUNCTION está reservado pero todavía no implementado',
        null,
        false,
        { adapter_type: type },
      );
    default:
      throw new ProvisioningError(
        'ADAPTER_NOT_IMPLEMENTED',
        `Tipo de integración desconocido: ${String(type)}`,
        null,
        false,
        { adapter_type: String(type) },
      );
  }
}
