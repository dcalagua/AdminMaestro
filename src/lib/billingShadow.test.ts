import { describe, it, expect } from 'vitest';
import { parseShadowLocal, toShadowDiffs, toShadowExpected } from './billingShadow';
import {
  billingAxisTargets, formatPeriod, nextPeriodStart, periodFromMonth, periodRange, poolLabel, undecidedText,
} from '@/features/usage/usageLabels';

describe('parseShadowLocal (BILLING_SHADOW, D-14)', () => {
  it('acepta {currency, lines[]} con itemCode único', () => {
    const r = parseShadowLocal(
      JSON.stringify({ source: 'eexpense-biller', currency: 'PEN', lines: [{ itemCode: 'plan:pro', quantity: 1, amount: 120 }] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.lines[0]?.itemCode).toBe('plan:pro');
  });

  it('rechaza texto que no es JSON', () => {
    expect(parseShadowLocal('{nope')).toEqual({ ok: false, error: 'El texto no es JSON válido.' });
  });

  it('rechaza moneda inválida, importes no numéricos e itemCode repetido', () => {
    const bad = (v: unknown) => parseShadowLocal(JSON.stringify(v));
    const currency = bad({ currency: 'soles', lines: [] });
    expect(currency.ok).toBe(false);
    if (!currency.ok) expect(currency.error).toMatch(/currency/);

    const amount = bad({ currency: 'PEN', lines: [{ itemCode: 'a', quantity: 1, amount: '10' }] });
    expect(amount.ok).toBe(false);
    if (!amount.ok) expect(amount.error).toMatch(/amount/);

    const dup = bad({
      currency: 'PEN',
      lines: [
        { itemCode: 'a', quantity: 1, amount: 1 },
        { itemCode: 'a', quantity: 2, amount: 2 },
      ],
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/itemCode repetido: a/);
  });

  it('tipa la expectativa y los diffs que devuelve la base', () => {
    const e = toShadowExpected({
      subscriptionId: 's1', periodStart: '2026-10-01', currency: 'PEN', total: '150.00',
      lines: [{ itemCode: 'usage:ai.pages', quantity: '3.00', amount: '30.00', currency: 'PEN' }],
    });
    expect(e).toMatchObject({ total: 150, lines: [{ itemCode: 'usage:ai.pages', quantity: 3, amount: 30 }] });
    const d = toShadowDiffs([
      { itemCode: '*', type: 'CURRENCY_MISMATCH', masteradmin: 'PEN', local: 'USD' },
      { itemCode: 'x', type: 'ONLY_LOCAL', masteradmin: null, local: { quantity: 1, amount: 9 } },
    ]);
    expect(d[0]).toEqual({ itemCode: '*', type: 'CURRENCY_MISMATCH', masteradmin: 'PEN', local: 'USD' });
    expect(d[1]?.local).toEqual({ quantity: 1, amount: 9 });
  });
});

describe('etiquetas y períodos de uso', () => {
  it('una decisión abierta nunca se pinta como 0 ni «gratis»', () => {
    expect(undecidedText('D-06')).toBe('No decidido (D-06)');
  });

  it('el eje BILLING avanza o retrocede un paso y nunca ofrece el retiro', () => {
    expect(billingAxisTargets('BILLING_LEGACY')).toEqual(['BILLING_SHADOW']);
    expect(billingAxisTargets('BILLING_SHADOW')).toEqual(['BILLING_LEGACY', 'BILLING_PRIMARY']);
    expect(billingAxisTargets('BILLING_PRIMARY')).toEqual(['BILLING_SHADOW']);
    expect(billingAxisTargets('???')).toEqual([]);
  });

  it('mes calendario UTC (D-10)', () => {
    expect(periodFromMonth('2026-12')).toBe('2026-12-01');
    expect(nextPeriodStart('2026-12-01')).toBe('2027-01-01');
    expect(periodRange('2026-10-01')).toEqual({ from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' });
    expect(formatPeriod('2026-10-01')).toMatch(/octubre/);
  });

  it('pools', () => {
    expect(poolLabel('TENANT')).toBe('Pool del tenant');
    expect(poolLabel('PRODUCT:ewm')).toBe('Pool del producto ewm');
  });
});
