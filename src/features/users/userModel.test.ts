import { describe, it, expect } from 'vitest';
import {
  ASSIGNABLE_PLATFORM_ROLES, accessSummary, accountStatus, assignableOrgRoles, matchesUserTab, toAdminUser,
  userCategories, userTabs, type AdminUser, type AdminUserRow,
} from './userModel';

/* M5 · Modelo de «Usuarios y accesos»: pestañas U-06, estados y roles asignables. */

function row(partial: Partial<AdminUserRow>): AdminUserRow {
  return {
    id: 'u1', email: 'x@ebim.test', full_name: 'X', phone: null as unknown as string, job_title: null as unknown as string,
    is_active: true, created_at: '2026-10-01T00:00:00Z', last_sign_in_at: '2026-10-02T00:00:00Z',
    invited_at: null as unknown as string, email_confirmed_at: '2026-10-01T00:00:00Z', banned: false,
    platform_role: null as unknown as AdminUserRow['platform_role'], platform_role_active: null as unknown as boolean,
    organizations: [], tenants: [], provisioning_roles: [], product_ownerships: [], sales_agent: null,
    ...partial,
  } as AdminUserRow;
}

const org = (role: string, kind = 'COMPANY', is_active = true) => ({
  id: `m-${role}`, organization_id: 'o1', organization_name: 'Andina', organization_kind: kind, is_partner: true,
  role, company_id: null, is_active,
});

describe('userModel', () => {
  it('toAdminUser tipa las listas JSONB y tolera nulos', () => {
    const u = toAdminUser(row({ organizations: null as never, sales_agent: null }));
    expect(u.organizations).toEqual([]);
    expect(u.salesAgent).toBeNull();
    expect(u.platformRoleActive).toBe(false);
  });

  it('clasifica EBIM, partners y clientes (un usuario puede estar en varias)', () => {
    const ebim = toAdminUser(row({ platform_role: 'EBIM_FINANCE', platform_role_active: true }));
    const operator = toAdminUser(row({ email: 'dcalagua@ebim.pe' }));
    const partner = toAdminUser(row({ organizations: [org('PARTNER_SALES')] }));
    const both = toAdminUser(row({ organizations: [org('PARTNER_ADMIN')], tenants: [{ id: 't', tenant_id: 't1', tenant_name: 'T', tenant_slug: 't', product_name: 'eSupplier', customer_organization_id: 'o2', role: 'TENANT_USER', is_active: true }] }));
    const agent = toAdminUser(row({ sales_agent: { id: 'a', code: 'carla', full_name: 'Carla', agent_type: 'INDEPENDENT', status: 'ACTIVE' } }));
    expect([...userCategories(ebim)]).toEqual(['EBIM']);
    expect([...userCategories(operator)]).toEqual(['EBIM']);
    expect([...userCategories(partner)]).toEqual(['PARTNER']);
    expect([...userCategories(both)].sort()).toEqual(['CUSTOMER', 'PARTNER']);
    expect([...userCategories(agent)]).toEqual(['PARTNER']);
    // Una membresía inactiva no clasifica.
    expect(userCategories(toAdminUser(row({ organizations: [org('ORG_ADMIN', 'COMPANY', false)] }))).size).toBe(0);
  });

  it('«Inactivos» agrupa a los desactivados, que salen de las demás pestañas', () => {
    const off = toAdminUser(row({ is_active: false, organizations: [org('ORG_ADMIN')] }));
    const on = toAdminUser(row({ id: 'u2', organizations: [org('ORG_ADMIN')] }));
    expect(matchesUserTab(off, 'INACTIVE')).toBe(true);
    expect(matchesUserTab(off, 'CUSTOMER')).toBe(false);
    expect(matchesUserTab(on, 'CUSTOMER')).toBe(true);
    const tabs = userTabs([off, on]);
    expect(tabs.map((t) => [t.label, t.count])).toEqual([
      ['Todos', 2], ['EBIM', 0], ['Partners', 0], ['Clientes', 1], ['Inactivos', 1],
    ]);
  });

  it('estado de la cuenta: desactivado, bloqueado, invitación pendiente o activo', () => {
    const base = (p: Partial<AdminUserRow>): AdminUser => toAdminUser(row(p));
    expect(accountStatus(base({ is_active: false })).label).toBe('Desactivado');
    expect(accountStatus(base({ banned: true })).label).toBe('Bloqueado en Auth');
    expect(accountStatus(base({ invited_at: '2026-10-01T00:00:00Z', email_confirmed_at: null as never, last_sign_in_at: null as never })).label)
      .toBe('Invitación pendiente');
    expect(accountStatus(base({})).label).toBe('Activo');
  });

  it('resume los accesos activos', () => {
    const u = toAdminUser(row({
      platform_role: 'EBIM_PRODUCT_ADMIN', platform_role_active: true, organizations: [org('ORG_VIEWER')],
      provisioning_roles: [{ id: 'p', role: 'TECH_LEAD', is_active: true, granted_at: '' }],
    }));
    expect(accessSummary(u)).toEqual(['Consola', 'Andina', 'Provisioning']);
  });

  it('S-01: el rol Super Admin nunca es asignable desde la consola', () => {
    expect(ASSIGNABLE_PLATFORM_ROLES).not.toContain('EBIM_SUPER_ADMIN');
  });

  it('roles de organización: EBIM según el tipo de organización; un admin, su familia y su nivel', () => {
    expect(assignableOrgRoles({ managePlatform: true, orgIsPartner: false })).toEqual(['ORG_ADMIN', 'ORG_VIEWER']);
    expect(assignableOrgRoles({ managePlatform: true, orgIsPartner: true })).toHaveLength(5);
    expect(assignableOrgRoles({ managePlatform: false, orgIsPartner: true, callerRole: 'PARTNER_ADMIN' }))
      .toEqual(['PARTNER_ADMIN', 'PARTNER_SALES', 'PARTNER_SUPPORT']);
    expect(assignableOrgRoles({ managePlatform: false, orgIsPartner: false, callerRole: 'ORG_ADMIN' }))
      .toEqual(['ORG_ADMIN', 'ORG_VIEWER']);
    expect(assignableOrgRoles({ managePlatform: false, orgIsPartner: true, callerRole: 'PARTNER_SALES' })).toEqual([]);
  });
});
