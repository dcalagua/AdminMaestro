import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, NumberField, SelectField, CheckboxField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import {
  useProductIntegrations,
  useCredentialProfiles,
  useTenantOverview,
} from '@/services/queries';
import {
  useConfigureDeploymentProvisioning,
  useCreateSaasProvisioningRequest,
  useRegisterManualProvisioning,
} from '@/services/mutations';
import {
  DEPLOYMENT_TARGET_STATUS_LABEL,
  PROVISIONING_ENVIRONMENT_LABEL,
  PROVISIONING_POLICY_LABEL,
  describeBaseUrlProblem,
  type DeploymentTargetStatus,
  type ProvisioningEnvironment,
} from '@/lib/provisioning';

const ENVIRONMENT_OPTIONS = (['DEV', 'QAS', 'DEMO', 'PRD'] as const).map((value) => ({
  value,
  label: `${value} · ${PROVISIONING_ENVIRONMENT_LABEL[value]}`,
}));

const TARGET_STATUS_OPTIONS = (['DRAFT', 'READY', 'MAINTENANCE', 'DISABLED'] as const).map(
  (value) => ({ value, label: DEPLOYMENT_TARGET_STATUS_LABEL[value] }),
);

const POLICY_OPTIONS = [
  { value: '', label: 'Heredar de la integración' },
  ...(['MANUAL', 'AFTER_SUBSCRIPTION_ACTIVE', 'AFTER_PAYMENT_CONFIRMED'] as const).map((value) => ({
    value,
    label: PROVISIONING_POLICY_LABEL[value],
  })),
];

/* ==========================================================================
   Configuración de provisioning de un destino
   ========================================================================== */

const configSchema = z
  .object({
    provisioning_environment: z.enum(['DEV', 'QAS', 'DEMO', 'PRD']),
    product_integration_id: z.string().optional(),
    credential_profile_id: z.string().optional(),
    base_url: z.string().trim().optional(),
    timeout_ms: z.coerce.number().int().min(1000).max(60000),
    retry_count: z.coerce.number().int().min(0).max(5),
    provisioning_status: z.enum(['DRAFT', 'READY', 'MAINTENANCE', 'DISABLED']),
    provisioning_enabled: z.boolean(),
    provisioning_policy: z
      .enum(['MANUAL', 'AFTER_SUBSCRIPTION_ACTIVE', 'AFTER_PAYMENT_CONFIRMED'])
      .or(z.literal('')),
  })
  // La misma regla que el CHECK de la base, explicada antes de enviarla.
  .refine((v) => !v.base_url || !describeBaseUrlProblem(v.base_url, v.provisioning_environment), {
    path: ['base_url'],
    message: 'URL no admisible para este ambiente',
  })
  .refine((v) => !v.provisioning_enabled || v.provisioning_status === 'READY', {
    path: ['provisioning_enabled'],
    message: 'Habilitar exige que el destino esté marcado como listo',
  });

type ConfigValues = z.input<typeof configSchema>;

export interface TargetProvisioningDraft {
  deployment_target_id: string;
  code: string;
  saas_product_id: string;
  provisioning_environment: string | null;
  product_integration_id: string | null;
  credential_profile_id: string | null;
  base_url: string | null;
  timeout_ms: number;
  retry_count: number;
  provisioning_status: string;
  provisioning_enabled: boolean;
  effective_provisioning_policy: string | null;
}

