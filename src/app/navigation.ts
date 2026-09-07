import type { PersonaKind } from '@/features/auth/session';

/**
 * Navegación de la consola.
 *
 * El menú se adapta al rol (contrato/prompt fase 9), pero eso es UX, NO
 * seguridad: cada ruta se protege además con `<RequirePersona>` y, sobre todo,
 * cada consulta está filtrada por RLS. Ocultar un menú no protege nada.
 */
export interface NavItem {
  to: string;
  label: string;
  /** Personas que ven la entrada. Vacío = todas. */
  personas?: PersonaKind[];
  group: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', group: 'General' },

  { to: '/products', label: 'SaaS Products', group: 'Catálogo' },
  { to: '/plans', label: 'Planes y licencias', group: 'Catálogo' },
  { to: '/feature-flags', label: 'Feature flags', group: 'Catálogo' },

  { to: '/organizations', label: 'Organizaciones', group: 'Cuentas', personas: ['EBIM', 'PARTNER'] },
  { to: '/partners', label: 'Partners / Resellers', group: 'Cuentas', personas: ['EBIM', 'PARTNER'] },
  { to: '/customers', label: 'Clientes', group: 'Cuentas', personas: ['EBIM', 'PARTNER'] },
  { to: '/tenants', label: 'Tenants', group: 'Cuentas' },
  { to: '/onboarding', label: 'Nueva venta', group: 'Cuentas', personas: ['EBIM'] },

  { to: '/sales-agents', label: 'Comerciales', group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
  { to: '/attributions', label: 'Atribuciones', group: 'Comercial' },
  { to: '/commission-plans', label: 'Planes de comisión', group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
  { to: '/commissions', label: 'Comisiones y liquidaciones', group: 'Comercial' },

  { to: '/subscriptions', label: 'Suscripciones', group: 'Finanzas', personas: ['EBIM', 'PARTNER'] },
  { to: '/billing', label: 'Facturación y cobros', group: 'Finanzas', personas: ['EBIM', 'PARTNER'] },
  { to: '/costs', label: 'Costos y margen', group: 'Finanzas', personas: ['EBIM'] },

  { to: '/deployments', label: 'Deployments', group: 'Infraestructura', personas: ['EBIM', 'PARTNER'] },
  { to: '/provisioning', label: 'Provisioning', group: 'Infraestructura', personas: ['EBIM', 'PARTNER'] },

  { to: '/audit', label: 'Auditoría', group: 'Gobierno', personas: ['EBIM', 'PARTNER'] },
  { to: '/settings', label: 'Configuración', group: 'Gobierno' },
];

export function navItemsFor(persona: PersonaKind): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.personas || item.personas.includes(persona));
}

export function navGroupsFor(persona: PersonaKind): Array<{ group: string; items: NavItem[] }> {
  const items = navItemsFor(persona);
  const order: string[] = [];
  const map = new Map<string, NavItem[]>();

  for (const item of items) {
    if (!map.has(item.group)) {
      map.set(item.group, []);
      order.push(item.group);
    }
    map.get(item.group)!.push(item);
  }

  return order.map((group) => ({ group, items: map.get(group)! }));
}
