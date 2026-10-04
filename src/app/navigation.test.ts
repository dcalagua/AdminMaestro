import { describe, it, expect } from 'vitest';
import { navItemsFor, navGroupsFor, NAV_ITEMS, hasFinanceView, routeMeta } from './navigation';
import type { SessionRoles } from '@/types/domain';

describe('navegación por perfil', () => {
  it('EBIM ve todas las entradas', () => {
    expect(navItemsFor('EBIM')).toHaveLength(NAV_ITEMS.length);
  });

  it('un partner NO ve la sección de costos de EBIM', () => {
    // Los costos de infraestructura son información interna: un partner no debe
    // ver cuánto le cuesta a EBIM operarlo. RLS además lo bloquea en la base.
    const rutas = navItemsFor('PARTNER').map((i) => i.to);
    expect(rutas).not.toContain('/costs');
    expect(rutas).toContain('/tenants');
  });

  it('un comercial sólo ve su dominio comercial', () => {
    const rutas = navItemsFor('SALES_AGENT').map((i) => i.to);
    expect(rutas).toContain('/attributions');
    expect(rutas).toContain('/commissions');
    // Nada de infraestructura, facturación ni organizaciones ajenas.
    expect(rutas).not.toContain('/deployments');
    expect(rutas).not.toContain('/billing');
    expect(rutas).not.toContain('/organizations');
    expect(rutas).not.toContain('/costs');
  });

  it('un usuario de tenant no ve gestión de partners ni comerciales', () => {
    const rutas = navItemsFor('TENANT').map((i) => i.to);
    expect(rutas).not.toContain('/partners');
    expect(rutas).not.toContain('/sales-agents');
    expect(rutas).toContain('/tenants');
  });

  it('todos los perfiles conservan el dashboard', () => {
    for (const persona of ['EBIM', 'PARTNER', 'SALES_AGENT', 'TENANT'] as const) {
      expect(navItemsFor(persona).map((i) => i.to)).toContain('/');
    }
  });

  it('agrupa por arquitectura de negocio (spec §5)', () => {
    // Sustituye a la agrupación de la Fase 14 (Plataforma → … → Gobierno): la
    // spec aprobada reorganiza el menú por pregunta de negocio sin tocar URLs.
    const grupos = navGroupsFor('EBIM').map((g) => g.group);
    expect(grupos).toEqual([
      'Inicio', 'Clientes y canales', 'Productos y contratos', 'Finanzas', 'Operación SaaS', 'Gobierno',
    ]);
    expect(new Set(grupos).size).toBe(grupos.length);
  });

  it('conserva exactamente las 32 rutas existentes', () => {
    // CCP fase 07 añade `/catalog/addons` y `/commercial/capabilities`;
    // CCP fase 08 añade `/commercial/entitlement-sync`;
    // CCP M4 añade `/usage`, `/ai-credits` y `/billing-shadow`;
    // M5 añade `/users`.
    expect(NAV_ITEMS.map((i) => i.to).sort()).toEqual([
      '/', '/ai-credits', '/attributions', '/audit', '/billing', '/billing-shadow', '/catalog/addons',
      '/commercial/capabilities', '/commercial/entitlement-sync',
      '/commission-plans', '/commissions', '/costs',
      '/customers', '/deployments', '/feature-flags', '/integrations', '/onboarding', '/organizations',
      '/partners', '/plans', '/products', '/provisioning', '/reconciliation', '/regional', '/renewals',
      '/saas-provisioning', '/sales-agents', '/settings', '/subscriptions', '/tenants', '/usage', '/users',
    ]);
  });

  it('uso es operación SaaS de EBIM; créditos IA y billing shadow son finanzas de EBIM (CCP M4)', () => {
    const ebim = navItemsFor('EBIM').map((i) => i.to);
    for (const r of ['/usage', '/ai-credits', '/billing-shadow']) expect(ebim).toContain(r);
    for (const persona of ['PARTNER', 'SALES_AGENT', 'TENANT'] as const) {
      const rutas = navItemsFor(persona).map((i) => i.to);
      for (const r of ['/usage', '/ai-credits', '/billing-shadow']) expect(rutas).not.toContain(r);
    }
    // Perfil técnico EBIM: ve «Uso» pero no las pantallas financieras.
    const technical = navItemsFor('EBIM', { finance: false }).map((i) => i.to);
    expect(technical).toContain('/usage');
    expect(technical).not.toContain('/ai-credits');
    expect(technical).not.toContain('/billing-shadow');
    expect(routeMeta('/usage')).toMatchObject({ group: 'Operación SaaS', title: 'Uso', isDetail: false });
    expect(routeMeta('/ai-credits')).toMatchObject({ group: 'Finanzas', title: 'Créditos IA' });
    expect(routeMeta('/billing-shadow')).toMatchObject({ group: 'Finanzas', title: 'Billing shadow' });
  });

  it('etiquetas de negocio de la spec', () => {
    const label = (to: string) => NAV_ITEMS.find((i) => i.to === to)?.label;
    expect(label('/')).toBe('Resumen ejecutivo');
    expect(label('/feature-flags')).toBe('Capacidades');
    expect(label('/deployments')).toBe('Entornos y despliegues');
    expect(label('/saas-provisioning')).toBe('Altas SaaS');
    expect(label('/provisioning')).toBe('Solicitudes de infraestructura');
    expect(label('/organizations')).toBe('Directorio corporativo');
  });

  it('la reconciliación financiera es solo de EBIM', () => {
    // Cruza cobros de todos los clientes y estados del proveedor de pago: no es
    // información de un partner. RLS lo bloquea además en la base.
    expect(navItemsFor('PARTNER').map((i) => i.to)).not.toContain('/reconciliation');
    expect(navItemsFor('EBIM').map((i) => i.to)).toContain('/reconciliation');
  });

  it('el alta de cliente es solo de EBIM', () => {
    // `onboard_customer_subscription` exige rol de plataforma o finanzas.
    expect(navItemsFor('PARTNER').map((i) => i.to)).not.toContain('/onboarding');
    expect(navItemsFor('SALES_AGENT').map((i) => i.to)).not.toContain('/onboarding');
  });

  it('monedas, FX y moneda de reporte son administración de EBIM', () => {
    // V3: `set_reporting_settings` y `set_exchange_rate` exigen EBIM_FINANCE o super admin.
    expect(navItemsFor('EBIM').map((i) => i.to)).toContain('/regional');
    expect(navItemsFor('PARTNER').map((i) => i.to)).not.toContain('/regional');
    expect(navItemsFor('TENANT').map((i) => i.to)).not.toContain('/regional');
  });

  it('el registro de capacidades es de EBIM; add-ons y tarifas es financiero', () => {
    expect(navItemsFor('EBIM').map((i) => i.to)).toContain('/commercial/capabilities');
    for (const persona of ['PARTNER', 'SALES_AGENT', 'TENANT'] as const) {
      expect(navItemsFor(persona).map((i) => i.to)).not.toContain('/commercial/capabilities');
    }
    expect(navItemsFor('EBIM').map((i) => i.to)).toContain('/catalog/addons');
    expect(navItemsFor('EBIM', { finance: false }).map((i) => i.to)).not.toContain('/catalog/addons');
    expect(navItemsFor('TENANT').map((i) => i.to)).not.toContain('/catalog/addons');
  });

  it('un partner sí ve las renovaciones de su cartera', () => {
    expect(navItemsFor('PARTNER').map((i) => i.to)).toContain('/renewals');
  });
});

