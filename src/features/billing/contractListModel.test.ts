import { describe, expect, it } from 'vitest';
import { buildContractRows, contractSummary, matchesContract, sortContracts, type SubscriptionLike } from './contractListModel';

const TODAY = new Date(2026, 10, 13);

const sub = (over: Partial<SubscriptionLike>): SubscriptionLike => ({
  id: 's-1',
  code: 'SUB-1',
  status: 'ACTIVE',
  started_on: '2026-01-01',
  tenant_id: 't-1',
  billed_organization_id: 'o-1',
  plans: { name: 'Shared Standard' },
  saas_products: { short_name: 'eSupplier' },
  organizations: { display_name: 'Alpha' },
  tenants: { name: 'Alpha eSupplier', deployment_mode: 'SHARED' },
  subscription_items: [
    { amount: 1200, currency: 'USD', billing_interval: 'MONTHLY' },
    { amount: 3500, currency: 'USD', billing_interval: 'ONE_TIME' },
  ],
  ...over,
});

describe('listado de contratos', () => {
  it('separa recurrente al mes y cargos únicos; renovación del pipeline y método de cobro', () => {
    const [row] = buildContractRows(
      [sub({})],
      [{ subscription_id: 's-1', renewal_on: '2026-11-21', days_to_renewal: 8 }],
      [{ subscription_id: 's-1', collection_method: 'CULQI_CARD', profile_missing: false }],
      TODAY,
    );
    expect(row).toMatchObject({
      plan: 'Shared Standard',
      app: 'eSupplier',
      customer: 'Alpha',
      tenant: 'Alpha eSupplier',
      monthly: { USD: 1200 },
      oneTime: { USD: 3500 },
      oneTimeCount: 1,
      renewalOn: '2026-11-21',
      daysToRenewal: 8,
      method: 'CULQI_CARD',
      methodMissing: false,
    });
  });

  it('sin tenant es nivel partner; sin perfil de cobro se marca; sin pipeline usa el fin de vigencia', () => {
    const [row] = buildContractRows([sub({ tenant_id: null, ends_on: '2026-12-13' })], [], [], TODAY);
    expect(row).toMatchObject({ tenant: null, method: null, methodMissing: true, renewalOn: '2026-12-13', daysToRenewal: 30 });
  });

  it('la franja: activos, atrasados, borradores, renuevan en 30 días y recurrente vivo por moneda sin sumar monedas', () => {
    const rows = buildContractRows(
      [
        sub({}),
        sub({ id: 's-2', code: 'SUB-2', status: 'PAST_DUE', subscription_items: [{ amount: 300, currency: 'PEN', billing_interval: 'QUARTERLY' }] }),
        sub({ id: 's-3', code: 'SUB-3', status: 'DRAFT' }),
        sub({ id: 's-4', code: 'SUB-4', status: 'CANCELLED' }),
      ],
      [
        { subscription_id: 's-1', renewal_on: '2026-11-21', days_to_renewal: 8 },
        { subscription_id: 's-2', renewal_on: '2027-02-01', days_to_renewal: 80 },
      ],
      [],
      TODAY,
    );
    expect(contractSummary(rows)).toEqual({
      total: 4,
      active: 1,
      pastDue: 1,
      drafts: 1,
      renewing: 1,
      liveMonthly: { USD: 1200, PEN: 100 },
    });
    expect(rows.filter((r) => matchesContract(r, 'RENEWING')).map((r) => r.id)).toEqual(['s-1']);
  });

  it('ordena por recurrente y por renovación (sin fecha al final)', () => {
    const rows = buildContractRows(
      [
        sub({ id: 'a', code: 'A', subscription_items: [{ amount: 10, currency: 'USD' }] }),
        sub({ id: 'b', code: 'B', subscription_items: [{ amount: 900, currency: 'USD' }] }),
        sub({ id: 'c', code: 'C', subscription_items: [] }),
      ],
      [
        { subscription_id: 'a', renewal_on: '2026-12-01', days_to_renewal: 18 },
        { subscription_id: 'b', renewal_on: '2026-11-20', days_to_renewal: 7 },
      ],
      [],
      TODAY,
    );
    expect(sortContracts(rows, 'monthly', 'desc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortContracts(rows, 'renewal', 'asc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });
});
