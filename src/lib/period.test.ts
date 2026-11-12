import { describe, expect, it } from 'vitest';
import { formatMonth, monthOptions, monthValue, shiftMonth } from './period';

describe('period (V5 · F0)', () => {
  it('formatea un mes en español sin dejar ver el ISO', () => {
    expect(formatMonth('2026-10')).toBe('octubre de 2026');
    expect(formatMonth('2026-01-01')).toBe('enero de 2026');
    expect(formatMonth('2026-13')).toBe('—');
    expect(formatMonth(null)).toBe('—');
  });

  it('desplaza meses cruzando el año', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthValue(new Date(2026, 10, 12))).toBe('2026-11');
  });

  it('lista del más reciente al más antiguo y rotula el mes en curso', () => {
    const opts = monthOptions({ today: new Date(2026, 10, 12), back: 2, ahead: 1 });
    expect(opts.map((o) => o.value)).toEqual(['2026-12', '2026-11', '2026-10', '2026-09']);
    expect(opts[1]!.label).toBe('noviembre de 2026 (mes en curso)');
  });

  it('incluye un valor fuera del rango en su lugar cronológico', () => {
    const opts = monthOptions({ today: new Date(2026, 10, 12), back: 1, include: '2024-05-01' });
    expect(opts.map((o) => o.value)).toEqual(['2026-11', '2026-10', '2024-05']);
  });
});
