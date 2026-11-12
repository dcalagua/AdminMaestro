import { describe, it, expect } from 'vitest';
import {
  navItemsFor, navGroupsFor, NAV_ITEMS, hasFinanceView, routeMeta, visibleTabs, tabHref, LEGACY_REDIRECTS,
  navDestinations, navAccessFor, type NavAccess,
} from './navigation';
import type { PersonaKind } from '@/features/auth/session';
import type { SessionRoles } from '@/types/domain';

type Options = { finance?: boolean; superAdmin?: boolean };

/** Pestañas sin ruta vieja propia: la entrada conserva la URL de la pantalla original. */
const HOME_TAB_ROUTE: Record<string, string> = {
  '/sales-agents?tab=equipo': '/sales-agents',
  '/commissions?tab=comisiones': '/commissions',
  '/settings?tab=general': '/settings',
};

/**
 * Pantallas (con su ruta ANTERIOR a la V5) que un perfil ve: una entrada simple
 * es su propia ruta; una entrada con pestañas, las rutas que absorben sus
 * pestañas visibles.
 */
function screens(persona: PersonaKind, options: Options = {}): string[] {
  const access: NavAccess = { persona, finance: options.finance ?? true, superAdmin: options.superAdmin ?? false };
  return navItemsFor(persona, options).flatMap((item) =>
    item.tabs
      ? visibleTabs(item, access).flatMap((t) => {
          const href = tabHref(item, t.id);
          return [...(t.legacy ?? []), ...(HOME_TAB_ROUTE[href] ? [HOME_TAB_ROUTE[href]] : [])];
        })
      : [item.to],
  );
}

/**
 * Reglas de visibilidad del menú ANTES de la V5 (32 entradas). La V5 reorganiza,
 * pero no puede abrir ni cerrar ninguna pantalla a ningún rol.
 */
const EP: PersonaKind[] = ['EBIM', 'PARTNER'];
const E: PersonaKind[] = ['EBIM'];
const OLD_RULES: Record<string, { personas?: PersonaKind[]; finance?: boolean; superAdmin?: boolean }> = {
  '/': {},
  '/customers': { personas: EP }, '/partners': { personas: EP }, '/organizations': { personas: EP },
  '/sales-agents': { personas: EP }, '/attributions': {},
  '/products': {}, '/plans': {}, '/feature-flags': {}, '/commercial/capabilities': { personas: E },
  '/catalog/addons': { personas: EP, finance: true }, '/onboarding': { personas: E }, '/tenants': {},
  '/subscriptions': { personas: EP, finance: true },
  '/billing': { personas: EP, finance: true }, '/costs': { personas: E, finance: true },
  '/commissions': { finance: true }, '/commission-plans': { personas: EP, finance: true },
  '/renewals': { personas: EP, finance: true }, '/reconciliation': { personas: E, finance: true },
  '/regional': { personas: E, finance: true }, '/ai-credits': { personas: E, finance: true },
  // V5: la comparación de cobro pasa a «Avanzado», sólo para el super admin (plan §4).
  '/billing-shadow': { personas: E, finance: true, superAdmin: true },
  '/partner-fees': { personas: E, finance: true },
  '/integrations': { personas: E }, '/commercial/entitlement-sync': { personas: E }, '/usage': { personas: E },
  '/deployments': { personas: EP }, '/saas-provisioning': { personas: EP }, '/provisioning': { personas: EP },
  '/users': { personas: EP }, '/audit': { personas: EP }, '/settings': {},
};

function oldScreens(persona: PersonaKind, options: Options = {}): string[] {
  return Object.entries(OLD_RULES)
    .filter(([, r]) => (!r.personas || r.personas.includes(persona)) && (!r.finance || (options.finance ?? true)))
    .filter(([, r]) => !r.superAdmin || options.superAdmin)
    .map(([route]) => route);
}

/** Entradas nuevas de la V5 sin pantalla anterior. */
const NEW_ENTRIES = ['/bandeja', '/suite'];

