import { SummaryBar, SummaryItem } from '@/components/ui/SummaryBar';
import { Badge } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import { relativeAge } from '@/features/suite/suiteModel';
import { PLATFORM_ROLE_LABEL } from '@/types/domain';
import { AppAccessChips } from './AppAccessChips';
import { UserStatus } from './UserStatus';
import { userAppAccess } from './userAppAccess';
import { accountStatus, type AdminUser } from './userModel';

/**
 * Cabecera fija de la ficha de usuario (V6 · T8): estado, rol de consola,
 * organizaciones, apps y último ingreso, sin abrir ninguna pestaña.
 */
export function UserSummaryBar({ user }: { user: AdminUser }) {
  const status = accountStatus(user);
  const orgs = user.organizations.filter((m) => m.is_active);
  const apps = userAppAccess(user);
  return (
    <SummaryBar label="Resumen del usuario">
      <SummaryItem label="Estado">
        <UserStatus label={status.label} tone={user.isActive ? status.tone : 'neutral'} />
      </SummaryItem>
      <SummaryItem label="Rol de consola" hint="Qué puede hacer en el Admin Maestro">
        {user.platformRole && user.platformRoleActive ? (
          <Badge tone="accent">{PLATFORM_ROLE_LABEL[user.platformRole]}</Badge>
        ) : (
          <span className="font-normal text-muted">Sin rol de consola</span>
        )}
      </SummaryItem>
      <SummaryItem label="Organizaciones" hint={orgs.map((m) => m.organization_name).join(', ') || undefined}>
        {orgs.length === 0 ? (
          <span className="font-normal text-muted">Ninguna</span>
        ) : (
          <span className="min-w-0 truncate" data-orgs>
            {orgs[0]!.organization_name}
            {orgs.length > 1 ? <span className="font-normal text-muted"> +{orgs.length - 1}</span> : null}
          </span>
        )}
      </SummaryItem>
      <SummaryItem label="Apps" hint="Apps a las que entra por sus membresías de tenant" grow>
        {apps.some((a) => a.active) ? (
          <AppAccessChips apps={apps} max={3} />
        ) : (
          <span className="font-normal text-muted">Sin apps</span>
        )}
      </SummaryItem>
      <SummaryItem label="Último ingreso" hint={user.lastSignInAt ? formatDateTime(user.lastSignInAt) : undefined}>
        {user.lastSignInAt ? (
          <time dateTime={user.lastSignInAt}>{relativeAge(user.lastSignInAt)}</time>
        ) : (
          <span className="font-normal text-muted">Nunca</span>
        )}
      </SummaryItem>
    </SummaryBar>
  );
}
