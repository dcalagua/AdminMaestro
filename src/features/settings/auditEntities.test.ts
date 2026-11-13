import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/queries', () => ({}));

import { resolveAuditEntity } from './auditEntities';

const maps = {
  tenants: new Map([['t-1', 'Andina PD · Cliente A']]),
  organizations: new Map([['o-1', 'Consultora Andina']]),
  products: new Map([['p-1', 'eSupplier']]),
};

describe('resolveAuditEntity', () => {
  it('nombra la propia entidad y enlaza a su ficha', () => {
    expect(resolveAuditEntity({ entity_type: 'organization', entity_id: 'o-1' }, maps)).toEqual({
      type: 'Organización', name: 'Consultora Andina', to: '/organizations/o-1',
    });
  });

  it('si la entidad no tiene nombre, usa el tenant o la organización del evento', () => {
    expect(resolveAuditEntity({ entity_type: 'saas_provisioning_request', entity_id: 'r-1', tenant_id: 't-1' }, maps)).toEqual({
      type: 'Alta en la app', name: 'Andina PD · Cliente A', to: '/tenants/t-1',
    });
    expect(resolveAuditEntity({ entity_type: 'company', entity_id: 'c-1', organization_id: 'o-1' }, maps).name).toBe('Consultora Andina');
  });

  it('sin nada que resolver queda solo el tipo, nunca un fragmento de UUID', () => {
    expect(resolveAuditEntity({ entity_type: 'tenant', entity_id: 'a63c03eb-0000' }, maps)).toEqual({ type: 'Tenant', name: null, to: null });
  });
});
