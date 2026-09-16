import { describe, it, expect } from 'vitest';
import { parseProvisioningResponse, sanitizeResources } from './response';
import { ProvisioningError } from './types';

/*
 * V4 · Validación de la respuesta del SaaS.
 *
 * Un 200 no es un éxito: es un 200. Sin esta validación, un producto que
 * respondiera `{"ok":true}` sin crear nada dejaría la solicitud en ACTIVE y el
 * mapeo vacío, y nadie se enteraría hasta que el cliente intentara entrar.
 */

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof ProvisioningError ? error.code : 'NOT_A_PROVISIONING_ERROR';
  }
  return 'NO_THROW';
}

describe('parseProvisioningResponse · contrato mínimo', () => {
  it('acepta una respuesta completa', () => {
    expect(
      parseProvisioningResponse({
        status: 'ACTIVE',
        externalTenantId: 'ewm-tenant-7',
        externalOrganizationId: 'org-3',
        externalCompanyId: 'co-9',
        resources: { initialWarehouseId: 'WH-01' },
        rawReference: 'op-123',
      }),
    ).toEqual({
      status: 'ACTIVE',
      externalTenantId: 'ewm-tenant-7',
      externalOrganizationId: 'org-3',
      externalCompanyId: 'co-9',
      resources: { initialWarehouseId: 'WH-01' },
      rawReference: 'op-123',
    });
  });

  it('ACTIVE es el estado por defecto cuando el producto no lo declara', () => {
    expect(parseProvisioningResponse({ externalTenantId: 'x' }).status).toBe('ACTIVE');
  });

  it('acepta PENDING: hay productos que crean el tenant de forma asíncrona', () => {
    expect(parseProvisioningResponse({ status: 'pending', externalTenantId: 'x' }).status).toBe(
      'PENDING',
    );
  });

  it('rechaza un estado que no está en el contrato', () => {
    expect(codeOf(() => parseProvisioningResponse({ status: 'OK', externalTenantId: 'x' }))).toBe(
      'PROVIDER_RESPONSE_INVALID',
    );
  });

  it('rechaza una respuesta sin externalTenantId: es el «éxito» que nadie puede verificar', () => {
    expect(codeOf(() => parseProvisioningResponse({ ok: true }))).toBe(
      'PROVIDER_RESPONSE_INVALID',
    );
    expect(codeOf(() => parseProvisioningResponse({ externalTenantId: '   ' }))).toBe(
      'PROVIDER_RESPONSE_INVALID',
    );
  });

  it.each([null, undefined, 'texto', 42, []])('rechaza un cuerpo que no es objeto (%s)', (body) => {
    expect(codeOf(() => parseProvisioningResponse(body))).toBe('PROVIDER_RESPONSE_INVALID');
  });

  it('acepta identificadores numéricos: no todos los backends usan texto', () => {
    expect(parseProvisioningResponse({ externalTenantId: 4711 }).externalTenantId).toBe('4711');
  });

  it('rechaza un identificador que es un objeto', () => {
    expect(codeOf(() => parseProvisioningResponse({ externalTenantId: { id: 1 } }))).toBe(
      'PROVIDER_RESPONSE_INVALID',
    );
  });

  it('rechaza un identificador desmesurado', () => {
    expect(codeOf(() => parseProvisioningResponse({ externalTenantId: 'x'.repeat(201) }))).toBe(
      'PROVIDER_RESPONSE_INVALID',
    );
  });

  it('los identificadores opcionales que faltan quedan en null, no en undefined', () => {
    const result = parseProvisioningResponse({ externalTenantId: 'x' });
    expect(result.externalOrganizationId).toBeNull();
    expect(result.externalCompanyId).toBeNull();
    expect(result.rawReference).toBeNull();
    expect(result.resources).toEqual({});
  });

  it('acepta `reference` como alias de rawReference', () => {
    expect(parseProvisioningResponse({ externalTenantId: 'x', reference: 'r1' }).rawReference).toBe(
      'r1',
    );
  });
});

describe('sanitizeResources', () => {
  it('conserva escalares no sensibles', () => {
    expect(
      sanitizeResources({ initialWarehouseId: 'WH-01', seats: 25, trial: true, note: null }),
    ).toEqual({ initialWarehouseId: 'WH-01', seats: 25, trial: true, note: null });
  });

  it.each([
    'password',
    'apiKey',
    'api_key',
    'privateKey',
    'service_role',
    'accessToken',
    'authorization',
    'connectionString',
    'dbCredential',
  ])('descarta la clave %s', (key) => {
    expect(sanitizeResources({ [key]: 'valor', ok: 1 })).toEqual({ ok: 1 });
  });

  it('descarta objetos y arrays: sin contrato no se sabe qué llevan dentro', () => {
    expect(sanitizeResources({ nested: { a: 1 }, list: [1, 2], ok: 'x' })).toEqual({ ok: 'x' });
  });

  it('descarta cadenas desmesuradas', () => {
    expect(sanitizeResources({ big: 'x'.repeat(501), ok: 1 })).toEqual({ ok: 1 });
  });

  it('acota el número de claves', () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 100; i += 1) big[`k${i}`] = i;
    expect(Object.keys(sanitizeResources(big))).toHaveLength(25);
  });

  it.each([null, 'texto', 42, []])('un valor que no es objeto da {} (%s)', (raw) => {
    expect(sanitizeResources(raw)).toEqual({});
  });
});
