import type { Database } from '@/types/database.types';
import type { OrgRole, PlatformRole, TenantRole } from '@/types/domain';
import type { ProvisioningRole } from '@/lib/provisioning';

/**
 * M5 · Modelo de «Usuarios y accesos».
 *
 * `admin_list_users` devuelve las membresías como JSONB; aquí se tipan y se
 * derivan las categorías de las pestañas (U-06). Es PRESENTACIÓN: el alcance lo
 * decide la RPC (un admin de organización solo recibe a sus miembros y nunca
 * roles de consola).
 */

export type AdminUserRow = Database['platform']['Functions']['admin_list_users']['Returns'][number];

export interface OrgMembershipItem {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_kind: 'PLATFORM' | 'COMPANY';
  is_partner: boolean;
  role: OrgRole;
  company_id: string | null;
  is_active: boolean;
}

export interface TenantMembershipItem {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  product_name: string;
  customer_organization_id: string;
  role: TenantRole;
  is_active: boolean;
}

export interface ProvisioningRoleItem {
  id: string;
  role: ProvisioningRole;
  is_active: boolean;
  granted_at: string;
}

export interface ProductOwnershipItem {
  id: string;
  saas_product_id: string;
  product_name: string;
  role: string;
  is_active: boolean;
}

export interface SalesAgentLink {
  id: string;
  code: string;
  full_name: string;
  agent_type: string;
  status: string;
}

export interface AdminUser {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  jobTitle: string | null;
  isActive: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  invitedAt: string | null;
  emailConfirmedAt: string | null;
  banned: boolean;
  platformRole: PlatformRole | null;
  platformRoleActive: boolean;
  organizations: OrgMembershipItem[];
  tenants: TenantMembershipItem[];
  provisioningRoles: ProvisioningRoleItem[];
  productOwnerships: ProductOwnershipItem[];
  salesAgent: SalesAgentLink | null;
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    jobTitle: row.job_title,
    isActive: row.is_active,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
    invitedAt: row.invited_at,
    emailConfirmedAt: row.email_confirmed_at,
    banned: Boolean(row.banned),
    platformRole: row.platform_role,
    platformRoleActive: Boolean(row.platform_role_active),
    organizations: list<OrgMembershipItem>(row.organizations),
    tenants: list<TenantMembershipItem>(row.tenants),
    provisioningRoles: list<ProvisioningRoleItem>(row.provisioning_roles),
    productOwnerships: list<ProductOwnershipItem>(row.product_ownerships),
    salesAgent: (row.sales_agent as SalesAgentLink | null) ?? null,
  };
}

/** Invitación enviada y todavía no aceptada (nunca fijó contraseña ni ingresó). */
export function isPendingInvitation(user: AdminUser): boolean {
  return Boolean(user.invitedAt) && !user.emailConfirmedAt && !user.lastSignInAt;
}

export type UserTab = 'ALL' | 'EBIM' | 'PARTNER' | 'CUSTOMER' | 'INACTIVE';

/**
 * Pestañas de estado (U-06). Un usuario puede caer en varias (EBIM y partner a
 * la vez, por ejemplo); «Inactivos» agrupa a los desactivados, que no aparecen
 * en las demás.
 */
export function userCategories(user: AdminUser): Set<Exclude<UserTab, 'ALL' | 'INACTIVE'>> {
  const out = new Set<Exclude<UserTab, 'ALL' | 'INACTIVE'>>();
  const activeOrgs = user.organizations.filter((m) => m.is_active);
  if (
    (user.platformRole && user.platformRoleActive) ||
    user.provisioningRoles.some((r) => r.is_active) ||
    user.productOwnerships.some((o) => o.is_active) ||
    activeOrgs.some((m) => m.organization_kind === 'PLATFORM') ||
    user.email.endsWith('@ebim.pe')
  ) {
    out.add('EBIM');
  }
  if (
    activeOrgs.some((m) => m.role.startsWith('PARTNER_')) ||
    (user.salesAgent !== null && user.salesAgent.agent_type !== 'EBIM_INTERNAL')
  ) {
    out.add('PARTNER');
  }
  if (
    activeOrgs.some((m) => m.organization_kind !== 'PLATFORM' && m.role.startsWith('ORG_')) ||
    user.tenants.some((t) => t.is_active)
  ) {
    out.add('CUSTOMER');
  }
  return out;
}

export function matchesUserTab(user: AdminUser, tab: UserTab): boolean {
  if (tab === 'ALL') return true;
  if (tab === 'INACTIVE') return !user.isActive;
  return user.isActive && userCategories(user).has(tab);
}

export const USER_TAB_LABEL: Record<UserTab, string> = {
  ALL: 'Todos',
  EBIM: 'EBIM',
  PARTNER: 'Partners',
  CUSTOMER: 'Clientes',
  INACTIVE: 'Inactivos',
};

export function userTabs(users: AdminUser[]): Array<{ id: UserTab; label: string; count: number }> {
  return (Object.keys(USER_TAB_LABEL) as UserTab[]).map((id) => ({
    id,
    label: USER_TAB_LABEL[id],
    count: users.filter((u) => matchesUserTab(u, id)).length,
  }));
}

