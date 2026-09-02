import { supabase } from '@/lib/supabase';
import type { SessionRoles } from '@/types/domain';

/**
 * Resuelve el rol EFECTIVO del usuario consultando la base.
 *
 * Por qué no se lee del JWT: `user_metadata` lo puede editar el propio usuario,
 * así que usarlo para autorización es una escalada de privilegios de un PATCH de
 * distancia (contrato §2.2 y regla de RLS del prompt fase 4). Las consultas de
 * abajo van filtradas por las mismas políticas RLS que protegen todo lo demás:
 * si el usuario no tiene el rol, la fila simplemente no vuelve.
 *
 * Esto es para DECIDIR QUÉ MOSTRAR. La autorización real vive en PostgreSQL —
 * ocultar un menú no protege nada.
 */
export async function loadSessionRoles(userId: string, email: string): Promise<SessionRoles> {
  const [profile, platformAdmin, orgMemberships, tenantMemberships, salesAgent] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    supabase
      .from('platform_admins')
      .select('role')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('organization_memberships')
      .select('organization_id, role, organizations(display_name)')
      .eq('user_id', userId)
      .eq('is_active', true),
    supabase
      .from('tenant_memberships')
      .select('tenant_id, role')
      .eq('user_id', userId)
      .eq('is_active', true),
    supabase
      .from('sales_agents')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'ACTIVE')
      .maybeSingle(),
  ]);

  return {
    userId,
    email,
    fullName: profile.data?.full_name ?? null,
    platformRole: platformAdmin.data?.role ?? null,
    organizations: (orgMemberships.data ?? []).map((m) => ({
      organizationId: m.organization_id,
      role: m.role,
      displayName:
        (m.organizations as { display_name: string } | null)?.display_name ?? 'Organización',
    })),
    tenantRoles: (tenantMemberships.data ?? []).map((m) => ({
      tenantId: m.tenant_id,
      role: m.role,
    })),
    salesAgentId: salesAgent.data?.id ?? null,
  };
}

/** Perfil funcional del usuario: determina qué dashboard y menú ve. */
export type PersonaKind = 'EBIM' | 'PARTNER' | 'SALES_AGENT' | 'TENANT' | 'UNKNOWN';

export function resolvePersona(roles: SessionRoles | null): PersonaKind {
  if (!roles) return 'UNKNOWN';
  if (roles.platformRole) return 'EBIM';
  if (roles.organizations.length > 0) return 'PARTNER';
  if (roles.salesAgentId) return 'SALES_AGENT';
  if (roles.tenantRoles.length > 0) return 'TENANT';
  return 'UNKNOWN';
}

export function isFinance(roles: SessionRoles | null): boolean {
  return roles?.platformRole === 'EBIM_FINANCE' || roles?.platformRole === 'EBIM_SUPER_ADMIN';
}

export function canManagePlatform(roles: SessionRoles | null): boolean {
  return (
    roles?.platformRole === 'EBIM_PRODUCT_ADMIN' || roles?.platformRole === 'EBIM_SUPER_ADMIN'
  );
}

/**
 * Contrato §13.2: los roles de CONSOLA no son visibles ni asignables desde la
 * UI de un tenant. Esta lista es la fuente única de ese filtro.
 */
export const CONSOLE_ROLES = ['EBIM_SUPER_ADMIN', 'EBIM_PRODUCT_ADMIN', 'EBIM_FINANCE'] as const;

/**
 * Contrato §13.2: el dominio operador ÚNICO es `ebim.pe`.
 * `grupoebim.com` es un dominio de negocio normal — NO va en esta lista.
 */
export const BLOCKED_OPERATOR_DOMAINS = ['ebim.pe'] as const;

export function isOperatorDomain(email: string): boolean {
  const domain = email.toLowerCase().split('@')[1] ?? '';
  return BLOCKED_OPERATOR_DOMAINS.includes(domain as (typeof BLOCKED_OPERATOR_DOMAINS)[number]);
}