/*
 * V4 · Plano de provisioning.
 *
 * Ocultar una entrada es UX, no seguridad: cada ruta está además protegida por
 * RLS y por el gate de permiso del orquestador. Pero la configuración de CÓMO
 * se integra la suite no es asunto de un partner, y el menú tampoco debe
 * sugerírselo.
 */
describe('navegación del plano de provisioning', () => {
  it('EBIM ve integraciones y provisioning SaaS', () => {
    const rutas = navItemsFor('EBIM').map((i) => i.to);
    expect(rutas).toContain('/integrations');
    expect(rutas).toContain('/saas-provisioning');
  });

  it('un partner NO ve la configuración de integraciones', () => {
    const rutas = navItemsFor('PARTNER').map((i) => i.to);
    expect(rutas).not.toContain('/integrations');
  });

  it.each(['SALES_AGENT', 'TENANT'] as const)(
    'un %s no ve nada del plano de provisioning',
    (persona) => {
      const rutas = navItemsFor(persona).map((i) => i.to);
      expect(rutas).not.toContain('/integrations');
      expect(rutas).not.toContain('/saas-provisioning');
    },
  );

  it('los dos ejes de provisioning conviven con nombres distinguibles', () => {
    const infra = NAV_ITEMS.find((i) => i.to === '/provisioning');
    const saas = NAV_ITEMS.find((i) => i.to === '/saas-provisioning');
    expect(infra?.label).toBe('Solicitudes de infraestructura');
    expect(saas?.label).toBe('Altas SaaS');
    expect(infra?.label).not.toBe(saas?.label);
    expect(infra?.group).toBe(saas?.group);
  });
});

