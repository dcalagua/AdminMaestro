import type { AdminUser } from '@/features/users/userModel';

/**
 * Impacto de suspender o reactivar (V5 · F4): qué tenants cambian, agrupados
 * por app, y qué usuarios con acceso en el Admin Maestro quedan afectados. Sólo
 * combina datos ya leídos; la transición válida la decide la base.
 */
export type LifecycleMode = 'SUSPEND' | 'RESUME';

export interface LifecycleTarget {
  tenantId: string;
  tenantName: string;
  productName: string;
  tenantStatus: string;
}

export interface LifecycleImpact {
  affected: LifecycleTarget[];
  skipped: LifecycleTarget[];
  byApp: Array<{ productName: string; tenants: LifecycleTarget[] }>;
  users: Array<{ id: string; name: string; email: string }>;
}

/** Estado de origen que admite cada acción (espejo de `set_tenant_status`). */
const FROM: Record<LifecycleMode, string> = { SUSPEND: 'ACTIVE', RESUME: 'SUSPENDED' };

export function lifecycleImpact(
  mode: LifecycleMode,
  targets: readonly LifecycleTarget[],
  users: readonly Pick<AdminUser, 'id' | 'fullName' | 'email' | 'tenants'>[],
): LifecycleImpact {
  const affected = targets.filter((t) => t.tenantStatus === FROM[mode]);
  const skipped = targets.filter((t) => t.tenantStatus !== FROM[mode]);
  const groups = new Map<string, LifecycleTarget[]>();
  for (const t of affected) groups.set(t.productName, [...(groups.get(t.productName) ?? []), t]);
  const ids = new Set(affected.map((t) => t.tenantId));
  return {
    affected,
    skipped,
    byApp: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([productName, tenants]) => ({ productName, tenants })),
    users: users
      .filter((u) => u.tenants.some((m) => m.is_active && ids.has(m.tenant_id)))
      .map((u) => ({ id: u.id, name: u.fullName ?? u.email, email: u.email }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  };
}
