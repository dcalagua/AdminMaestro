import type { Tone } from '@/lib/provisioning';
import type { TenantRole } from '@/types/domain';
import { TENANT_STATUS_LABEL } from '@/types/domain';
import {
  CELL,
  cellKind,
  latestRequestByTenant,
  type ProvisioningRow,
  type TenantRow,
} from '@/features/suite/suiteModel';
import type { AdminUser } from './userModel';

/**
 * V5 · F6 · A qué apps de la suite entra cada persona, con qué rol y en qué
 * estado está su tenant en cada app.
 *
 * Todo sale de datos que YA existen: las membresías de tenant del usuario
 * (`admin_list_users`), los tenants con su app (`v_tenant_overview`), las altas
 * en las apps (`v_saas_provisioning`, sólo si el perfil las ve) y las
 * membresías de organización (para saber si además administra la cuenta dueña).
 *
 * Es PRESENTACIÓN: quién entra a qué lo decide RLS en la base. Una membresía de
 * organización NO da acceso dentro de la app (comercial ≠ acceso operativo): solo
 * las membresías de tenant cuentan como acceso a una app.
 *
 * Invitar, suspender o reactivar a una persona DENTRO de una app no existe hoy:
 * no hay canal de usuarios/SSO por app. Ver `APP_USER_CHANNEL_AVAILABLE`.
 */

/** Canal de usuarios/SSO por app (invitar, suspender, reactivar dentro de la app). Aún no existe en la base. */
export const APP_USER_CHANNEL_AVAILABLE = false;

export const APP_USER_CHANNEL_PENDING = 'Disponible cuando exista el canal de usuarios de la app';

export const APP_ROLE_LABEL: Record<TenantRole, string> = {
  TENANT_ADMIN: 'Admin',
  TENANT_USER: 'Usuario',
};

export interface TenantState {
  label: string;
  tone: Tone;
  help: string;
}

export interface UserAppTenant {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  /** Cuenta (cliente) dueña del tenant, si se ve. */
  accountName: string | null;
  role: TenantRole;
  roleLabel: string;
  membershipActive: boolean;
  /** Estado del tenant en la app; `null` si el perfil no ve el tenant. */
  state: TenantState | null;
  /** La persona además administra la cuenta dueña (ORG_ADMIN / PARTNER_ADMIN activo). */
  managesAccount: boolean;
}

export interface UserAppAccess {
  key: string;
  appId: string | null;
  appCode: string | null;
  appName: string;
  /** Rol más alto entre las membresías ACTIVAS; `null` si no le queda ninguna activa. */
  role: TenantRole | null;
  roleLabel: string;
  /** Tiene al menos una membresía activa en la app. */
  active: boolean;
  tenants: UserAppTenant[];
  /** Estado que resume la app: el que más atención pide entre sus tenants activos. */
  attention: TenantState | null;
}

const TONE_WEIGHT: Record<Tone, number> = { danger: 4, warn: 3, info: 2, neutral: 1, accent: 1, ok: 0 };

const TENANT_STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'ok',
  PENDING: 'warn',
  SUSPENDED: 'danger',
  CHURNED: 'neutral',
  ARCHIVED: 'neutral',
};

const TENANT_STATUS_HELP: Record<string, string> = {
  ACTIVE: 'El tenant está activo en el Admin Maestro.',
  PENDING: 'El tenant todavía no está activo.',
  SUSPENDED: 'El tenant está suspendido: la persona no debería operar en la app.',
  CHURNED: 'El tenant se dio de baja.',
  ARCHIVED: 'El tenant está archivado.',
};

/**
 * Estado del tenant en su app. Con las altas visibles se usa el modelo de la
 * suite (estado combinado Admin Maestro × app); sin ellas, solo el estado del
 * tenant en el Admin Maestro, sin inventar el lado de la app.
 */
