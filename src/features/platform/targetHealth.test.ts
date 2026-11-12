import { describe, it, expect } from 'vitest';
import { isEvaluable, observedHealth, summarizeByEnvironment } from './targetHealth';

const qasOk = {
  provisioning_environment: 'QAS',
  provisioning_enabled: true,
  provisioning_status: 'READY',
  health_status: 'HEALTHY',
  health_checked_at: '2026-09-20T10:00:00Z',
};
const prdDown = {
  provisioning_environment: 'PRD',
  provisioning_enabled: true,
  provisioning_status: 'READY',
  health_status: 'UNHEALTHY',
  health_checked_at: '2026-09-21T10:00:00Z',
};
const qasDisabledDown = {
  provisioning_environment: 'QAS',
  provisioning_enabled: false,
  provisioning_status: 'READY',
  health_status: 'UNHEALTHY',
  health_checked_at: '2026-09-22T10:00:00Z',
};
const qasDraftDown = { ...qasDisabledDown, provisioning_enabled: true, provisioning_status: 'DRAFT' };

describe('summarizeByEnvironment', () => {
  it('no mezcla entornos: PRD caído no contamina QAS sano', () => {
    const [qas, prd] = summarizeByEnvironment([prdDown, qasOk]);
    expect(qas).toMatchObject({ environment: 'QAS', health: 'HEALTHY', latestCheckedAt: qasOk.health_checked_at });
    expect(prd).toMatchObject({ environment: 'PRD', health: 'UNHEALTHY' });
  });

  it('deshabilitados y borradores no entran en el resumen del entorno', () => {
    const [qas] = summarizeByEnvironment([qasOk, qasDisabledDown, qasDraftDown]);
    expect(qas).toMatchObject({ health: 'HEALTHY', evaluated: 1, notEvaluated: 2, total: 3 });
    // La fecha es la de la observación evaluada, no la del destino deshabilitado.
    expect(qas?.latestCheckedAt).toBe(qasOk.health_checked_at);
  });

  it('un entorno sin destinos habilitados es «No evaluado», no un fallo', () => {
    const [qas] = summarizeByEnvironment([qasDisabledDown]);
    expect(qas?.health).toBe('NOT_EVALUATED');
    expect(observedHealth(qasDisabledDown)).toBe('NOT_EVALUATED');
  });

  it('habilitado no significa sano: sin comprobación queda UNKNOWN', () => {
    const neverChecked = { ...qasOk, health_status: 'UNKNOWN', health_checked_at: null };
    const [qas] = summarizeByEnvironment([neverChecked]);
    expect(isEvaluable(neverChecked)).toBe(true);
    expect(qas).toMatchObject({ health: 'UNKNOWN', latestCheckedAt: null, neverChecked: 1 });
  });
});
