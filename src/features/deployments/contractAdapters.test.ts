import { describe, it, expect } from 'vitest';
import { CONTRACT_ADAPTERS, CONTRACT_ADAPTER_KEYS, contractAdapterFor } from './contractAdapters';

const EWM_EXAMPLE = {
  organizationTimezone: 'America/Lima',
  initialWarehouse: {
    code: 'CD01',
    name: 'Almacén principal',
    timezone: 'America/Lima',
    erpCode: null,
    address: null,
    is3pl: false,
  },
  admin: { fullName: 'Administrador Cliente' },
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe('CONTRACT_ADAPTERS', () => {
  it('catálogo cerrado: GENERIC y EWM_V1, en ese orden', () => {
    expect(Object.keys(CONTRACT_ADAPTERS)).toEqual(['GENERIC', 'EWM_V1']);
    expect([...CONTRACT_ADAPTER_KEYS]).toEqual(['GENERIC', 'EWM_V1']);
  });

  it('GENERIC no pide configuración de producto', () => {
    expect(CONTRACT_ADAPTERS.GENERIC.configurationSchema).toBeNull();
    expect(CONTRACT_ADAPTERS.GENERIC.fields).toEqual([]);
    expect(CONTRACT_ADAPTERS.GENERIC.label).toBe('Estándar EBIM v1');
  });

  it('una clave desconocida o ausente cae en GENERIC', () => {
    expect(contractAdapterFor(null)).toBe(CONTRACT_ADAPTERS.GENERIC);
    expect(contractAdapterFor('OTRO')).toBe(CONTRACT_ADAPTERS.GENERIC);
    expect(contractAdapterFor('EWM_V1')).toBe(CONTRACT_ADAPTERS.EWM_V1);
  });
});

describe('EWM_V1 · esquema del formulario', () => {
  const schema = CONTRACT_ADAPTERS.EWM_V1.configurationSchema!;

  it('acepta el ejemplo de la spec sin resolvedCurrency', () => {
    expect(schema.safeParse(EWM_EXAMPLE).success).toBe(true);
  });

  it('rechaza un código de almacén inválido', () => {
    const v = clone(EWM_EXAMPLE);
    v.initialWarehouse.code = 'WH 001';
    expect(schema.safeParse(v).success).toBe(false);
  });

  it('rechaza fullName vacío', () => {
    const v = clone(EWM_EXAMPLE);
    v.admin.fullName = '   ';
    expect(schema.safeParse(v).success).toBe(false);
  });

  it('rechaza una zona horaria inexistente', () => {
    const v = clone(EWM_EXAMPLE);
    v.organizationTimezone = 'Mars/Base';
    expect(schema.safeParse(v).success).toBe(false);
  });

  it('rechaza claves extra (strict), también resolvedCurrency del cliente', () => {
    expect(schema.safeParse({ ...clone(EWM_EXAMPLE), script: 'x' }).success).toBe(false);
    expect(schema.safeParse({ ...clone(EWM_EXAMPLE), resolvedCurrency: 'USD' }).success).toBe(false);
  });

  it('la precarga usa el nombre del perfil y la zona de la cascada', () => {
    const pre = CONTRACT_ADAPTERS.EWM_V1.prefill({ fullName: 'Ana Pérez', timezone: 'America/Bogota' });
    expect(pre).toMatchObject({
      organizationTimezone: 'America/Bogota',
      initialWarehouse: { timezone: 'America/Bogota' },
      admin: { fullName: 'Ana Pérez' },
    });
  });
});
