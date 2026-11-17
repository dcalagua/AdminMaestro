import { describe, it, expect } from 'vitest';
import { endOfDayIso, toDateInput, trialEndPreview, trialStatus, trialText } from './tenantTrial';

const NOW = new Date('2026-11-17T12:00:00Z');

describe('trialStatus', () => {
  it('un tenant que no es TRIAL no tiene prueba', () => {
    expect(trialStatus({ tenant_type: 'PRODUCTION', trial_ends_at: null }, NOW)).toEqual({ kind: 'NOT_TRIAL' });
  });

  it('convertida gana aunque ya no sea TRIAL', () => {
    expect(trialStatus({ tenant_type: 'PRODUCTION', trial_converted_at: '2026-11-10T00:00:00Z' }, NOW).kind).toBe('CONVERTED');
  });

  it('TRIAL sin fecha (anterior a la migración) se dice como tal', () => {
    expect(trialStatus({ tenant_type: 'TRIAL', trial_ends_at: null }, NOW)).toEqual({ kind: 'NO_END' });
  });

  it('cuenta los días que quedan hacia arriba: mañana a esta hora es 1 día', () => {
    expect(trialStatus({ tenant_type: 'TRIAL', trial_ends_at: '2026-11-24T12:00:00Z' }, NOW)).toMatchObject({ kind: 'ACTIVE', daysLeft: 7 });
    expect(trialStatus({ tenant_type: 'TRIAL', trial_ends_at: '2026-11-17T13:00:00Z' }, NOW)).toMatchObject({ kind: 'ACTIVE', daysLeft: 1 });
  });

  it('vencida cuenta los días transcurridos', () => {
    expect(trialStatus({ tenant_type: 'TRIAL', trial_ends_at: '2026-11-14T11:00:00Z' }, NOW)).toMatchObject({ kind: 'EXPIRED', daysAgo: 3 });
  });
});

describe('trialText', () => {
  it('dice la fecha y cuánto queda, en español', () => {
    const text = trialText(trialStatus({ tenant_type: 'TRIAL', trial_ends_at: '2026-11-24T12:00:00Z' }, NOW));
    expect(text).toMatch(/^Prueba vence el .+ \(quedan 7 días\)$/);
    expect(trialText(trialStatus({ tenant_type: 'TRIAL', trial_ends_at: '2026-11-17T13:00:00Z' }, NOW))).toMatch(/\(queda 1 día\)$/);
    expect(trialText(trialStatus({ tenant_type: 'TRIAL', trial_ends_at: '2026-11-14T11:00:00Z' }, NOW))).toMatch(/^Prueba vencida el .+ \(hace 3 días\)$/);
    expect(trialText({ kind: 'NO_END' })).toBe('Prueba sin vencimiento registrado');
  });
});

describe('fechas del diálogo', () => {
  it('la vista previa del alta suma los días del producto', () => {
    expect(trialEndPreview(7, NOW)).toBe(trialEndPreview(7, new Date('2026-11-17T12:00:00Z')));
    expect(trialEndPreview(null, NOW)).toBeNull();
  });

  it('el día elegido vence al final de ese día (hora local)', () => {
    const iso = endOfDayIso('2026-11-30')!;
    const d = new Date(iso);
    expect(toDateInput(d)).toBe('2026-11-30');
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(endOfDayIso('30/11/2026')).toBeNull();
  });
});