/** Etiqueta corta de estado de la cuenta para la lista y la ficha. */
export function accountStatus(user: AdminUser): { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' } {
  if (!user.isActive) return { label: 'Desactivado', tone: 'danger' };
  if (user.banned) return { label: 'Bloqueado en Auth', tone: 'danger' };
  if (isPendingInvitation(user)) return { label: 'Invitación pendiente', tone: 'warn' };
  return { label: 'Activo', tone: 'ok' };
}

/** Resumen de accesos activos para una celda de tabla. */
export function accessSummary(user: AdminUser): string[] {
  const out: string[] = [];
  if (user.platformRole && user.platformRoleActive) out.push('Consola');
  for (const m of user.organizations.filter((x) => x.is_active)) out.push(m.organization_name);
  const tenants = user.tenants.filter((t) => t.is_active).length;
  if (tenants > 0) out.push(tenants === 1 ? '1 tenant' : `${tenants} tenants`);
  if (user.provisioningRoles.some((r) => r.is_active)) out.push('Provisioning');
  if (user.salesAgent) out.push('Comercial');
  return out;
}

/* ---------------------------------------------------------------------------
   Roles asignables (espejo de la base; la autoridad es la RPC)
   --------------------------------------------------------------------------- */

/** S-01: EBIM_SUPER_ADMIN NUNCA se ofrece. */
export const ASSIGNABLE_PLATFORM_ROLES: PlatformRole[] = ['EBIM_PRODUCT_ADMIN', 'EBIM_FINANCE'];

export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  PARTNER_ADMIN: 3,
  PARTNER_SALES: 2,
  PARTNER_SUPPORT: 1,
  ORG_ADMIN: 2,
  ORG_VIEWER: 1,
};

const PARTNER_ROLES: OrgRole[] = ['PARTNER_ADMIN', 'PARTNER_SALES', 'PARTNER_SUPPORT'];
const CUSTOMER_ROLES: OrgRole[] = ['ORG_ADMIN', 'ORG_VIEWER'];

/**
 * Roles que el operador puede ofrecer en una organización:
 *   · EBIM (gestión de plataforma): PARTNER_* si la organización es partner o
 *     reseller, más ORG_*;
 *   · admin de la organización: solo su familia y nunca por encima de su rol.
 */
export function assignableOrgRoles(opts: {
  managePlatform: boolean;
  orgIsPartner: boolean;
  callerRole?: OrgRole | null;
}): OrgRole[] {
  const family = opts.orgIsPartner ? [...PARTNER_ROLES, ...CUSTOMER_ROLES] : CUSTOMER_ROLES;
  if (opts.managePlatform) return family;
  const caller = opts.callerRole;
  if (!caller || (caller !== 'PARTNER_ADMIN' && caller !== 'ORG_ADMIN')) return [];
  const own = caller.startsWith('PARTNER_') ? PARTNER_ROLES : CUSTOMER_ROLES;
  return own.filter((r) => family.includes(r) && ORG_ROLE_RANK[r] <= ORG_ROLE_RANK[caller]);
}

export const TENANT_ROLE_LABEL: Record<TenantRole, string> = {
  TENANT_ADMIN: 'Admin del tenant',
  TENANT_USER: 'Usuario del tenant',
};

/** Acceso pedido al invitar (`grant` de la Edge Function `user-admin`). */
export type InviteGrant =
  | { kind: 'PLATFORM_ROLE'; role: PlatformRole }
  | { kind: 'ORG_MEMBERSHIP'; role: OrgRole; organization_id: string; company_id?: string }
  | { kind: 'TENANT_MEMBERSHIP'; role: TenantRole; tenant_id: string };

/** Acciones de auditoría de M5 (y de provisioning) en lenguaje de negocio. */
export const USER_ACTIVITY_LABEL: Record<string, string> = {
  USER_PROFILE_UPDATED: 'Perfil actualizado',
  PLATFORM_ROLE_GRANTED: 'Rol de consola otorgado',
  PLATFORM_ROLE_REVOKED: 'Rol de consola revocado',
  ORG_MEMBERSHIP_GRANTED: 'Agregado a una organización',
  ORG_MEMBERSHIP_UPDATED: 'Membresía de organización actualizada',
  ORG_MEMBERSHIP_ACTIVATED: 'Membresía de organización reactivada',
  ORG_MEMBERSHIP_DEACTIVATED: 'Membresía de organización desactivada',
  TENANT_MEMBERSHIP_GRANTED: 'Agregado a un tenant',
  TENANT_MEMBERSHIP_UPDATED: 'Membresía de tenant actualizada',
  TENANT_MEMBERSHIP_ACTIVATED: 'Membresía de tenant reactivada',
  TENANT_MEMBERSHIP_DEACTIVATED: 'Membresía de tenant desactivada',
  PROVISIONING_ROLE_GRANTED: 'Rol de provisioning otorgado',
  PROVISIONING_ROLE_REVOKED: 'Rol de provisioning revocado',
  SALES_AGENT_USER_LINKED: 'Vinculado a un comercial',
  SALES_AGENT_USER_UNLINKED: 'Desvinculado de un comercial',
  USER_DEACTIVATED: 'Usuario desactivado',
  USER_REACTIVATED: 'Usuario reactivado',
  USER_INVITED: 'Invitación enviada',
  USER_INVITATION_RESENT: 'Invitación reenviada',
  USER_INVITATION_ACCEPTED: 'Invitación aceptada',
};

export function activityLabel(action: string): string {
  return USER_ACTIVITY_LABEL[action] ?? action;
}
