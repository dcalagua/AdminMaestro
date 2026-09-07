import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, SelectField, TextAreaField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useProducts, useOrganizations } from '@/services/queries';
import { useCreateTenant, useSetTenantStatus } from '@/services/mutations';
import { isOperatorDomain } from '@/features/auth/session';
import type { Enums } from '@/types/domain';
import { TENANT_STATUS_LABEL } from '@/types/domain';

/* ==========================================================================
   Alta de tenant
   ========================================================================== */

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const createSchema = z
  .object({
    saas_product_code: z.string().min(1, 'Elige un producto'),
    customer_organization_id: z.string().uuid('Elige el cliente'),
    managing_organization_id: z.string().optional(),
    slug: z.string().trim().regex(SLUG, 'Minúsculas, números y guiones'),
    name: z.string().trim().min(2, 'Obligatorio'),
    admin_email: z.string().trim().email('Correo inválido'),
    tenant_type: z.enum(['PRODUCTION', 'TRIAL', 'DEMO', 'SANDBOX']),
    deployment_mode: z.enum(['SHARED', 'PARTNER_DEDICATED', 'TENANT_DEDICATED']),
  })
  .refine((v) => !isOperatorDomain(v.admin_email), {
    // Contrato §13.2: `ebim.pe` es el dominio del operador, no un actor de negocio.
    // La base lo rechaza igual; validarlo aquí ahorra el viaje y explica por qué.
    path: ['admin_email'],
    message: 'El dominio operador ebim.pe no puede administrar un tenant cliente',
  })
  .refine((v) => v.deployment_mode !== 'PARTNER_DEDICATED' || Boolean(v.managing_organization_id), {
    path: ['managing_organization_id'],
    message: 'Un tenant Partner Dedicated necesita el partner que lo administra',
  });

type CreateValues = z.infer<typeof createSchema>;

const TENANT_TYPES = [
  { value: 'PRODUCTION', label: 'Producción' },
  { value: 'TRIAL', label: 'Trial' },
  { value: 'DEMO', label: 'Demo (sin recurrente)' },
  { value: 'SANDBOX', label: 'Sandbox' },
];

const MODES = [
  { value: 'SHARED', label: 'Compartido' },
  { value: 'PARTNER_DEDICATED', label: 'Dedicado partner' },
  { value: 'TENANT_DEDICATED', label: 'Dedicado cliente' },
];

export function TenantFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const products = useProducts();
  const orgs = useOrganizations();
  const create = useCreateTenant();

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      saas_product_code: '',
      customer_organization_id: '',
      managing_organization_id: '',
      slug: '',
      name: '',
      admin_email: '',
      tenant_type: 'PRODUCTION',
      deployment_mode: 'SHARED',
    },
  });

  useEffect(() => {
    if (!open) return;
    create.reset();
    form.reset();
  }, [open]);

  const productOptions = (products.data ?? [])
    .filter((p) => p.status === 'ACTIVE')
    .map((p) => ({ value: p.code, label: `${p.short_name} (${p.code})` }));

  const orgOptions = (orgs.data ?? []).map((o) => ({ value: o.id, label: o.display_name }));

  const managerOptions = (orgs.data ?? [])
    .filter((o) =>
      ((o.organization_capabilities ?? []) as Array<{ capability: string }>).some((c) =>
        ['PARTNER', 'RESELLER', 'CONSULTING'].includes(c.capability),
      ),
    )
    .map((o) => ({ value: o.id, label: o.display_name }));

  const submit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync({
        p_saas_product_code: values.saas_product_code,
        p_customer_organization_id: values.customer_organization_id,
        p_slug: values.slug,
        p_name: values.name,
        p_admin_email: values.admin_email,
        p_tenant_type: values.tenant_type,
        p_deployment_mode: values.deployment_mode,
        p_managing_organization_id: values.managing_organization_id || undefined,
      });
      toast.success('Tenant creado', `${values.name} queda en estado PENDIENTE hasta activarse.`);
      onClose();
    } catch {
      /* mensaje visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title="Nuevo tenant"
      description="El alta pasa por platform.create_tenant(): sin correo de administrador la base rechaza la operación (contrato §3.2)."
      submitLabel="Crear tenant"
      busy={create.isPending}
      error={create.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <FieldRow>
        <SelectField
          label="Producto SaaS"
          required
          placeholder="Elige un producto…"
          options={productOptions}
          error={form.formState.errors.saas_product_code}
          {...form.register('saas_product_code')}
        />
        <SelectField
          label="Organización cliente"
          required
          placeholder="Elige el cliente…"
          options={orgOptions}
          error={form.formState.errors.customer_organization_id}
          {...form.register('customer_organization_id')}
        />
      </FieldRow>

      <FieldRow>
        <TextField
          label="Nombre del tenant"
          required
          placeholder="Alpha Producción"
          error={form.formState.errors.name}
          {...form.register('name')}
        />
        <TextField
          label="Slug"
          required
          placeholder="alpha-prod"
          hint="Único dentro del producto."
          error={form.formState.errors.slug}
          {...form.register('slug')}
        />
      </FieldRow>

      <TextField
        label="Correo del administrador del cliente"
        required
        type="email"
        placeholder="admin@cliente.com"
        hint="Obligatorio por contrato §3.2. No puede ser del dominio operador ebim.pe."
        error={form.formState.errors.admin_email}
        {...form.register('admin_email')}
      />

      <FieldRow>
        <SelectField
          label="Tipo de tenant"
          options={TENANT_TYPES}
          hint="DEMO nunca genera suscripción recurrente."
          error={form.formState.errors.tenant_type}
          {...form.register('tenant_type')}
        />
        <SelectField
          label="Modelo de despliegue"
          options={MODES}
          error={form.formState.errors.deployment_mode}
          {...form.register('deployment_mode')}
        />
      </FieldRow>

      <SelectField
        label="Partner que lo administra"
        placeholder="Venta directa EBIM (sin partner)"
        options={managerOptions}
        hint="Necesita un acuerdo activo con can_manage_tenants para ese producto; si no, la base lo rechaza."
        error={form.formState.errors.managing_organization_id}
        {...form.register('managing_organization_id')}
      />
    </FormDialog>
  );
}

/* ==========================================================================
   Cambio de estado
   ========================================================================== */

const statusSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'CHURNED', 'ARCHIVED']),
  reason: z.string().trim().optional(),
});

