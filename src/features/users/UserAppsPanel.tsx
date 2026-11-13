import { Link } from 'react-router-dom';
import { PlugsConnectedIcon } from '@phosphor-icons/react';
import { Badge, Card, DataTable, EmptyState, LoadingState } from '@/components/ui/primitives';
import type { Tone } from '@/lib/provisioning';
import type { AdminUser } from './userModel';
import { APP_USER_CHANNEL_AVAILABLE, APP_USER_CHANNEL_PENDING, userAppAccess, type TenantState } from './userAppAccess';
import { useUserAppContext } from './useUserAppContext';

const BADGE_TONE: Record<Tone, 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent'> = {
  ok: 'ok', warn: 'warn', danger: 'danger', info: 'info', neutral: 'neutral', accent: 'accent',
};

function StateBadge({ state }: { state: TenantState | null }) {
  if (!state) return <span className="text-caption text-muted">No visible para tu perfil</span>;
  return (
    <Badge tone={BADGE_TONE[state.tone]} title={state.help}>
      {state.label}
    </Badge>
  );
}

/** Acciones de usuario DENTRO de cada app: sin canal todavía, se dicen como pendientes, sin botones falsos. */
const IN_APP_ACTIONS = ['Invitar a la app', 'Suspender en la app', 'Reactivar en la app'];

/**
 * V5 · F6 · «Apps y accesos» de la ficha de usuario: a qué apps entra, con qué
 * rol y en qué estado está su tenant en cada app. La membresía de tenant es el
 * acceso; pertenecer a la cuenta no da acceso dentro de la app.
 */
export function UserAppsPanel({ user, managePlatform }: { user: AdminUser; managePlatform: boolean }) {
  const ctx = useUserAppContext(managePlatform);
  const apps = userAppAccess(user, ctx);
  const activeApps = apps.filter((a) => a.active).length;

  return (
    <Card
      title="Apps de la suite"
      description="A qué apps entra esta persona, con qué rol y en qué estado está su tenant en cada una. El acceso lo da la membresía del tenant; ser parte de la cuenta no da acceso dentro de la app."
    >
      {ctx.loading ? (
        <LoadingState label="Leyendo las apps de la persona…" rows={3} />
      ) : apps.length === 0 ? (
        <EmptyState
          illustration="none"
          title="No entra a ninguna app"
          description="Agrégala a un tenant en «Membresías de tenant» para darle acceso a la app de ese tenant."
        />
      ) : (
        <div className="grid gap-4 p-4" data-user-apps>
          <p className="text-compact text-fg-2">
            {activeApps === 0
              ? 'Sin acceso activo a ninguna app.'
              : `Entra a ${activeApps} app${activeApps === 1 ? '' : 's'}.`}
          </p>
          {apps.map((app) => (
            <section key={app.key} aria-labelledby={`app-${app.key}`} className="rounded-card border border-border" data-user-app={app.appName}>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-sunken px-4 py-2.5">
                <h3 id={`app-${app.key}`} className="flex items-center gap-2 text-body font-semibold text-fg">
                  {app.appCode ? (
                    <Link to={`/apps/${app.appCode}`} className="hover:text-accent-deep hover:underline">
                      {app.appName}
                    </Link>
                  ) : (
                    app.appName
                  )}
                </h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={app.active ? 'info' : 'neutral'}>{app.active ? `Rol: ${app.roleLabel}` : app.roleLabel}</Badge>
                  {app.attention ? <StateBadge state={app.attention} /> : null}
                </div>
              </header>
              <DataTable paginate={false} label={`Tenants de ${app.appName}`} columns={['Tenant', 'Rol', 'Acceso', 'Estado en la app']}>
                {app.tenants.map((t) => (
                  <tr key={t.membershipId}>
                    <td className="ebim-td">
                      <Link to={`/tenants/${t.tenantId}`} className="font-semibold text-fg hover:text-accent-deep hover:underline">
                        {t.tenantName}
                      </Link>
                      <div className="text-caption text-muted">
                        {t.accountName ?? 'Cuenta no visible'}
                        {t.managesAccount ? ' · administra la cuenta' : ''}
                      </div>
                    </td>
                    <td className="ebim-td">{t.roleLabel}</td>
                    <td className="ebim-td">
                      <Badge tone={t.membershipActive ? 'ok' : 'neutral'}>{t.membershipActive ? 'Activo' : 'Desactivado'}</Badge>
                    </td>
                    <td className="ebim-td">
                      <StateBadge state={t.state} />
                    </td>
                  </tr>
                ))}
              </DataTable>
            </section>
          ))}
        </div>
      )}

      {APP_USER_CHANNEL_AVAILABLE ? null : (
        <div className="flex gap-3 rounded-b-card border-t border-border bg-sunken px-5 py-3" role="note" data-app-user-channel="pending">
          <PlugsConnectedIcon size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          <div className="min-w-0 text-compact text-fg-2">
            <p className="font-semibold text-fg">Usuarios dentro de cada app</p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-muted">
              {IN_APP_ACTIONS.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <p className="mt-1">
              {APP_USER_CHANNEL_PENDING}. Hoy el Admin Maestro registra el acceso al tenant y la cuenta de la consola; la
              app todavía no recibe invitaciones, suspensiones ni reactivaciones de usuarios.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
