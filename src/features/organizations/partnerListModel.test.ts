import { describe, expect, it } from 'vitest';
import { buildPartnerRows, latestFeePeriod, partnerSummary } from './partnerListModel';

const org = (id: string, caps: string[], status = 'ACTIVE') => ({
  id,
  display_name: id,
  status,
  organization_capabilities: caps.map((capability) => ({ capability })),
});

describe('partnerListModel', () => {
  const rows = buildPartnerRows({
    organizations: [org('andina', ['PARTNER', 'CUSTOMER']), org('sur', ['RESELLER'], 'INACTIVE'), org('cli', ['CUSTOMER'])],
    tenants: [
      { managing_organization_id: 'andina', customer_organization_id: 'a', saas_product_id: 'p1', product_short_name: 'EWM', status: 'ACTIVE', mrr: 500, currency: 'USD' },
      { managing_organization_id: 'andina', customer_organization_id: 'a', saas_product_id: 'p2', product_short_name: 'TMS', status: 'ACTIVE', mrr: 300, currency: 'PEN' },
      { managing_organization_id: 'andina', customer_organization_id: 'b', saas_product_id: 'p1', product_short_name: 'EWM', status: 'SUSPENDED', mrr: 900, currency: 'USD' },
      { managing_organization_id: 'sur', customer_organization_id: 'c', saas_product_id: 'p1', product_short_name: 'EWM', status: 'ACTIVE', mrr: 100, currency: 'USD' },
    ],
    finance: [{ organization_id: 'andina', weighted_channel_margin_rate: '0.25', active_agreements: 2 }],
    statements: [
      { partner_organization_id: 'andina', period_start: '2026-10-01', currency: 'USD', fee_total: 50, status: 'ISSUED' },
      { partner_organization_id: 'andina', period_start: '2026-09-01', currency: 'USD', fee_total: 40, status: 'ISSUED' },
      { partner_organization_id: 'andina', period_start: '2026-10-01', currency: 'USD', fee_total: 70, status: 'VOID' },
    ],
  });

  it('solo organizaciones de canal, con su cartera administrada', () => {
    expect(rows.map((r) => r.id)).toEqual(['andina', 'sur']);
    const andina = rows[0]!;
    expect(andina.customers).toBe(2);
    expect(andina.tenants).toBe(3);
    expect(andina.activeTenants).toBe(2);
    expect(andina.apps).toEqual([
      { productId: 'p1', name: 'EWM', tenants: 2 },
      { productId: 'p2', name: 'TMS', tenants: 1 },
    ]);
  });

  it('MRR por moneda solo de tenants activos; margen y tarifa del último período sin anuladas', () => {
    const andina = rows[0]!;
    expect(andina.mrr).toEqual({ USD: 500, PEN: 300 });
    expect(andina.marginRate).toBe(0.25);
    expect(andina.fee).toEqual({ USD: 50 });
    expect(rows[1]!.marginRate).toBeNull();
    expect(latestFeePeriod([{ period_start: '2026-09-01' }, { period_start: '2026-10-01' }])).toBe('2026-10-01');
  });

  it('el resumen nunca suma monedas distintas', () => {
    const s = partnerSummary(rows);
    expect(s).toMatchObject({ total: 2, active: 1, customers: 3, tenants: 4, averageMargin: 0.25 });
    expect(s.mrr).toEqual({ USD: 600, PEN: 300 });
  });
});