type StatusValues = z.infer<typeof statusSchema>;

/** Transiciones permitidas — el mismo grafo que valida `platform.set_tenant_status`. */
const NEXT_STATUS: Record<string, Array<Enums<'tenant_status'>>> = {
  PENDING: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['SUSPENDED', 'CHURNED'],
  SUSPENDED: ['ACTIVE', 'CHURNED', 'ARCHIVED'],
  CHURNED: ['ARCHIVED'],
  ARCHIVED: [],
};

/** Estados cuyo cambio exige motivo auditable, igual que en la base. */
const NEEDS_REASON = new Set(['SUSPENDED', 'CHURNED']);

export function TenantStatusDialog({
  open,
  tenantId,
  tenantName,
  currentStatus,
  onClose,
}: {
  open: boolean;
  tenantId: string | null;
  tenantName: string;
  currentStatus: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const setStatus = useSetTenantStatus();

  const options = (NEXT_STATUS[currentStatus] ?? []).map((s) => ({
    value: s,
    label: TENANT_STATUS_LABEL[s],
  }));

  const form = useForm<StatusValues>({
    resolver: zodResolver(statusSchema),
    defaultValues: { status: options[0]?.value ?? 'ACTIVE', reason: '' },
  });

  useEffect(() => {
    if (!open) return;
    setStatus.reset();
    form.reset({ status: options[0]?.value ?? 'ACTIVE', reason: '' });
  }, [open, currentStatus]);

  const selected = form.watch('status');
  const reasonRequired = NEEDS_REASON.has(selected);

  const submit = form.handleSubmit(async (values) => {
    if (reasonRequired && !values.reason?.trim()) {
      form.setError('reason', { message: 'Suspender o dar de baja exige un motivo auditable' });
      return;
    }
    if (!tenantId) return;
    try {
      await setStatus.mutateAsync({
        p_tenant_id: tenantId,
        p_status: values.status,
        p_reason: values.reason?.trim() || undefined,
      });
      toast.success('Estado actualizado', `${tenantName} → ${TENANT_STATUS_LABEL[values.status]}`);
      onClose();
    } catch {
      /* mensaje visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Cambiar estado de ${tenantName}`}
      description={
        options.length === 0
          ? 'Este tenant está en un estado terminal: no admite más transiciones.'
          : `Estado actual: ${TENANT_STATUS_LABEL[currentStatus as Enums<'tenant_status'>] ?? currentStatus}. El cambio queda registrado en auditoría.`
      }
      submitLabel="Aplicar cambio"
      busy={setStatus.isPending}
      error={setStatus.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField
        label="Nuevo estado"
        required
        options={options}
        error={form.formState.errors.status}
        {...form.register('status')}
      />
      <TextAreaField
        label={reasonRequired ? 'Motivo (obligatorio)' : 'Motivo'}
        required={reasonRequired}
        placeholder="Impago de la factura F-2026-0031, tercer aviso"
        hint="Un tenant apagado sin explicación es un incidente, no una operación."
        error={form.formState.errors.reason}
        {...form.register('reason')}
      />
    </FormDialog>
  );
}
