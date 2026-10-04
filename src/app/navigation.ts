import {
  type Icon, ArrowsClockwiseIcon, BellRingingIcon, BuildingOfficeIcon, BuildingsIcon, CertificateIcon,
  ChartLineUpIcon, CloudArrowUpIcon, CoinsIcon, CurrencyCircleDollarIcon, FlagIcon, GaugeIcon, GearSixIcon, GitDiffIcon,
  HandCoinsIcon, HandshakeIcon, HardDrivesIcon, HouseIcon, LinkIcon, ListChecksIcon, PercentIcon,
  PlugsConnectedIcon, PuzzlePieceIcon, ReceiptIcon, RocketLaunchIcon, ScalesIcon, ShieldCheckIcon, SquaresFourIcon,
  StackIcon, TreeStructureIcon, UserGearIcon, UsersThreeIcon,
} from '@phosphor-icons/react';
import type { PersonaKind } from '@/features/auth/session';
import type { SessionRoles } from '@/types/domain';

/**
 * Navegación de la consola.
 *
 * El menú se adapta al rol, pero eso es UX, NO seguridad: cada ruta se protege
 * además con `<RequirePersona>` y, sobre todo, cada consulta está filtrada por
 * RLS. Ocultar un menú no protege nada.
 *
 * Arquitectura de información de negocio (spec §5): Inicio · Clientes y canales ·
 * Productos y contratos · Finanzas · Operación SaaS · Gobierno. Las URL NO cambian;
 * sólo la agrupación y las etiquetas.
 */
export type NavGroup =
  | 'Inicio'
  | 'Clientes y canales'
  | 'Productos y contratos'
  | 'Finanzas'
  | 'Operación SaaS'
  | 'Gobierno';

export const NAV_GROUP_ORDER: NavGroup[] = [
  'Inicio',
  'Clientes y canales',
  'Productos y contratos',
  'Finanzas',
  'Operación SaaS',
  'Gobierno',
];

export interface NavItem {
  to: string;
  label: string;
  /** Icono Phosphor, mismo set que EWM. */
  icon: Icon;
  /** Personas que ven la entrada. Vacío = todas. */
  personas?: PersonaKind[];
  group: NavGroup;
  /** Información financiera: no se ofrece a personal EBIM con alcance sólo técnico. */
  finance?: boolean;
  /** Nombre de la ficha de detalle (`/ruta/:id`), para migas y título. */
  detailLabel?: string;
}

