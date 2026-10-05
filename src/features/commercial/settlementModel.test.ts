import { describe, expect, it } from 'vitest';
import {
  approvalBlocker,
  localIsoDate,
  paymentMethodLabel,
  previousMonthRange,
  settlementActions,
  settlementStatus,
  settlementStep,
} from './settlementModel';

const s = (status: string, total: number, event_count = 3) => ({ status, total_amount: total, event_count });

describe('settlementModel · acciones por estado', () => {
  it('ofrece el siguiente paso del ciclo y anular mientras no esté pagada', () => {
    expect(settlementActions(s('OPEN', 150), true)).toEqual(['approve', 'cancel']);
    expect(settlementActions(s('APPROVED', 150), true)).toEqual(['pay', 'cancel']);
    expect(settlementActions(s('PAID', 150), true)).toEqual([]);
    expect(settlementActions(s('CANCELLED', 150), true)).toEqual([]);
  });

  it('una abierta negativa o vacía solo se anula (la base la rechazaría al aprobar)', () => {
    expect(settlementActions(s('OPEN', -100), true)).toEqual(['cancel']);
    expect(settlementActions(s('OPEN', 0, 0), true)).toEqual(['cancel']);
    expect(approvalBlocker(s('OPEN', -100))).toMatch(/reversos superan/);
    expect(approvalBlocker(s('OPEN', 0, 0))).toMatch(/No tiene comisiones/);
    expect(approvalBlocker(s('OPEN', 0, 2))).toBeNull();
    expect(approvalBlocker(s('APPROVED', -1))).toBeNull();
  });

  it('sin permiso de finanzas no se ofrece ninguna acción', () => {
    expect(settlementActions(s('OPEN', 150), false)).toEqual([]);
    expect(settlementActions(s('APPROVED', 150), false)).toEqual([]);
  });
});

describe('settlementModel · etiquetas y fechas', () => {
  it('estados y medios en español; lo desconocido no se inventa', () => {
    expect(settlementStatus('APPROVED')).toEqual({ label: 'Aprobada', tone: 'warn' });
    expect(settlementStatus('CANCELLED').label).toBe('Anulada');
    expect(settlementStatus('RARO').label).toBe('RARO');
    expect(paymentMethodLabel('PAYROLL')).toBe('Planilla');
    expect(paymentMethodLabel('WIRE')).toBe('WIRE');
    expect(paymentMethodLabel(null)).toBe('—');
  });

  it('el período por defecto es el último mes cerrado completo, en fecha local', () => {
    expect(previousMonthRange(new Date(2026, 9, 5))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousMonthRange(new Date(2026, 0, 31))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(previousMonthRange(new Date(2028, 2, 1))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(localIsoDate(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05');
  });

  it('el paso del ciclo: generada, aprobada, pagada; anulada fuera del recorrido', () => {
    expect(settlementStep('OPEN')).toBe(0);
    expect(settlementStep('APPROVED')).toBe(1);
    expect(settlementStep('PAID')).toBe(2);
    expect(settlementStep('CANCELLED')).toBe(-1);
  });
});
