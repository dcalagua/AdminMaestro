import { describe, it, expect } from 'vitest';
import {
  toMarketOptions, allowedCurrenciesFor, isCurrencyAllowed, currencyForMarket,
  suggestedMarketForCountry, resolveRegionalPrice, planHasRegionalPrice,
  type MarketRow, type RegionalPriceRow,
} from './regional';

const MARKET_ROWS: MarketRow[] = [
  {
    id: 'm-ec', code: 'EC', name: 'Ecuador', country_code: 'EC', default_currency_code: 'USD',
    status: 'ACTIVE', sort_order: 30,
    market_currencies: [{ currency_code: 'USD', status: 'ACTIVE', currencies: { status: 'ACTIVE' } }],
  },
  {
    id: 'm-pe', code: 'PE', name: 'Perú', country_code: 'PE', default_currency_code: 'PEN',
    status: 'ACTIVE', sort_order: 10,
    market_currencies: [
      { currency_code: 'USD', status: 'ACTIVE', currencies: { status: 'ACTIVE' } },
      { currency_code: 'PEN', status: 'ACTIVE', currencies: { status: 'ACTIVE' } },
    ],
  },
  {
    id: 'm-bo', code: 'BO', name: 'Bolivia', country_code: 'BO', default_currency_code: 'BOB',
    status: 'ACTIVE', sort_order: 20,
    market_currencies: [
      { currency_code: 'BOB', status: 'ACTIVE', currencies: { status: 'ACTIVE' } },
      { currency_code: 'USD', status: 'ACTIVE', currencies: { status: 'ACTIVE' } },
      // Retirada del mercado: no se ofrece aunque la moneda exista.
      { currency_code: 'EUR', status: 'INACTIVE', currencies: { status: 'ACTIVE' } },
    ],
  },
  {
    id: 'm-xx', code: 'XX', name: 'Cerrado', country_code: 'PE', default_currency_code: 'USD',
    status: 'INACTIVE', sort_order: 99,
    market_currencies: [{ currency_code: 'USD', status: 'ACTIVE', currencies: { status: 'ACTIVE' } }],
  },
];

const markets = toMarketOptions(MARKET_ROWS);

describe('catálogo de mercados', () => {
  it('lista solo mercados activos, en el orden del catálogo', () => {
    expect(markets.map((m) => m.code)).toEqual(['PE', 'BO', 'EC']);
  });

  it('pone la moneda sugerida primero y omite las retiradas', () => {
    expect(allowedCurrenciesFor(markets, 'PE')).toEqual(['PEN', 'USD']);
    expect(allowedCurrenciesFor(markets, 'BO')).toEqual(['BOB', 'USD']);
    expect(allowedCurrenciesFor(markets, 'EC')).toEqual(['USD']);
  });

  it('PEN no está permitida en Bolivia ni en Ecuador', () => {
    expect(isCurrencyAllowed(markets, 'PE', 'PEN')).toBe(true);
    expect(isCurrencyAllowed(markets, 'BO', 'PEN')).toBe(false);
    expect(isCurrencyAllowed(markets, 'EC', 'PEN')).toBe(false);
    expect(isCurrencyAllowed(markets, 'BO', 'EUR')).toBe(false);
  });

  it('sin mercado no hay moneda por defecto global (nada de USD implícito)', () => {
    expect(currencyForMarket(markets, '', 'USD')).toBe('');
    expect(allowedCurrenciesFor(markets, undefined)).toEqual([]);
  });

  it('al elegir mercado sugiere su moneda, y conserva la actual solo si está admitida', () => {
    expect(currencyForMarket(markets, 'BO', '')).toBe('BOB');
    expect(currencyForMarket(markets, 'BO', 'USD')).toBe('USD');
    expect(currencyForMarket(markets, 'BO', 'PEN')).toBe('BOB');
    expect(currencyForMarket(markets, 'EC', 'PEN')).toBe('USD');
  });

  it('sugiere mercado por país solo cuando hay un único mercado activo', () => {
    expect(suggestedMarketForCountry(markets, 'BO')).toBe('BO');
    // El mercado XX (también PE) está inactivo: no genera ambigüedad.
    expect(suggestedMarketForCountry(markets, 'PE')).toBe('PE');
    expect(suggestedMarketForCountry(markets, 'CL')).toBe('');
    expect(suggestedMarketForCountry(toMarketOptions([
      ...MARKET_ROWS, { ...MARKET_ROWS[0], id: 'm-ec2', code: 'EC_NORTE', status: 'ACTIVE' },
    ]), 'EC')).toBe('');
  });
});

