import { describe, it, expect } from 'vitest';
import {
  NO_DUE_ITEMS_MESSAGE, formatDateDMY, formatPeriod, issueErrorMessage, issueResultTitle,
  monthInputValue, periodStartFromMonth,
} from './billing';
import * as billing from './billing';

describe('V3.1 · periodo de facturación (presentación)', () => {
  it('el valor por defecto del selector es el mes de calendario, sin desfase de zona horaria', () => {
    expect(monthInputValue(new Date(2026, 0, 31, 23, 59))).toBe('2026-01');
    expect(monthInputValue(new Date(2026, 11, 1, 0, 0))).toBe('2026-12');
  });

  it('convierte el mes elegido en el p_period_start de la RPC y rechaza meses inválidos', () => {
    expect(periodStartFromMonth('2026-03')).toBe('2026-03-01');
    expect(periodStartFromMonth('2026-13')).toBeNull();
    expect(periodStartFromMonth('')).toBeNull();
  });

  it('pinta fechas DD/MM/YYYY y periodos MM/YYYY sin pasar por Date (no se corre un día en UTC−5)', () => {
    expect(formatDateDMY('2027-03-01')).toBe('01/03/2027');
    expect(formatDateDMY(null)).toBe('—');
    expect(formatPeriod('2026-02-01')).toBe('02/2026');
    expect(formatPeriod(undefined)).toBe('—');
  });

  it('distingue factura nueva de la ya existente (idempotencia visible)', () => {
    expect(issueResultTitle({ created: true })).toBe('Factura emitida');
    expect(issueResultTitle({ created: false })).toBe('La factura del período ya existía');
    expect(issueResultTitle({ created: false })).not.toMatch(/del mes/);
  });

  it('explica el rechazo sin cargos debidos en lugar de un error técnico', () => {
    expect(issueErrorMessage({ message: 'SIN_LINEAS_FACTURABLES: la suscripción X no tiene cargos facturables en el periodo 04/2026', code: '23514' }))
      .toBe(NO_DUE_ITEMS_MESSAGE);
    expect(issueErrorMessage({ message: 'SIN_IMPORTE_FACTURABLE: suman 0', code: '23514' })).toMatch(/suman 0/);
    expect(issueErrorMessage({ message: 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin emiten facturas', code: '42501' }))
      .toBe('solo EBIM_FINANCE o el super admin emiten facturas');
  });

  it('no replica la billing cadence: el módulo no expone nada que decida qué línea toca', () => {
    const exported = Object.keys(billing).join(',');
    expect(exported).not.toMatch(/isDue|dueFor|cadence|nextBilling|addMonths|monthsBetween|interval/i);
  });
});
