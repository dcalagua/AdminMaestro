import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminUsers } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import { isAuthorizationError } from '@/lib/pgError';
import { PLATFORM_ROLE_LABEL } from '@/types/domain';
import { accessSummary, accountStatus, matchesUserTab, userTabs, type UserTab } from './userModel';
import { useUserAdminScope } from './useUserAdminScope';
import { InviteUserDialog } from './InviteUserDialog';

/**
 * Gobierno → «Usuarios y accesos» (spec §6.4).
 *
 * Buscador único (nombre, correo, organización) y pestañas de estado (U-06).
 * EBIM ve a todos; un admin de partner o de cliente ve solo a los miembros de su
 * organización — lo decide `admin_list_users` en la base, no esta pantalla.
 */
export function UsersPage() {
  const scope = useUserAdminScope();
  const users = useAdminUsers();
  const [tab, setTab] = useState<UserTab>('ALL');
  const [inviting, setInviting] = useState(false);
  const { term, setTerm, filtered } = useSearchFilter(users.data, (u) => [
    u.fullName, u.email, ...u.organizations.map((m) => m.organization_name),
  ]);
  const visible = filtered.filter((u) => matchesUserTab(u, tab));
  const hasAny = (users.data ?? []).length > 0;

  const description = scope.managePlatform || scope.isSuperAdmin || (scope.canView && scope.adminOrgs.length === 0)
    ? 'Personal EBIM, usuarios de partners y de clientes: perfil, accesos, invitaciones y desactivación.'
    : 'Miembros de tu organización y de sus tenants. Solo puedes otorgar roles de tu propio nivel o inferiores.';

  if (!scope.canView) {
    return (
      <PageContainer title="Usuarios y accesos">
        <Card>
          <EmptyState
            title="Tu rol no administra usuarios"
            description="La administración de usuarios es del equipo de plataforma EBIM o del administrador de tu organización."
          />
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Usuarios y accesos"
      description={description}
      actions={
        scope.canInvite ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setInviting(true)}>
            Invitar usuario
          </button>
        ) : null
      }
    >
      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por nombre, correo u organización…"
          right={<StatusTabs value={tab} onChange={setTab} options={userTabs(filtered)} />}
        />
        {users.isLoading ? (
          <LoadingState label="Cargando usuarios…" />
        ) : users.error ? (
          isAuthorizationError(users.error) ? (
            <EmptyState
              title="Sin acceso a la administración de usuarios"
              description="La base de datos rechazó la consulta para tu rol. Pide acceso al equipo de plataforma EBIM."
            />
          ) : (
            <ErrorState error={users.error} onRetry={() => void users.refetch()} />
          )
        ) : visible.length === 0 ? (
          <EmptyState
            title={hasAny ? 'Ningún usuario coincide' : 'Sin usuarios'}
            description={
              hasAny
                ? 'Prueba con otra búsqueda o cambia de pestaña.'
                : 'Todavía no hay usuarios visibles para tu perfil. Invita al primero.'
            }
          />
        ) : (
          <DataTable columns={['Usuario', 'Accesos', 'Último ingreso', 'Estado', '']}>
            {visible.map((u) => {
              const status = accountStatus(u);
              const access = accessSummary(u);
              return (
                <tr key={u.id}>
                  <td className="ebim-td">
                    <div className="font-semibold">{u.fullName ?? 'Sin nombre'}</div>
                    <div className="text-xs text-muted">{u.email}</div>
                    {u.jobTitle ? <div className="text-[11px] text-muted">{u.jobTitle}</div> : null}
                  </td>
                  <td className="ebim-td">
                    <div className="flex flex-wrap gap-1">
                      {u.platformRole && u.platformRoleActive ? (
                        <Badge tone="accent">{PLATFORM_ROLE_LABEL[u.platformRole]}</Badge>
                      ) : null}
                      {access.filter((a) => a !== 'Consola').map((a) => (
                        <Badge key={a} tone="info">{a}</Badge>
                      ))}
                      {access.length === 0 ? <span className="text-xs text-muted">Sin accesos activos</span> : null}
                    </div>
                  </td>
                  <td className="ebim-td whitespace-nowrap text-xs text-muted">
                    {u.lastSignInAt ? formatDateTime(u.lastSignInAt) : 'Nunca'}
                  </td>
                  <td className="ebim-td">
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </td>
                  <td className="ebim-td text-right">
                    <Link className="ebim-link text-[13px]" to={`/users/${u.id}`}>
                      Ver ficha
                    </Link>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <InviteUserDialog open={inviting} scope={scope} onClose={() => setInviting(false)} />
    </PageContainer>
  );
}
