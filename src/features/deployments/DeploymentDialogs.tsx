import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, SelectField, TextAreaField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useOrganizations, useProducts, useTenantOverview, useDeploymentTargets } from '@/services/queries';
import {
  useUpsertDeploymentTarget, useAttachTenantToTarget, useEnqueueProvisioning,
} from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/* ==========================================================================
   Deployment target
   ========================================================================== */

const targetSchema = z
  .object({
    code: z.string().trim().regex(SLUG, 'Minúsculas y guiones (ej. shared-esupplier-sa-east)'),
    name: z.string().trim().min(2, 'Obligatorio'),
    provider: z.enum(['SUPABASE', 'AWS', 'AZURE', 'GCP', 'ON_PREMISE']),
    deployment_mode: z.enum(['SHARED', 'PARTNER_DEDICATED', 'TENANT_DEDICATED']),
    environment: z.enum(['PRODUCTION', 'DEMO', 'TRIAL', 'SANDBOX']),
    region: z.string().trim().optional(),
    provider_project_ref: z.string().trim().optional(),
    owner_organization_id: z.string().optional(),
    saas_product_id: z.string().optional(),
    cost_center: z.string().trim().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED']),
  })
  // Las dos caras de la misma regla del CHECK `deployment_targets_owner_ck`.
  .refine((v) => v.deployment_mode === 'SHARED' || Boolean(v.owner_organization_id), {
    path: ['owner_organization_id'],
    message: 'Un target dedicado necesita una organización dueña',
  })
  .refine((v) => v.deployment_mode !== 'SHARED' || !v.owner_organization_id, {
    path: ['owner_organization_id'],
    message: 'Un target compartido no pertenece a una organización concreta',
  });

type TargetValues = z.infer<typeof targetSchema>;

export interface TargetDraft {
  id: string;
  code: string;
  name: string;
  provider: string;
  deployment_mode: string;
  environment: string;
  region: string | null;
  provider_project_ref: string | null;
  owner_organization_id: string | null;
  saas_product_id: string | null;
  cost_center: string | null;
  status: string;
}

const PROVIDERS = [
  { value: 'SUPABASE', label: 'Supabase' },
  { value: 'AWS', label: 'AWS' },
  { value: 'AZURE', label: 'Azure' },
  { value: 'GCP', label: 'GCP' },
  { value: 'ON_PREMISE', label: 'On premise' },
];

const MODES = [
  { value: 'SHARED', label: 'Compartido' },
  { value: 'PARTNER_DEDICATED', label: 'Dedicado partner' },
  { value: 'TENANT_DEDICATED', label: 'Dedicado cliente' },
];

const ENVIRONMENTS = [
  { value: 'PRODUCTION', label: 'Producción' },
  { value: 'DEMO', label: 'Demo' },
  { value: 'TRIAL', label: 'Trial' },
  { value: 'SANDBOX', label: 'Sandbox' },
];

const TARGET_STATUSES = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'INACTIVE', label: 'Inactivo' },
  { value: 'SUSPENDED', label: 'Suspendido' },
  { value: 'ARCHIVED', label: 'Archivado' },
];