describe('menú V5: seis grupos, 18 entradas (plan §4)', () => {
  it('grupos por tarea, en orden', () => {
    expect(navGroupsFor('EBIM').map((g) => g.group)).toEqual([
      'Inicio', 'Clientes', 'Suite', 'Comercial', 'Finanzas', 'Gobierno',
    ]);
  });

  it('las entradas de cada grupo son las de la tabla del plan', () => {
    const byGroup = Object.fromEntries(
      navGroupsFor('EBIM', { superAdmin: true }).map((g) => [g.group, g.items.map((i) => i.label)]),
    );
    expect(byGroup).toEqual({
      Inicio: ['Resumen', 'Bandeja'],
      Clientes: ['Cuentas', 'Partners', 'Equipo comercial'],
      Suite: ['Centro de la suite', 'Tenants', 'Apps'],
      Comercial: ['Nueva venta', 'Contratos', 'Catálogo'],
      Finanzas: ['Cobranza', 'Comisiones', 'Costos y margen', 'Tarifas de partners'],
      Gobierno: ['Usuarios', 'Auditoría', 'Configuración'],
    });
    expect(NAV_ITEMS).toHaveLength(18);
  });

  it('las fusiones llevan sus pestañas', () => {
    const tabs = (to: string) => NAV_ITEMS.find((i) => i.to === to)?.tabs?.map((t) => t.id);
    expect(tabs('/cuentas')).toEqual(['clientes', 'directorio']);
    expect(tabs('/catalogo')).toEqual(['productos', 'planes', 'addons', 'capacidades', 'registro']);
    expect(tabs('/cobranza')).toEqual(['por-cobrar', 'facturacion', 'renovaciones', 'conciliacion']);
    expect(tabs('/commissions')).toEqual(['comisiones', 'planes']);
    expect(tabs('/apps')).toEqual(['integraciones', 'altas', 'sincronizacion', 'uso', 'entornos', 'infraestructura']);
    expect(tabs('/sales-agents')).toEqual(['equipo', 'atribuciones']);
    expect(tabs('/settings')).toEqual(['general', 'regional', 'creditos-ia', 'avanzado']);
  });
});

describe('permisos: la V5 no abre ni cierra ninguna pantalla', () => {
  const personas: PersonaKind[] = ['EBIM', 'PARTNER', 'SALES_AGENT', 'TENANT'];
  const profiles: Options[] = [
    { finance: true, superAdmin: true },
    { finance: true, superAdmin: false },
    { finance: false, superAdmin: false },
  ];
  for (const persona of personas) {
    for (const options of profiles) {
      it(`${persona} · finanzas=${options.finance} · super admin=${options.superAdmin}`, () => {
        const now = screens(persona, options).filter((r) => !NEW_ENTRIES.includes(r)).sort();
        const before = oldScreens(persona, options).sort();
        expect(now).toEqual(before);
        // Además de las pantallas de siempre, sólo las entradas nuevas.
        const tos = navItemsFor(persona, options).map((i) => i.to);
        for (const to of tos) {
          const item = NAV_ITEMS.find((i) => i.to === to)!;
          expect(item.tabs || OLD_RULES[to] || NEW_ENTRIES.includes(to)).toBeTruthy();
        }
      });
    }
  }

  it('el partner y el técnico ven menos entradas y pestañas', () => {
    const ebim = navItemsFor('EBIM').length;
    expect(navItemsFor('PARTNER').length).toBeLessThan(ebim);
    expect(navItemsFor('EBIM', { finance: false }).length).toBeLessThan(ebim);
    // Técnico EBIM: el grupo Finanzas desaparece entero.
    expect(navGroupsFor('EBIM', { finance: false }).map((g) => g.group)).not.toContain('Finanzas');
    // Partner: Apps sin Integraciones, Uso ni Módulos habilitados.
    const apps = NAV_ITEMS.find((i) => i.to === '/apps')!;
    expect(visibleTabs(apps, { persona: 'PARTNER', finance: true, superAdmin: false }).map((t) => t.id)).toEqual([
      'altas', 'entornos', 'infraestructura',
    ]);
  });

  it('el centro de la suite es de EBIM; la bandeja, de todos', () => {
    expect(navItemsFor('EBIM', { finance: false }).map((i) => i.to)).toContain('/suite');
    expect(navItemsFor('PARTNER').map((i) => i.to)).not.toContain('/suite');
    for (const persona of personas) expect(navItemsFor(persona).map((i) => i.to)).toContain('/bandeja');
  });

  it('«Avanzado» (comparación de cobro) sólo para el super admin', () => {
    const settings = NAV_ITEMS.find((i) => i.to === '/settings')!;
    const ids = (access: NavAccess) => visibleTabs(settings, access).map((t) => t.id);
    expect(ids({ persona: 'EBIM', finance: true, superAdmin: true })).toContain('avanzado');
    expect(ids({ persona: 'EBIM', finance: true, superAdmin: false })).not.toContain('avanzado');
    expect(ids({ persona: 'PARTNER', finance: true, superAdmin: false })).toEqual(['general']);
  });

  it('el perfil sale de la sesión', () => {
    const base: SessionRoles = {
      userId: 'u', email: 'u@ebim.test', fullName: null, platformRole: null, organizations: [],
      tenantRoles: [], salesAgentId: null, provisioningRoles: [], ownedProductIds: [],
    };
    expect(navAccessFor('EBIM', { ...base, platformRole: 'EBIM_SUPER_ADMIN' })).toEqual({
      persona: 'EBIM', finance: true, superAdmin: true,
    });
    expect(navAccessFor('EBIM', { ...base, platformRole: 'EBIM_FINANCE' })).toMatchObject({ superAdmin: false });
    expect(navAccessFor('EBIM', { ...base, ownedProductIds: ['p'] })).toMatchObject({ finance: false });
  });
});

