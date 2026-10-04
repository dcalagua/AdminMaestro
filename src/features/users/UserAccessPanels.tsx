import { useEffect, useState } from 'react';
import { Card, DataTable, EmptyState, Badge, LoadingState, ErrorState } from '@/components/ui/primitives';
import { SelectField, TextField, FieldRow } from '@/components/ui/fields';
import { FormDialog } from '@/components/ui/FormDialog';
import { RevokeWithReasonDialog } from '@/components/ui/RevokeWithReasonDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatDate, formatDateTime } from '@/lib/format';
import { ORG_ROLE_LABEL, PLATFORM_ROLE_LABEL } from '@/types/domain';
import type { OrgRole, PlatformRole, TenantRole } from '@/types/domain';
import { PROVISIONING_ROLE_LABEL, PRODUCT_OWNER_ROLE_LABEL, type ProvisioningRole, type ProductOwnerRole } from '@/lib/provisioning';
import { useSalesAgents, useUserActivity, useUserInvitations } from '@/services/queries';
import {
  useAdminUpdateProfile, useGrantPlatformRole, useRevokePlatformRole, useUpsertOrganizationMembership,
  useSetOrganizationMembershipActive, useUpsertTenantMembership, useSetTenantMembershipActive,
  useGrantProvisioningRole, useRevokeProvisioningRole, useLinkUserSalesAgent,
} from '@/services/mutations';
import {
  ASSIGNABLE_PLATFORM_ROLES, TENANT_ROLE_LABEL, activityLabel, assignableOrgRoles, isPendingInvitation,
  type AdminUser,
} from './userModel';
import { useAccessOptions } from './accessOptions';
import type { useUserAdminScope } from './useUserAdminScope';

type Scope = ReturnType<typeof useUserAdminScope>;

function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? 'ok' : 'neutral'}>{active ? 'Activa' : 'Inactiva'}</Badge>;
}

/* ==========================================================================
   Perfil
   ========================================================================== */

