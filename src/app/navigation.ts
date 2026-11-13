import {
  type Icon, ArrowsClockwiseIcon, BuildingOfficeIcon, BuildingsIcon, ChartLineUpIcon, GearSixIcon,
  HandCoinsIcon, HandshakeIcon, HouseIcon, PlugsConnectedIcon, ReceiptIcon, RocketLaunchIcon, ShieldCheckIcon,
  SquaresFourIcon, StackIcon, StorefrontIcon, TrayIcon, UserGearIcon, UsersThreeIcon,
} from '@phosphor-icons/react';
import type { PersonaKind } from '@/features/auth/session';
import type { SessionRoles } from '@/types/domain';

/**
 * Navegación de la consola (V5 · F1).
 *
 * El menú se adapta al rol, pero eso es UX, NO seguridad: cada pantalla se
 * protege además con su guard y, sobre todo, cada consulta está filtrada por
 * RLS. Ocultar un menú o una pestaña no protege nada.
 *
 * Arquitectura de información V5 (plan §4): seis grupos organizados por tarea —
 * Inicio · Clientes · Suite · Comercial · Finanzas · Gobierno. Varias pantallas
 * antiguas viven ahora como PESTAÑAS de una sola entrada (`tabs`, deep-link por
 * `?tab=`); sus rutas viejas (`legacy`) redirigen a la nueva casa con la pestaña
 * correcta, así los enlaces y marcadores siguen funcionando.
 *
 * Las reglas de acceso de cada pestaña copian EXACTAMENTE las de la ruta que
 * absorben: si un rol no veía una pantalla, tampoco ve su pestaña.
 */
export type NavGroup = 'Inicio' | 'Clientes' | 'Suite' | 'Comercial' | 'Finanzas' | 'Gobierno';

export const NAV_GROUP_ORDER: NavGroup[] = ['Inicio', 'Clientes', 'Suite', 'Comercial', 'Finanzas', 'Gobierno'];

/** Regla de visibilidad (UX) de una entrada o de una pestaña. */
export interface AccessRule {
  /** Personas que la ven. Vacío = todas. */
  personas?: PersonaKind[];
  /** Información financiera: no se ofrece a personal EBIM con alcance sólo técnico. */
  finance?: boolean;
  /** Sólo el super admin de EBIM (sección «Avanzado»). */
  superAdmin?: boolean;
}

/** Con qué perfil se evalúan las reglas. */
export interface NavAccess {
  persona: PersonaKind;
  finance: boolean;
  superAdmin: boolean;
}

export interface NavTab extends AccessRule {
  /** Valor de `?tab=`. */
  id: string;
  label: string;
  /** Rutas anteriores a la fusión: redirigen a esta pestaña. */
  legacy?: string[];
  /** Nombres anteriores, para que ⌘K los siga encontrando. */
  aliases?: string[];
}

/** Ficha de detalle (`/prefijo/:id`) que cuelga de una entrada. */
export interface NavDetail {
  prefix: string;
  label: string;
  /** Pestaña de la entrada de la que viene la ficha (para la miga). */
  tab?: string;
}

export interface NavItem extends AccessRule {
  to: string;
  label: string;
  /** Icono Phosphor, mismo set que EWM. */
  icon: Icon;
  group: NavGroup;
  /** Una frase bajo el título de la pantalla. */
  description?: string;
  /** Pantallas fusionadas en esta entrada, como pestañas (`?tab=`). */
  tabs?: NavTab[];
  /** Fichas de detalle que cuelgan de esta entrada. */
  details?: NavDetail[];
}

