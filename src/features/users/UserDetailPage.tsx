import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAdminUser } from '@/services/queries';
import { useUserAdminAction, type UserAdminResult } from '@/services/mutations';
import { SectionTabs } from '@/components/ui/SectionTabs';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { PageContainer, Card, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { isAuthorizationError } from '@/lib/pgError';
import { accountStatus, isPendingInvitation } from './userModel';
import { useUserAdminScope } from './useUserAdminScope';
import {
  ActivityPanel, ConsoleRolePanel, OrganizationsPanel, ProfilePanel, ProvisioningPanel, SalesAgentPanel, TenantsPanel,
} from './UserAccessPanels';

/**
 * Ficha de usuario (spec §6.4) con `SectionTabs` y deep-link por `#hash` (U-07):
 * Perfil · Rol de consola · Organizaciones · Tenants · Provisioning · Vendedor ·
 * Actividad. Desactivar / Reactivar es una acción de cabecera (super admin).
 *
 * Las pestañas se ocultan según el rol (UX); cada RPC vuelve a decidir.
 */
export function UserDetailPage() {
  const { userId } = useParams();
  const scope = useUserAdminScope();
  const user = useAdminUser(userId);
  const action = useUserAdminAction();
  const toast = useToast();
  const [statusDialog, setStatusDialog] = useState<'ban' | 'unban' | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<Error | null>(null);
  const [resent, setResent] = useState<UserAdminResult | null>(null);

  const back = <Link className="text-xs text-muted hover:text-fg" to="/users">← Usuarios y accesos</Link>;

  if (user.isLoading) return <LoadingState label="Cargando la ficha del usuario…" />;
  if (user.error || !user.data) {
    return (
      <PageContainer title="Usuario no disponible" breadcrumbs={back}>
        <Card>
          {user.error && !isAuthorizationError(user.error) ? (
            <ErrorState error={user.error} onRetry={() => void user.refetch()} />
          ) : (
            <EmptyState
              title="No existe o está fuera de tu alcance"
              description="La base solo devuelve a los usuarios que tu rol administra. No es un fallo de la pantalla."
            />
          )}
        </Card>
      </PageContainer>
    );
  }

  const u = user.data;
  const status = accountStatus(u);
  const isSelf = u.id === scope.userId;
  const isTheSuperAdmin = u.platformRole === 'EBIM_SUPER_ADMIN';
  const canResend = isPendingInvitation(u) && u.isActive && !isSelf;

  async function confirmStatus() {
    if (statusDialog === 'ban' && reason.trim() === '') {
      setReasonError(new Error('MOTIVO_REQUERIDO: indica el motivo de la desactivación.'));
      return;
    }
    try {
      const res = await action.mutateAsync(
        statusDialog === 'ban'
          ? { action: 'ban', user_id: u.id, reason: reason.trim() }
          : { action: 'unban', user_id: u.id, reason: reason.trim() || undefined },
      );
      setStatusDialog(null);
      if (res.auth_updated === false) {
        toast.error(
          statusDialog === 'ban' ? 'Accesos desactivados, pero Auth no se actualizó' : 'Perfil reactivado, pero Auth no se actualizó',
          'Revisa el runbook de usuarios (bloqueo en Auth).',
        );
      } else {
        toast.success(statusDialog === 'ban' ? 'Usuario desactivado' : 'Usuario reactivado', u.email);
      }
    } catch {
      /* visible en el diálogo */
    }
  }

  async function resend() {
    try {
      const res = await action.mutateAsync({ action: 'resend', user_id: u.id });
      setResent(res);
      if (res.delivery === 'EMAIL') toast.success('Invitación reenviada', u.email);
    } catch (e) {
      toast.error('No se pudo reenviar', e instanceof Error ? e.message.replace(/^[A-Z_]+:\s*/, '') : undefined);
    }
  }

  return (
    <PageContainer
      title={u.fullName ?? u.email}
      description={`${u.email}${u.jobTitle ? ` · ${u.jobTitle}` : ''}`}
      breadcrumbs={back}
      actions={
        <>
          <Badge tone={status.tone}>{status.label}</Badge>
          {canResend ? (
            <button type="button" className="ebim-btn-ghost" disabled={action.isPending} onClick={() => void resend()}>
              Reenviar invitación
            </button>
          ) : null}
          {scope.isSuperAdmin && !isSelf && !isTheSuperAdmin ? (
            u.isActive ? (
              <button type="button" className="ebim-btn-danger" onClick={() => { setReason(''); setReasonError(null); action.reset(); setStatusDialog('ban'); }}>
                Desactivar
              </button>
            ) : (
              <button type="button" className="ebim-btn-primary" onClick={() => { setReason(''); setReasonError(null); action.reset(); setStatusDialog('unban'); }}>
                Reactivar
              </button>
            )
          ) : null}
        </>
      }
    >
      {!u.isActive ? (
        <p role="status" className="mb-4 rounded-field bg-danger-soft px-3 py-2.5 text-sm text-danger">
          Usuario desactivado: no puede ingresar y sus accesos quedaron inactivos. Reactivarlo solo reactiva el perfil;
          los accesos se otorgan de nuevo uno por uno.
        </p>
      ) : null}

      {/* Base y Auth desalineados (p. ej. Auth no respondió al desactivar): se
          reintenta la misma acción; las RPC son idempotentes. */}
      {scope.isSuperAdmin && !isTheSuperAdmin && u.isActive === u.banned ? (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-field bg-warn-soft px-3 py-2.5 text-sm text-warn">
          <span>
            {u.banned
              ? 'El perfil está activo, pero el ingreso sigue bloqueado en el servicio de autenticación.'
              : 'El perfil está desactivado, pero el servicio de autenticación aún permite el ingreso.'}
          </span>
          <button
            type="button"
            className="ebim-btn-ghost"
            onClick={() => { setReason(''); setReasonError(null); action.reset(); setStatusDialog(u.banned ? 'unban' : 'ban'); }}
          >
            {u.banned ? 'Quitar bloqueo de ingreso' : 'Bloquear ingreso'}
          </button>
        </div>
      ) : null}

      {resent?.delivery === 'LINK' && resent.action_link ? (
        <Card title="Enlace de invitación" className="mb-4">
          <div className="grid gap-2 p-4">
            <p className="text-sm">
              No hay envío de correo configurado. Comparte este enlace por un canal seguro: es de un solo uso y no se
              volverá a mostrar.
            </p>
            <input className="ebim-input font-mono text-xs" readOnly aria-label="Enlace de invitación" value={resent.action_link}
              onFocus={(e) => e.currentTarget.select()} />
          </div>
        </Card>
      ) : null}

      <SectionTabs
        tabs={[
          { id: 'perfil', label: 'Perfil', content: <ProfilePanel user={u} scope={scope} /> },
          { id: 'consola', label: 'Rol de consola', hidden: !scope.isSuperAdmin, content: <ConsoleRolePanel user={u} /> },
          { id: 'organizaciones', label: 'Organizaciones', content: <OrganizationsPanel user={u} scope={scope} /> },
          { id: 'tenants', label: 'Tenants', content: <TenantsPanel user={u} scope={scope} /> },
          {
            id: 'provisioning',
            label: 'Provisioning',
            hidden: !(scope.isSuperAdmin || scope.managePlatform),
            content: <ProvisioningPanel user={u} scope={scope} />,
          },
          { id: 'vendedor', label: 'Vendedor', hidden: !scope.manageCommercial, content: <SalesAgentPanel user={u} /> },
          { id: 'actividad', label: 'Actividad', content: <ActivityPanel userId={u.id} /> },
        ]}
      />

      <FormDialog
        open={statusDialog !== null}
        title={statusDialog === 'ban' ? `Desactivar a ${u.fullName ?? u.email}` : `Reactivar a ${u.fullName ?? u.email}`}
        description={
          statusDialog === 'ban'
            ? 'Se desactivan el perfil, el rol de consola, las membresías y los roles de provisioning, y se bloquea el ingreso. El vínculo comercial se conserva.'
            : 'Solo se reactiva el perfil y se quita el bloqueo de ingreso. Los accesos se otorgan de nuevo explícitamente.'
        }
        submitLabel={statusDialog === 'ban' ? 'Desactivar' : 'Reactivar'}
        busy={action.isPending}
        error={reasonError ?? action.error}
        onCancel={() => setStatusDialog(null)}
        onSubmit={() => {
          setReasonError(null);
          void confirmStatus();
        }}
      >
        <TextAreaField
          label="Motivo"
          required={statusDialog === 'ban'}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Queda en la auditoría."
        />
      </FormDialog>
    </PageContainer>
  );
}
