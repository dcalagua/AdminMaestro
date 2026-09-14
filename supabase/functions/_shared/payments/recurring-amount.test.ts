import { describe, it, expect } from 'vitest';
import { recurringCardAmount } from './recurring-amount';

/*
 * V3.1 · Importe que se domicilia en un plan recurrente de tarjeta.
 * Un plan del proveedor cobra UN importe cada UN intervalo: sumar líneas de
 * cadencias distintas cobraría, p. ej., el soporte anual todos los meses.
 */
const AS_OF = '2026-09-13';

describe('recurringCardAmount', () => {
  it('suma solo las líneas recurrentes vigentes de la cadencia del contrato', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 850, valid_from: '2026-01-01', valid_to: null },
      { billing_interval: 'MONTHLY', amount: 150.5, valid_from: '2026-09-01', valid_to: null },
      { billing_interval: 'ONE_TIME', amount: 3500, valid_from: '2026-01-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({ ok: true, amount: 1000.5 });
  });

  it('rechaza cadencias mixtas: una licencia MONTHLY y un soporte YEARLY no caben en un solo plan', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 100, valid_from: '2026-01-01', valid_to: null },
      { billing_interval: 'YEARLY', amount: 1200, valid_from: '2026-01-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({ ok: false, error: 'CADENCIA_MIXTA_NO_DOMICILIABLE' });
  });

  it('no domicilia líneas vencidas ni futuras', () => {
    expect(recurringCardAmount([
      { billing_interval: 'MONTHLY', amount: 850, valid_from: '2026-01-01', valid_to: '2026-06-30' },
      { billing_interval: 'MONTHLY', amount: 900, valid_from: '2026-07-01', valid_to: null },
      { billing_interval: 'YEARLY', amount: 1200, valid_from: '2027-01-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({ ok: true, amount: 900 });
  });

  it('sin importe recurrente vigente no hay nada que domiciliar', () => {
    expect(recurringCardAmount([
      { billing_interval: 'ONE_TIME', amount: 3500, valid_from: '2026-01-01', valid_to: null },
    ], 'MONTHLY', AS_OF)).toEqual({ ok: false, error: 'SIN_IMPORTE_RECURRENTE' });
  });

  it('YEARLY puro se domicilia por su importe anual', () => {
    expect(recurringCardAmount([
      { billing_interval: 'YEARLY', amount: 24000, valid_from: '2026-03-13', valid_to: null },
      { billing_interval: 'ONE_TIME', amount: 12000, valid_from: '2026-03-13', valid_to: null },
    ], 'YEARLY', AS_OF)).toEqual({ ok: true, amount: 24000 });
  });
});