export const NAV_ITEMS: NavItem[] = [
  // ---- Inicio -------------------------------------------------------------
  { to: '/', label: 'Resumen', icon: HouseIcon, group: 'Inicio' },
  {
    to: '/bandeja', label: 'Bandeja', icon: TrayIcon, group: 'Inicio',
    description: 'Lo que requiere tu atención hoy, en una sola lista.',
  },

  // ---- Clientes -----------------------------------------------------------
  {
    to: '/cuentas', label: 'Cuentas', icon: BuildingsIcon, group: 'Clientes',
    description: 'Clientes y organizaciones de la plataforma. Una misma cuenta puede ser cliente y partner a la vez.',
    tabs: [
      { id: 'clientes', label: 'Clientes', personas: ['EBIM', 'PARTNER'], legacy: ['/customers'] },
      {
        id: 'directorio', label: 'Todas las organizaciones', personas: ['EBIM', 'PARTNER'],
        legacy: ['/organizations'], aliases: ['Directorio corporativo'],
      },
    ],
    details: [{ prefix: '/organizations', label: 'Ficha 360' }],
  },
  { to: '/partners', label: 'Partners', icon: HandshakeIcon, group: 'Clientes', personas: ['EBIM', 'PARTNER'] },
  {
    to: '/sales-agents', label: 'Equipo comercial', icon: UsersThreeIcon, group: 'Clientes',
    description: 'Comerciales y la cartera que tienen atribuida. Cobrar comisión no da acceso operativo a ningún tenant.',
    tabs: [
      { id: 'equipo', label: 'Comerciales', personas: ['EBIM', 'PARTNER'] },
      { id: 'atribuciones', label: 'Atribuciones', legacy: ['/attributions'] },
    ],
  },

  // ---- Suite --------------------------------------------------------------
  {
    to: '/suite', label: 'Centro de la suite', icon: SquaresFourIcon, group: 'Suite', personas: ['EBIM'],
    description: 'La salud de las 8 apps y el estado de cada cuenta en cada app.',
    // Ficha de app (V5 · F2): `/apps/:codigo`. `/apps` a secas sigue siendo la entrada «Apps».
    details: [{ prefix: '/apps', label: 'Ficha de app' }, { prefix: '/suite', label: 'Ciclo de vida' }],
  },
  {
    to: '/tenants', label: 'Tenants', icon: BuildingOfficeIcon, group: 'Suite',
    details: [{ prefix: '/tenants', label: 'Tenant 360' }],
  },
  {
    to: '/apps', label: 'Apps', icon: PlugsConnectedIcon, group: 'Suite',
    description: 'La conexión de la consola con cada app de la suite: altas, módulos habilitados, entornos y uso.',
    tabs: [
      { id: 'integraciones', label: 'Integraciones', personas: ['EBIM'], legacy: ['/integrations'] },
      { id: 'altas', label: 'Altas en las apps', personas: ['EBIM', 'PARTNER'], legacy: ['/saas-provisioning'], aliases: ['Altas SaaS'] },
      {
        id: 'sincronizacion', label: 'Módulos habilitados', personas: ['EBIM'],
        legacy: ['/commercial/entitlement-sync'], aliases: ['Sincronización de entitlements'],
      },
      { id: 'uso', label: 'Uso', personas: ['EBIM'], legacy: ['/usage'] },
      {
        id: 'entornos', label: 'Entornos y despliegues', personas: ['EBIM', 'PARTNER'], legacy: ['/deployments'],
      },
      {
        id: 'infraestructura', label: 'Solicitudes de infraestructura', personas: ['EBIM', 'PARTNER'],
        legacy: ['/provisioning'],
      },
    ],
    details: [{ prefix: '/integrations', label: 'Ficha de integración', tab: 'integraciones' }],
  },

  // ---- Comercial ----------------------------------------------------------
  { to: '/onboarding', label: 'Nueva venta', icon: RocketLaunchIcon, group: 'Comercial', personas: ['EBIM'] },
  {
    to: '/subscriptions', label: 'Contratos', icon: ArrowsClockwiseIcon, group: 'Comercial',
    personas: ['EBIM', 'PARTNER'], finance: true,
    details: [{ prefix: '/subscriptions', label: 'Contrato 360' }],
  },
  {
    to: '/catalogo', label: 'Catálogo', icon: StackIcon, group: 'Comercial',
    description: 'Lo que se vende: productos de la suite, planes, add-ons y las capacidades que habilita cada uno.',
    tabs: [
      { id: 'productos', label: 'Productos', legacy: ['/products'], aliases: ['Suite SaaS'] },
      { id: 'planes', label: 'Planes y licencias', legacy: ['/plans'] },
      {
        id: 'addons', label: 'Add-ons y tarifas', personas: ['EBIM', 'PARTNER'], finance: true,
        legacy: ['/catalog/addons'],
      },
      { id: 'capacidades', label: 'Capacidades', legacy: ['/feature-flags'] },
      { id: 'registro', label: 'Registro de capacidades', personas: ['EBIM'], legacy: ['/commercial/capabilities'] },
    ],
    details: [{ prefix: '/products', label: 'Ficha de producto', tab: 'productos' }],
  },

  // ---- Finanzas -----------------------------------------------------------
  {
    to: '/cobranza', label: 'Cobranza', icon: ReceiptIcon, group: 'Finanzas',
    description: 'Qué hay que cobrar hoy, facturas, cobros, conciliación con la pasarela y renovaciones por vencer.',
    tabs: [
      // V5 · F4: la bandeja de lo que hay que cobrar va primero (tarea antes que tabla).
      {
        id: 'por-cobrar', label: 'Por cobrar', personas: ['EBIM', 'PARTNER'], finance: true,
        aliases: ['Bandeja de cobranza', 'Facturas vencidas', 'Mora'],
      },
      {
        id: 'facturacion', label: 'Facturación y cobros', personas: ['EBIM', 'PARTNER'], finance: true,
        legacy: ['/billing'],
      },
      {
        id: 'renovaciones', label: 'Renovaciones', personas: ['EBIM', 'PARTNER'], finance: true,
        legacy: ['/renewals'],
      },
      { id: 'conciliacion', label: 'Conciliación', personas: ['EBIM'], finance: true, legacy: ['/reconciliation'] },
    ],
  },
  {
    to: '/commissions', label: 'Comisiones', icon: HandCoinsIcon, group: 'Finanzas',
    description: 'Comisiones generadas por cobros confirmados, sus liquidaciones y los planes que las calculan.',
    tabs: [
      { id: 'comisiones', label: 'Comisiones y liquidaciones', finance: true },
      {
        id: 'planes', label: 'Planes de comisión', personas: ['EBIM', 'PARTNER'], finance: true,
        legacy: ['/commission-plans'], aliases: ['Reglas de comisión'],
      },
    ],
  },
  { to: '/costs', label: 'Costos y margen', icon: ChartLineUpIcon, group: 'Finanzas', personas: ['EBIM'], finance: true },
  {
    to: '/partner-fees', label: 'Tarifas de partners', icon: StorefrontIcon, group: 'Finanzas',
    personas: ['EBIM'], finance: true,
  },

  // ---- Gobierno -----------------------------------------------------------
  // M5 · administración de usuarios (EBIM: todos; admin de partner/cliente: su organización).
  {
    to: '/users', label: 'Usuarios', icon: UserGearIcon, group: 'Gobierno', personas: ['EBIM', 'PARTNER'],
    details: [{ prefix: '/users', label: 'Ficha de usuario' }],
  },
  { to: '/audit', label: 'Auditoría', icon: ShieldCheckIcon, group: 'Gobierno', personas: ['EBIM', 'PARTNER'] },
  {
    to: '/settings', label: 'Configuración', icon: GearSixIcon, group: 'Gobierno',
    description: 'Tu sesión y tu apariencia; para EBIM, además, monedas, créditos IA y opciones avanzadas.',
    tabs: [
      { id: 'general', label: 'General' },
      {
        id: 'regional', label: 'Monedas y tipo de cambio', personas: ['EBIM'], finance: true,
        legacy: ['/regional'], aliases: ['Monedas y FX', 'Regional'],
      },
      { id: 'creditos-ia', label: 'Créditos IA', personas: ['EBIM'], finance: true, legacy: ['/ai-credits'] },
      {
        id: 'avanzado', label: 'Avanzado', personas: ['EBIM'], finance: true, superAdmin: true,
        legacy: ['/billing-shadow'], aliases: ['Comparación de cobro', 'Billing shadow'],
      },
    ],
  },
];

