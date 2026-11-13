import { describe, expect, it } from 'vitest';
import type { ProvisioningRow, TenantRow } from '@/features/suite/suiteModel';
import {
  accountSummary,
  buildAccountRows,
  channelLabel,
  matchesAccountFilter,
  sortAccounts,
  type OrganizationLike,
} from './accountListModel';

const org = (id: string, name: string, status = 'ACTIVE'): OrganizationLike => ({
  id,
  display_name: name,
  legal_name: `${name} S.A.C.`,
  country_code: 'PE',
  tax_id: '20500000001',
  status,
  kind: 'CUSTOMER',
  organization_capabilities: [{ capability: 'CUSTOMER' }],
});

const tenant = (p: Partial<TenantRow>): TenantRow =>
  ({
    tenant_id: 't',
    name: 'T',
    status: 'ACTIVE',
    customer_organization_id: 'a',
    managing_organization_id: null,
    managing_name: null,
    saas_product_id: 'p-ewm',
    product_short_name: 'EWM',
    mrr: null,
    currency: null,
    ...p,
  }) as TenantRow;

const request = (p: Partial<ProvisioningRow>): ProvisioningRow =>
  ({ tenant_id: 't', saas_product_id: 'p-ewm', status: 'ACTIVE', requested_at: '2026-10-01T00:00:00Z', ...p }) as ProvisioningRow;

const ORGS = [org('a', 'Andina'), org('b', 'Bolivar'), org('c', 'Cerrada', 'INACTIVE')];
const TENANTS = [
  tenant({ tenant_id: 't1', customer_organization_id: 'a', saas_product_id: 'p-ewm', product_short_name: 'EWM', mrr: 1200, currency: 'USD' }),
  tenant({ tenant_id: 't2', customer_organization_id: 'a', saas_product_id: 'p-ech', product_short_name: 'eChange', mrr: 300, currency: 'PEN' }),
  tenant({
    tenant_id: 't3', customer_organization_id: 'b', saas_product_id: 'p-ewm', product_short_name: 'EWM', mrr: 500, currency: 'USD',
    managing_organization_id: 'a', managing_name: 'Andina',
  }),
];
const REQUESTS = [request({ tenant_id: 't1', saas_product_id: 'p-ewm', status: 'ACTIVE' }), request({ tenant_id: 't2', saas_product_id: 'p-ech', status: 'FAILED' })];

describe('accountListModel (V6 · F1)', () => {
  const rows = buildAccountRows({
    organizations: ORGS,
    tenants: TENANTS,
    requests: REQUESTS,
    overdueInvoices: [
      { customer_organization_id: 'b', currency: 'USD', balance: 400, days_overdue: 12 },
      { customer_organization_id: 'b', currency: 'USD', balance: '100.5', days_overdue: 45 },
    ],
    renewals: [
      { billed_organization_id: 'a', is_past_due: false, suspension_pending: false },
      { billed_organization_id: 'b', is_past_due: true, suspension_pending: true },
    ],
    attributions: [
      {
        customer_organization_id: 'a', attribution_pct: 100, status: 'ACTIVE', valid_from: '2026-01-01', valid_to: null,
        sales_agents: { full_name: 'Beto' },
      },
    ],
    today: '2026-11-13',
  });
  const [a, b, c] = rows;

  it('apps con el estado del Centro de la suite, lo que pide atención primero', () => {
    expect(a!.apps.map((x) => `${x.name}:${x.kind}`)).toEqual(['eChange:FAILED', 'EWM:ACTIVE']);
    expect(b!.apps.map((x) => x.kind)).toEqual(['ACTIVE_NO_APP']);
    expect(c!.apps).toEqual([]);
  });

  it('MRR y vencido por moneda, nunca sumados entre monedas; días de la factura más antigua', () => {
    expect(a!.mrr).toEqual({ USD: 1200, PEN: 300 });
    expect(b!.overdue).toEqual({ USD: 500.5 });
    expect(b!.overdueInvoices).toBe(2);
    expect(b!.oldestOverdueDays).toBe(45);
    expect(a!.overdueInvoices).toBe(0);
  });

  it('salud de cobranza, canal y responsable', () => {
    expect(a!.health).toBe('OK');
    expect(b!.health).toBe('SUSPENSION');
    expect(c!.health).toBe('NO_CONTRACTS');
    expect(channelLabel(b!)).toEqual({ label: 'Vía Andina' });
    expect(channelLabel(a!)).toEqual({ label: 'Directo' });
    expect(a!.managedTenants).toBe(1);
    expect(a!.owner?.name).toBe('Beto');
    expect(b!.owner).toBeNull();
  });

  it('sin vista financiera no afirma ninguna salud de cobranza', () => {
    const [x] = buildAccountRows({ organizations: [ORGS[0]!], tenants: TENANTS });
    expect(x!.health).toBeNull();
  });

  it('filtros de las pestañas y resumen de la franja', () => {
    expect(rows.filter((r) => matchesAccountFilter(r, 'DEBT')).map((r) => r.id)).toEqual(['b']);
    expect(rows.filter((r) => matchesAccountFilter(r, 'SUSPENSION')).map((r) => r.id)).toEqual(['b']);
    expect(rows.filter((r) => matchesAccountFilter(r, 'APPS_PENDING')).map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows.filter((r) => matchesAccountFilter(r, 'NO_ACTIVE_APPS')).map((r) => r.id)).toEqual(['b']);
    expect(rows.filter((r) => matchesAccountFilter(r, 'INACTIVE')).map((r) => r.id)).toEqual(['c']);
    const s = accountSummary(rows);
    expect(s).toMatchObject({ total: 3, active: 2, withDebt: 1, suspension: 1, appsPending: 2, overdueInvoices: 2 });
    expect(s.mrr).toEqual({ USD: 1700, PEN: 300 });
  });

  it('orden por MRR o vencido (mayor importe nativo), con desempate por nombre', () => {
    expect(sortAccounts(rows, 'mrr', 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortAccounts(rows, 'overdue', 'desc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortAccounts(rows, 'name', 'desc').map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});