export function DeploymentProvisioningDialog({
  open,
  target,
  onClose,
}: {
  open: boolean;
  target: TargetProvisioningDraft | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const integrations = useProductIntegrations();
  const credentials = useCredentialProfiles();
  const configure = useConfigureDeploymentProvisioning();

  const form = useForm<ConfigValues>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      provisioning_environment: 'QAS',
      product_integration_id: '',
      credential_profile_id: '',
      base_url: '',
      timeout_ms: 15000,
      retry_count: 2,
      provisioning_status: 'DRAFT',
      provisioning_enabled: false,
      provisioning_policy: '',
    },
  });

  useEffect(() => {
    if (!open || !target) return;
    configure.reset();
    form.reset({
      provisioning_environment:
        (target.provisioning_environment as ConfigValues['provisioning_environment']) ?? 'QAS',
      product_integration_id: target.product_integration_id ?? '',
      credential_profile_id: target.credential_profile_id ?? '',
      base_url: target.base_url ?? '',
      timeout_ms: target.timeout_ms ?? 15000,
      retry_count: target.retry_count ?? 2,
      provisioning_status: (target.provisioning_status as DeploymentTargetStatus) ?? 'DRAFT',
      provisioning_enabled: target.provisioning_enabled ?? false,
      provisioning_policy: '',
    });
  }, [open, target]);

  const environment = form.watch('provisioning_environment') as ProvisioningEnvironment;
  const baseUrl = String(form.watch('base_url') ?? '');
  const liveProblem = describeBaseUrlProblem(baseUrl, environment);

  // Sólo integraciones y credenciales del MISMO producto: la base lo rechazaría
  // igual, pero ofrecerlas y que falle después es una mala pantalla.
  const productIntegrations = (integrations.data ?? []).filter(
    (i) => i.saas_product_id === target?.saas_product_id,
  );
  const productCredentials = (credentials.data ?? []).filter(
    (c) =>
      (c.saas_product_id === target?.saas_product_id || c.saas_product_id === null) &&
      c.environment === environment,
  );

  const submit = form.handleSubmit(async (values) => {
    if (!target) return;
    try {
      await configure.mutateAsync({
        p_deployment_target_id: target.deployment_target_id,
        p_provisioning_environment: values.provisioning_environment,
        p_product_integration_id: values.product_integration_id || undefined,
        p_credential_profile_id: values.credential_profile_id || undefined,
        p_base_url: values.base_url || undefined,
        p_timeout_ms: Number(values.timeout_ms),
        p_retry_count: Number(values.retry_count),
        p_provisioning_status: values.provisioning_status,
        p_provisioning_enabled: values.provisioning_enabled,
        p_provisioning_policy: values.provisioning_policy || undefined,
      });
      toast.success('Destino configurado', target.code);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Provisioning de ${target?.code ?? ''}`}
      description="A qué URL se llama, con qué contrato y con qué credencial. Al marcar el destino como listo, las solicitudes que esperaban esta infraestructura se promueven solas."
      submitLabel="Guardar configuración"
      busy={configure.isPending}
      error={configure.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <FieldRow>
        <SelectField
          label="Ambiente de provisioning"
          options={ENVIRONMENT_OPTIONS}
          hint="Eje técnico, distinto del entorno comercial del destino."
          error={form.formState.errors.provisioning_environment}
          {...form.register('provisioning_environment')}
        />
        <SelectField
          label="Integración"
          placeholder="Sin integración"
          options={productIntegrations.map((i) => ({
            value: i.id,
            label: `${i.code} · ${i.integration_type}`,
          }))}
          hint="Sólo se ofrecen las del mismo producto."
          error={form.formState.errors.product_integration_id}
          {...form.register('product_integration_id')}
        />
      </FieldRow>

      <TextField
        label="URL base"
        placeholder="https://api.producto.ebim.pe"
        hint={
          liveProblem ??
          'Sin barra final. En QAS, DEMO y PRD se exige HTTPS y un host público: el servidor lo vuelve a validar antes de cada llamada.'
        }
        error={
          liveProblem ? { message: liveProblem } : form.formState.errors.base_url
        }
        {...form.register('base_url')}
      />

      <FieldRow>
        <SelectField
          label="Perfil de credencial"
          placeholder="Sin credencial"
          options={productCredentials.map((c) => ({
            value: c.id,
            label: `${c.code} · ${c.type}${c.enabled ? '' : ' (deshabilitado)'}`,
          }))}
          hint="Sólo perfiles del mismo producto y del mismo ambiente."
          error={form.formState.errors.credential_profile_id}
          {...form.register('credential_profile_id')}
        />
        <SelectField
          label="Política de provisioning"
          options={POLICY_OPTIONS}
          hint="Vacío = hereda la de la integración. Jerarquía: destino > integración."
          error={form.formState.errors.provisioning_policy}
          {...form.register('provisioning_policy')}
        />
      </FieldRow>

      <FieldRow>
        <NumberField
          label="Timeout (ms)"
          min={1000}
          max={60000}
          hint="Entre 1000 y 60000. Un timeout largo bloquea el orquestador sin avanzar."
          error={form.formState.errors.timeout_ms}
          {...form.register('timeout_ms')}
        />
        <NumberField
          label="Reintentos"
          min={0}
          max={5}
          hint="Sólo se reintentan timeouts y 5xx. Un 409 nunca se reintenta."
          error={form.formState.errors.retry_count}
          {...form.register('retry_count')}
        />
      </FieldRow>

      <SelectField
        label="Estado del destino"
        options={TARGET_STATUS_OPTIONS}
        error={form.formState.errors.provisioning_status}
        {...form.register('provisioning_status')}
      />

      <CheckboxField
        label="Provisioning habilitado en este destino"
        hint="Sólo se puede habilitar un destino listo y completamente configurado."
        {...form.register('provisioning_enabled')}
      />
    </FormDialog>
  );
}

/* ==========================================================================
   Nueva solicitud de provisioning
   ========================================================================== */

const requestSchema = z.object({
  tenant_id: z.string().min(1, 'Elija el tenant'),
  environment: z.enum(['DEV', 'QAS', 'DEMO', 'PRD']),
});

type RequestValues = z.input<typeof requestSchema>;

export function NewProvisioningRequestDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const tenants = useTenantOverview();
  const create = useCreateSaasProvisioningRequest();

  const form = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { tenant_id: '', environment: 'QAS' },
  });

  useEffect(() => {
    if (!open) return;
    create.reset();
    form.reset({ tenant_id: '', environment: 'QAS' });
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync({
        p_tenant_id: values.tenant_id,
        p_environment: values.environment,
      });
      toast.success(
        'Solicitud registrada',
        'Si ya existía una viva para ese tenant y producto, se reutiliza: no se duplica.',
      );
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title="Nueva solicitud de provisioning"
      description="Sólo se indica el tenant y el ambiente. El destino, la integración y la credencial los resuelve el servidor: el navegador no elige contra qué se llama."
      submitLabel="Crear solicitud"
      busy={create.isPending}
      error={create.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField
        label="Tenant"
        required
        placeholder="Elija el tenant a provisionar"
        options={(tenants.data ?? []).map((t) => ({
          value: t.tenant_id as string,
          label: `${t.name} · ${t.product_short_name ?? ''}`,
        }))}
        error={form.formState.errors.tenant_id}
        {...form.register('tenant_id')}
      />
      <SelectField
        label="Ambiente"
        options={ENVIRONMENT_OPTIONS}
        hint="Un dedicado sin infraestructura en ese ambiente queda en «Infraestructura pendiente», que es un estado del negocio y no un error."
        error={form.formState.errors.environment}
        {...form.register('environment')}
      />
    </FormDialog>
  );
}

/* ==========================================================================
   Registro manual del alta
   ========================================================================== */

const manualSchema = z.object({
  external_tenant_id: z.string().trim().min(1, 'Obligatorio'),
  external_organization_id: z.string().trim().optional(),
  external_company_id: z.string().trim().optional(),
});

type ManualValues = z.input<typeof manualSchema>;

export function RegisterManualDialog({
  open,
  requestId,
  tenantName,
  productName,
  onClose,
}: {
  open: boolean;
  requestId: string | null;
  tenantName: string;
  productName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const register = useRegisterManualProvisioning();

  const form = useForm<ManualValues>({
    resolver: zodResolver(manualSchema),
    defaultValues: { external_tenant_id: '', external_organization_id: '', external_company_id: '' },
  });

  useEffect(() => {
    if (!open) return;
    register.reset();
    form.reset({ external_tenant_id: '', external_organization_id: '', external_company_id: '' });
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    if (!requestId) return;
    try {
      await register.mutateAsync({
        p_request_id: requestId,
        p_external_tenant_id: values.external_tenant_id,
        p_external_organization_id: values.external_organization_id || undefined,
        p_external_company_id: values.external_company_id || undefined,
      });
      toast.success('Alta registrada', `${tenantName} en ${productName}`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title="Registrar alta manual"
      description="Para productos sin API todavía, o dedicados cuya alta realiza una persona. Se recorre la misma máquina de estados y queda la misma auditoría que en el alta automática."
      submitLabel="Registrar"
      busy={register.isPending}
      error={register.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextField
        label="ID del tenant en el producto"
        required
        placeholder="Identificador que devolvió el producto"
        hint="Es un identificador DEL PRODUCTO. MasterAdmin lo guarda y lo muestra; no lo interpreta como un ID universal EBIM."
        error={form.formState.errors.external_tenant_id}
        {...form.register('external_tenant_id')}
      />
      <FieldRow>
        <TextField
          label="ID de organización en el producto"
          error={form.formState.errors.external_organization_id}
          {...form.register('external_organization_id')}
        />
        <TextField
          label="ID de sociedad en el producto"
          error={form.formState.errors.external_company_id}
          {...form.register('external_company_id')}
        />
      </FieldRow>
    </FormDialog>
  );
}
