import { describe, expect, it } from 'vitest';
import { altaEnvironments, altaState, customerProgress, flowFor } from './flowModel';

const req = (status: string, extra: Record<string, unknown> = {}) =>
  ({ id: 'r1', status, attempt_count: 1, max_attempts: 3, last_error_code: null, last_error_message: null, ...extra }) as never;

describe('hilo del flujo', () => {
  it('venta: seis fases visibles y el contrato se crea en el paso 5', () => {
    const f = flowFor('SALE');
    expect(f.phases.map((p) => p.label)).toEqual([
      'Cuenta', 'Plan y precio', 'Contrato', 'Primera factura', 'Enlace de pago', 'Alta en las apps',
    ]);
    expect(f.createStep).toBe(5);
    expect(f.steps.at(-1)?.phase).toBe('alta');
  });

  it('«Nuevo tenant»: sólo cuenta, tenant y alta en la app', () => {
    const f = flowFor('APP');
    expect(f.phases.map((p) => p.label)).toEqual(['Cuenta y app', 'Tenant', 'Alta en la app']);
    expect(f.createStep).toBe(2);
  });
});

describe('altaState', () => {
  it('traduce cada estado al resultado por app', () => {
    expect(altaState(null).outcome).toBe('NONE');
    expect(altaState(req('READY_TO_PROVISION')).outcome).toBe('READY');
    expect(altaState(req('ACTIVE'))).toMatchObject({ outcome: 'ACTIVE', label: 'Activo', tone: 'ok' });
    expect(altaState(req('PENDING'))).toMatchObject({ outcome: 'PENDING', label: 'Pendiente' });
    expect(altaState(req('WAITING_INFRA')).reason).toMatch(/infraestructura/);
    // Cancelada: se puede pedir una nueva.
    expect(altaState(req('CANCELLED'))).toMatchObject({ outcome: 'NONE', requestId: null });
  });

  it('falló: con motivo y sabiendo si queda intento para la misma solicitud', () => {
    const failed = altaState(req('FAILED', { last_error_message: 'Timeout de la app' }));
    expect(failed).toMatchObject({ outcome: 'FAILED', label: 'Falló', canRetrySame: true });
    expect(failed.reason).toBe('Timeout de la app');
    expect(altaState(req('FAILED', { attempt_count: 3 })).canRetrySame).toBe(false);
  });
});

describe('altaEnvironments', () => {
  const t = (env: string, enabled = true, status = 'READY', product = 'p1') =>
    ({ saas_product_id: product, provisioning_enabled: enabled, provisioning_status: status, provisioning_environment: env }) as never;

  it('sólo destinos habilitados de esa app, del más productivo al menos', () => {
    const envs = altaEnvironments([t('QAS'), t('PRD'), t('DEV', false), t('DEMO', true, 'DRAFT'), t('QAS', true, 'READY', 'p2')], 'p1');
    expect(envs.map((e) => e.value)).toEqual(['PRD', 'QAS']);
    expect(envs[1]?.label).toBe('Calidad');
  });

  it('sin destino habilitado no hay ambiente', () => {
    expect(altaEnvironments([t('QAS', false)], 'p1')).toEqual([]);
  });
});

describe('customerProgress', () => {
  it('el siguiente paso es el primero sin hacer', () => {
    const r = customerProgress({ contracts: 1, invoicesIssued: 1, paymentLinks: 0, paid: false, apps: [{ name: 'EWM', active: false }] });
    expect(r.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'todo', 'todo', 'todo']);
    expect(r.next?.id).toBe('enlace');
  });

  it('sin vista financiera lo dice; no lo da por hecho ni por pendiente', () => {
    const r = customerProgress({ contracts: 0, invoicesIssued: null, paymentLinks: null, paid: null, apps: [] });
    expect(r.steps.find((s) => s.id === 'factura')).toMatchObject({ state: 'unknown', detail: 'Visible con permisos de finanzas' });
    expect(r.next?.id).toBe('contrato');
    expect(r.steps.find((s) => s.id === 'alta')?.detail).toBe('Sin tenants en la suite');
  });

  it('alta completa cuando todas las apps están activas', () => {
    const r = customerProgress({
      contracts: 2, invoicesIssued: 3, paymentLinks: 1, paid: true,
      apps: [{ name: 'EWM', active: true }, { name: 'TMS', active: true }],
    });
    expect(r.next).toBeNull();
    expect(r.steps.find((s) => s.id === 'alta')?.detail).toBe('2 de 2 apps activas');
  });
});
