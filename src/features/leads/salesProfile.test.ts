import { describe, it, expect } from 'vitest';
import { canWorkLead, onboardingUrlForTrial, ownerLabel, trialDraftFrom, trialRequestPrefill, type SalesReminder } from './leadsModel';
import { reminderItems, trialRequestItems } from '@/features/inbox/inboxModel';

/*
 * Perfil comercial (2026-11-18). Lo que se fija aquí:
 *   · un comercial mueve solo lo libre o lo suyo, nunca lo convertido; EBIM, todo;
 *   · pedir prueba desde una solicitud propone sus datos y el plan de ESA app;
 *   · «Nueva venta» desde un pedido: TRIAL, sin cobro y con el comercial atribuido;
 *   · los recordatorios llevan a lo que el comercial puede abrir y el vencido es urgente;
 *   · un pedido pendiente avisa a EBIM y, pasado un día, es urgente.
 */
const NOW = new Date('2026-11-18T12:00:00Z');
const me = { canManageCommercial: false, salesAgentId: 'sa-yo' };

describe('quién mueve una solicitud', () => {
  it('libre o propia sí; de otro o convertida no; EBIM siempre', () => {
    expect(canWorkLead({ status: 'NEW', owner_sales_agent_id: null }, me)).toBe(true);
    expect(canWorkLead({ status: 'CONTACTED', owner_sales_agent_id: 'sa-yo' }, me)).toBe(true);
    expect(canWorkLead({ status: 'CONTACTED', owner_sales_agent_id: 'sa-otro' }, me)).toBe(false);
    expect(canWorkLead({ status: 'CONVERTED', owner_sales_agent_id: 'sa-yo' }, me)).toBe(false);
    expect(canWorkLead({ status: 'CONTACTED', owner_sales_agent_id: 'sa-otro' }, { canManageCommercial: true, salesAgentId: null })).toBe(true);
    expect(canWorkLead({ status: 'NEW', owner_sales_agent_id: null }, { canManageCommercial: false, salesAgentId: null })).toBe(false);
  });

  it('«Tomada por»: por ti, por su nombre o por otro comercial', () => {
    expect(ownerLabel({ owner_sales_agent_id: null }, 'sa-yo')).toBeNull();
    expect(ownerLabel({ owner_sales_agent_id: 'sa-yo' }, 'sa-yo')).toBe('Tomada por ti');
    expect(ownerLabel({ owner_sales_agent_id: 'sa-2', owner: { full_name: 'Carla' } }, null)).toBe('Tomada por Carla');
    expect(ownerLabel({ owner_sales_agent_id: 'sa-2', owner: null }, 'sa-yo')).toBe('Tomada por otro comercial');
  });
});

describe('pedir la prueba', () => {
  const plans = [
    { id: 'pl-a', code: 'echange-mesa-completa', saas_product_id: 'p-echange' },
    { id: 'pl-x', code: 'echange-mesa-completa', saas_product_id: 'p-otra' },
  ];

  it('desde una solicitud propone sus datos y el plan de ESA app', () => {
    const d = trialDraftFrom({
      id: 'l1', saas_product_id: 'p-echange', plan_code: 'echange-mesa-completa', company_name: 'Andina',
      contact_name: 'Ana', email: 'ana@andina.pe', country_code: 'PE', message: null,
    }, plans);
    expect(d).toMatchObject({ leadId: 'l1', productId: 'p-echange', planId: 'pl-a', adminEmail: 'ana@andina.pe', countryCode: 'PE' });
  });

  it('sin solicitud llega vacío', () => {
    expect(trialDraftFrom(null, plans)).toMatchObject({ leadId: null, productId: '', planId: '' });
  });

  it('«Nueva venta» desde el pedido: TRIAL, sin cobro y con el comercial', () => {
    const v = trialRequestPrefill({
      saas_product_id: 'p-echange', plan_id: 'pl-a', admin_email: 'ana@andina.pe', company_name: 'Servicios Andinos S.A.C.',
      country_code: 'PE', created_at: '2026-11-18T10:00:00Z', sales_agent_id: 'sa-yo',
    }, [{ id: 'p-echange', code: 'echange' }], [{ code: 'PE' }]);
    expect(v).toMatchObject({
      tenant_type: 'TRIAL', activate: false, saas_product_code: 'echange', plan_id: 'pl-a', market_code: 'PE',
      sales_agent_id: 'sa-yo', tenant_slug: 'servicios-andinos-s-a-c', admin_email: 'ana@andina.pe',
    });
    expect(onboardingUrlForTrial('tr-1', 'org-1')).toBe('/onboarding?prueba=tr-1&cuenta=org-1');
  });
});

describe('Bandeja del perfil comercial', () => {
  const r = (over: Partial<SalesReminder>): SalesReminder => ({
    type: 'INVOICE_OVERDUE', ref_id: 'x', title: 'F001-1', organization_id: 'o-1', organization_name: 'Andina',
    product: null, date: '2026-11-10', amount: 100, currency: 'USD', tenant_id: null, note: null, ...over,
  });

  it('cada recordatorio lleva a la ficha que el comercial puede abrir', () => {
    const [inv, trial, rejected] = reminderItems([
      r({}),
      r({ type: 'TRIAL_EXPIRED', ref_id: 't-1', title: 'Andina prueba', tenant_id: 't-1', amount: null, currency: null }),
      r({ type: 'TRIAL_REJECTED', ref_id: 'tr-1', note: 'Ya es cliente', amount: null }),
    ], NOW);
    expect(inv).toMatchObject({ kind: 'reminder', priority: 2, amount: { value: 100, currency: 'USD' } });
    expect(inv!.action).toMatchObject({ to: '/organizations/o-1' });
    expect(trial).toMatchObject({ priority: 1, title: 'La prueba de Andina prueba venció' });
    expect(trial!.action).toMatchObject({ to: '/tenants/t-1' });
    expect(rejected).toMatchObject({ detail: 'Ya es cliente' });
    expect(rejected!.action).toMatchObject({ to: '/solicitudes' });
  });

  it('una factura con más de 30 días vencida es urgente', () => {
    expect(reminderItems([r({ date: '2026-09-01' })], NOW)[0]!.priority).toBe(1);
  });

  it('un pedido de prueba pendiente avisa a EBIM; pasado un día, urgente', () => {
    const items = trialRequestItems([
      { id: 'a', status: 'PENDING', company_name: 'Andina', created_at: '2026-11-18T11:00:00Z', sales_agents: { full_name: 'Carla' } },
      { id: 'b', status: 'PENDING', company_name: 'Vieja', created_at: '2026-11-16T11:00:00Z' },
      { id: 'c', status: 'APPROVED', company_name: 'Lista', created_at: '2026-11-10T11:00:00Z' },
    ], NOW);
    expect(items.map((i) => [i.title, i.priority])).toEqual([
      ['Carla pidió una prueba para Andina', 2],
      ['Un comercial pidió una prueba para Vieja', 1],
    ]);
  });
});