export function tenantState(
  row: Pick<TenantRow, 'status'> | undefined,
  request: Pick<ProvisioningRow, 'status'> | null | undefined,
  withProvisioning: boolean,
): TenantState | null {
  if (!row) return null;
  if (withProvisioning) {
    const cell = CELL[cellKind(row.status, request?.status ?? null)];
    return { label: cell.short, tone: cell.tone, help: cell.help };
  }
  const status = row.status ?? 'PENDING';
  return {
    label: TENANT_STATUS_LABEL[status] ?? status,
    tone: TENANT_STATUS_TONE[status] ?? 'neutral',
    help: TENANT_STATUS_HELP[status] ?? '',
  };
}

function worst(states: Array<TenantState | null>): TenantState | null {
  let out: TenantState | null = null;
  for (const s of states) {
    if (s && (!out || TONE_WEIGHT[s.tone] > TONE_WEIGHT[out.tone])) out = s;
  }
  return out;
}

/**
 * Apps a las que entra la persona, agrupando sus membresías de tenant por app.
 * Primero las apps con acceso activo; dentro, por nombre.
 */
export function userAppAccess(
  user: Pick<AdminUser, 'tenants' | 'organizations'>,
  ctx: { tenants?: readonly TenantRow[] | null; requests?: readonly ProvisioningRow[] | null } = {},
): UserAppAccess[] {
  const rows = new Map<string, TenantRow>();
  for (const t of ctx.tenants ?? []) if (t.tenant_id) rows.set(t.tenant_id, t);
  const withProvisioning = Array.isArray(ctx.requests);
  const latest = latestRequestByTenant(ctx.requests ?? []);
  const adminOf = new Set(
    user.organizations
      .filter((m) => m.is_active && (m.role === 'ORG_ADMIN' || m.role === 'PARTNER_ADMIN'))
      .map((m) => m.organization_id),
  );

  const apps = new Map<string, UserAppAccess>();
  for (const m of user.tenants) {
    const row = rows.get(m.tenant_id);
    const appId = row?.saas_product_id ?? null;
    const appName = row?.product_short_name ?? m.product_name ?? 'App';
    const key = appId ?? `name:${appName}`;
    const request = appId ? latest.get(`${m.tenant_id}:${appId}`) : null;
    const organizationId = row?.customer_organization_id ?? m.customer_organization_id ?? null;
    const tenant: UserAppTenant = {
      membershipId: m.id,
      tenantId: m.tenant_id,
      tenantName: row?.name ?? m.tenant_name,
      accountName: row?.customer_name ?? null,
      role: m.role,
      roleLabel: APP_ROLE_LABEL[m.role] ?? m.role,
      membershipActive: m.is_active,
      state: tenantState(row, request, withProvisioning),
      managesAccount: Boolean(organizationId && adminOf.has(organizationId)),
    };
    const app =
      apps.get(key) ??
      ({
        key,
        appId,
        appCode: row?.product_code ?? null,
        appName,
        role: null,
        roleLabel: 'Sin acceso activo',
        active: false,
        tenants: [],
        attention: null,
      } satisfies UserAppAccess);
    app.tenants.push(tenant);
    apps.set(key, app);
  }

  for (const app of apps.values()) {
    const active = app.tenants.filter((t) => t.membershipActive);
    app.active = active.length > 0;
    app.role = active.some((t) => t.role === 'TENANT_ADMIN') ? 'TENANT_ADMIN' : active.length > 0 ? 'TENANT_USER' : null;
    app.roleLabel = app.role ? APP_ROLE_LABEL[app.role] : 'Sin acceso activo';
    app.attention = worst(active.map((t) => t.state));
    app.tenants.sort((a, b) => Number(b.membershipActive) - Number(a.membershipActive) || a.tenantName.localeCompare(b.tenantName));
  }

  return [...apps.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.appName.localeCompare(b.appName));
}

/** Texto del chip de una app en el listado: «EWM · Admin», y el estado si pide atención. */
export function appChipText(app: UserAppAccess): string {
  const base = `${app.appName} · ${app.roleLabel}`;
  const s = app.attention;
  return s && (s.tone === 'danger' || s.tone === 'warn') ? `${base} · ${s.label}` : base;
}