export function ProfilePanel({ user, scope }: { user: AdminUser; scope: Scope }) {
  const update = useAdminUpdateProfile();
  const toast = useToast();
  const editable = scope.isSuperAdmin || scope.userId === user.id;
  const [fullName, setFullName] = useState(user.fullName ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? '');
  const invitations = useUserInvitations(user.id);

  useEffect(() => {
    setFullName(user.fullName ?? '');
    setPhone(user.phone ?? '');
    setJobTitle(user.jobTitle ?? '');
  }, [user.id, user.fullName, user.phone, user.jobTitle]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      await update.mutateAsync({
        p_user_id: user.id,
        p_full_name: fullName,
        p_phone: phone.trim() || undefined,
        p_job_title: jobTitle.trim() || undefined,
      });
      toast.success('Perfil actualizado', fullName);
    } catch {
      /* visible bajo el formulario */
    }
  }

  const facts: Array<[string, string]> = [
    ['Correo', user.email],
    ['Alta', formatDate(user.createdAt)],
    ['Último ingreso', user.lastSignInAt ? formatDateTime(user.lastSignInAt) : 'Nunca'],
    ['Invitación', isPendingInvitation(user) ? `Pendiente desde ${formatDate(user.invitedAt)}` : user.invitedAt ? 'Aceptada' : '—'],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Datos de la persona" description={editable ? undefined : 'Solo el propio usuario o el super admin los editan.'}>
        {editable ? (
          <form className="grid gap-4 p-4" aria-label="Datos de la persona" onSubmit={(e) => void save(e)}>
            <TextField label="Nombre completo" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <FieldRow>
              <TextField label="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <TextField label="Cargo" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </FieldRow>
            {update.error ? (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {businessErrorMessage(update.error)}
              </p>
            ) : null}
            <div className="flex justify-end">
              <button type="submit" className="ebim-btn-primary" disabled={update.isPending}>
                {update.isPending ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        ) : (
          <dl className="divide-y divide-border">
            {[['Nombre', user.fullName ?? '—'], ['Teléfono', user.phone ?? '—'], ['Cargo', user.jobTitle ?? '—']].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
      <Card title="Cuenta" description="El correo es la identidad: no se edita desde la consola.">
        <dl className="divide-y divide-border">
          {facts.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {(invitations.data ?? []).length > 0 ? (
          <div className="border-t border-border px-4 py-3 text-xs text-muted">
            {(invitations.data ?? []).map((i) => (
              <div key={i.id}>
                {formatDateTime(i.created_at)} · {i.delivery === 'EMAIL' ? 'por correo' : 'enlace copiado'} ·{' '}
                {i.status === 'ACCEPTED' ? 'aceptada' : i.status === 'REVOKED' ? 'anulada' : 'pendiente'}
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/* ==========================================================================
   Rol de consola (solo super admin; S-01: nunca EBIM_SUPER_ADMIN)
   ========================================================================== */

export function ConsoleRolePanel({ user }: { user: AdminUser }) {
  const grant = useGrantPlatformRole();
  const revoke = useRevokePlatformRole();
  const toast = useToast();
  const [role, setRole] = useState<PlatformRole>(
    user.platformRole && user.platformRole !== 'EBIM_SUPER_ADMIN' ? user.platformRole : 'EBIM_PRODUCT_ADMIN',
  );
  const [revoking, setRevoking] = useState(false);
  const isSuper = user.platformRole === 'EBIM_SUPER_ADMIN';
  const active = Boolean(user.platformRole && user.platformRoleActive);

  if (isSuper) {
    return (
      <Card title="Rol de consola">
        <EmptyState
          title="Super Admin EBIM"
          description="Rol único de la suite: no se asigna, no se transfiere y no se modifica desde la consola (contrato §13.1)."
        />
      </Card>
    );
  }

  return (
    <Card
      title="Rol de consola"
      description="Da acceso a la consola EBIM entera según el rol. Invisible y no asignable desde la UI de un tenant (S-03)."
    >
      <div className="grid gap-4 p-4">
        <p className="text-sm">
          Rol actual:{' '}
          {active && user.platformRole ? (
            <Badge tone="accent">{PLATFORM_ROLE_LABEL[user.platformRole]}</Badge>
          ) : (
            <span className="text-muted">Ninguno</span>
          )}
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          aria-label="Asignar rol de consola"
          onSubmit={(e) => {
            e.preventDefault();
            void grant
              .mutateAsync({ p_user_id: user.id, p_role: role, p_reason: 'Asignado desde la ficha de usuario' })
              .then(() => toast.success('Rol de consola asignado', PLATFORM_ROLE_LABEL[role]))
              .catch(() => undefined);
          }}
        >
          <SelectField label="Rol" className="min-w-[220px]" value={role}
            options={ASSIGNABLE_PLATFORM_ROLES.map((r) => ({ value: r, label: PLATFORM_ROLE_LABEL[r] }))}
            onChange={(e) => setRole(e.target.value as PlatformRole)} />
          <button type="submit" className="ebim-btn-primary" disabled={grant.isPending || !user.isActive}>
            {active ? 'Cambiar rol' : 'Asignar rol'}
          </button>
          {active ? (
            <button type="button" className="ebim-btn-danger" onClick={() => setRevoking(true)}>
              Revocar rol
            </button>
          ) : null}
        </form>
        {grant.error ? <p role="alert" className="text-sm text-danger">{businessErrorMessage(grant.error)}</p> : null}
      </div>
      <RevokeWithReasonDialog
        open={revoking}
        title="Revocar rol de consola"
        description="La persona deja de ver la consola EBIM al instante. El motivo queda en la auditoría."
        busy={revoke.isPending}
        onCancel={() => setRevoking(false)}
        onSubmit={async (reason) => {
          await revoke.mutateAsync({ p_user_id: user.id, p_reason: reason });
          setRevoking(false);
          toast.success('Rol de consola revocado', user.email);
        }}
      />
    </Card>
  );
}

/* ==========================================================================
   Membresías de organización
   ========================================================================== */

export function OrganizationsPanel({ user, scope }: { user: AdminUser; scope: Scope }) {
  const upsert = useUpsertOrganizationMembership();
  const setActive = useSetOrganizationMembershipActive();
  const toast = useToast();
  const { orgOptions } = useAccessOptions(scope);
  const [adding, setAdding] = useState(false);
  const [orgId, setOrgId] = useState('');
  const [role, setRole] = useState<OrgRole | ''>('');
  const [deactivating, setDeactivating] = useState<string | null>(null);

  const canManage = (organizationId: string, current?: OrgRole) => {
    if (scope.managePlatform) return true;
    const caller = scope.adminRoleIn(organizationId);
    if (!caller || user.id === scope.userId) return false;
    return !current || assignableOrgRoles({ managePlatform: false, orgIsPartner: true, callerRole: caller }).includes(current);
  };
  const selectedOrg = orgOptions.find((o) => o.id === orgId);
  const roles = selectedOrg
    ? assignableOrgRoles({ managePlatform: scope.managePlatform, orgIsPartner: selectedOrg.isPartner, callerRole: scope.adminRoleIn(selectedOrg.id) })
    : [];

  return (
    <Card
      title="Organizaciones"
      description="Membresías del usuario en partners y clientes. Un correo @ebim.pe no puede ser miembro de una organización cliente (S-02)."
      actions={
        user.isActive && (scope.managePlatform || scope.adminOrgs.length > 0) && user.id !== scope.userId ? (
          <button type="button" className="ebim-btn-ghost" onClick={() => { setOrgId(''); setRole(''); upsert.reset(); setAdding(true); }}>
            Agregar a organización
          </button>
        ) : null
      }
    >
      {user.organizations.length === 0 ? (
        <EmptyState title="Sin membresías de organización" />
      ) : (
        <DataTable columns={['Organización', 'Rol', 'Estado', '']}>
          {user.organizations.map((m) => (
            <tr key={m.id}>
              <td className="ebim-td font-semibold">{m.organization_name}</td>
              <td className="ebim-td"><Badge tone="info">{ORG_ROLE_LABEL[m.role] ?? m.role}</Badge></td>
              <td className="ebim-td"><ActiveBadge active={m.is_active} /></td>
              <td className="ebim-td text-right">
                {canManage(m.organization_id, m.role) ? (
                  m.is_active ? (
                    <button type="button" className="ebim-link text-[13px]" onClick={() => setDeactivating(m.id)}>
                      Desactivar
                    </button>
                  ) : user.isActive ? (
                    <button
                      type="button"
                      className="ebim-link text-[13px]"
                      onClick={() =>
                        void setActive
                          .mutateAsync({ p_membership_id: m.id, p_active: true, p_reason: 'Reactivada desde la ficha' })
                          .then(() => toast.success('Membresía reactivada', m.organization_name))
                          .catch((e: unknown) => toast.error('No se pudo reactivar', businessErrorMessage(e)))
                      }
                    >
                      Reactivar
                    </button>
                  ) : null
                ) : null}
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      <FormDialog
        open={adding}
        title="Agregar a organización"
        description="Si ya era miembro, se actualiza su rol y queda activa."
        submitLabel="Guardar"
        busy={upsert.isPending}
        error={upsert.error}
        onCancel={() => setAdding(false)}
        onSubmit={() => {
          if (!orgId || !role) return;
          void upsert
            .mutateAsync({ p_user_id: user.id, p_org_id: orgId, p_role: role, p_reason: 'Asignado desde la ficha de usuario' })
            .then(() => {
              setAdding(false);
              toast.success('Membresía guardada', selectedOrg?.name ?? '');
            })
            .catch(() => undefined);
        }}
      >
        <FieldRow>
          <SelectField label="Organización" required placeholder="Elige la organización" value={orgId}
            options={orgOptions.map((o) => ({ value: o.id, label: o.name }))}
            onChange={(e) => { setOrgId(e.target.value); setRole(''); }} />
          <SelectField label="Rol" required placeholder="Elige el rol" value={role} disabled={!orgId}
            options={roles.map((r) => ({ value: r, label: ORG_ROLE_LABEL[r] }))}
            onChange={(e) => setRole(e.target.value as OrgRole)} />
        </FieldRow>
      </FormDialog>

      <RevokeWithReasonDialog
        open={deactivating !== null}
        title="Desactivar membresía"
        description="La persona deja de ver esta organización. Se puede reactivar después."
        busy={setActive.isPending}
        onCancel={() => setDeactivating(null)}
        onSubmit={async (reason) => {
          await setActive.mutateAsync({ p_membership_id: deactivating!, p_active: false, p_reason: reason });
          setDeactivating(null);
          toast.success('Membresía desactivada', user.email);
        }}
      />
    </Card>
  );
}

/* ==========================================================================
   Membresías de tenant (acceso OPERATIVO; comercial ≠ acceso)
   ========================================================================== */

export function TenantsPanel({ user, scope }: { user: AdminUser; scope: Scope }) {
  const upsert = useUpsertTenantMembership();
  const setActive = useSetTenantMembershipActive();
  const toast = useToast();
  const { tenantOptions } = useAccessOptions(scope);
  const manageableIds = new Set(tenantOptions.map((t) => t.id));
  const [adding, setAdding] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [role, setRole] = useState<TenantRole>('TENANT_USER');
  const [deactivating, setDeactivating] = useState<string | null>(null);
  const canManage = (id: string) => user.id !== scope.userId && (scope.managePlatform || manageableIds.has(id));

  return (
    <Card
      title="Tenants"
      description="Acceso operativo a un tenant. Vender un tenant no crea esta membresía (comercial ≠ acceso operativo)."
      actions={
        user.isActive && tenantOptions.length > 0 && user.id !== scope.userId ? (
          <button type="button" className="ebim-btn-ghost" onClick={() => { setTenantId(''); setRole('TENANT_USER'); upsert.reset(); setAdding(true); }}>
            Agregar a tenant
          </button>
        ) : null
      }
    >
      {user.tenants.length === 0 ? (
        <EmptyState title="Sin membresías de tenant" />
      ) : (
        <DataTable columns={['Tenant', 'Producto', 'Rol', 'Estado', '']}>
          {user.tenants.map((t) => (
            <tr key={t.id}>
              <td className="ebim-td font-semibold">{t.tenant_name}</td>
              <td className="ebim-td text-muted">{t.product_name}</td>
              <td className="ebim-td"><Badge tone="info">{TENANT_ROLE_LABEL[t.role] ?? t.role}</Badge></td>
              <td className="ebim-td"><ActiveBadge active={t.is_active} /></td>
              <td className="ebim-td text-right">
                {canManage(t.tenant_id) ? (
                  t.is_active ? (
                    <button type="button" className="ebim-link text-[13px]" onClick={() => setDeactivating(t.id)}>
                      Desactivar
                    </button>
                  ) : user.isActive ? (
                    <button
                      type="button"
                      className="ebim-link text-[13px]"
                      onClick={() =>
                        void setActive
                          .mutateAsync({ p_membership_id: t.id, p_active: true, p_reason: 'Reactivada desde la ficha' })
                          .then(() => toast.success('Membresía reactivada', t.tenant_name))
                          .catch((e: unknown) => toast.error('No se pudo reactivar', businessErrorMessage(e)))
                      }
                    >
                      Reactivar
                    </button>
                  ) : null
                ) : null}
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      <FormDialog
        open={adding}
        title="Agregar a tenant"
        submitLabel="Guardar"
        busy={upsert.isPending}
        error={upsert.error}
        onCancel={() => setAdding(false)}
        onSubmit={() => {
          if (!tenantId) return;
          void upsert
            .mutateAsync({ p_user_id: user.id, p_tenant_id: tenantId, p_role: role, p_reason: 'Asignado desde la ficha de usuario' })
            .then(() => {
              setAdding(false);
              toast.success('Membresía de tenant guardada', tenantOptions.find((t) => t.id === tenantId)?.name ?? '');
            })
            .catch(() => undefined);
        }}
      >
        <FieldRow>
          <SelectField label="Tenant" required placeholder="Elige el tenant" value={tenantId}
            options={tenantOptions.map((t) => ({ value: t.id, label: t.product ? `${t.name} · ${t.product}` : t.name }))}
            onChange={(e) => setTenantId(e.target.value)} />
          <SelectField label="Rol en el tenant" value={role}
            options={(['TENANT_USER', 'TENANT_ADMIN'] as TenantRole[]).map((r) => ({ value: r, label: TENANT_ROLE_LABEL[r] }))}
            onChange={(e) => setRole(e.target.value as TenantRole)} />
        </FieldRow>
      </FormDialog>

      <RevokeWithReasonDialog
        open={deactivating !== null}
        title="Desactivar membresía de tenant"
        description="La persona pierde el acceso operativo a este tenant."
        busy={setActive.isPending}
        onCancel={() => setDeactivating(null)}
        onSubmit={async (reason) => {
          await setActive.mutateAsync({ p_membership_id: deactivating!, p_active: false, p_reason: reason });
          setDeactivating(null);
          toast.success('Membresía desactivada', user.email);
        }}
      />
    </Card>
  );
}

/* ==========================================================================
   Provisioning (RPC existentes grant/revoke_provisioning_role; super admin)
   ========================================================================== */

const GRANTABLE_PROVISIONING: ProvisioningRole[] = ['TECH_LEAD', 'PROVISIONING_ADMIN', 'PROVISIONING_VIEWER'];

export function ProvisioningPanel({ user, scope }: { user: AdminUser; scope: Scope }) {
  const grant = useGrantProvisioningRole();
  const revoke = useRevokeProvisioningRole();
  const toast = useToast();
  const [role, setRole] = useState<ProvisioningRole>('PROVISIONING_VIEWER');

  return (
    <div className="grid gap-4">
      <Card
        title="Roles de provisioning"
        description="Roles transversales del plano de provisioning. Solo el super admin los concede; la propiedad por producto se administra en la ficha del producto."
      >
        {user.provisioningRoles.length === 0 ? (
          <EmptyState title="Sin roles de provisioning" />
        ) : (
          <DataTable columns={['Rol', 'Desde', 'Estado', '']}>
            {user.provisioningRoles.map((r) => (
              <tr key={r.id}>
                <td className="ebim-td font-semibold">{PROVISIONING_ROLE_LABEL[r.role] ?? r.role}</td>
                <td className="ebim-td text-xs text-muted">{formatDate(r.granted_at)}</td>
                <td className="ebim-td"><ActiveBadge active={r.is_active} /></td>
                <td className="ebim-td text-right">
                  {scope.isSuperAdmin && r.is_active ? (
                    <button
                      type="button"
                      className="ebim-link text-[13px]"
                      onClick={() =>
                        void revoke
                          .mutateAsync({ p_id: r.id })
                          .then(() => toast.success('Rol de provisioning revocado', PROVISIONING_ROLE_LABEL[r.role]))
                          .catch((e: unknown) => toast.error('No se pudo revocar', businessErrorMessage(e)))
                      }
                    >
                      Revocar
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
        {scope.isSuperAdmin && user.isActive ? (
          <form
            className="flex flex-wrap items-end gap-3 border-t border-border p-4"
            aria-label="Otorgar rol de provisioning"
            onSubmit={(e) => {
              e.preventDefault();
              void grant
                .mutateAsync({ p_user_id: user.id, p_role: role, p_notes: 'Otorgado desde la ficha de usuario' })
                .then(() => toast.success('Rol de provisioning otorgado', PROVISIONING_ROLE_LABEL[role]))
                .catch(() => undefined);
            }}
          >
            <SelectField label="Rol" className="min-w-[220px]" value={role}
              options={GRANTABLE_PROVISIONING.map((r) => ({ value: r, label: PROVISIONING_ROLE_LABEL[r] }))}
              onChange={(e) => setRole(e.target.value as ProvisioningRole)} />
            <button type="submit" className="ebim-btn-primary" disabled={grant.isPending}>Otorgar</button>
            {grant.error ? <p role="alert" className="w-full text-sm text-danger">{businessErrorMessage(grant.error)}</p> : null}
          </form>
        ) : null}
      </Card>
      <Card title="Propiedad técnica de productos">
        {user.productOwnerships.length === 0 ? (
          <EmptyState title="No es propietario técnico de ningún producto" />
        ) : (
          <DataTable columns={['Producto', 'Rol', 'Estado']}>
            {user.productOwnerships.map((o) => (
              <tr key={o.id}>
                <td className="ebim-td font-semibold">{o.product_name}</td>
                <td className="ebim-td">{PRODUCT_OWNER_ROLE_LABEL[o.role as ProductOwnerRole] ?? o.role}</td>
                <td className="ebim-td"><ActiveBadge active={o.is_active} /></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}

/* ==========================================================================
   Vendedor (vínculo comercial; NO da acceso operativo)
   ========================================================================== */

export function SalesAgentPanel({ user }: { user: AdminUser }) {
  const agents = useSalesAgents();
  const link = useLinkUserSalesAgent();
  const toast = useToast();
  const [agentId, setAgentId] = useState('');
  const available = (agents.data ?? []).filter((a) => !a.user_id || a.user_id === user.id);

  return (
    <Card
      title="Vendedor"
      description="Vincular la cuenta a un comercial le deja ver SUS atribuciones y comisiones. No le da acceso operativo a ningún tenant."
    >
      <div className="grid gap-4 p-4">
        {user.salesAgent ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>
              Vinculado a <strong>{user.salesAgent.full_name}</strong>{' '}
              <span className="font-mono text-xs text-muted">({user.salesAgent.code})</span>
            </span>
            <button
              type="button"
              className="ebim-btn-ghost"
              disabled={link.isPending}
              onClick={() =>
                void link
                  .mutateAsync({ p_sales_agent_id: user.salesAgent!.id, p_user_id: null as unknown as string, p_reason: 'Desvinculado desde la ficha' })
                  .then(() => toast.success('Comercial desvinculado', user.salesAgent!.full_name))
                  .catch((e: unknown) => toast.error('No se pudo desvincular', businessErrorMessage(e)))
              }
            >
              Desvincular
            </button>
          </div>
        ) : agents.isLoading ? (
          <LoadingState label="Cargando comerciales…" />
        ) : agents.error ? (
          <ErrorState error={agents.error} />
        ) : (
          <form
            className="flex flex-wrap items-end gap-3"
            aria-label="Vincular a comercial"
            onSubmit={(e) => {
              e.preventDefault();
              if (!agentId) return;
              void link
                .mutateAsync({ p_sales_agent_id: agentId, p_user_id: user.id, p_reason: 'Vinculado desde la ficha' })
                .then(() => toast.success('Comercial vinculado', user.email))
                .catch(() => undefined);
            }}
          >
            <SelectField label="Comercial" className="min-w-[260px]" placeholder="Elige el comercial" value={agentId}
              options={available.map((a) => ({ value: a.id, label: `${a.full_name} (${a.code})` }))}
              onChange={(e) => setAgentId(e.target.value)} />
            <button type="submit" className="ebim-btn-primary" disabled={!agentId || link.isPending || !user.isActive}>
              Vincular
            </button>
          </form>
        )}
        {link.error ? <p role="alert" className="text-sm text-danger">{businessErrorMessage(link.error)}</p> : null}
      </div>
    </Card>
  );
}

/* ==========================================================================
   Actividad (auditoría de y para el usuario)
   ========================================================================== */

export function ActivityPanel({ userId }: { userId: string }) {
  const activity = useUserActivity(userId);
  return (
    <Card title="Actividad" description="Lo que hizo la persona y lo que se hizo sobre su cuenta. Fuente: bitácora de auditoría.">
      {activity.isLoading ? (
        <LoadingState label="Cargando actividad…" />
      ) : activity.error ? (
        <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
      ) : (activity.data ?? []).length === 0 ? (
        <EmptyState title="Sin actividad registrada" />
      ) : (
        <DataTable columns={['Fecha', 'Acción', 'Por', 'Detalle']}>
          {(activity.data ?? []).map((a) => {
            const meta = (a.metadata ?? {}) as Record<string, unknown>;
            const detail = [meta.role, meta.reason].filter((x) => typeof x === 'string' && x !== '').join(' · ');
            return (
              <tr key={a.id}>
                <td className="ebim-td whitespace-nowrap text-xs text-muted">{formatDateTime(a.occurred_at)}</td>
                <td className="ebim-td font-semibold">{activityLabel(a.action)}</td>
                <td className="ebim-td text-xs text-muted">
                  {a.actor_user_id === userId ? 'La propia persona' : (a.actor_email ?? 'Sistema')}
                </td>
                <td className="ebim-td text-xs text-muted">{detail || '—'}</td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </Card>
  );
}
