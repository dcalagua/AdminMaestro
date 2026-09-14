import { describe, it, expect } from 'vitest';
import { formatMinorUnits, toMinorUnits } from './money';
import { providerPlanIdentity, providerPlanRpcArgs } from './provider-plan';
import { toCulqiAmount } from './culqi-mapping';

/*
 * V3.2 · Una sola conversión importe → unidades mínimas, sin redondeo
 * silencioso, y la identidad del Plan del proveedor construida sobre ella.
 */
describe('toMinorUnits', () => {
  it.each([
    [1250, 125000],
    ['1250.00', 125000],
    [1250.5, 125050],
    ['970.50', 97050],
    [0.01, 1],
    ['999999999999.99', 99999999999999],
    ['-15.25', -1525],
  ])('%s → %s céntimos', (amount, minor) => {
    expect(toMinorUnits(amount)).toBe(minor);
  });

  it('cada importe de numeric(14,2) entre 0.00 y 20.00 es exacto, sin error binario', () => {
    for (let cents = 0; cents <= 2000; cents++) {
      const asNumber = Number(`${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`);
      expect(toMinorUnits(asNumber)).toBe(cents);
    }
  });

  it('acepta ceros de relleno más allá de la escala', () => {
    expect(toMinorUnits('12.3400')).toBe(1234);
  });

  it.each([
    ['12.345'],
    [12.345],
    [0.1 + 0.2],
    ['1e3'],
    ['abc'],
    [''],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    ['99999999999999999999'],
  ])('rechaza %s en vez de redondearlo', (amount) => {
    expect(() => toMinorUnits(amount)).toThrow(/IMPORTE_NO_REPRESENTABLE/);
  });
});

describe('formatMinorUnits', () => {
  it.each([
    [125000, '1250.00'],
    [97050, '970.50'],
    [1, '0.01'],
    [0, '0.00'],
    [-1525, '-15.25'],
  ])('%s → %s', (minor, text) => {
    expect(formatMinorUnits(minor)).toBe(text);
    expect(toMinorUnits(text)).toBe(minor);
  });

  it('rechaza fracciones de céntimo', () => {
    expect(() => formatMinorUnits(12.5)).toThrow(/IMPORTE_NO_REPRESENTABLE/);
  });
});

describe('importe hacia Culqi', () => {
  it('USD 1250.00, PEN 1250.00 y BOB 1250.00 son 125000 unidades mínimas', () => {
    // Culqi trabaja en céntimos; las tres monedas tienen 2 decimales.
    expect(toCulqiAmount('1250.00')).toBe(125000);
    expect(toCulqiAmount(1250)).toBe(125000);
  });

  it('usa la misma conversión que la identidad del Plan del proveedor', () => {
    const identity = providerPlanIdentity({
      providerAccountId: 'acc', planId: 'plan', billingInterval: 'MONTHLY', currency: 'USD',
      amountMinor: toMinorUnits('875.00'),
    });
    expect(toCulqiAmount(providerPlanRpcArgs(identity).p_amount)).toBe(identity.amountMinor);
  });
});

describe('identidad del Plan del proveedor', () => {
  const base = {
    providerAccountId: '11111111-1111-4111-8111-111111111111',
    planId: '60000000-0000-4000-a000-000000000001',
    billingInterval: 'MONTHLY',
    currency: 'USD',
    amountMinor: 100000,
  };

  it('el importe viaja como decimal exacto hacia numeric, nunca como float', () => {
    expect(providerPlanRpcArgs(providerPlanIdentity(base))).toEqual({
      p_provider_account_id: base.providerAccountId,
      p_plan_id: base.planId,
      p_billing_interval: 'MONTHLY',
      p_currency: 'USD',
      p_amount: '1000.00',
    });
    expect(providerPlanRpcArgs(providerPlanIdentity({ ...base, amountMinor: 87550 })).p_amount).toBe('875.50');
  });

  it('1000 y 1250 del mismo plan son identidades distintas', () => {
    const a = providerPlanRpcArgs(providerPlanIdentity(base));
    const b = providerPlanRpcArgs(providerPlanIdentity({ ...base, amountMinor: 125000 }));
    expect({ ...a, p_amount: undefined }).toEqual({ ...b, p_amount: undefined });
    expect(a.p_amount).not.toBe(b.p_amount);
  });

  it.each([
    [{ billingInterval: 'ONE_TIME' }, /INTERVALO_NO_RECURRENTE/],
    [{ currency: 'usd' }, /MONEDA_INVALIDA/],
    [{ amountMinor: 0 }, /IMPORTE_INVALIDO/],
    [{ amountMinor: -100 }, /IMPORTE_INVALIDO/],
    [{ amountMinor: 1000.5 }, /IMPORTE_INVALIDO/],
    [{ providerAccountId: '' }, /IDENTIDAD_INCOMPLETA/],
  ])('rechaza %o', (override, error) => {
    expect(() => providerPlanIdentity({ ...base, ...override })).toThrow(error);
  });
});
