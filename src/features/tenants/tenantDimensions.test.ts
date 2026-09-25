import { describe, expect, it } from 'vitest';
import { tenantDimensions } from './tenantDimensions';

/*
 * P31/P32 · Cuatro dimensiones separadas (spec §11.2, AC12).
 * Fixture obligatorio: comercial PENDING + mapping ACTIVE + MRR 0 +
 * administrador PREPROVISIONED, sin un semáforo global falso.
 */
const tenant = { status: 'PENDING', tenant_type: 'PRODUCTION', mrr: 0, currency: null, environment: 'QAS' };
const saas = [
  {
    status: 'ACTIVE',
    mapping_status: 'ACTIVE',
    requested_at: '2026-09-24T10:00:00Z',
    product_short_name: 'EWM',
    provisioning_environment: 'QAS',
    deployment_target_id: 't1',
    mapping_metadata: { resources: { adminProvisioningStatus: 'PREPROVISIONED' } },
  },
];
const targets = [{ deployment_target_id: 't1', health_status: 'HEALTHY', health_checked_at: '2026-09-25T06:17:22Z', provisioning_enabled: true, provisioning_status: 'READY' }];

describe('tenantDimensions', () => {
  const d = tenantDimensions(tenant, saas, targets);

  it('comercial PENDING no se convierte en «no provisionado» ni en fallo', () => {
    expect(d.commercial.label).toBe('Pendiente de activación comercial');
    expect(d.commercial.detail).toMatch(/no refleja el acceso remoto/i);
    expect(d.commercial.tone).toBe('warn');
  });

  it('alta técnica ACTIVE con mapping ACTIVE se muestra como tal', () => {
    expect(d.technical.label).toBe('Alta registrada · mapping activo');
    expect(d.technical.tone).toBe('ok');
  });

  it('MRR 0 se dice como cero real, sin «USD 0» inventado', () => {
    expect(d.commercial.mrr).toBe('Sin recurrente vigente');
  });

  it('salud es una observación fechada, no uptime', () => {
    expect(d.health.label).toBe('Última observación: respondió sano');
    expect(d.health.detail).toMatch(/2026|set/);
    expect(d.health.detail).not.toMatch(/uptime|tiempo real/i);
  });

  it('PREPROVISIONED no implica un usuario que ya puede entrar', () => {
    expect(d.admin.label).toBe('Administrador preaprovisionado');
    expect(d.admin.detail).toMatch(/no implica que ya pueda iniciar sesión/i);
    expect(d.admin.tone).toBe('info');
  });

  it('no existe un estado global: las cuatro dimensiones se exponen por separado', () => {
    expect(Object.keys(d).sort()).toEqual(['admin', 'commercial', 'health', 'technical']);
  });

  it('sin alta ni mapping: se dice, no se inventa', () => {
    const none = tenantDimensions({ ...tenant, status: 'ACTIVE' }, [], []);
    expect(none.technical.label).toBe('Sin alta SaaS registrada');
    expect(none.health.label).toBe('Sin observación de salud');
    expect(none.admin.label).toBe('Sin dato del producto');
  });

  it('destino deshabilitado: no evaluado, no «caído»', () => {
    const dis = tenantDimensions(tenant, saas, [{ ...targets[0]!, provisioning_enabled: false, provisioning_status: 'DRAFT' }]);
    expect(dis.health.label).toBe('Destino no evaluado');
  });
});
