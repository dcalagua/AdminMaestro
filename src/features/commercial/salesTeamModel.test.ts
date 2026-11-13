import { describe, expect, it } from 'vitest';
import { agentCommissions, agentPortfolios } from './salesTeamModel';

describe('salesTeamModel', () => {
  it('cartera vigente y MRR atribuido por participación, por moneda', () => {
    const map = agentPortfolios(
      [
        { sales_agent_id: 'beto', status: 'ACTIVE', customer_organization_id: 'c1', saas_product_id: 'ewm', attribution_pct: 0.5, saas_products: { short_name: 'EWM' } },
        { sales_agent_id: 'beto', status: 'ACTIVE', customer_organization_id: 'c2', saas_product_id: 'tms', tenant_id: 't3', attribution_pct: 1, saas_products: { short_name: 'TMS' } },
        { sales_agent_id: 'beto', status: 'INACTIVE', customer_organization_id: 'c9', saas_product_id: 'ewm', attribution_pct: 1 },
      ],
      [
        { tenant_id: 't1', customer_organization_id: 'c1', saas_product_id: 'ewm', status: 'ACTIVE', mrr: 1000, currency: 'USD' },
        { tenant_id: 't2', customer_organization_id: 'c1', saas_product_id: 'ewm', status: 'SUSPENDED', mrr: 500, currency: 'USD' },
        { tenant_id: 't3', customer_organization_id: 'c2', saas_product_id: 'tms', status: 'ACTIVE', mrr: 300, currency: 'PEN' },
        { tenant_id: 't4', customer_organization_id: 'c2', saas_product_id: 'tms', status: 'ACTIVE', mrr: 999, currency: 'PEN' },
        { tenant_id: 't5', customer_organization_id: 'c9', saas_product_id: 'ewm', status: 'ACTIVE', mrr: 700, currency: 'USD' },
      ],
    );
    expect(map.get('beto')).toEqual({ attributions: 2, customers: 2, products: ['EWM', 'TMS'], mrr: { USD: 500, PEN: 300 } });
  });

  it('comisión por liquidar (elegible o devengada) y pagada; pendientes y anuladas no cuentan', () => {
    const map = agentCommissions([
      { sales_agent_id: 'beto', status: 'ACCRUED', amount: 100, currency: 'USD' },
      { sales_agent_id: 'beto', status: 'ELIGIBLE', amount: 50, currency: 'USD' },
      { sales_agent_id: 'beto', status: 'PAID', amount: 80, currency: 'PEN' },
      { sales_agent_id: 'beto', status: 'PENDING', amount: 999, currency: 'USD' },
      { sales_agent_id: 'beto', status: 'VOID', amount: 999, currency: 'USD' },
    ]);
    expect(map.get('beto')).toEqual({ pending: { USD: 150 }, paid: { PEN: 80 } });
  });
});