describe('finanzas y perfil técnico (spec §4)', () => {
  const base: SessionRoles = {
    userId: 'u', email: 'u@ebim.test', fullName: null, platformRole: null, organizations: [],
    tenantRoles: [], salesAgentId: null, provisioningRoles: [], ownedProductIds: [],
  };

  it('un propietario técnico (EBIM sin rol de plataforma) no obtiene el menú de finanzas', () => {
    const technical = { ...base, ownedProductIds: ['p1'] };
    const finance = hasFinanceView('EBIM', technical);
    expect(finance).toBe(false);
    const rutas = navItemsFor('EBIM', { finance }).map((i) => i.to);
    for (const r of ['/billing', '/costs', '/commissions', '/renewals', '/reconciliation', '/regional', '/subscriptions']) {
      expect(rutas).not.toContain(r);
    }
    expect(rutas).toContain('/integrations');
    expect(rutas).toContain('/saas-provisioning');
  });

  it('super admin y finanzas sí la obtienen; partner conserva su cartera', () => {
    expect(hasFinanceView('EBIM', { ...base, platformRole: 'EBIM_FINANCE' })).toBe(true);
    expect(hasFinanceView('EBIM', { ...base, platformRole: 'EBIM_SUPER_ADMIN' })).toBe(true);
    expect(hasFinanceView('PARTNER', base)).toBe(true);
  });
});

describe('migas y títulos humanos', () => {
  it('listado', () => {
    expect(routeMeta('/billing')).toMatchObject({ group: 'Finanzas', title: 'Facturación y cobros', isDetail: false });
  });
  it('fichas de detalle', () => {
    expect(routeMeta('/tenants/abc')).toMatchObject({ group: 'Productos y contratos', title: 'Tenant 360', isDetail: true });
    expect(routeMeta('/organizations/x')).toMatchObject({ title: 'Ficha 360', isDetail: true });
    expect(routeMeta('/subscriptions/x')).toMatchObject({ title: 'Contrato 360' });
  });
  it('la sincronización de entitlements es operación de EBIM (CCP fase 08)', () => {
    expect(navItemsFor('EBIM').map((i) => i.to)).toContain('/commercial/entitlement-sync');
    for (const persona of ['PARTNER', 'SALES_AGENT', 'TENANT'] as const) {
      expect(navItemsFor(persona).map((i) => i.to)).not.toContain('/commercial/entitlement-sync');
    }
    expect(routeMeta('/commercial/entitlement-sync')).toMatchObject({
      group: 'Operación SaaS', title: 'Sincronización de entitlements', isDetail: false,
    });
  });
  it('rutas de dos segmentos del catálogo comercial (CCP fase 07)', () => {
    expect(routeMeta('/catalog/addons')).toMatchObject({
      group: 'Productos y contratos', title: 'Add-ons y tarifas', isDetail: false,
    });
    expect(routeMeta('/commercial/capabilities')).toMatchObject({
      group: 'Productos y contratos', title: 'Registro de capacidades', isDetail: false,
    });
    expect(routeMeta('/catalog').title).toBe('Página no encontrada');
  });
  it('inicio y no encontrado', () => {
    expect(routeMeta('/').title).toBe('Resumen ejecutivo');
    expect(routeMeta('/nada').title).toBe('Página no encontrada');
  });

  it('«Usuarios y accesos» es Gobierno para EBIM y admins de partner/cliente (M5)', () => {
    expect(navItemsFor('EBIM').map((i) => i.to)).toContain('/users');
    expect(navItemsFor('PARTNER').map((i) => i.to)).toContain('/users');
    expect(navItemsFor('SALES_AGENT').map((i) => i.to)).not.toContain('/users');
    expect(navItemsFor('TENANT').map((i) => i.to)).not.toContain('/users');
    // No es financiero: el perfil técnico de EBIM también la ve (la RPC decide).
    expect(navItemsFor('EBIM', { finance: false }).map((i) => i.to)).toContain('/users');
    expect(routeMeta('/users')).toMatchObject({ group: 'Gobierno', title: 'Usuarios y accesos', isDetail: false });
    expect(routeMeta('/users/10000000-0000-4000-a000-000000000001')).toMatchObject({
      group: 'Gobierno', title: 'Ficha de usuario', isDetail: true,
    });
  });
});
