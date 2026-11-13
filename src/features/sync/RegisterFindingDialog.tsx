import { useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { FieldRow, SelectField, TextField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useOrganizations } from '@/services/queries';
import { useRegisterFinding, useUnlinkedTenants, type RegisterArgs } from './syncApi';
import { findingSubject, suggestSlug, type SyncFindingRow } from './syncModel';

/**
 * «Registrar en el Admin Maestro» un cliente que existe solo en la app.
 *
 * No llama a la app: el cliente ya opera allí. La base crea (o reutiliza) la
 * cuenta, crea el tenant y registra el alta manual con los identificadores de
 * la app, en una sola transacción y con las guardias de siempre.
 */
type Mode = 'NEW_ACCOUNT' | 'EXISTING_ACCOUNT' | 'EXISTING_TENANT';

const MODES = [
  { value: 'NEW_ACCOUNT', label: 'Crear una cuenta nueva' },
  { value: 'EXISTING_ACCOUNT', label: 'Usar una cuenta que ya existe' },
  { value: 'EXISTING_TENANT', label: 'Vincular a un tenant ya creado sin alta en la app' },
];

const TENANT_TYPES = [
  { value: 'PRODUCTION', label: 'Producción' },
  { value: 'DEMO', label: 'Demostración' },
  { value: 'TRIAL', label: 'Prueba' },
  { value: 'SANDBOX', label: 'Pruebas internas' },
];

interface Draft {
  mode: Mode;
  orgLegalName: string;
  orgDisplayName: string;
  orgCountry: string;
  orgTaxId: string;
  organizationId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  adminEmail: string;
  tenantType: string;
}

function initialDraft(f: SyncFindingRow): Draft {
  const name = findingSubject(f);
  return {
    mode: 'NEW_ACCOUNT',
    orgLegalName: f.app_name ?? '',
    orgDisplayName: '',
    orgCountry: 'PE',
    orgTaxId: '',
    organizationId: '',
    tenantId: '',
    tenantName: f.product_short_name ? `${name} · ${f.product_short_name}` : name,
    tenantSlug: suggestSlug(f.app_code ?? f.app_name, f.product_code ?? undefined),
    adminEmail: '',
    tenantType: 'PRODUCTION',
  };
}

function toRegisterArgs(f: SyncFindingRow, d: Draft): RegisterArgs {
  if (d.mode === 'EXISTING_TENANT') return { p_finding_id: f.id!, p_existing_tenant_id: d.tenantId };
  const tenant = {
    p_finding_id: f.id!,
    p_tenant_name: d.tenantName.trim(),
    p_tenant_slug: d.tenantSlug.trim(),
    p_admin_email: d.adminEmail.trim(),
    p_tenant_type: d.tenantType as RegisterArgs['p_tenant_type'],
  };
  if (d.mode === 'EXISTING_ACCOUNT') return { ...tenant, p_organization_id: d.organizationId };
  return {
    ...tenant,
    p_org_legal_name: d.orgLegalName.trim(),
    p_org_display_name: d.orgDisplayName.trim() || undefined,
    p_org_slug: suggestSlug(d.orgDisplayName || d.orgLegalName),
    p_org_country_code: d.orgCountry.trim().toUpperCase(),
    p_org_tax_id: d.orgTaxId.trim() || undefined,
  };
}

export function RegisterFindingDialog({ finding, onClose }: { finding: SyncFindingRow | null; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(finding ? initialDraft(finding) : null);
  const [shownFor, setShownFor] = useState<string | null>(finding?.id ?? null);
  const [error, setError] = useState<unknown>(null);
  const register = useRegisterFinding();
  const toast = useToast();
  const orgs = useOrganizations({ enabled: draft?.mode === 'EXISTING_ACCOUNT' });
  const unlinked = useUnlinkedTenants(draft?.mode === 'EXISTING_TENANT' ? (finding?.saas_product_id ?? null) : null);

  // Cada vez que se abre para otro hallazgo, el formulario arranca de cero.
  if ((finding?.id ?? null) !== shownFor) {
    setShownFor(finding?.id ?? null);
    setDraft(finding ? initialDraft(finding) : null);
    setError(null);
  }
  if (!finding || !draft) return null;

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  return (
    <FormDialog
      open
      wide
      title={`Registrar «${findingSubject(finding)}» en el Admin Maestro`}
      description={`Este cliente ya opera en ${finding.product_short_name ?? 'la app'}. Se crea aquí con los datos de la app y queda vinculado; no se llama a la app ni se le cambia nada.`}
      submitLabel="Registrar"
      busy={register.isPending}
      error={error}
      onCancel={onClose}
      onSubmit={() => {
        setError(null);
        register
          .mutateAsync(toRegisterArgs(finding, draft))
          .then(() => {
            toast.success('Cliente registrado', 'Ya aparece en Tenants y se le puede facturar y suspender.');
            onClose();
          })
          .catch((e: unknown) => setError(e));
      }}
    >
      <SelectField
        label="¿Cómo lo registras?"
        value={draft.mode}
        options={MODES}
        onChange={(e) => set({ mode: e.target.value as Mode })}
      />

      {draft.mode === 'EXISTING_TENANT' ? (
        <SelectField
          label="Tenant del Admin Maestro"
          required
          placeholder={unlinked.isLoading ? 'Cargando…' : 'Elige el tenant'}
          value={draft.tenantId}
          options={(unlinked.data ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.slug})` }))}
          hint="Solo aparecen tenants de esta app que todavía no tienen alta."
          onChange={(e) => set({ tenantId: e.target.value })}
        />
      ) : (
        <>
          {draft.mode === 'EXISTING_ACCOUNT' ? (
            <SelectField
              label="Cuenta"
              required
              placeholder={orgs.isLoading ? 'Cargando…' : 'Elige la cuenta'}
              value={draft.organizationId}
              options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.display_name }))}
              onChange={(e) => set({ organizationId: e.target.value })}
            />
          ) : (
            <>
              <FieldRow>
                <TextField
                  label="Razón social"
                  required
                  value={draft.orgLegalName}
                  onChange={(e) => set({ orgLegalName: e.target.value })}
                />
                <TextField
                  label="Nombre comercial"
                  value={draft.orgDisplayName}
                  hint="Si lo dejas vacío, se usa la razón social."
                  onChange={(e) => set({ orgDisplayName: e.target.value })}
                />
              </FieldRow>
              <FieldRow>
                <TextField
                  label="País (código de 2 letras)"
                  required
                  maxLength={2}
                  value={draft.orgCountry}
                  onChange={(e) => set({ orgCountry: e.target.value })}
                />
                <TextField
                  label="RUC / NIT"
                  value={draft.orgTaxId}
                  onChange={(e) => set({ orgTaxId: e.target.value })}
                />
              </FieldRow>
            </>
          )}
          <FieldRow>
            <TextField
              label="Nombre del tenant"
              required
              value={draft.tenantName}
              onChange={(e) => set({ tenantName: e.target.value })}
            />
            <TextField
              label="Identificador del tenant"
              required
              value={draft.tenantSlug}
              hint="Minúsculas, números y guiones."
              onChange={(e) => set({ tenantSlug: e.target.value })}
            />
          </FieldRow>
          <FieldRow>
            <TextField
              label="Correo del administrador del cliente"
              type="email"
              required
              value={draft.adminEmail}
              onChange={(e) => set({ adminEmail: e.target.value })}
            />
            <SelectField
              label="Tipo"
              value={draft.tenantType}
              options={TENANT_TYPES}
              onChange={(e) => set({ tenantType: e.target.value })}
            />
          </FieldRow>
        </>
      )}
    </FormDialog>
  );
}
