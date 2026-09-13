import { describe, it, expect } from 'vitest';
import { sumByCurrency, formatCurrencyMap, formatMoney } from './format';
import { toMarketOptions, isCurrencyAllowed, resolveRegionalPrice, type MarketRow } from './regional';
import { metricDisplay, marginDisplay } from './consolidated';
import type { ConsolidatedGroup } from '@/types/domain';

/**
 * Regresiones de dominio multicurrency del lado cliente (fase 15).
 *
 * Mismos nombres que `supabase/tests/15_v3_domain_regressions.test.sql` para las
 * reglas que también tienen reflejo en la UI. La autoridad es la base; esto
 * garantiza que la pantalla no reintroduzca el error al presentar.
 */

const markets = toMarketOptions([
  { id: 'pe', code: 'PE', name: 'Perú', country_code: 'PE', default_currency_code: 'PEN', status: 'ACTIVE', sort_order: 10,
    market_currencies: [{ currency_code: 'PEN', status: 'ACTIVE' }, { currency_code: 'USD', status: 'ACTIVE' }] },
  { id: 'bo', code: 'BO', name: 'Bolivia', country_code: 'BO', default_currency_code: 'BOB', status: 'ACTIVE', sort_order: 20,
    market_currencies: [{ currency_code: 'BOB', status: 'ACTIVE' }, { currency_code: 'USD', status: 'ACTIVE' }] },
  { id: 'ec', code: 'EC', name: 'Ecuador', country_code: 'EC', default_currency_code: 'USD', status: 'ACTIVE', sort_order: 30,
    market_currencies: [{ currency_code: 'USD', status: 'ACTIVE' }] },
] as MarketRow[]);

describe('regresiones de dominio multicurrency (UI)', () => {
  it('PEN + USD no se suma directamente', () => {
    const totals = sumByCurrency([{ a: 5000, c: 'PEN' }, { a: 250, c: 'USD' }], (r) => r.a, (r) => r.c);
    expect(totals).toEqual({ PEN: 5000, USD: 250 });
    expect(formatCurrencyMap(totals)).not.toContain('5,250');
  });

  it('BOB + USD no se suma directamente', () => {
    const totals = sumByCurrency([{ a: 890, c: 'BOB' }, { a: 480, c: 'USD' }], (r) => r.a, (r) => r.c);
    expect(totals).toEqual({ BOB: 890, USD: 480 });
    expect(formatCurrencyMap(totals)).not.toContain('1,370');
  });

  it('PE/USD price puede diferir de EC/USD', () => {
    const prices = [
      { plan_id: 'p', market_code: 'PE', charge_kind: 'LICENSE', billing_interval: 'MONTHLY', amount: 850, currency: 'USD', valid_from: '2026-01-01', valid_to: null },
      { plan_id: 'p', market_code: 'EC', charge_kind: 'LICENSE', billing_interval: 'MONTHLY', amount: 700, currency: 'USD', valid_from: '2026-01-01', valid_to: null },
    ];
    const q = { planId: 'p', currency: 'USD', billingInterval: 'MONTHLY', chargeKinds: ['LICENSE'], asOf: '2026-09-13' };
    expect(resolveRegionalPrice(prices, { ...q, marketCode: 'PE' })).toBe(850);
    expect(resolveRegionalPrice(prices, { ...q, marketCode: 'EC' })).toBe(700);
  });

  it('currency no permitida por market -> DENIED (no se ofrece)', () => {
    expect(isCurrencyAllowed(markets, 'EC', 'PEN')).toBe(false);
    expect(isCurrencyAllowed(markets, 'BO', 'PEN')).toBe(false);
  });

  it('FX faltante -> no conversion inventada', () => {
    const group: ConsolidatedGroup = {
      key: 'TOTAL', label: 'Total',
      metrics: { COLLECTED: { native: { BOB: 5900 }, reporting_amount: null, complete: false, missing_currencies: ['BOB'] } },
      native_margin: { BOB: 5900 },
      margin: { reporting_amount: null, complete: false },
    };
    expect(metricDisplay(group, 'COLLECTED', 'CONSOLIDATED', 'USD').value).toBe('Incompleto');
    expect(marginDisplay(group, 'CONSOLIDATED', 'USD').value).toBe('No calculable');
    expect(metricDisplay(group, 'COLLECTED', 'CONSOLIDATED', 'USD').value).not.toMatch(/USD\s0/);
  });

  it('native amount no cambia tras reporting conversion (la UI pinta el nativo tal cual)', () => {
    const group: ConsolidatedGroup = {
      key: 'TOTAL', label: 'Total',
      metrics: { COLLECTED: { native: { PEN: 5000 }, reporting_amount: 1428.57, complete: true, missing_currencies: [] } },
      native_margin: { PEN: 5000 },
      margin: { reporting_amount: 1428.57, complete: true },
    };
    expect(metricDisplay(group, 'COLLECTED', 'NATIVE', 'USD').value).toMatch(/^PEN\s5,000\.00$/);
    expect(metricDisplay(group, 'COLLECTED', 'CONSOLIDATED', 'USD').hint).toContain('PEN');
  });

  it('un importe sin moneda nunca se presenta como USD', () => {
    expect(formatMoney(5000, null)).not.toContain('USD');
  });
});
