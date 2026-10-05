import { describe, expect, it } from 'vitest';
import type { AccountSeriesPoint } from '@/services/queries';
import { accountHealth, accountSeriesView } from './accountSeriesModel';

function point(month: string, over: Partial<AccountSeriesPoint> = {}): AccountSeriesPoint {
  return {
    month,
    asOf: month,
    isPartial: false,
    reportingCurrency: 'USD',
    mrr: 0,
    invoiced: 0,
    collected: 0,
    mrrNative: {},
    invoicedNative: {},
    collectedNative: {},
    complete: true,
    missingCurrencies: [],
    fxIsDemo: false,
    ...over,
  };
}

describe('accountSeriesView', () => {
  it('con una sola moneda grafica la nativa (sin ruido de tipo de cambio)', () => {
    const v = accountSeriesView([
      point('2026-08-01', { mrr: 756.33, mrrNative: { PEN: 2660 }, invoicedNative: { PEN: 2660 } }),
      point('2026-09-01', { mrr: 760, mrrNative: { PEN: 2660 }, collectedNative: { PEN: 2660 }, isPartial: true }),
    ])!;
    expect(v.native).toBe(true);
    expect(v.currency).toBe('PEN');
    expect(v.points.map((p) => p.mrr)).toEqual([2660, 2660]);
    expect(v.points[0]).toMatchObject({ invoiced: 2660, collected: 0, label: 'ago 26' });
    expect(v.points[1]!.partial).toBe(true);
    expect(v.hasMrr && v.hasBilling).toBe(true);
  });

  it('con varias monedas usa la moneda de reporte convertida por la base y conserva el null de tasa', () => {
    const v = accountSeriesView([
      point('2026-09-01', { mrr: null, mrrNative: { PEN: 100, BOB: 50 }, complete: false, missingCurrencies: ['BOB'] }),
    ])!;
    expect(v.native).toBe(false);
    expect(v.currency).toBe('USD');
    expect(v.points[0]!.mrr).toBeNull();
    expect(v.missing).toEqual(['BOB']);
  });

  it('sin movimientos: moneda de reporte y banderas en falso (la UI muestra el vacío, no ceros)', () => {
    const v = accountSeriesView([point('2026-09-01')])!;
    expect(v.currency).toBe('USD');
    expect(v.hasMrr).toBe(false);
    expect(v.hasBilling).toBe(false);
    expect(accountSeriesView([])).toBeNull();
  });
});

describe('accountHealth', () => {
  it('la peor bandera de los contratos gana', () => {
    expect(accountHealth([])).toBe('NO_CONTRACTS');
    expect(accountHealth([{ is_past_due: false }])).toBe('OK');
    expect(accountHealth([{ is_past_due: true }, { is_past_due: false }])).toBe('PAST_DUE');
    expect(accountHealth([{ is_past_due: true }, { suspension_pending: true }])).toBe('SUSPENSION');
  });
});
