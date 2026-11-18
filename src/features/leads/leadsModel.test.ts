import { describe, it, expect } from 'vitest';
import { leadPrefill, matchesTab, onboardingUrl, organizationDraftFrom, planLabel, slugFromCompany, tabOptions } from './leadsModel';
import { leadItems } from '@/features/inbox/inboxModel';

/*
 * Solicitudes de la web (leads.v1). Lo que se fija aquí:
 *   · «Abiertas» son las nuevas y las contactadas;
 *   · convertir propone la cuenta con un slug válido y los datos de la solicitud;
 *   · «Nueva venta» propone prueba, plan del MISMO producto, admin y país, y no activa el cobro;
 *   · la Bandeja avisa solo las NUEVAS, y pasado un día son urgentes.
 */
const lead = {
  id: 'l1', organization_id: null, saas_product_id: 'p-echange', plan_code: 'echange-mesa-completa',
  email: 'ana@andina.pe', company_name: 'Servicios Andinos S.A.C.', country_code: 'PE',
  received_at: '2026-11-17T10:00:00Z', status: 'NEW',
};

describe('solicitudes de la web', () => {
  it('pestañas: abiertas = nuevas + contactadas', () => {
    const rows = [{ status: 'NEW' }, { status: 'CONTACTED' }, { status: 'CONVERTED' }, { status: 'DISCARDED' }];
    expect(rows.filter((r) => matchesTab(r, 'OPEN'))).toHaveLength(2);
    expect(tabOptions(rows).find((t) => t.id === 'ALL')?.count).toBe(4);
  });

  it('el slug sale de la empresa: sin tildes, minúsculas y guiones', () => {
    expect(slugFromCompany('Servicios Andinos S.A.C.')).toBe('servicios-andinos-s-a-c');
    expect(slugFromCompany('Ñandú Perú')).toBe('nandu-peru');
    expect(slugFromCompany('X')).toMatch(/^cliente-/);
  });

  it('el cliente propuesto lleva empresa, país y correo', () => {
    expect(organizationDraftFrom(lead)).toMatchObject({
      legal_name: 'Servicios Andinos S.A.C.', display_name: 'Servicios Andinos S.A.C.', country_code: 'PE', billing_email: 'ana@andina.pe',
    });
  });

  it('«Nueva venta» propone prueba, plan del mismo producto, admin y país, sin activar el cobro', () => {
    const v = leadPrefill(
      lead,
      [{ id: 'p-echange', code: 'echange' }],
      [{ id: 'plan-a', code: 'echange-mesa-completa', saas_product_id: 'p-echange' }, { id: 'otro', code: 'echange-mesa-completa', saas_product_id: 'p-otro' }],
      [{ code: 'PE' }],
    );
    expect(v).toMatchObject({
      tenant_type: 'TRIAL', saas_product_code: 'echange', plan_id: 'plan-a', admin_email: 'ana@andina.pe',
      market_code: 'PE', activate: false, tenant_slug: 'servicios-andinos-s-a-c',
    });
  });

  it('un país sin mercado no se propone; un plan desconocido tampoco', () => {
    const v = leadPrefill({ ...lead, country_code: 'CL', plan_code: null }, [], [], [{ code: 'PE' }]);
    expect(v.market_code).toBeUndefined();
    expect(v.plan_id).toBeUndefined();
    expect(planLabel(null, [])).toBe('Sin preferencia');
  });

  it('la URL de «Nueva venta» lleva la solicitud y, si ya hay cuenta, la cuenta', () => {
    expect(onboardingUrl({ id: 'l1', organization_id: null })).toBe('/onboarding?solicitud=l1');
    expect(onboardingUrl({ id: 'l1', organization_id: 'o1' })).toBe('/onboarding?solicitud=l1&cuenta=o1');
  });

  it('Bandeja: solo las nuevas; pasado un día, urgentes', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    const items = leadItems(
      [
        { ...lead, contact_name: 'Ana' },
        { ...lead, id: 'l2', contact_name: 'Luis', received_at: '2026-11-15T10:00:00Z' },
        { ...lead, id: 'l3', contact_name: 'Eva', status: 'CONTACTED' },
      ],
      now,
    );
    expect(items.map((i) => [i.key, i.priority])).toEqual([['lead:l1:NEW', 2], ['lead:l2:NEW', 1]]);
    expect(items[0]).toMatchObject({ kind: 'lead', title: 'Servicios Andinos S.A.C. pidió una prueba', action: { to: '/solicitudes' } });
  });
});