export function DeploymentTargetDialog({
  open,
  target,
  onClose,
}: {
  open: boolean;
  target?: TargetDraft | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const orgs = useOrganizations();
  const products = useProducts();
  const upsert = useUpsertDeploymentTarget();
  const isEdit = Boolean(target);

  const form = useForm<TargetValues>({
    resolver: zodResolver(targetSchema),
    defaultValues: {
      code: '', name: '', provider: 'SUPABASE', deployment_mode: 'SHARED',
      environment: 'PRODUCTION', region: '', provider_project_ref: '',
      owner_organization_id: '', saas_product_id: '', cost_center: '', status: 'ACTIVE',
    },
  });

  useEffect(() => {
    if (!open) return;
    upsert.reset();
    form.reset({
      code: target?.code ?? '',
      name: target?.name ?? '',
      provider: (target?.provider as TargetValues['provider']) ?? 'SUPABASE',
      deployment_mode: (target?.deployment_mode as TargetValues['deployment_mode']) ?? 'SHARED',
      environment: (target?.environment as TargetValues['environment']) ?? 'PRODUCTION',
      region: target?.region ?? '',
      provider_project_ref: target?.provider_project_ref ?? '',
      owner_organization_id: target?.owner_organization_id ?? '',
      saas_product_id: target?.saas_product_id ?? '',
      cost_center: target?.cost_center ?? '',
      status: (target?.status as TargetValues['status']) ?? 'ACTIVE',
    });
  }, [open, target]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await upsert.mutateAsync({
        p_id: target?.id,
        p_code: values.code,
        p_name: values.name,
        p_provider: values.provider,
        p_deployment_mode: values.deployment_mode,
        p_environment: values.environment,
        p_region: values.region || undefined,
        p_provider_project_ref: values.provider_project_ref || undefined,
        p_owner_organization_id: values.owner_organization_id || undefined,
        p_saas_product_id: values.saas_product_id || undefined,
        p_cost_center: values.cost_center || undefined,
        p_status: values.status,
      });
      toast.success(isEdit ? 'Target actualizado' : 'Target creado', values.code);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={isEdit ? `Editar ${target?.code}` : 'Nuevo deployment target'}
      description="Un target guarda REFERENCIAS públicas (región, project ref), nunca credenciales: un trigger de la base rechaza cualquier metadata que huela a secreto."
      submitLabel={isEdit ? 'Guardar cambios' : 'Crear target'}
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <FieldRow>
        <TextField label="Nombre" required placeholder="Supabase compartido eSupplier (São Paulo)"
          error={form.formState.errors.name} {...form.register('name')} />
        <TextField label="Código" required placeholder="shared-esupplier-sa-east"
          error={form.formState.errors.code} {...form.register('code')} />
      </FieldRow>

      <FieldRow>
        <SelectField label="Proveedor" options={PROVIDERS}
          error={form.formState.errors.provider} {...form.register('provider')} />
        <SelectField label="Modelo" options={MODES}
          error={form.formState.errors.deployment_mode} {...form.register('deployment_mode')} />
      </FieldRow>

      <FieldRow>
        <SelectField label="Entorno" options={ENVIRONMENTS}
          error={form.formState.errors.environment} {...form.register('environment')} />
        <TextField label="Región" placeholder="sa-east-1"
          error={form.formState.errors.region} {...form.register('region')} />
      </FieldRow>

      <FieldRow>
        <SelectField label="Organización dueña" placeholder="Ninguna (infraestructura EBIM)"
          hint="Obligatoria para targets dedicados; prohibida para compartidos."
          options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.display_name }))}
          error={form.formState.errors.owner_organization_id}
          {...form.register('owner_organization_id')} />
        <SelectField label="Producto" placeholder="Cualquiera"
          options={(products.data ?? []).map((p) => ({ value: p.id, label: p.short_name }))}
          error={form.formState.errors.saas_product_id} {...form.register('saas_product_id')} />
      </FieldRow>

      <FieldRow>
        <TextField label="Referencia pública del proyecto" placeholder="abcdefghijklmnop"
          hint="Identificador NO secreto del proyecto en el proveedor."
          error={form.formState.errors.provider_project_ref}
          {...form.register('provider_project_ref')} />
        <TextField label="Centro de costo" placeholder="INFRA-SHARED"
          error={form.formState.errors.cost_center} {...form.register('cost_center')} />
      </FieldRow>

      <SelectField label="Estado" options={TARGET_STATUSES}
        error={form.formState.errors.status} {...form.register('status')} />
    </FormDialog>
  );
}

/* ==========================================================================
   Adjuntar tenant a target
   ========================================================================== */

const attachSchema = z.object({
  tenant_id: z.string().uuid('Elige el tenant'),
  notes: z.string().trim().optional(),
});

type AttachValues = z.infer<typeof attachSchema>;