/**
 * ¿Se le ofrece información financiera? Personal EBIM cuyo único vínculo es el
 * plano de provisioning (propietario técnico, rol de provisioning, sin rol de
 * plataforma) NO: «ser EBIM» no concede finanzas (spec §4). Es UX; la base
 * (`can_read_finance`, RLS) sigue siendo la autoridad.
 */
export function hasFinanceView(persona: PersonaKind, roles: SessionRoles | null | undefined): boolean {
  if (persona !== 'EBIM') return true;
  return Boolean(roles?.platformRole);
}

/** Perfil de navegación a partir de la sesión. */
export function navAccessFor(persona: PersonaKind, roles: SessionRoles | null | undefined): NavAccess {
  return {
    persona,
    finance: hasFinanceView(persona, roles),
    superAdmin: roles?.platformRole === 'EBIM_SUPER_ADMIN',
  };
}

export function allows(rule: AccessRule, access: NavAccess): boolean {
  if (rule.personas && !rule.personas.includes(access.persona)) return false;
  if (rule.finance && !access.finance) return false;
  if (rule.superAdmin && !access.superAdmin) return false;
  return true;
}

/** Pestañas de una entrada que este perfil ve (todas, si la entrada no tiene). */
export function visibleTabs(item: NavItem, access: NavAccess): NavTab[] {
  return (item.tabs ?? []).filter((t) => allows(t, access));
}

function toAccess(persona: PersonaKind, options: { finance?: boolean; superAdmin?: boolean }): NavAccess {
  return { persona, finance: options.finance ?? true, superAdmin: options.superAdmin ?? false };
}

