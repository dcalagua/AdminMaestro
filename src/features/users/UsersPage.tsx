import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminUsers } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, KpiTile,
} from '@/components/ui/primitives';
import { Avatar } from '@/components/ui/Avatar';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { KpiStrip } from '@/features/billing/financeUi';
import { formatDateTime, formatNumber } from '@/lib/format';
import { isAuthorizationError } from '@/lib/pgError';
import { PLATFORM_ROLE_LABEL } from '@/types/domain';
import { accessSummary, accountStatus, isPendingInvitation, matchesUserTab, userTabs, type UserTab } from './userModel';
import { UserStatus } from './UserStatus';
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
  const everyone = users.data ?? [];
  const since = Date.now() - 30 * 86_400_000;
  const kpis = {
    active: everyone.filter((u) => u.isActive && !u.banned && !isPendingInvitation(u)).length,
    pending: everyone.filter((u) => u.isActive && isPendingInvitation(u)).length,
    recent: everyone.filter((u) => u.lastSignInAt && new Date(u.lastSignInAt).getTime() >= since).length,
    inactive: everyone.filter((u) => !u.isActive).length,
  };

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
      {hasAny ? (
        <KpiStrip label="Resumen de usuarios">
          <KpiTile label="Usuarios activos" value={formatNumber(kpis.active)} />
          <KpiTile
            label="Invitaciones pendientes"
            value={formatNumber(kpis.pending)}
            tone={kpis.pending > 0 ? 'warn' : 'neutral'}
            footer="Aún no aceptan su invitación."
          />
          <KpiTile label="Ingresaron en 30 días" value={formatNumber(kpis.recent)} footer="Último ingreso registrado en Auth." />
          <KpiTile label="Desactivados" value={formatNumber(kpis.inactive)} footer="Conservan su historial; no ingresan." />
        </KpiStrip>
      ) : null}

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
          <DataTable
            label="Usuarios"
            columns={['Usuario', 'Roles y accesos', 'Último ingreso', 'Estado', { label: 'Acciones', srOnly: true }]}
          >
            {visible.map((u) => {
              const status = accountStatus(u);
              const access = accessSummary(u);
              const name = u.fullName ?? 'Sin nombre';
              return (
                <tr key={u.id} className={u.isActive ? undefined : 'opacity-80'}>
                  <td className="ebim-td">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={u.fullName ?? u.email} mode="person" />
                      <div className="min-w-0">
                        <Link
                          to={`/users/${u.id}`}
                          className="block truncate font-semibold text-fg hover:text-accent-deep hover:underline"
                        >
                          {name}
                        </Link>
                        <div className="truncate text-caption text-muted">
                          {u.email}
                          {u.jobTitle ? ` · ${u.jobTitle}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="ebim-td">
                    <div className="flex max-w-[420px] flex-wrap gap-1">
                      {u.platformRole && u.platformRoleActive ? (
                        <Badge tone="accent">{PLATFORM_ROLE_LABEL[u.platformRole]}</Badge>
                      ) : null}
                      {access.filter((a) => a !== 'Consola').map((a) => (
                        <Badge key={a} tone="neutral">{a}</Badge>
                      ))}
                      {access.length === 0 ? <span className="text-caption text-muted">Sin accesos activos</span> : null}
                    </div>
                  </td>
                  <td className="ebim-td whitespace-nowrap text-compact text-muted">
                    {u.lastSignInAt ? formatDateTime(u.lastSignInAt) : 'Nunca'}
                  </td>
                  <td className="ebim-td whitespace-nowrap">
                    <UserStatus label={status.label} tone={u.isActive ? status.tone : 'neutral'} />
                  </td>
                  <td className="ebim-td text-right">
                    <ActionMenu
                      label={`Acciones de ${name}`}
                      items={[
                        { label: 'Ver ficha', to: `/users/${u.id}` },
                        { label: 'Ver actividad', to: `/users/${u.id}#actividad` },
                      ]}
                    />
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
