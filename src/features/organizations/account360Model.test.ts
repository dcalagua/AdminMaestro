import { describe, expect, it } from 'vitest';
import type { AccountSeriesPoint } from '@/services/queries';
import { commercialOwner, currentMrrByCurrency, isCurrentAttribution } from './account360Model';

const point = (mrrNative: Record<string, number>): AccountSeriesPoint => ({
  month: '2026-11-01', asOf: '2026-11-12', isPartial: true, reportingCurrency: 'USD',
  mrr: 999, invoiced: null, collected: null, mrrNative, invoicedNative: {}, collectedNative: {},
  complete: true, missingCurrencies: [], fxIsDemo: false,
});

describe('MRR de la cabecera', () => {
  it('toma el último punto, por moneda nativa, sin sumar monedas ni usar la de reporte', () => {
    const mrr = currentMrrByCurrency([point({ PEN: 100 }), point({ PEN: 2660, USD: 450, CLP: 0 })]);
    expect(mrr).toEqual({ PEN: 2660, USD: 450 });
  });
  it('sin serie no inventa un cero', () => {
    expect(currentMrrByCurrency(undefined)).toEqual({});
    expect(currentMrrByCurrency([])).toEqual({});
  });
});

describe('responsable comercial', () => {
  const a = (name: string, pct: number, extra: Partial<{ status: string; valid_from: string; valid_to: string | null }> = {}) => ({
    attribution_pct: pct, status: 'ACTIVE', valid_from: '2026-01-01', valid_to: null, sales_agents: { full_name: name }, ...extra,
  });
  it('gana quien tiene más participación vigente; los demás quedan como «+N»', () => {
    const owner = commercialOwner([a('Ana', 0.4), a('Luis', 0.6), a('Ana', 0.3)], '2026-11-12');
    expect(owner).toEqual({ name: 'Ana', others: ['Luis'] });
  });
  it('ignora atribuciones vencidas, futuras o inactivas', () => {
    expect(isCurrentAttribution(a('X', 1, { valid_to: '2026-10-01' }), '2026-11-12')).toBe(false);
    expect(isCurrentAttribution(a('X', 1, { valid_from: '2027-01-01' }), '2026-11-12')).toBe(false);
    expect(isCurrentAttribution(a('X', 1, { status: 'INACTIVE' }), '2026-11-12')).toBe(false);
    expect(commercialOwner([a('X', 1, { status: 'INACTIVE' })], '2026-11-12')).toBeNull();
  });
});
