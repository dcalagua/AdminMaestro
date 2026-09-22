import {
  type Icon, ArrowsClockwiseIcon, BellRingingIcon, BuildingOfficeIcon, BuildingsIcon, CertificateIcon,
  ChartLineUpIcon, CloudArrowUpIcon, CurrencyCircleDollarIcon, FlagIcon, GearSixIcon,
  HandCoinsIcon, HandshakeIcon, HardDrivesIcon, HouseIcon, LinkIcon, PercentIcon,
  PlugsConnectedIcon, ReceiptIcon, RocketLaunchIcon, ScalesIcon, ShieldCheckIcon, SquaresFourIcon,
  StackIcon, TreeStructureIcon, UsersThreeIcon,
} from '@phosphor-icons/react';
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
  /** Icono Phosphor, mismo set que EWM. */
  icon: Icon;
  /** Personas que ven la entrada. Vacío = todas. */
  personas?: PersonaKind[];
  group: string;
}

export const NAV_ITEMS: NavItem[] = [
  // ---- Plataforma ---------------------------------------------------------
  { to: '/', label: 'Dashboard', icon: HouseIcon, group: 'Plataforma' },
  { to: '/products', label: 'Suite SaaS', icon: SquaresFourIcon, group: 'Plataforma' },
  { to: '/plans', label: 'Planes y licencias', icon: CertificateIcon, group: 'Plataforma' },
  { to: '/feature-flags', label: 'Feature flags', icon: FlagIcon, group: 'Plataforma' },
  { to: '/integrations', label: 'Integraciones SaaS', icon: PlugsConnectedIcon, group: 'Plataforma', personas: ['EBIM'] },

  // ---- Comercial ----------------------------------------------------------
  { to: '/partners', label: 'Partners / Resellers', icon: HandshakeIcon, group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
  { to: '/customers', label: 'Clientes', icon: BuildingsIcon, group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
  { to: '/organizations', label: 'Todas las organizaciones', icon: TreeStructureIcon, group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
  { to: '/sales-agents', label: 'Comerciales', icon: UsersThreeIcon, group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
  { to: '/attributions', label: 'Atribuciones', icon: LinkIcon, group: 'Comercial' },
  { to: '/commission-plans', label: 'Planes de comisión', icon: PercentIcon, group: 'Comercial', personas: ['EBIM', 'PARTNER'] },
  { to: '/commissions', label: 'Comisiones y liquidaciones', icon: HandCoinsIcon, group: 'Comercial' },

  // ---- Tenancy ------------------------------------------------------------
  { to: '/onboarding', label: 'Nueva venta', icon: RocketLaunchIcon, group: 'Tenancy', personas: ['EBIM'] },
  { to: '/tenants', label: 'Tenants', icon: BuildingOfficeIcon, group: 'Tenancy' },
  { to: '/subscriptions', label: 'Suscripciones y licencias', icon: ArrowsClockwiseIcon, group: 'Tenancy', personas: ['EBIM', 'PARTNER'] },

  // ---- Cobranza -----------------------------------------------------------
  { to: '/billing', label: 'Facturación y cobros', icon: ReceiptIcon, group: 'Cobranza', personas: ['EBIM', 'PARTNER'] },
  { to: '/renewals', label: 'Renovaciones y alertas', icon: BellRingingIcon, group: 'Cobranza', personas: ['EBIM', 'PARTNER'] },
  { to: '/reconciliation', label: 'Reconciliación', icon: ScalesIcon, group: 'Cobranza', personas: ['EBIM'] },

  // ---- Infraestructura ----------------------------------------------------
  { to: '/deployments', label: 'Deployments', icon: CloudArrowUpIcon, group: 'Infraestructura', personas: ['EBIM', 'PARTNER'] },
  { to: '/provisioning', label: 'Provisioning de infraestructura', icon: HardDrivesIcon, group: 'Infraestructura', personas: ['EBIM', 'PARTNER'] },
  { to: '/saas-provisioning', label: 'Provisioning SaaS', icon: StackIcon, group: 'Infraestructura', personas: ['EBIM', 'PARTNER'] },

  // ---- Gobierno -----------------------------------------------------------
  { to: '/costs', label: 'Costos y margen', icon: ChartLineUpIcon, group: 'Gobierno', personas: ['EBIM'] },
  { to: '/regional', label: 'Monedas y FX', icon: CurrencyCircleDollarIcon, group: 'Gobierno', personas: ['EBIM'] },
  { to: '/audit', label: 'Auditoría', icon: ShieldCheckIcon, group: 'Gobierno', personas: ['EBIM', 'PARTNER'] },
  { to: '/settings', label: 'Configuración', icon: GearSixIcon, group: 'Gobierno' },
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
