import { describe, it, expect } from 'vitest';
import { recurringCardAmount, RECURRING_ERROR_MESSAGES } from './recurring-amount';

/*
 * V3.1 · Importe que se domicilia en un plan recurrente de tarjeta.
 * Un plan del proveedor cobra UN importe cada UN intervalo: sumar líneas de
 * cadencias distintas cobraría, p. ej., el soporte anual todos los meses.
 *
 * V3.2 · El Plan se crea HOY y no cambia solo. Todo lo que el contrato ya sabe
 * que va a entrar o salir de vigencia cuenta: si mañana cambia la cadencia o
 * el importe, hoy no se domicilia.
 */
const AS_OF = '2026-09-13';

describe('recurringCardAmount · V3.1', () => {
  it('suma solo las líneas recurrentes vigentes de la cadencia del contrato', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 850, valid_from: '2026-01-01', valid_to: null },
      { billing_interval: 'MONTHLY', amount: 150.5, valid_from: '2026-09-01', valid_to: null },
      { billing_interval: 'ONE_TIME', amount: 3500, valid_from: '2026-01-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({ ok: true, amountMinor: 100050, amount: '1000.50' });
  });

  it('rechaza cadencias mixtas: una licencia MONTHLY y un soporte YEARLY no caben en un solo plan', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 100, valid_from: '2026-01-01', valid_to: null },
      { billing_interval: 'YEARLY', amount: 1200, valid_from: '2026-01-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toMatchObject({ ok: false, error: 'CADENCIA_MIXTA_NO_DOMICILIABLE' });
  });

  it('sin importe recurrente no hay nada que domiciliar', () => {
    expect(recurringCardAmount([
      { billing_interval: 'ONE_TIME', amount: 3500, valid_from: '2026-01-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({ ok: false, error: 'SIN_IMPORTE_RECURRENTE' });
  });

  it('YEARLY puro se domicilia por su importe anual', () => {
    expect(recurringCardAmount([
      { billing_interval: 'YEARLY', amount: 24000, valid_from: '2026-03-13', valid_to: null },
      { billing_interval: 'ONE_TIME', amount: 12000, valid_from: '2026-03-13', valid_to: null },
    ], 'YEARLY', AS_OF)).toEqual({ ok: true, amountMinor: 2400000, amount: '24000.00' });
  });

  it('QUARTERLY puro se domicilia por su importe trimestral', () => {
    expect(recurringCardAmount([
      { billing_interval: 'QUARTERLY', amount: '3000.00', valid_from: '2026-07-01', valid_to: null },
    ], 'QUARTERLY', AS_OF)).toEqual({ ok: true, amountMinor: 300000, amount: '3000.00' });
  });
});

describe('recurringCardAmount · V3.2 cadencia futura', () => {
  it('MONTHLY vigente + YEARLY que empieza en 3 meses: cadencia mixta', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 1000, valid_from: '2026-09-01', valid_to: null },
      { billing_interval: 'YEARLY', amount: 2400, valid_from: '2026-12-13', valid_to: null },
    ], 'MONTHLY', AS_OF)).toMatchObject({ ok: false, error: 'CADENCIA_MIXTA_NO_DOMICILIABLE' });
  });

  it('MONTHLY futuro + YEARLY futuro, nada vigente hoy: cadencia mixta', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 1000, valid_from: '2026-10-01', valid_to: null },
      { billing_interval: 'YEARLY', amount: 2400, valid_from: '2027-01-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toMatchObject({ ok: false, error: 'CADENCIA_MIXTA_NO_DOMICILIABLE' });
  });

  it.each([
    ['MONTHLY', 'QUARTERLY'],
    ['QUARTERLY', 'YEARLY'],
    ['YEARLY', 'MONTHLY'],
  ])('%s vigente + %s futuro: cadencia mixta', (current, future) => {
    expect(recurringCardAmount([
      { billing_interval: current, amount: 500, valid_from: '2026-01-01', valid_to: null },
      { billing_interval: future, amount: 500, valid_from: '2027-06-01', valid_to: null },
    ], current, AS_OF)).toMatchObject({ ok: false, error: 'CADENCIA_MIXTA_NO_DOMICILIABLE' });
  });

  it('una línea YEARLY ya vencida no convierte el contrato en mixto', () => {
    expect(recurringCardAmount([
      { billing_interval: 'YEARLY', amount: 99, valid_from: '2025-01-01', valid_to: '2026-06-30' },
      { billing_interval: 'MONTHLY', amount: 900, valid_from: '2026-07-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({ ok: true, amountMinor: 90000, amount: '900.00' });
  });

  it('una línea que termina justo el día anterior a hoy se ignora', () => {
    expect(recurringCardAmount([
      { billing_interval: 'QUARTERLY', amount: 99, valid_from: '2025-01-01', valid_to: '2026-09-12' },
      { billing_interval: 'MONTHLY', amount: 900, valid_from: '2026-07-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({ ok: true, amountMinor: 90000, amount: '900.00' });
  });

  it('ONE_TIME futuro no cuenta como cadencia ni cambia el importe recurrente', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 900, valid_from: '2026-07-01', valid_to: null },
      { billing_interval: 'ONE_TIME', amount: 5000, valid_from: '2027-01-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({ ok: true, amountMinor: 90000, amount: '900.00' });
  });

  it('una línea de otra cadencia que empieza después del fin del contrato no cuenta', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 900, valid_from: '2026-07-01', valid_to: null },
      { billing_interval: 'YEARLY', amount: 2400, valid_from: '2027-07-01', valid_to: null },
    ], 'MONTHLY', AS_OF, '2027-06-30')).toEqual({ ok: true, amountMinor: 90000, amount: '900.00' });
  });
});