describe('tarifa regional', () => {
  const PLAN = 'plan-shared';
  const row = (over: Partial<RegionalPriceRow>): RegionalPriceRow => ({
    plan_id: PLAN, market_code: 'PE', charge_kind: 'LICENSE', billing_interval: 'MONTHLY',
    amount: 850, currency: 'USD', valid_from: '2026-01-01', valid_to: null, ...over,
  });

  const prices: RegionalPriceRow[] = [
    row({}),
    row({ market_code: 'EC', amount: '700.00' }),
    row({ market_code: 'PE', currency: 'PEN', amount: 3200 }),
    // Tarifa PE/USD anterior, ya cerrada.
    row({ amount: 800, valid_from: '2025-01-01', valid_to: '2025-12-31' }),
    // Tarifa PE/USD programada a futuro.
    row({ amount: 900, valid_from: '2026-12-01' }),
    // Legacy sin mercado: nunca debe resolverse.
    row({ market_code: null, currency: 'BOB', amount: 1 }),
    row({ market_code: 'BO', charge_kind: 'TENANT_LICENSE', currency: 'BOB', amount: 5900 }),
  ];

  const q = { planId: PLAN, billingInterval: 'MONTHLY', chargeKinds: ['LICENSE', 'TENANT_LICENSE'], asOf: '2026-09-13' };

  it('PE/USD y EC/USD pueden tener precios distintos', () => {
    expect(resolveRegionalPrice(prices, { ...q, marketCode: 'PE', currency: 'USD' })).toBe(850);
    expect(resolveRegionalPrice(prices, { ...q, marketCode: 'EC', currency: 'USD' })).toBe(700);
  });

  it('no toma el precio de otro mercado aunque la moneda coincida', () => {
    expect(resolveRegionalPrice(prices, { ...q, marketCode: 'BO', currency: 'USD' })).toBeNull();
  });

  it('respeta la vigencia: ni la cerrada ni la programada', () => {
    expect(resolveRegionalPrice(prices, { ...q, marketCode: 'PE', currency: 'USD', asOf: '2025-06-01' })).toBe(800);
    expect(resolveRegionalPrice(prices, { ...q, marketCode: 'PE', currency: 'USD', asOf: '2026-12-01' })).toBe(900);
  });

  it('usa TENANT_LICENSE si no hay LICENSE, como el coalesce de la base', () => {
    expect(resolveRegionalPrice(prices, { ...q, marketCode: 'BO', currency: 'BOB' })).toBe(5900);
  });

  it('una tarifa legacy sin mercado nunca se usa para vender', () => {
    expect(planHasRegionalPrice(prices, PLAN, 'BO', 'BOB', '2026-09-13')).toBe(true);
    expect(planHasRegionalPrice([row({ market_code: null })], PLAN, 'PE', 'USD', '2026-09-13')).toBe(false);
  });

  it('sin mercado o sin moneda no resuelve nada', () => {
    expect(resolveRegionalPrice(prices, { ...q, marketCode: '', currency: 'USD' })).toBeNull();
    expect(resolveRegionalPrice(prices, { ...q, marketCode: 'PE', currency: '' })).toBeNull();
  });
});
