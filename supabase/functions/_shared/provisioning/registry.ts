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
  AdapterType,
  ProvisioningAdapter,
  ProvisioningEnvironment,
  SecretResolver,
} from './types.ts';
import { ProvisioningError } from './types.ts';
import { HttpM2mAdapter } from './adapters/http-m2m.ts';
import { ManualAdapter } from './adapters/manual.ts';
import { MockAdapter } from './adapters/mock.ts';

export interface RegistryDeps {
  secretResolver: SecretResolver;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/** Tipos implementados HOY. EDGE_FUNCTION está reservado, no implementado. */
export const IMPLEMENTED_ADAPTERS: readonly AdapterType[] = ['HTTP_M2M', 'MANUAL', 'MOCK'];

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

  switch (type) {
    case 'HTTP_M2M':
      return new HttpM2mAdapter({
        secretResolver: deps.secretResolver,
        fetchImpl: deps.fetchImpl,
        sleep: deps.sleep,
        now: deps.now,
      });
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