describe('recurringCardAmount · V3.2 importe futuro', () => {
  it('addon MONTHLY que empieza en 3 meses: el importe sube y se rechaza', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 1000, valid_from: '2026-09-01', valid_to: null },
      { billing_interval: 'MONTHLY', amount: 150, valid_from: '2026-12-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({
      ok: false, error: 'MONTO_RECURRENTE_FUTURO_VARIABLE', changesOn: '2026-12-01',
    });
  });

  it('una línea MONTHLY que termina antes que el contrato: el importe baja y se rechaza', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 1000, valid_from: '2026-09-01', valid_to: null },
      { billing_interval: 'MONTHLY', amount: 200, valid_from: '2026-09-01', valid_to: '2027-02-28' },
    ], 'MONTHLY', AS_OF)).toEqual({
      ok: false, error: 'MONTO_RECURRENTE_FUTURO_VARIABLE', changesOn: '2027-03-01',
    });
  });

  it('nada vigente hoy pero una línea futura: el importe pasa de 0 a X y se rechaza', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 1000, valid_from: '2026-12-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({
      ok: false, error: 'MONTO_RECURRENTE_FUTURO_VARIABLE', changesOn: '2026-12-01',
    });
  });

  it('sustitución contigua por el mismo importe: estable, se permite', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 1000, valid_from: '2026-01-01', valid_to: '2026-11-30' },
      { billing_interval: 'MONTHLY', amount: '1000.00', valid_from: '2026-12-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({ ok: true, amountMinor: 100000, amount: '1000.00' });
  });

  it('sustitución con un día sin cobertura: el importe cae a 0 ese día y se rechaza', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 1000, valid_from: '2026-01-01', valid_to: '2026-11-29' },
      { billing_interval: 'MONTHLY', amount: 1000, valid_from: '2026-12-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toMatchObject({ ok: false, error: 'MONTO_RECURRENTE_FUTURO_VARIABLE', changesOn: '2026-11-30' });
  });

  it('cambios después del fin del contrato no cuentan', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 1000, valid_from: '2026-01-01', valid_to: '2027-06-30' },
      { billing_interval: 'MONTHLY', amount: 150, valid_from: '2027-07-01', valid_to: null },
    ], 'MONTHLY', AS_OF, '2027-06-30')).toEqual({ ok: true, amountMinor: 100000, amount: '1000.00' });
  });

  it('dos cambios que se compensan el mismo día: el importe no cambia', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 700, valid_from: '2026-01-01', valid_to: '2026-12-31' },
      { billing_interval: 'MONTHLY', amount: 300, valid_from: '2026-01-01', valid_to: null },
      { billing_interval: 'MONTHLY', amount: 700, valid_from: '2027-01-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({ ok: true, amountMinor: 100000, amount: '1000.00' });
  });

  it('suma en céntimos exactos: 0.10 + 0.20 son 30 céntimos, no 30.000000000000004', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 0.1, valid_from: '2026-01-01', valid_to: null },
      { billing_interval: 'MONTHLY', amount: '0.20', valid_from: '2026-01-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({ ok: true, amountMinor: 30, amount: '0.30' });
  });

  it('un importe con más de dos decimales no se redondea en silencio', () => {
    expect(() => recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: '12.345', valid_from: '2026-01-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toThrow(/IMPORTE_NO_REPRESENTABLE/);
  });
});

describe('mensajes al usuario', () => {
  it('explican el motivo sin detalles del proveedor', () => {
    expect(RECURRING_ERROR_MESSAGES.CADENCIA_MIXTA_NO_DOMICILIABLE).toBe(
      'La suscripción contiene cargos recurrentes con distintas periodicidades y no puede domiciliarse mediante un único plan.',
    );
    expect(RECURRING_ERROR_MESSAGES.MONTO_RECURRENTE_FUTURO_VARIABLE).toBe(
      'El importe recurrente cambiará durante la vigencia del contrato. Esta configuración requiere un esquema de cobro distinto.',
    );
    for (const message of Object.values(RECURRING_ERROR_MESSAGES)) {
      expect(message).not.toMatch(/culqi|pln_|sxn_|plan_id|provider/i);
    }
  });
});
