import { describe, expect, it } from 'vitest';
import { lifecycleImpact, type LifecycleTarget } from './lifecycleModel';

const T = (tenantId: string, productName: string, tenantStatus: string): LifecycleTarget => ({
  tenantId, tenantName: `Tenant ${tenantId}`, productName, tenantStatus,
});

const users = [
  { id: 'u1', fullName: 'Zoila', email: 'z@a.pe', tenants: [{ tenant_id: 't1', is_active: true }] },
  { id: 'u2', fullName: null, email: 'b@a.pe', tenants: [{ tenant_id: 't2', is_active: true }] },
  { id: 'u3', fullName: 'Inactiva', email: 'i@a.pe', tenants: [{ tenant_id: 't1', is_active: false }] },
  { id: 'u4', fullName: 'Ajena', email: 'x@a.pe', tenants: [{ tenant_id: 't9', is_active: true }] },
] as never;

describe('lifecycleImpact', () => {
  const targets = [T('t1', 'TMS', 'ACTIVE'), T('t2', 'EWM', 'ACTIVE'), T('t3', 'EWM', 'PENDING'), T('t4', 'EWM', 'SUSPENDED')];

  it('suspender: sólo los activos, agrupados por app, con sus usuarios activos', () => {
    const r = lifecycleImpact('SUSPEND', targets, users);
    expect(r.affected.map((t) => t.tenantId)).toEqual(['t1', 't2']);
    expect(r.skipped.map((t) => t.tenantId)).toEqual(['t3', 't4']);
    expect(r.byApp.map((a) => a.productName)).toEqual(['EWM', 'TMS']);
    // Sin nombre se muestra el correo; la membresía inactiva y la ajena no cuentan.
    expect(r.users.map((u) => u.name)).toEqual(['b@a.pe', 'Zoila']);
  });

  it('reactivar: sólo los suspendidos', () => {
    const r = lifecycleImpact('RESUME', targets, users);
    expect(r.affected.map((t) => t.tenantId)).toEqual(['t4']);
    expect(r.users).toEqual([]);
  });
});
