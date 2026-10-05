import { describe, it, expect } from 'vitest';
import { autochargeToast } from './autochargeSummary';

const summary = (status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'REVIEW', error_code: string | null = null) => ({
  processed: 1, succeeded: 0, failed: 0, skipped: 0, results: [{ invoice_number: 'INV-1', status, error_code }],
});

describe('«Cobrar ahora» · mensaje del resultado', () => {
  it('cobrado, rechazado con código, omitido y en revisión', () => {
    expect(autochargeToast(summary('SUCCEEDED'), 'INV-1')).toEqual(['success', 'Cobro realizado', expect.stringContaining('INV-1')]);
    expect(autochargeToast(summary('FAILED', 'TARJETA_RECHAZADA'), 'INV-1')[2]).toContain('TARJETA_RECHAZADA');
    expect(autochargeToast(summary('SKIPPED', 'COBRO_NO_PROCEDE'), 'INV-1')[1]).toBe('Cobro omitido');
    expect(autochargeToast(summary('REVIEW'), 'INV-1')[1]).toBe('Cobro en revisión');
    expect(autochargeToast({ processed: 0, succeeded: 0, failed: 0, skipped: 0, results: [] }, 'INV-1')[1]).toBe('Cobro omitido');
  });
});