export function AttachTenantDialog({
  open,
  targetId,
  targetCode,
  targetMode,
  onClose,
}: {
  open: boolean;
  targetId: string | null;
  targetCode: string;
  targetMode: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const tenants = useTenantOverview();
  const attach = useAttachTenantToTarget();

  const form = useForm<AttachValues>({
    resolver: zodResolver(attachSchema),
    defaultValues: { tenant_id: '', notes: '' },
  });

  useEffect(() => {
    if (!open) return;
    attach.reset();
    form.reset();
  }, [open]);

  // Solo se ofrecen tenants del mismo modo: el trigger de coherencia rechaza el
  // resto (MODO_DESPLIEGUE_INCOMPATIBLE) y no tiene sentido invitar al error.
  const options = (tenants.data ?? [])
    .filter((t) => t.deployment_mode === targetMode)
    .map((t) => ({
      value: t.tenant_id as string,
      label: `${t.name as string} · ${t.product_short_name as string}`,
    }));

  const submit = form.handleSubmit(async (values) => {
    if (!targetId) return;
    try {
      await attach.mutateAsync({
        p_tenant_id: values.tenant_id,
        p_deployment_target_id: targetId,
        p_is_primary: true,
        p_notes: values.notes || undefined,
      });
      toast.success('Tenant adjuntado', targetCode);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Adjuntar tenant a ${targetCode}`}
      description="La base valida coherencia: modo, producto y dueño. Un tenant del partner B no puede aterrizar en el target dedicado del partner A."
      submitLabel="Adjuntar"
      busy={attach.isPending}
      error={attach.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField label="Tenant" required placeholder="Elige el tenant…" options={options}
        hint={options.length === 0 ? `No hay tenants en modo ${targetMode} disponibles.` : undefined}
        error={form.formState.errors.tenant_id} {...form.register('tenant_id')} />
      <TextAreaField label="Notas" error={form.formState.errors.notes} {...form.register('notes')} />
    </FormDialog>
  );
}

/* ==========================================================================
   Encolar provisioning
   ========================================================================== */

const enqueueSchema = z.object({
  action: z.enum([
    'CREATE_TENANT_SPACE', 'CREATE_DEDICATED_TARGET', 'ATTACH_TENANT_TO_TARGET',
    'SUSPEND_TENANT', 'RESUME_TENANT', 'DECOMMISSION_TENANT',
  ]),
  tenant_id: z.string().optional(),
  deployment_target_id: z.string().optional(),
  mode: z.enum(['DRY_RUN', 'LIVE']),
});

type EnqueueValues = z.infer<typeof enqueueSchema>;

const ACTIONS = [
  { value: 'CREATE_TENANT_SPACE', label: 'Crear espacio de tenant' },
  { value: 'CREATE_DEDICATED_TARGET', label: 'Crear infraestructura dedicada' },
  { value: 'ATTACH_TENANT_TO_TARGET', label: 'Adjuntar tenant a target' },
  { value: 'SUSPEND_TENANT', label: 'Suspender tenant' },
  { value: 'RESUME_TENANT', label: 'Reanudar tenant' },
  { value: 'DECOMMISSION_TENANT', label: 'Dar de baja tenant' },
];

export function EnqueueProvisioningDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const perms = usePermissions();
  const tenants = useTenantOverview();
  const targets = useDeploymentTargets();
  const enqueue = useEnqueueProvisioning();

  const form = useForm<EnqueueValues>({
    resolver: zodResolver(enqueueSchema),
    defaultValues: {
      action: 'CREATE_TENANT_SPACE', tenant_id: '', deployment_target_id: '', mode: 'DRY_RUN',
    },
  });

  useEffect(() => {
    if (!open) return;
    enqueue.reset();
    form.reset();
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const id = await enqueue.mutateAsync({
        p_action: values.action,
        p_tenant_id: values.tenant_id || undefined,
        p_deployment_target_id: values.deployment_target_id || undefined,
        p_mode: values.mode,
      });
      toast.success(
        'Solicitud encolada',
        `La clave de idempotencia evita duplicarla (id ${String(id).slice(0, 8)}…).`,
      );
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  // LIVE toca infraestructura real. La base solo se lo permite al super admin, y
  // aquí ni siquiera se ofrece la opción a los demás (contrato §13).
  const modeOptions = perms.isSuperAdmin
    ? [
        { value: 'DRY_RUN', label: 'DRY_RUN (simulación)' },
        { value: 'LIVE', label: 'LIVE (infraestructura real)' },
      ]
    : [{ value: 'DRY_RUN', label: 'DRY_RUN (simulación)' }];

  return (
    <FormDialog
      open={open}
      title="Encolar solicitud de provisioning"
      description="DRY_RUN por defecto: el worker simula la operación y registra el timeline sin llamar a ninguna API remota."
      submitLabel="Encolar"
      busy={enqueue.isPending}
      error={enqueue.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField label="Acción" required options={ACTIONS}
        error={form.formState.errors.action} {...form.register('action')} />

      <FieldRow>
        <SelectField label="Tenant" placeholder="Sin tenant"
          options={(tenants.data ?? []).map((t) => ({
            value: t.tenant_id as string,
            label: t.name as string,
          }))}
          error={form.formState.errors.tenant_id} {...form.register('tenant_id')} />
        <SelectField label="Deployment target" placeholder="Sin target"
          options={(targets.data ?? []).map((t) => ({ value: t.id, label: t.code }))}
          error={form.formState.errors.deployment_target_id}
          {...form.register('deployment_target_id')} />
      </FieldRow>

      <SelectField label="Modo" options={modeOptions}
        hint={
          perms.isSuperAdmin
            ? 'LIVE ejecuta contra el proveedor real. Úsalo solo con autorización explícita.'
            : 'Solo el super admin de la suite puede pedir modo LIVE.'
        }
        error={form.formState.errors.mode} {...form.register('mode')} />
    </FormDialog>
  );
}