/** Una entrada con pestañas se ve si el perfil ve al menos una de ellas. */
export function navItemsFor(
  persona: PersonaKind,
  options: { finance?: boolean; superAdmin?: boolean } = {},
): NavItem[] {
  const access = toAccess(persona, options);
  return NAV_ITEMS.filter(
    (item) => allows(item, access) && (!item.tabs || visibleTabs(item, access).length > 0),
  );
}

export function navGroupsFor(
  persona: PersonaKind,
  options: { finance?: boolean; superAdmin?: boolean } = {},
): Array<{ group: NavGroup; items: NavItem[] }> {
  const items = navItemsFor(persona, options);
  return NAV_GROUP_ORDER.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter(
    (g) => g.items.length > 0,
  );
}

export function findNavItem(to: string): NavItem | undefined {
  return NAV_ITEMS.find((i) => i.to === to);
}

/** URL de una pestaña concreta de una entrada. */
export function tabHref(item: NavItem, tabId: string): string {
  return `${item.to}?tab=${encodeURIComponent(tabId)}`;
}

/**
 * Destinos de ⌘K: cada entrada visible y, dentro de las que fusionan
 * pantallas, cada pestaña que el perfil ve (`/cobranza?tab=conciliacion`).
 * Los nombres anteriores (`aliases`) siguen encontrando su pantalla.
 */
export interface NavDestination {
  to: string;
  label: string;
  /** Dónde vive: grupo, o «Entrada · grupo» para una pestaña. */
  hint: string;
  icon: Icon;
  keywords: string[];
  /** Es una pestaña dentro de otra entrada. */
  isTab: boolean;
}

export function navDestinations(items: NavItem[], access: NavAccess): NavDestination[] {
  return items.flatMap((item) => {
    const own: NavDestination = {
      to: item.to, label: item.label, hint: item.group, icon: item.icon, keywords: [item.group, item.to], isTab: false,
    };
    const tabs = visibleTabs(item, access);
    if (tabs.length < 2) return [own];
    return [
      own,
      ...tabs.map((tab) => ({
        to: tabHref(item, tab.id),
        label: tab.label,
        hint: `${item.label} · ${item.group}`,
        icon: item.icon,
        keywords: [...(tab.aliases ?? []), item.label, ...(tab.legacy ?? [])],
        isTab: true,
      })),
    ];
  });
}

/** Rutas anteriores a la V5 y su nueva casa (`?tab=`). */
export interface LegacyRedirect {
  from: string;
  to: string;
  tab: string;
}

export const LEGACY_REDIRECTS: LegacyRedirect[] = NAV_ITEMS.flatMap((item) =>
  (item.tabs ?? []).flatMap((tab) => (tab.legacy ?? []).map((from) => ({ from, to: item.to, tab: tab.id }))),
);

export interface RouteMeta {
  group: NavGroup | null;
  section: NavItem | null;
  /** Título humano de la pantalla (o de la ficha). */
  title: string;
  isDetail: boolean;
  /** En una ficha: a dónde vuelve la miga del listado (con su pestaña). */
  parentTo?: string;
}

/** Migas y título humano para una ruta (reemplaza a `location.pathname`). */
export function routeMeta(pathname: string): RouteMeta {
  if (pathname === '/' || pathname === '') {
    const home = NAV_ITEMS[0]!;
    return { group: home.group, section: home, title: 'Resumen ejecutivo', isDetail: false };
  }
  if (pathname === '/404') return { group: null, section: null, title: 'Página no encontrada', isDetail: false };
  if (pathname === '/login') return { group: null, section: null, title: 'Ingreso', isDetail: false };
  // Herramienta interna (solo desarrollo o super admin): sin entrada de menú.
  if (pathname === '/design') return { group: null, section: null, title: 'Galería de componentes', isDetail: false };

  const path = pathname.replace(/\/+$/, '');
  const section = NAV_ITEMS.find((i) => i.to !== '/' && path === i.to);
  if (section) return { group: section.group, section, title: section.label, isDetail: false };

  // Fichas de detalle: `/prefijo/:id`, colgadas de la entrada dueña.
  for (const item of NAV_ITEMS) {
    for (const detail of item.details ?? []) {
      if (path.startsWith(`${detail.prefix}/`)) {
        return {
          group: item.group,
          section: item,
          title: detail.label,
          isDetail: true,
          parentTo: detail.tab ? tabHref(item, detail.tab) : item.to,
        };
      }
    }
  }
  return { group: null, section: null, title: 'Página no encontrada', isDetail: false };
}
