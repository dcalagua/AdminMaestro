import type { PersonaKind } from '@/features/auth/session';

/**
 * Navegación de la consola.
 *
 * El menú se adapta al rol (contrato/prompt fase 9), pero eso es UX, NO
 * seguridad: cada ruta se protege además con `<RequirePersona>` y, sobre todo,
 * cada consulta está filtrada por RLS. Ocultar un menú no protege nada.
 *
 * La agrupación sigue el recorrido real de una venta (Fase 14):
 * Plataforma → Comercial → Tenancy → Cobranza → Infraestructura → Gobierno.
 * Antes «Suscripciones» y «Facturación» vivían en un cajón llamado «Finanzas»
 * junto a «Costos», que mezclaba el contrato con el dinero ya cobrado.
 */
export interface NavItem {
  to: string;
  label: string;
  /** Personas que ven la entrada. Vacío = todas. */
  personas?: PersonaKind[];
  group: string;
}

export const NAV_ITEMS: NavItem[] = [
  // ---- Plataforma ---------------------------------------------------------
  { to: '/', label: 'Dashboard', group: 'Plataforma' },
  { to: '/products', label: 'Suite SaaS', group: 'Plataforma' },
  { to: '/plans', label: 'Planes y licencias', group: 'Plataforma' },
  { to: '/feature-flags', label: 'Feature flags', group: 'Plataforma' },

  // ---- Comercial ----------------------------------------------------------
  { to: '/partners', label: 'Partners / Resellers', group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
  { to: '/customers', label: 'Clientes', group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
  { to: '/organizations', label: 'Todas las organizaciones', group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
  { to: '/sales-agents', label: 'Comerciales', group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
  { to: '/attributions', label: 'Atribuciones', group: 'Comercial' },
  { to: '/commission-plans', label: 'Planes de comisión', group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
  { to: '/commissions', label: 'Comisiones y liquidaciones', group: 'Comercial' },

  // ---- Tenancy ------------------------------------------------------------
  { to: '/onboarding', label: 'Nueva venta', group: 'Tenancy', personas: ['EBIM'] },
  { to: '/tenants', label: 'Tenants', group: 'Tenancy' },
  { to: '/subscriptions', label: 'Suscripciones y licencias', group: 'Tenancy', personas: ['EBIM', 'PARTNER'] },

  // ---- Cobranza -----------------------------------------------------------
  { to: '/billing', label: 'Facturación y cobros', group: 'Cobranza', personas: ['EBIM', 'PARTNER'] },
  { to: '/renewals', label: 'Renovaciones y alertas', group: 'Cobranza', personas: ['EBIM', 'PARTNER'] },
  { to: '/reconciliation', label: 'Reconciliación', group: 'Cobranza', personas: ['EBIM'] },

  // ---- Infraestructura ----------------------------------------------------
  { to: '/deployments', label: 'Deployments', group: 'Infraestructura', personas: ['EBIM', 'PARTNER'] },
  { to: '/provisioning', label: 'Provisioning', group: 'Infraestructura', personas: ['EBIM', 'PARTNER'] },

  // ---- Gobierno -----------------------------------------------------------
  { to: '/costs', label: 'Costos y margen', group: 'Gobierno', personas: ['EBIM'] },
  { to: '/regional', label: 'Monedas y FX', group: 'Gobierno', personas: ['EBIM'] },
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
