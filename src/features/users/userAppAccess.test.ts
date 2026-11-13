import { describe, expect, it } from 'vitest';
import type { ProvisioningRow, TenantRow } from '@/features/suite/suiteModel';
import type { TenantMembershipItem } from './userModel';
import { APP_USER_CHANNEL_AVAILABLE, appChipText, tenantState, userAppAccess } from './userAppAccess';

/* V5 · F6 · Apps y accesos de un usuario a partir de membresías, tenants y altas. */

const EWM = 'p-ewm';
const SUP = 'p-sup';
const ALPHA = 'org-alpha';

function membership(p: Partial<TenantMembershipItem>): TenantMembershipItem {
  return {
    id: 'tm', tenant_id: 't1', tenant_name: 'Alpha EWM', tenant_slug: 'alpha-ewm', product_name: 'EWM',
    customer_organization_id: ALPHA, role: 'TENANT_USER', is_active: true, ...p,
  };
}

const tenants = [
  { tenant_id: 't1', name: 'Alpha EWM', saas_product_id: EWM, product_short_name: 'EWM', product_code: 'ewm', status: 'ACTIVE', customer_name: 'Empresa Alpha', customer_organization_id: ALPHA },
  { tenant_id: 't2', name: 'Alpha EWM 2', saas_product_id: EWM, product_short_name: 'EWM', product_code: 'ewm', status: 'SUSPENDED', customer_name: 'Empresa Alpha', customer_organization_id: ALPHA },
  { tenant_id: 't3', name: 'Alpha eSupplier', saas_product_id: SUP, product_short_name: 'eSupplier', product_code: 'esupplier', status: 'PENDING', customer_name: 'Empresa Alpha', customer_organization_id: ALPHA },
] as unknown as TenantRow[];

describe('userAppAccess', () => {
  it('agrupa las membresías por app, con el rol más alto entre las activas', () => {
    const apps = userAppAccess(
      {
        organizations: [],
        tenants: [
          membership({ id: 'a', tenant_id: 't1', role: 'TENANT_USER' }),
          membership({ id: 'b', tenant_id: 't2', role: 'TENANT_ADMIN', tenant_name: 'Alpha EWM 2' }),
          membership({ id: 'c', tenant_id: 't3', product_name: 'eSupplier', tenant_name: 'Alpha eSupplier' }),
        ],
      },
      { tenants },
    );
    expect(apps.map((a) => [a.appName, a.roleLabel, a.tenants.length])).toEqual([
      ['eSupplier', 'Usuario', 1],
      ['EWM', 'Admin', 2],
    ]);
    // El tenant suspendido es lo que más atención pide en EWM.
    expect(apps[1]!.attention).toMatchObject({ label: 'Suspendido', tone: 'danger' });
    expect(appChipText(apps[1]!)).toBe('EWM · Admin · Suspendido');
    expect(apps[1]!.appCode).toBe('ewm');
  });

  it('una membresía desactivada no cuenta como acceso y va al final', () => {
    const apps = userAppAccess(
      { organizations: [], tenants: [membership({ is_active: false }), membership({ id: 'c', tenant_id: 't3', product_name: 'eSupplier' })] },
      { tenants },
    );
    expect(apps.map((a) => [a.appName, a.active, a.roleLabel])).toEqual([
      ['eSupplier', true, 'Usuario'],
      ['EWM', false, 'Sin acceso activo'],
    ]);
  });

  it('sin el tenant visible usa el nombre de la membresía y no inventa el estado', () => {
    const [app] = userAppAccess({ organizations: [], tenants: [membership({ tenant_id: 'otro' })] }, { tenants });
    expect(app).toMatchObject({ appName: 'EWM', appId: null, appCode: null, attention: null });
    expect(app!.tenants[0]!.state).toBeNull();
  });

  it('con las altas visibles usa el estado combinado de la suite', () => {
    const requests = [
      { tenant_id: 't3', saas_product_id: SUP, status: 'ACTIVE', requested_at: '2026-10-01T00:00:00Z' },
    ] as unknown as ProvisioningRow[];
    const [app] = userAppAccess(
      { organizations: [], tenants: [membership({ tenant_id: 't3', product_name: 'eSupplier' })] },
      { tenants, requests },
    );
    expect(app!.tenants[0]!.state).toMatchObject({ label: 'Por confirmar', tone: 'warn' });
    expect(tenantState({ status: 'ACTIVE' }, null, false)).toMatchObject({ label: 'Activo', tone: 'ok' });
  });

  it('marca si además administra la cuenta dueña; ser miembro de la cuenta no crea apps', () => {
    const orgs = [
      { id: 'o', organization_id: ALPHA, organization_name: 'Empresa Alpha', organization_kind: 'COMPANY' as const, is_partner: false, role: 'ORG_ADMIN' as const, company_id: null, is_active: true },
    ];
    expect(userAppAccess({ organizations: orgs, tenants: [] }, { tenants })).toEqual([]);
    const [app] = userAppAccess({ organizations: orgs, tenants: [membership({})] }, { tenants });
    expect(app!.tenants[0]!.managesAccount).toBe(true);
  });

  it('el canal de usuarios por app todavía no existe', () => {
    expect(APP_USER_CHANNEL_AVAILABLE).toBe(false);
  });
});
