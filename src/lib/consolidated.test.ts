import { describe, it, expect } from 'vitest';
import { metricDisplay, marginDisplay, formatRateLabel } from './consolidated';
import type { ConsolidatedGroup } from '@/types/domain';

const incomplete: ConsolidatedGroup = {
  key: 'TOTAL',
  label: 'Total',
  metrics: {
    COLLECTED: { native: { PEN: 1000, BOB: 500 }, reporting_amount: null, complete: false, missing_currencies: ['BOB'] },
    COST: { native: { USD: 100 }, reporting_amount: 100, complete: true, missing_currencies: [] },
  },
  native_margin: { PEN: 1000, BOB: 475, USD: -100 },
  margin: { reporting_amount: null, complete: false },
};

const complete: ConsolidatedGroup = {
  ...incomplete,
  metrics: {
    COLLECTED: { native: { PEN: 1000, BOB: 500 }, reporting_amount: 339.13, complete: true, missing_currencies: [] },
  },
  margin: { reporting_amount: 235.51, complete: true },
};

describe('modo NATIVO', () => {
  it('muestra cada moneda por separado y nunca un total mezclado', () => {
    const d = metricDisplay(incomplete, 'COLLECTED', 'NATIVE', 'USD');
    expect(d.value).toMatch(/^BOB\s500\.00 · PEN\s1,000\.00$/);
    expect(d.value).not.toContain('1,500');
  });

  it('el margen nativo es por moneda', () => {
    expect(marginDisplay(incomplete, 'NATIVE', 'USD').value).toMatch(/BOB\s475\.00 · PEN\s1,000\.00 · -USD\s100\.00/);
  });
});

describe('modo CONSOLIDADO', () => {
  it('con una tasa faltante no presenta la cifra como completa', () => {
    const d = metricDisplay(incomplete, 'COLLECTED', 'CONSOLIDATED', 'USD');
    expect(d.value).toBe('Incompleto');
    expect(d.complete).toBe(false);
    expect(d.tone).toBe('warn');
    expect(d.hint).toContain('Falta FX: BOB');
  });

  it('una métrica completa se muestra en la moneda de reporte con su nativo como referencia', () => {
    const d = metricDisplay(complete, 'COLLECTED', 'CONSOLIDATED', 'USD');
    expect(d.value).toMatch(/^USD\s339\.13$/);
    expect(d.hint).toContain('PEN');
  });

  it('el margen consolidado solo existe con todas las conversiones', () => {
    expect(marginDisplay(incomplete, 'CONSOLIDATED', 'USD').value).toBe('No calculable');
    expect(marginDisplay(complete, 'CONSOLIDATED', 'USD').value).toMatch(/^USD\s235\.51$/);
  });

  it('sin moneda de reporte no inventa una', () => {
    expect(metricDisplay(complete, 'COLLECTED', 'CONSOLIDATED', null).value).toBe('Sin moneda de reporte');
  });

  it('una métrica sin hechos vale 0 en la moneda de reporte', () => {
    expect(metricDisplay(complete, 'MRR', 'CONSOLIDATED', 'USD').value).toMatch(/^USD\s0\.00$/);
  });
});

it('rotula la tasa con ambas monedas', () => {
  expect(formatRateLabel('PEN', 'USD', 0.2666666667)).toBe('1 PEN = 0.266667 USD');
});
