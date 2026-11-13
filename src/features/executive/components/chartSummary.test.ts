import { describe, expect, it } from 'vitest';
import { axisInterval, summarizeSeries } from './chartSummary';

const fmt = (n: number) => `USD ${n}`;

describe('summarizeSeries (V5 · F7)', () => {
  it('resume rango, máximo, mínimo y último; un hueco no es cero', () => {
    const text = summarizeSeries(
      'Cobrado por mes',
      [
        { label: 'jul', value: 10 },
        { label: 'ago', value: null },
        { label: 'set', value: 30 },
        { label: 'oct', value: 20 },
      ],
      fmt,
    );
    expect(text).toBe(
      'Cobrado por mes: 4 puntos, de jul a oct. Máximo en set, USD 30. Mínimo en jul, USD 10. Último: oct, USD 20. 1 sin dato.',
    );
  });

  it('sin datos o con un solo punto lo dice tal cual', () => {
    expect(summarizeSeries('MRR', [{ label: 'set', value: null }], fmt)).toBe('MRR: sin datos.');
    expect(summarizeSeries('MRR', [{ label: 'set', value: 5 }], fmt)).toBe('MRR: set, USD 5.');
  });
});

describe('axisInterval', () => {
  it('en móvil deja como mucho seis etiquetas; en escritorio, todas', () => {
    expect(axisInterval(12, false)).toBe(0);
    expect(axisInterval(12, true)).toBe(1);
    expect(axisInterval(18, true)).toBe(2);
    expect(axisInterval(5, true)).toBe(0);
  });
});
