import { describe, expect, it } from 'vitest';
import { formatDate } from '@/lib/format';
import { agingCells, readableDates } from './collectionsModel';

describe('collectionsModel · V6', () => {
  it('agrupa el saldo por tramo de antigüedad y moneda, sin sumar monedas', () => {
    const cells = agingCells([
      { aging_bucket: 'D1_30', currency: 'USD', invoice_count: 2, balance: '300.50' },
      { aging_bucket: 'D1_30', currency: 'PEN', invoice_count: 1, balance: 100 },
      { aging_bucket: 'D90_MAS', currency: 'USD', invoice_count: '3', balance: 900 },
      { aging_bucket: 'A_FAVOR', currency: 'USD', invoice_count: 1, balance: -20 },
    ]);
    expect(cells.D1_30).toEqual({ amounts: { USD: 300.5, PEN: 100 }, invoices: 3 });
    expect(cells.D90_MAS).toEqual({ amounts: { USD: 900 }, invoices: 3 });
    expect(cells.VIGENTE).toEqual({ amounts: {}, invoices: 0 });
  });

  it('las fechas ISO de un detalle se leen con el formato de la consola', () => {
    expect(readableDates('Emitida el 2026-09-01, vence el 2026-09-16, sin cobro')).toBe(
      `Emitida el ${formatDate('2026-09-01')}, vence el ${formatDate('2026-09-16')}, sin cobro`,
    );
    expect(readableDates(null)).toBeNull();
    expect(readableDates('Sin fechas')).toBe('Sin fechas');
  });
});
