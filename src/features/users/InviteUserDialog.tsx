import { useEffect, useMemo, useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, TextField, FieldRow } from '@/components/ui/fields';
import { useUserAdminAction, type UserAdminResult } from '@/services/mutations';
import { ORG_ROLE_LABEL, PLATFORM_ROLE_LABEL } from '@/types/domain';
import type { OrgRole, PlatformRole, TenantRole } from '@/types/domain';
import {
  ASSIGNABLE_PLATFORM_ROLES, TENANT_ROLE_LABEL, assignableOrgRoles, type InviteGrant,
} from './userModel';
import { useAccessOptions } from './accessOptions';
import type { useUserAdminScope } from './useUserAdminScope';

type Scope = ReturnType<typeof useUserAdminScope>;
type AccessKind = 'PLATFORM_ROLE' | 'ORG_MEMBERSHIP' | 'TENANT_MEMBERSHIP';

const KIND_LABEL: Record<AccessKind, string> = {
  PLATFORM_ROLE: 'Rol de consola (personal EBIM)',
  ORG_MEMBERSHIP: 'Membresía de organización',
  TENANT_MEMBERSHIP: 'Membresía de tenant',
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * «Invitar usuario» (spec §6.4). Crea la cuenta por la Edge Function
 * `user-admin`: con SMTP llega un correo; sin SMTP, el resultado muestra el
 * enlace de invitación para copiarlo (una sola vez; no se guarda).
 *
 * Solo ofrece los tipos de acceso y roles que la base aceptaría para quien
 * invita. S-01: EBIM_SUPER_ADMIN nunca aparece.
 */
export function InviteUserDialog({
  open,
  scope,
  onClose,
}: {
  open: boolean;
  scope: Scope;
  onClose: () => void;
}) {
  const action = useUserAdminAction();
  const { orgOptions, tenantOptions } = useAccessOptions(scope);

  const kinds = useMemo<AccessKind[]>(() => {
    const out: AccessKind[] = [];
    if (scope.isSuperAdmin) out.push('PLATFORM_ROLE');
    if (scope.managePlatform || scope.adminOrgs.length > 0) out.push('ORG_MEMBERSHIP', 'TENANT_MEMBERSHIP');
    return out;
  }, [scope]);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [kind, setKind] = useState<AccessKind>('ORG_MEMBERSHIP');
  const [platformRole, setPlatformRole] = useState<PlatformRole>('EBIM_PRODUCT_ADMIN');
  const [orgId, setOrgId] = useState('');
  const [orgRole, setOrgRole] = useState<OrgRole | ''>('');
  const [tenantId, setTenantId] = useState('');
  const [tenantRole, setTenantRole] = useState<TenantRole>('TENANT_USER');
  const [localError, setLocalError] = useState<Error | null>(null);
  const [result, setResult] = useState<UserAdminResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    action.reset();
    setEmail('');
    setFullName('');
    setKind(kinds.includes('ORG_MEMBERSHIP') ? 'ORG_MEMBERSHIP' : (kinds[0] ?? 'ORG_MEMBERSHIP'));
    setPlatformRole('EBIM_PRODUCT_ADMIN');
    setOrgId(scope.adminOrgs.length === 1 && !scope.managePlatform ? scope.adminOrgs[0]!.organizationId : '');
    setOrgRole('');
    setTenantId('');
    setTenantRole('TENANT_USER');
    setLocalError(null);
    setResult(null);
    setCopied(false);
  }, [open]);

  const selectedOrg = orgOptions.find((o) => o.id === orgId);
  const orgRoles = selectedOrg
    ? assignableOrgRoles({
        managePlatform: scope.managePlatform,
        orgIsPartner: selectedOrg.isPartner,
        callerRole: scope.adminRoleIn(selectedOrg.id),
      })
    : [];

  function buildGrant(): InviteGrant | null {
    if (kind === 'PLATFORM_ROLE') return { kind, role: platformRole };
    if (kind === 'ORG_MEMBERSHIP') {
      if (!orgId || !orgRole) return null;
      return { kind, role: orgRole, organization_id: orgId };
    }
    if (!tenantId) return null;
    return { kind, role: tenantRole, tenant_id: tenantId };
  }

  async function submit() {
    setLocalError(null);
    const target = email.trim().toLowerCase();
    if (!EMAIL_RE.test(target)) {
      setLocalError(new Error('EMAIL_INVALIDO: indica un correo válido.'));
      return;
    }
    const grant = buildGrant();
    if (!grant) {
      setLocalError(new Error('ACCESO_INCOMPLETO: elige el destino y el rol del acceso.'));
      return;
    }
    try {
      const res = await action.mutateAsync({
        action: 'invite',
        email: target,
        full_name: fullName.trim() || undefined,
        grant,
      });
      setResult(res);
    } catch {
      /* visible en el diálogo */
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (result) {
    return (
      <FormDialog
        open={open}
        title={result.status === 'EXISTING_USER' ? 'Acceso otorgado' : 'Invitación creada'}
        submitLabel="Listo"
        cancelLabel="Cerrar"
        onSubmit={onClose}
        onCancel={onClose}
      >
        {result.status === 'EXISTING_USER' ? (
          <p className="text-sm text-fg">
            {email.trim().toLowerCase()} ya tenía una cuenta: se le otorgó el acceso pedido. No se envió ninguna
            invitación.
          </p>
        ) : result.delivery === 'EMAIL' ? (
          <p className="text-sm text-fg" role="status">
            Invitación enviada a <strong>{email.trim().toLowerCase()}</strong>. El enlace del correo lleva a
            «/bienvenida», donde la persona elige su contraseña.
          </p>
        ) : (
          <div className="grid gap-2">
            <p className="text-sm text-fg" role="status">
              No hay envío de correo configurado. Copia este enlace y compártelo con la persona por un canal seguro:
              es de <strong>un solo uso</strong>, vence pronto y <strong>no se volverá a mostrar</strong>.
            </p>
            <div className="flex gap-2">
              <input
                className="ebim-input font-mono text-xs"
                readOnly
                aria-label="Enlace de invitación"
                value={result.action_link ?? ''}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button type="button" className="ebim-btn-ghost" onClick={() => void copy(result.action_link ?? '')}>
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
        )}
        {result.grant_applied === false ? (
          <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            La cuenta se creó, pero el acceso no se pudo aplicar: {result.grant_message ?? result.grant_error}.
            Corrígelo desde la ficha del usuario.
          </p>
        ) : null}
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open={open}
      title="Invitar usuario"
      description="La persona recibe un enlace para elegir su contraseña. El acceso se otorga en el mismo paso; nunca se crea una cuenta sin acceso."
      submitLabel="Invitar"
      busy={action.isPending}
      error={localError ?? action.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <FieldRow>
        <TextField label="Correo" type="email" required placeholder="nombre@empresa.com" value={email}
          onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Nombre completo" placeholder="Nombre y apellido" value={fullName}
          onChange={(e) => setFullName(e.target.value)} />
      </FieldRow>

      <SelectField label="Tipo de acceso" value={kind}
        options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        onChange={(e) => setKind(e.target.value as AccessKind)} />

      {kind === 'PLATFORM_ROLE' ? (
        <SelectField label="Rol de consola" value={platformRole}
          hint="El rol Super Admin EBIM no es asignable (contrato §13.1)."
          options={ASSIGNABLE_PLATFORM_ROLES.map((r) => ({ value: r, label: PLATFORM_ROLE_LABEL[r] }))}
          onChange={(e) => setPlatformRole(e.target.value as PlatformRole)} />
      ) : kind === 'ORG_MEMBERSHIP' ? (
        <FieldRow>
          <SelectField label="Organización" required placeholder="Elige la organización" value={orgId}
            options={orgOptions.map((o) => ({ value: o.id, label: o.name }))}
            onChange={(e) => {
              setOrgId(e.target.value);
              setOrgRole('');
            }} />
          <SelectField label="Rol" required placeholder={orgId ? 'Elige el rol' : 'Primero la organización'}
            value={orgRole} disabled={!orgId}
            options={orgRoles.map((r) => ({ value: r, label: ORG_ROLE_LABEL[r] }))}
            onChange={(e) => setOrgRole(e.target.value as OrgRole)} />
        </FieldRow>
      ) : (
        <FieldRow>
          <SelectField label="Tenant" required placeholder="Elige el tenant" value={tenantId}
            options={tenantOptions.map((t) => ({ value: t.id, label: t.product ? `${t.name} · ${t.product}` : t.name }))}
            onChange={(e) => setTenantId(e.target.value)} />
          <SelectField label="Rol en el tenant" value={tenantRole}
            options={(['TENANT_USER', 'TENANT_ADMIN'] as TenantRole[]).map((r) => ({ value: r, label: TENANT_ROLE_LABEL[r] }))}
            onChange={(e) => setTenantRole(e.target.value as TenantRole)} />
        </FieldRow>
      )}
    </FormDialog>
  );
}
