import { describe, it, expect } from 'vitest';
import {
  DEV_ONLY_ADAPTERS,
  IMPLEMENTED_ADAPTERS,
  isAdapterAllowedInEnvironment,
  resolveAdapter,
} from './registry';
import { HttpM2mAdapter } from './adapters/http-m2m';
import { ManualAdapter } from './adapters/manual';
import { MockAdapter } from './adapters/mock';
import { ProvisioningError } from './types';
import type { AdapterType, ProvisioningContext, ProvisioningEnvironment } from './types';

/*
 * V4 · Registro de adaptadores.
 *
 * La clave del registro es el TIPO DE INTEGRACIÓN, nunca el producto. Si alguna
 * vez aparece un `if (product === 'EWM')`, este archivo es el sitio donde se
 * nota — y el test que sigue es el que lo impide.
 */

const deps = { secretResolver: () => 'x' };

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof ProvisioningError ? error.code : 'NOT_A_PROVISIONING_ERROR';
  }
  return 'NO_THROW';
}

describe('inventario', () => {
  it('los tipos implementados hoy son HTTP_M2M, MANUAL y MOCK', () => {
    expect([...IMPLEMENTED_ADAPTERS]).toEqual(['HTTP_M2M', 'MANUAL', 'MOCK']);
  });

  it('MOCK es el único restringido a DEV', () => {
    expect([...DEV_ONLY_ADAPTERS]).toEqual(['MOCK']);
  });
});

describe('guard de ambiente', () => {
  it.each<ProvisioningEnvironment>(['QAS', 'DEMO', 'PRD'])('MOCK prohibido en %s', (env) => {
    expect(isAdapterAllowedInEnvironment('MOCK', env)).toBe(false);
    expect(codeOf(() => resolveAdapter('MOCK', env, deps))).toBe(
      'MOCK_NOT_ALLOWED_IN_ENVIRONMENT',
    );
  });

  it('MOCK permitido en DEV', () => {
    expect(resolveAdapter('MOCK', 'DEV', deps)).toBeInstanceOf(MockAdapter);
  });

  it.each<ProvisioningEnvironment>(['DEV', 'QAS', 'DEMO', 'PRD'])(
    'HTTP_M2M permitido en %s',
    (env) => {
      expect(resolveAdapter('HTTP_M2M', env, deps)).toBeInstanceOf(HttpM2mAdapter);
    },
  );

  it('el guard corta ANTES de instanciar: un MOCK fuera de DEV ni se construye', () => {
    // Si se instanciara y sólo fallara al ejecutar, habría una ruta por la que
    // alguien podría llamar a provision() directamente.
    expect(() => resolveAdapter('MOCK', 'PRD', deps)).toThrow(ProvisioningError);
  });
});

describe('resolución por tipo', () => {
  it('MANUAL devuelve el adaptador manual', () => {
    expect(resolveAdapter('MANUAL', 'PRD', deps)).toBeInstanceOf(ManualAdapter);
  });

  it('EDGE_FUNCTION está reservado pero no implementado, y lo dice', () => {
    expect(codeOf(() => resolveAdapter('EDGE_FUNCTION', 'QAS', deps))).toBe(
      'ADAPTER_NOT_IMPLEMENTED',
    );
  });

  it('DB_DIRECT no existe como tipo y no se resuelve a nada', () => {
    expect(codeOf(() => resolveAdapter('DB_DIRECT' as AdapterType, 'PRD', deps))).toBe(
      'ADAPTER_NOT_IMPLEMENTED',
    );
  });
});

// ---------------------------------------------------------------------------
// Adaptadores MANUAL y MOCK
// ---------------------------------------------------------------------------
function context(environment: ProvisioningEnvironment): ProvisioningContext {
  return {
    request: {
      id: 'r1',
      status: 'READY_TO_PROVISION',
      idempotency_key: 'ma-prov-v1-abc',
      correlation_id: 'corr-1',
      attempt_count: 0,
      max_attempts: 3,
      request_version: 1,
      environment,
      policy: 'MANUAL',
      requested_by: 'u1',
      subscription_id: null,
    },
    product: { id: 'p1', code: 'ewm', short_name: 'EWM' },
    deployment: null,
    integration: null,
    credential: null,
    payload: {
      tenantCode: 'alpha-ewm',
      tenantName: 'Alpha EWM',
      adminEmail: 'admin@alpha.ebim.test',
      tenantType: 'PRODUCTION',
      environment,
      deploymentMode: 'SHARED',
      organization: {},
      company: { code: 'C1' },
      plan: null,
      masterAdmin: {},
    },
    actor: { id: 'u1', role: 'TECH_LEAD' },
  };
}

describe('ManualAdapter', () => {
  it('no finge un éxito: pide el registro manual y explica cómo', async () => {
    const outcome = await new ManualAdapter().provision(context('PRD'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.code).toBe('MANUAL_REGISTRATION_REQUIRED');
    expect(outcome.failure.retryable).toBe(false);
  });

  it('no expone consulta de estado remota', async () => {
    const outcome = await new ManualAdapter().getStatus(context('PRD'));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.code).toBe('MANUAL_STATUS_UNAVAILABLE');
  });
});

describe('MockAdapter', () => {
  it('recorre el flujo completo en DEV y devuelve identificadores deterministas', async () => {
    const outcome = await new MockAdapter().provision(context('DEV'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe('ACTIVE');
    expect(outcome.result.externalTenantId).toBe('mock-tenant-alpha-ewm');
    expect(outcome.result.externalOrganizationId).toBe('mock-org-alpha-ewm');
    expect(outcome.result.resources).toMatchObject({ simulated: true });
  });

  it.each<ProvisioningEnvironment>(['QAS', 'DEMO', 'PRD'])('falla cerrado en %s', async (env) => {
    const outcome = await new MockAdapter().provision(context(env));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.code).toBe('MOCK_NOT_ALLOWED_IN_ENVIRONMENT');
  });

  it('el prefijo `mock-` hace evidente cualquier fuga a otro entorno', async () => {
    const outcome = await new MockAdapter().provision(context('DEV'));
    if (outcome.ok) expect(outcome.result.externalTenantId.startsWith('mock-')).toBe(true);
  });
});
