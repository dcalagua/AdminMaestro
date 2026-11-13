import { useState } from 'react';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextAreaField } from '@/components/ui/fields';
import { Badge } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast-context';
import { useAdminUsers } from '@/services/queries';
import { useRequestTenantResume, useRequestTenantSuspension } from '@/services/mutations';
import { businessErrorMessage } from '@/lib/pgError';
import { TENANT_STATUS_LABEL } from '@/types/domain';
import { lifecycleImpact, type LifecycleMode, type LifecycleTarget } from './lifecycleModel';
import { SUSPENSION_CHANNEL_AVAILABLE } from './suiteModel';

export type { LifecycleMode, LifecycleTarget } from './lifecycleModel';

/**
 * Suspender / reactivar con la vista previa del impacto (V5 · F4).
 *
 * Antes de confirmar se ve QUÉ cambia: qué apps y tenants pasan de estado y qué
 * usuarios con acceso en el Admin Maestro quedan afectados. Cada tenant pasa por
 * `request_tenant_suspension` / `request_tenant_resume` (las RPC de siempre: la
 * base valida la transición y el permiso, y deja el motivo en auditoría).
 *
 * Honestidad: mientras no exista el canal de suspensión por app, el aviso lo
 * dice sin rodeos. Cambia el estado aquí y encola la orden; la app no la aplica.
 */
