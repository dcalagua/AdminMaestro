import { describe, it, expect } from 'vitest';
import {
  formatMoney, formatMoneyCompact, formatNumber, formatPercent,
  formatDate, formatDateTime, formatCurrencyMap,
} from './format';

describe('formateo de dinero', () => {
  it('muestra dos decimales y el símbolo de la moneda', () => {
    expect(formatMoney(1234.5, 'USD')).toContain('1,234.50');
  });

  it('no inventa un valor cuando el dato falta', () => {
    // Un 0 y un "sin dato" son cosas distintas en un tablero financiero.
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney(0)).toContain('0.00');
  });

  it('respeta la moneda pedida en vez de asumir una', () => {
    expect(formatMoney(100, 'PEN')).not.toEqual(formatMoney(100, 'USD'));
  });

  it('compacta sólo a partir de 10.000', () => {
    expect(formatMoneyCompact(9999, 'USD')).toContain('9,999.00');
    expect(formatMoneyCompact(1_500_000, 'USD')).toMatch(/1[.,]5\s?M/);
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

  it('no revienta con una fecha inválida', () => {
    expect(formatDate('no-es-una-fecha')).toBe('—');
    expect(formatDateTime('')).toBe('—');
  });
});

describe('formatCurrencyMap', () => {
  it('lista cada moneda por separado, sin convertir entre ellas', () => {
    // No hay conversión FX: mezclar monedas con un tipo de cambio implícito
    // produce un número que nadie puede auditar.
    // es-PE renderiza PEN como "S/", no como el código: lo que importa es que
    // los dos importes aparezcan por separado y NO se sumen en un solo número.
    const result = formatCurrencyMap({ USD: 1000, PEN: 2000 });
    expect(result).toContain('1,000.00');
    expect(result).toContain('2,000.00');
    expect(result).toContain('·');
    expect(result).not.toContain('3,000');
  });

  it('devuelve marcador con un mapa vacío', () => {
    expect(formatCurrencyMap({})).toBe('—');
    expect(formatCurrencyMap(null)).toBe('—');
  });
});