describe('rutas viejas', () => {
  it('cada pantalla fusionada redirige a su nueva casa con la pestaña correcta', () => {
    const map = Object.fromEntries(LEGACY_REDIRECTS.map((r) => [r.from, `${r.to}?tab=${r.tab}`]));
    expect(map).toEqual({
      '/customers': '/cuentas?tab=clientes',
      '/organizations': '/cuentas?tab=directorio',
      '/attributions': '/sales-agents?tab=atribuciones',
      '/integrations': '/apps?tab=integraciones',
      '/saas-provisioning': '/apps?tab=altas',
      '/commercial/entitlement-sync': '/apps?tab=sincronizacion',
      '/usage': '/apps?tab=uso',
      '/deployments': '/apps?tab=entornos',
      '/provisioning': '/apps?tab=infraestructura',
      '/products': '/catalogo?tab=productos',
      '/plans': '/catalogo?tab=planes',
      '/catalog/addons': '/catalogo?tab=addons',
      '/feature-flags': '/catalogo?tab=capacidades',
      '/commercial/capabilities': '/catalogo?tab=registro',
      '/billing': '/cobranza?tab=facturacion',
      '/renewals': '/cobranza?tab=renovaciones',
      '/reconciliation': '/cobranza?tab=conciliacion',
      '/commission-plans': '/commissions?tab=planes',
      '/regional': '/settings?tab=regional',
      '/ai-credits': '/settings?tab=creditos-ia',
      '/billing-shadow': '/settings?tab=avanzado',
    });
  });

  it('todas las rutas de antes siguen existiendo (como entrada o como redirección)', () => {
    const alive = new Set([...NAV_ITEMS.map((i) => i.to), ...LEGACY_REDIRECTS.map((r) => r.from)]);
    for (const route of Object.keys(OLD_RULES)) expect(alive).toContain(route);
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
    const rutas = screens('EBIM', { finance });
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
  it('entrada', () => {
    expect(routeMeta('/cobranza')).toMatchObject({ group: 'Finanzas', title: 'Cobranza', isDetail: false });
    expect(routeMeta('/apps')).toMatchObject({ group: 'Suite', title: 'Apps' });
  });
  it('fichas de detalle: conservan su URL y cuelgan de la entrada dueña', () => {
    expect(routeMeta('/tenants/abc')).toMatchObject({ group: 'Suite', title: 'Tenant 360', isDetail: true, parentTo: '/tenants' });
    expect(routeMeta('/organizations/x')).toMatchObject({ group: 'Clientes', title: 'Ficha 360', parentTo: '/cuentas' });
    expect(routeMeta('/subscriptions/x')).toMatchObject({ group: 'Comercial', title: 'Contrato 360' });
    expect(routeMeta('/products/x')).toMatchObject({ title: 'Ficha de producto', parentTo: '/catalogo?tab=productos' });
    expect(routeMeta('/integrations/x')).toMatchObject({ group: 'Suite', parentTo: '/apps?tab=integraciones' });
    // V5 · F2: la ficha de app cuelga del Centro de la suite; `/apps` sigue siendo «Apps».
    expect(routeMeta('/apps/ewm')).toMatchObject({ group: 'Suite', title: 'Ficha de app', isDetail: true, parentTo: '/suite' });
    expect(routeMeta('/users/10000000-0000-4000-a000-000000000001')).toMatchObject({
      group: 'Gobierno', title: 'Ficha de usuario', isDetail: true,
    });
  });
  it('inicio y no encontrado', () => {
    expect(routeMeta('/').title).toBe('Resumen ejecutivo');
    expect(routeMeta('/nada').title).toBe('Página no encontrada');
    expect(routeMeta('/catalog').title).toBe('Página no encontrada');
  });
  it('la galería de componentes tiene título propio aunque no esté en el menú', () => {
    expect(routeMeta('/design')).toMatchObject({ group: null, title: 'Galería de componentes' });
    expect(NAV_ITEMS.map((i) => i.to)).not.toContain('/design');
  });
});

describe('destinos de ⌘K', () => {
  it('incluye las pestañas que el perfil ve, con sus nombres anteriores', () => {
    const access: NavAccess = { persona: 'EBIM', finance: true, superAdmin: false };
    const all = navDestinations(navItemsFor('EBIM'), access);
    const conciliacion = all.find((d) => d.to === '/cobranza?tab=conciliacion');
    expect(conciliacion).toMatchObject({ label: 'Conciliación', hint: 'Cobranza · Finanzas', isTab: true });
    expect(all.find((d) => d.to === '/apps?tab=sincronizacion')?.keywords).toContain('Sincronización de entitlements');
    expect(all.map((d) => d.to)).not.toContain('/settings?tab=avanzado');
  });
  it('un partner no recibe destinos de pestañas que no ve', () => {
    const access: NavAccess = { persona: 'PARTNER', finance: true, superAdmin: false };
    const tos = navDestinations(navItemsFor('PARTNER'), access).map((d) => d.to);
    expect(tos).toContain('/cobranza?tab=renovaciones');
    expect(tos).not.toContain('/cobranza?tab=conciliacion');
    expect(tos).not.toContain('/apps?tab=integraciones');
  });
});