export const NAV_ITEMS: NavItem[] = [
  // ---- Inicio -------------------------------------------------------------
  { to: '/', label: 'Resumen ejecutivo', icon: HouseIcon, group: 'Inicio' },

  // ---- Clientes y canales -------------------------------------------------
  { to: '/customers', label: 'Clientes', icon: BuildingsIcon, group: 'Clientes y canales', personas: ['EBIM', 'PARTNER'] },
  { to: '/partners', label: 'Partners y canales', icon: HandshakeIcon, group: 'Clientes y canales', personas: ['EBIM', 'PARTNER'] },
  { to: '/organizations', label: 'Directorio corporativo', icon: TreeStructureIcon, group: 'Clientes y canales', personas: ['EBIM', 'PARTNER'], detailLabel: 'Ficha 360' },
  { to: '/sales-agents', label: 'Equipo comercial', icon: UsersThreeIcon, group: 'Clientes y canales', personas: ['EBIM', 'PARTNER'] },
  { to: '/attributions', label: 'Atribuciones', icon: LinkIcon, group: 'Clientes y canales' },

  // ---- Productos y contratos ----------------------------------------------
  { to: '/products', label: 'Suite SaaS', icon: SquaresFourIcon, group: 'Productos y contratos', detailLabel: 'Ficha de producto' },
  { to: '/plans', label: 'Planes y licencias', icon: CertificateIcon, group: 'Productos y contratos' },
  { to: '/feature-flags', label: 'Capacidades', icon: FlagIcon, group: 'Productos y contratos' },
  { to: '/commercial/capabilities', label: 'Registro de capacidades', icon: ListChecksIcon, group: 'Productos y contratos', personas: ['EBIM'] },
  { to: '/catalog/addons', label: 'Add-ons y tarifas', icon: PuzzlePieceIcon, group: 'Productos y contratos', personas: ['EBIM', 'PARTNER'], finance: true },
  { to: '/onboarding', label: 'Nueva venta', icon: RocketLaunchIcon, group: 'Productos y contratos', personas: ['EBIM'] },
  { to: '/tenants', label: 'Tenants', icon: BuildingOfficeIcon, group: 'Productos y contratos', detailLabel: 'Tenant 360' },
  { to: '/subscriptions', label: 'Contratos y suscripciones', icon: ArrowsClockwiseIcon, group: 'Productos y contratos', personas: ['EBIM', 'PARTNER'], finance: true, detailLabel: 'Contrato 360' },

  // ---- Finanzas -----------------------------------------------------------
  { to: '/billing', label: 'Facturación y cobros', icon: ReceiptIcon, group: 'Finanzas', personas: ['EBIM', 'PARTNER'], finance: true },
  { to: '/costs', label: 'Costos y margen', icon: ChartLineUpIcon, group: 'Finanzas', personas: ['EBIM'], finance: true },
  { to: '/commissions', label: 'Comisiones', icon: HandCoinsIcon, group: 'Finanzas', finance: true },
  { to: '/commission-plans', label: 'Reglas de comisión', icon: PercentIcon, group: 'Finanzas', personas: ['EBIM', 'PARTNER'], finance: true },
  { to: '/renewals', label: 'Renovaciones', icon: BellRingingIcon, group: 'Finanzas', personas: ['EBIM', 'PARTNER'], finance: true },
  { to: '/reconciliation', label: 'Conciliación', icon: ScalesIcon, group: 'Finanzas', personas: ['EBIM'], finance: true },
  { to: '/regional', label: 'Monedas y FX', icon: CurrencyCircleDollarIcon, group: 'Finanzas', personas: ['EBIM'], finance: true },
  { to: '/ai-credits', label: 'Créditos IA', icon: CoinsIcon, group: 'Finanzas', personas: ['EBIM'], finance: true },
  { to: '/billing-shadow', label: 'Billing shadow', icon: GitDiffIcon, group: 'Finanzas', personas: ['EBIM'], finance: true },

  // ---- Operación SaaS -----------------------------------------------------
  { to: '/integrations', label: 'Integraciones', icon: PlugsConnectedIcon, group: 'Operación SaaS', personas: ['EBIM'], detailLabel: 'Ficha de integración' },
  { to: '/commercial/entitlement-sync', label: 'Sincronización de entitlements', icon: ArrowsClockwiseIcon, group: 'Operación SaaS', personas: ['EBIM'] },
  { to: '/usage', label: 'Uso', icon: GaugeIcon, group: 'Operación SaaS', personas: ['EBIM'] },
  { to: '/deployments', label: 'Entornos y despliegues', icon: CloudArrowUpIcon, group: 'Operación SaaS', personas: ['EBIM', 'PARTNER'] },
  { to: '/saas-provisioning', label: 'Altas SaaS', icon: StackIcon, group: 'Operación SaaS', personas: ['EBIM', 'PARTNER'] },
  { to: '/provisioning', label: 'Solicitudes de infraestructura', icon: HardDrivesIcon, group: 'Operación SaaS', personas: ['EBIM', 'PARTNER'] },

  // ---- Gobierno -----------------------------------------------------------
  // M5 · administración de usuarios (EBIM: todos; admin de partner/cliente: su organización).
  { to: '/users', label: 'Usuarios y accesos', icon: UserGearIcon, group: 'Gobierno', personas: ['EBIM', 'PARTNER'], detailLabel: 'Ficha de usuario' },
  { to: '/audit', label: 'Auditoría', icon: ShieldCheckIcon, group: 'Gobierno', personas: ['EBIM', 'PARTNER'] },
  { to: '/settings', label: 'Configuración', icon: GearSixIcon, group: 'Gobierno' },
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

export function navItemsFor(persona: PersonaKind, options: { finance?: boolean } = {}): NavItem[] {
  const finance = options.finance ?? true;
  return NAV_ITEMS.filter(
    (item) => (!item.personas || item.personas.includes(persona)) && (finance || !item.finance),
  );
}

export function navGroupsFor(
  persona: PersonaKind,
  options: { finance?: boolean } = {},
): Array<{ group: NavGroup; items: NavItem[] }> {
  const items = navItemsFor(persona, options);
  return NAV_GROUP_ORDER.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter(
    (g) => g.items.length > 0,
  );
}

export interface RouteMeta {
  group: NavGroup | null;
  section: NavItem | null;
  /** Título humano de la pantalla (o de la ficha). */
  title: string;
  isDetail: boolean;
}

/** Migas y título humano para una ruta (reemplaza a `location.pathname`). */
export function routeMeta(pathname: string): RouteMeta {
  if (pathname === '/' || pathname === '') {
    const home = NAV_ITEMS[0]!;
    return { group: home.group, section: home, title: home.label, isDetail: false };
  }
  if (pathname === '/404') return { group: null, section: null, title: 'Página no encontrada', isDetail: false };
  if (pathname === '/login') return { group: null, section: null, title: 'Ingreso', isDetail: false };

  // La entrada más específica que contiene la ruta: hay entradas de dos
  // segmentos (`/catalog/addons`) además de las de uno con fichas `/:id`.
  const path = pathname.replace(/\/+$/, '');
  const section =
    NAV_ITEMS.filter((i) => i.to !== '/' && (path === i.to || path.startsWith(`${i.to}/`))).sort(
      (a, b) => b.to.length - a.to.length,
    )[0] ?? null;
  if (!section) return { group: null, section: null, title: 'Página no encontrada', isDetail: false };
  const isDetail = path !== section.to;
  return {
    group: section.group,
    section,
    title: isDetail ? (section.detailLabel ?? 'Detalle') : section.label,
    isDetail,
  };
}