export function LifecycleDialog({
  open,
  mode,
  subject,
  organizationId,
  targets,
  defaultReason = '',
  loadingTargets = false,
  onClose,
}: {
  open: boolean;
  mode: LifecycleMode;
  /** Qué se suspende: «Beta TMS», «la cuenta Acme». */
  subject: string;
  /** Cuenta cliente: acota la lista de usuarios afectados. */
  organizationId: string | null | undefined;
  /** Tenants candidatos; sólo cambian los que admiten la transición. */
  targets: LifecycleTarget[];
  defaultReason?: string;
  /** Los tenants de la cuenta todavía se están leyendo. */
  loadingTargets?: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const suspend = useRequestTenantSuspension();
  const resume = useRequestTenantResume();
  const users = useAdminUsers(organizationId ?? null, { enabled: open && Boolean(organizationId) });

  const [reason, setReason] = useState(defaultReason);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setReason(defaultReason);
      setError(null);
      setFailed({});
      setDone(new Set());
    }
  }

  const impact = lifecycleImpact(mode, targets, users.data ?? []);
  const pending = impact.affected.filter((t) => !done.has(t.tenantId));
  const suspending = mode === 'SUSPEND';
  const verb = suspending ? 'Suspender' : 'Reactivar';

  async function submit() {
    if (loadingTargets) return;
    if (reason.trim() === '') {
      setError(new Error('MOTIVO_REQUERIDO: indica el motivo; queda en la auditoría.'));
      return;
    }
    if (pending.length === 0) {
      setError(new Error(suspending ? 'No hay tenants activos que suspender.' : 'No hay tenants suspendidos que reactivar.'));
      return;
    }
    setError(null);
    setBusy(true);
    const nextFailed: Record<string, string> = {};
    const nextDone = new Set(done);
    // Uno a uno: cada tenant es una transacción propia; si uno falla, los demás siguen.
    for (const t of pending) {
      try {
        if (suspending) await suspend.mutateAsync({ p_tenant_id: t.tenantId, p_reason: reason.trim() });
        else await resume.mutateAsync({ p_tenant_id: t.tenantId, p_reason: reason.trim() });
        nextDone.add(t.tenantId);
      } catch (e) {
        nextFailed[t.tenantId] = businessErrorMessage(e);
      }
    }
    setBusy(false);
    setDone(nextDone);
    setFailed(nextFailed);
    const ok = pending.length - Object.keys(nextFailed).length;
    if (Object.keys(nextFailed).length === 0) {
      toast.success(
        suspending ? 'Suspendido en el Admin Maestro' : 'Reactivado en el Admin Maestro',
        `${ok === 1 ? '1 tenant' : `${ok} tenants`}. ${
          SUSPENSION_CHANNEL_AVAILABLE ? '' : 'La app aún no aplica el cambio: canal pendiente.'
        }`.trim(),
      );
      onClose();
    } else {
      setError(
        new Error(
          `${ok > 0 ? `${ok} cambiaron; ` : ''}${Object.keys(nextFailed).length} no se pudieron ${suspending ? 'suspender' : 'reactivar'}. Revisa el motivo en la lista.`,
        ),
      );
    }
  }

  return (
    <FormDialog
      open={open}
      wide
      title={`${verb} ${subject}`}
      description={
        suspending
          ? 'Revisa el impacto antes de confirmar. Cada tenant pasa a «Suspendido» y se encola la orden para la app.'
          : 'Revisa el impacto antes de confirmar. Cada tenant vuelve a «Activo» y se encola la orden para la app.'
      }
      submitLabel={Object.keys(failed).length > 0 ? 'Reintentar los que fallaron' : verb}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      {!SUSPENSION_CHANNEL_AVAILABLE ? (
        <p className="flex items-start gap-2 rounded-field bg-warn-soft px-3 py-2.5 text-compact text-fg" role="note" data-channel-warning>
          <WarningCircleIcon size={18} className="mt-px shrink-0 text-warn" aria-hidden />
          <span>
            <strong>La app aún no aplica {suspending ? 'la suspensión' : 'la reactivación'}: canal pendiente.</strong>{' '}
            {suspending
              ? 'Cambia el estado en el Admin Maestro y deja la orden encolada, pero los usuarios siguen entrando a la app hasta que exista el canal.'
              : 'Cambia el estado en el Admin Maestro y deja la orden encolada; el acceso en la app no cambió con la suspensión, así que tampoco cambia ahora.'}
          </span>
        </p>
      ) : null}

      <section aria-labelledby="lifecycle-apps">
        <h3 id="lifecycle-apps" className="text-micro text-muted">
          Apps y tenants afectados
        </h3>
        {loadingTargets ? (
          <p className="mt-1.5 text-compact text-fg-2" role="status">Leyendo los tenants de la cuenta…</p>
        ) : impact.affected.length === 0 ? (
          <p className="mt-1.5 text-compact text-fg-2">
            {suspending ? 'Ningún tenant activo: no hay nada que suspender.' : 'Ningún tenant suspendido: no hay nada que reactivar.'}
          </p>
        ) : (
          <ul className="mt-1.5 divide-y divide-border rounded-field border border-border" data-lifecycle-impact>
            {impact.byApp.map((app) => (
              <li key={app.productName} className="px-3 py-2" data-impact-app={app.productName}>
                <p className="text-compact font-semibold text-fg">{app.productName}</p>
                <ul className="mt-1 space-y-1">
                  {app.tenants.map((t) => (
                    <li key={t.tenantId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-compact text-fg-2">
                      <span className="font-medium text-fg">{t.tenantName}</span>
                      <span>
                        {TENANT_STATUS_LABEL[t.tenantStatus as keyof typeof TENANT_STATUS_LABEL] ?? t.tenantStatus} →{' '}
                        {suspending ? 'Suspendido' : 'Activo'}
                      </span>
                      {done.has(t.tenantId) ? <Badge tone="ok">Hecho</Badge> : null}
                      {failed[t.tenantId] ? (
                        <span className="block w-full text-caption text-danger">{failed[t.tenantId]}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {impact.skipped.length > 0 ? (
          <p className="mt-1.5 text-caption text-muted">
            {impact.skipped.length === 1 ? '1 tenant no cambia' : `${impact.skipped.length} tenants no cambian`} (
            {impact.skipped.map((t) => t.tenantName).join(', ')}): su estado no admite esta acción.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="lifecycle-users">
        <h3 id="lifecycle-users" className="text-micro text-muted">
          Usuarios afectados
        </h3>
        <div className="mt-1.5 text-compact text-fg-2" data-lifecycle-users>
          {!organizationId ? (
            <p>Sin cuenta cliente: no se puede saber qué usuarios tienen acceso.</p>
          ) : users.isLoading ? (
            <p role="status">Buscando usuarios con acceso…</p>
          ) : users.error ? (
            <p>No visible para tu rol: la lista de usuarios la ven los administradores.</p>
          ) : impact.users.length === 0 ? (
            <p>Ningún usuario con acceso registrado en el Admin Maestro para estos tenants.</p>
          ) : (
            <>
              <p>
                {impact.users.length === 1
                  ? '1 usuario con acceso en el Admin Maestro:'
                  : `${impact.users.length} usuarios con acceso en el Admin Maestro:`}
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {impact.users.slice(0, 12).map((u) => (
                  <li key={u.id}>
                    <Badge tone="neutral" title={u.email}>{u.name}</Badge>
                  </li>
                ))}
                {impact.users.length > 12 ? <li className="text-caption text-muted">y {impact.users.length - 12} más</li> : null}
              </ul>
            </>
          )}
          <p className="mt-1 text-caption text-muted">Los usuarios propios de cada app no se conocen desde aquí.</p>
        </div>
      </section>

      <TextAreaField
        label="Motivo"
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="Queda en la auditoría de cada tenant."
      />
    </FormDialog>
  );
}
