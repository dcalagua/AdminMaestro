import { describe, it, expect } from 'vitest';
import {
  formatMoney, formatMoneyCompact, formatNumber, formatPercent,
  formatDate, formatDateTime, formatCurrencyMap, sumByCurrency, subtractByCurrency,
} from './format';

describe('formateo de dinero', () => {
  it('muestra dos decimales y SIEMPRE el código ISO de la moneda', () => {
    expect(formatMoney(1234.5, 'USD')).toMatch(/^USD\s1,234\.50$/);
    expect(formatMoney(1250, 'PEN')).toMatch(/^PEN\s1,250\.00$/);
    expect(formatMoney(890, 'BOB')).toMatch(/^BOB\s890\.00$/);
  });

  it('no usa símbolos ambiguos: PEN no se pinta como «S/» ni USD como «$»', () => {
    expect(formatMoney(100, 'PEN')).not.toContain('S/');
    expect(formatMoney(100, 'USD')).not.toContain('$');
  });

  it('no inventa un valor cuando el dato falta', () => {
    // Un 0 y un "sin dato" son cosas distintas en un tablero financiero.
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney(undefined, 'USD')).toBe('—');
    expect(formatMoney(0, 'USD')).toContain('0.00');
  });

  it('sin moneda no asume USD (G-27)', () => {
    expect(formatMoney(0, null)).toBe('—');
    expect(formatMoney(150, undefined)).toBe('150 (sin moneda)');
    expect(formatMoney(150, null)).not.toContain('USD');
  });

  it('respeta la moneda pedida en vez de asumir una', () => {
    expect(formatMoney(100, 'PEN')).not.toEqual(formatMoney(100, 'USD'));
  });

  it('compacta sólo a partir de 10.000 y conserva el código', () => {
    expect(formatMoneyCompact(9999, 'USD')).toContain('9,999.00');
    expect(formatMoneyCompact(1_500_000, 'USD')).toMatch(/USD\s1[.,]5\s?M/);
  });
});

describe('sumByCurrency (R-7)', () => {
  const rows = [
    { amount: 100, currency: 'PEN' },
    { amount: '50.10', currency: 'PEN' },
    { amount: 100, currency: 'USD' },
    { amount: 890, currency: 'BOB' },
    { amount: 999, currency: null },
  ];

  it('PEN + USD + BOB no se suman: un total por moneda', () => {
    expect(sumByCurrency(rows, (r) => r.amount, (r) => r.currency)).toEqual({ PEN: 150.1, USD: 100, BOB: 890 });
  });

  it('una fila sin moneda no se asigna a ninguna', () => {
    const totals = sumByCurrency(rows, (r) => r.amount, (r) => r.currency);
    expect(Object.values(totals)).not.toContain(999);
    expect(totals.USD).toBe(100);
  });

  it('resta por moneda sin cruzarlas', () => {
    expect(subtractByCurrency({ PEN: 500, USD: 100 }, { PEN: 200, BOB: 10 })).toEqual({ PEN: 300, USD: 100, BOB: -10 });
  });
});

describe('formateo de números y porcentajes', () => {
  it('formatea enteros con separador de miles', () => {
    expect(formatNumber(1234567)).toContain('1,234,567');
  });

  it('convierte la fracción a porcentaje', () => {
    expect(formatPercent(0.25)).toContain('25');
    expect(formatPercent(0.185, 1)).toContain('18.5');
  });

  it('devuelve marcador cuando no hay dato', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
  });
});

describe('formateo de fechas', () => {
  it('formatea una fecha ISO', () => {
    expect(formatDate('2026-03-15')).not.toBe('—');
  });

  it('una fecha sin hora es un día de calendario: no retrocede por zona horaria', () => {
    // es-PE abrevia el mes («13 set. 2026»); lo que importa es el DÍA.
    expect(formatDate('2026-09-13')).toMatch(/^13\b/);
    expect(formatDate('2031-01-01')).toMatch(/^1\b/);
  });

  it('no revienta con una fecha inválida', () => {
    expect(formatDate('no-es-una-fecha')).toBe('—');
    expect(formatDateTime('')).toBe('—');
  });
});

describe('formatCurrencyMap', () => {
  it('lista cada moneda por separado, con su código y sin convertir entre ellas', () => {
    const result = formatCurrencyMap({ USD: 1000, PEN: 2000 });
    expect(result).toMatch(/^PEN\s2,000\.00 · USD\s1,000\.00$/);
    expect(result).not.toContain('3,000');
  });

  it('devuelve marcador con un mapa vacío', () => {
    expect(formatCurrencyMap({})).toBe('—');
    expect(formatCurrencyMap(null)).toBe('—');
  });
});
