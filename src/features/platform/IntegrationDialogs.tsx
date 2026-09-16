import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, NumberField, SelectField, CheckboxField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useProducts, usePlatformPeople } from '@/services/queries';
import {
  useUpsertProductIntegration,
  useUpsertCredentialProfile,
  useUpsertProductOwner,
} from '@/services/mutations';
import {
  INTEGRATION_TYPE_HINT,
  INTEGRATION_TYPE_LABEL,
  PROVISIONING_ENVIRONMENT_LABEL,
  PROVISIONING_POLICY_HINT,
  PROVISIONING_POLICY_LABEL,
  PRODUCT_OWNER_ROLE_LABEL,
  TOKEN_TTL_MAX,
  TOKEN_TTL_MIN,
  describePathTemplateProblem,
  describeSecretRefProblem,
} from '@/lib/provisioning';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const TYPE_OPTIONS = (['HTTP_M2M', 'MANUAL', 'MOCK', 'EDGE_FUNCTION'] as const).map((value) => ({
  value,
  label: INTEGRATION_TYPE_LABEL[value],
}));

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Borrador' },
  { value: 'READY', label: 'Lista' },
  { value: 'DEGRADED', label: 'Degradada' },
  { value: 'DISABLED', label: 'Deshabilitada' },
];

const ALGORITHM_OPTIONS = [
  { value: 'RS256', label: 'RS256 (RSA + SHA-256)' },
  { value: 'ES256', label: 'ES256 (ECDSA P-256)' },
];

const POLICY_OPTIONS = (
  ['MANUAL', 'AFTER_SUBSCRIPTION_ACTIVE', 'AFTER_PAYMENT_CONFIRMED'] as const
).map((value) => ({ value, label: PROVISIONING_POLICY_LABEL[value] }));

const ENVIRONMENT_OPTIONS = (['DEV', 'QAS', 'DEMO', 'PRD'] as const).map((value) => ({
  value,
  label: `${value} · ${PROVISIONING_ENVIRONMENT_LABEL[value]}`,
}));

/* ==========================================================================
   Integración de producto
   ========================================================================== */

const pathRule = (value: string | undefined) => !value || !describePathTemplateProblem(value);

const integrationSchema = z
  .object({
    saas_product_id: z.string().min(1, 'Elija el producto'),
    code: z.string().trim().regex(SLUG, 'Minúsculas y guiones (ej. ewm-provisioning-v1)'),
    name: z.string().trim().min(2, 'Obligatorio'),
    integration_type: z.enum(['HTTP_M2M', 'EDGE_FUNCTION', 'MANUAL', 'MOCK']),
    contract_version: z.string().trim().regex(/^v[0-9]+$/, 'Formato vN, por ejemplo v1'),
    owner_name: z.string().trim().optional(),
    issuer: z.string().trim().min(3, 'Obligatorio'),
    audience: z.string().trim().optional(),
    subject: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{2,63}$/, 'Identificador del SISTEMA en minúsculas, no un correo'),
    algorithm: z.enum(['RS256', 'ES256']).or(z.literal('')),
    token_ttl_seconds: z.coerce.number().int().min(TOKEN_TTL_MIN).max(TOKEN_TTL_MAX),
    create_scope: z.string().trim().optional(),
    read_scope: z.string().trim().optional(),
    create_path_template: z.string().trim().optional().refine(pathRule, 'Ruta insegura'),
    status_path_template: z.string().trim().optional().refine(pathRule, 'Ruta insegura'),
    health_path_template: z.string().trim().optional().refine(pathRule, 'Ruta insegura'),
    allowed_hosts: z.string().trim().optional(),
    provisioning_policy: z.enum(['MANUAL', 'AFTER_SUBSCRIPTION_ACTIVE', 'AFTER_PAYMENT_CONFIRMED']),
    enabled: z.boolean(),
    status: z.enum(['DRAFT', 'READY', 'DEGRADED', 'DISABLED']),
  })
  // Mismas reglas que el CHECK `product_integrations_http_ready_ck`: mejor
  // explicarlas aquí que dejar que la base devuelva «violates check constraint».
  .refine(
    (v) => v.integration_type !== 'HTTP_M2M' || v.status !== 'READY' || Boolean(v.audience),
    { path: ['audience'], message: 'Una integración HTTP lista necesita audience' },
  )
  .refine(
    (v) => v.integration_type !== 'HTTP_M2M' || v.status !== 'READY' || Boolean(v.algorithm),
    { path: ['algorithm'], message: 'Una integración HTTP lista necesita algoritmo de firma' },
  )
  .refine(
    (v) => v.integration_type !== 'HTTP_M2M' || v.status !== 'READY' || Boolean(v.create_path_template),
    { path: ['create_path_template'], message: 'Falta la ruta de alta del contrato' },
  )
  .refine(
    (v) => v.integration_type !== 'HTTP_M2M' || v.status !== 'READY' || Boolean(v.create_scope),
    { path: ['create_scope'], message: 'Un token sin scope es un token con todos' },
  );

// `z.input` y no `z.infer`: con `z.coerce` el tipo de ENTRADA del formulario no
// coincide con el de salida, y RHF tipa el formulario por su entrada.
type IntegrationValues = z.input<typeof integrationSchema>;

export interface IntegrationDraft {
  id: string;
  saas_product_id: string;
  code: string;
  name: string;
  integration_type: string;
  contract_version: string;
  owner_name: string | null;
  issuer: string;
  audience: string | null;
  subject: string;
  algorithm: string | null;
  token_ttl_seconds: number | null;
  create_scope: string | null;
  read_scope: string | null;
  create_path_template: string | null;
  status_path_template: string | null;
  health_path_template: string | null;
  allowed_hosts: string[] | null;
  provisioning_policy: string;
  enabled: boolean;
  status: string;
}

export function IntegrationDialog({
  open,
  integration,
  productId,
  onClose,
}: {
  open: boolean;
  integration?: IntegrationDraft | null;
  productId?: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const products = useProducts();
  const upsert = useUpsertProductIntegration();
  const isEdit = Boolean(integration);

  const form = useForm<IntegrationValues>({
    resolver: zodResolver(integrationSchema),
    defaultValues: {
      saas_product_id: productId ?? '',
      code: '',
      name: '',
      integration_type: 'HTTP_M2M',
      contract_version: 'v1',
      owner_name: '',
      issuer: 'masteradmin.ebim',
      audience: '',
      subject: 'masteradmin-provisioning',
      algorithm: 'RS256',
      token_ttl_seconds: 300,
      create_scope: '',
      read_scope: '',
      create_path_template: '',
      status_path_template: '',
      health_path_template: '',
      allowed_hosts: '',
      provisioning_policy: 'MANUAL',
      enabled: false,
      status: 'DRAFT',
    },
  });

  useEffect(() => {
    if (!open) return;
    upsert.reset();
    form.reset({
      saas_product_id: integration?.saas_product_id ?? productId ?? '',
      code: integration?.code ?? '',
      name: integration?.name ?? '',
      integration_type: (integration?.integration_type as IntegrationValues['integration_type']) ?? 'HTTP_M2M',
      contract_version: integration?.contract_version ?? 'v1',
      owner_name: integration?.owner_name ?? '',
      issuer: integration?.issuer ?? 'masteradmin.ebim',
      audience: integration?.audience ?? '',
      subject: integration?.subject ?? 'masteradmin-provisioning',
      algorithm: (integration?.algorithm as 'RS256' | 'ES256') ?? '',
      token_ttl_seconds: integration?.token_ttl_seconds ?? 300,
      create_scope: integration?.create_scope ?? '',
      read_scope: integration?.read_scope ?? '',
      create_path_template: integration?.create_path_template ?? '',
      status_path_template: integration?.status_path_template ?? '',
      health_path_template: integration?.health_path_template ?? '',
      allowed_hosts: (integration?.allowed_hosts ?? []).join(', '),
      provisioning_policy: (integration?.provisioning_policy as IntegrationValues['provisioning_policy']) ?? 'MANUAL',
      enabled: integration?.enabled ?? false,
      status: (integration?.status as IntegrationValues['status']) ?? 'DRAFT',
    });
  }, [open, integration, productId]);

  const type = form.watch('integration_type');
  const isHttp = type === 'HTTP_M2M' || type === 'EDGE_FUNCTION';

  const submit = form.handleSubmit(async (values) => {
    try {
      await upsert.mutateAsync({
        p_id: integration?.id,
        p_saas_product_id: values.saas_product_id,
        p_code: values.code,
        p_name: values.name,
        p_integration_type: values.integration_type,
        p_contract_version: values.contract_version,
        p_owner_name: values.owner_name || undefined,
        p_issuer: values.issuer,
        // Un adaptador MANUAL/MOCK no arrastra configuración criptográfica: la
        // base lo rechaza y aquí se limpia antes de enviarla.
        p_audience: isHttp ? values.audience || undefined : undefined,
        p_subject: values.subject,
        p_algorithm: isHttp && values.algorithm ? values.algorithm : undefined,
        p_token_ttl_seconds: isHttp && values.token_ttl_seconds ? Number(values.token_ttl_seconds) : undefined,
        p_create_scope: values.create_scope || undefined,
        p_read_scope: values.read_scope || undefined,
        p_create_path_template: values.create_path_template || undefined,
        p_status_path_template: values.status_path_template || undefined,
        p_health_path_template: values.health_path_template || undefined,
        p_allowed_hosts: (values.allowed_hosts ?? '')
          .split(',')
          .map((h: string) => h.trim())
          .filter(Boolean),
        p_provisioning_policy: values.provisioning_policy,
        p_enabled: values.enabled,
        p_status: values.status,
      });
      toast.success(isEdit ? 'Integración actualizada' : 'Integración creada', values.code);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={isEdit ? `Editar ${integration?.code}` : 'Nueva integración de producto'}
      description="Define CÓMO habla MasterAdmin con el producto. Aquí va configuración —endpoint relativo, issuer, audience, algoritmo, TTL, scopes—, nunca secretos ni lógica interna del SaaS."
      submitLabel={isEdit ? 'Guardar cambios' : 'Crear integración'}
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <FieldRow>
        <SelectField
          label="Producto"
          required
          placeholder="Elija un producto"
          options={(products.data ?? []).map((p) => ({ value: p.id, label: p.short_name }))}
          disabled={isEdit}
          hint={isEdit ? 'El producto de una integración es inmutable.' : undefined}
          error={form.formState.errors.saas_product_id}
          {...form.register('saas_product_id')}
        />
        <SelectField
          label="Tipo de integración"
          options={TYPE_OPTIONS}
          hint={INTEGRATION_TYPE_HINT[type]}
          error={form.formState.errors.integration_type}
          {...form.register('integration_type')}
        />
      </FieldRow>

      <FieldRow>
        <TextField
          label="Nombre"
          required
          placeholder="EWM · API interna de provisioning v1"
          error={form.formState.errors.name}
          {...form.register('name')}
        />
        <TextField
          label="Código"
          required
          placeholder="ewm-provisioning-v1"
          error={form.formState.errors.code}
          {...form.register('code')}
        />
      </FieldRow>

      <FieldRow>
        <TextField
          label="Versión del contrato"
          required
          placeholder="v1"
          error={form.formState.errors.contract_version}
          {...form.register('contract_version')}
        />
        <TextField
          label="Responsable técnico (nombre visible)"
          placeholder="A quién llamar cuando algo falla"
          error={form.formState.errors.owner_name}
          {...form.register('owner_name')}
        />
      </FieldRow>

      <FieldRow>
        <SelectField
          label="Política de provisioning"
          options={POLICY_OPTIONS}
          hint={PROVISIONING_POLICY_HINT[form.watch('provisioning_policy')]}
          error={form.formState.errors.provisioning_policy}
          {...form.register('provisioning_policy')}
        />
        <SelectField
          label="Estado"
          options={STATUS_OPTIONS}
          error={form.formState.errors.status}
          {...form.register('status')}
        />
      </FieldRow>

      {isHttp ? (
        <>
          <p className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Contrato M2M
          </p>

          <FieldRow>
            <TextField
              label="Issuer"
              required
              placeholder="masteradmin.ebim"
              hint="Quién EMITE el token. Es siempre MasterAdmin."
              error={form.formState.errors.issuer}
              {...form.register('issuer')}
            />
            <TextField
              label="Audience"
              placeholder="ewm.ebim"
              hint="Para QUIÉN es el token. Cada producto tiene la suya; MasterAdmin no la adivina."
              error={form.formState.errors.audience}
              {...form.register('audience')}
            />
          </FieldRow>

          <FieldRow>
            <TextField
              label="Subject"
              required
              placeholder="masteradmin-provisioning"
              hint="Identifica al SISTEMA. La persona viaja aparte, como claim de auditoría."
              error={form.formState.errors.subject}
              {...form.register('subject')}
            />
            <SelectField
              label="Algoritmo"
              placeholder="Sin definir"
              options={ALGORITHM_OPTIONS}
              hint="Solo asimétricos: con un secreto compartido, quien verifica también puede emitir."
              error={form.formState.errors.algorithm}
              {...form.register('algorithm')}
            />
          </FieldRow>

          <FieldRow>
            <NumberField
              label="TTL del token (segundos)"
              min={TOKEN_TTL_MIN}
              max={TOKEN_TTL_MAX}
              placeholder="300"
              hint={`Entre ${TOKEN_TTL_MIN} y ${TOKEN_TTL_MAX}. Un token de provisioning de vida larga es un token robado de vida larga.`}
              error={form.formState.errors.token_ttl_seconds}
              {...form.register('token_ttl_seconds')}
            />
            <TextField
              label="Hosts permitidos"
              placeholder="api.ewm.ebim.pe, ewm-qas.ebim.pe"
              hint="Lista blanca adicional para el guard SSRF. Vacío = solo el host de la URL base del destino."
              error={form.formState.errors.allowed_hosts}
              {...form.register('allowed_hosts')}
            />
          </FieldRow>

          <FieldRow>
            <TextField
              label="Scope de creación"
              placeholder="provisioning:tenant:create"
              error={form.formState.errors.create_scope}
              {...form.register('create_scope')}
            />
            <TextField
              label="Scope de consulta"
              placeholder="provisioning:tenant:read"
              error={form.formState.errors.read_scope}
              {...form.register('read_scope')}
            />
          </FieldRow>

          <p className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Rutas del contrato (relativas a la URL base del destino)
          </p>

          <FieldRow>
            <TextField
              label="Ruta de alta"
              placeholder="/internal/platform/v1/tenants"
              hint="El host vive en el destino: la misma ruta sirve para QAS, PRD y dedicados."
              error={form.formState.errors.create_path_template}
              {...form.register('create_path_template')}
            />
            <TextField
              label="Ruta de consulta"
              placeholder="/internal/platform/v1/tenants/{externalTenantId}"
              error={form.formState.errors.status_path_template}
              {...form.register('status_path_template')}
            />
          </FieldRow>

          <TextField
            label="Ruta de salud"
            placeholder="/internal/platform/v1/health"
            hint="Opcional. Si el producto no la expone, la salud queda en «Sin verificar» y no se inventa un estado."
            error={form.formState.errors.health_path_template}
            {...form.register('health_path_template')}
          />
        </>
      ) : null}

      <CheckboxField
        label="Integración habilitada"
        hint="Habilitar no basta para provisionar: el destino también debe estar listo."
        {...form.register('enabled')}
      />
    </FormDialog>
  );
}

/* ==========================================================================
   Perfil de credencial
   ========================================================================== */

const credentialSchema = z
  .object({
    code: z.string().trim().regex(SLUG, 'Minúsculas y guiones (ej. ewm-qas-m2m)'),
    name: z.string().trim().min(2, 'Obligatorio'),
    saas_product_id: z.string().optional(),
    type: z.enum(['M2M_ASYMMETRIC_JWT', 'NONE']),
    environment: z.enum(['DEV', 'QAS', 'DEMO', 'PRD']),
    secret_ref: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || !describeSecretRefProblem(v), {
        message:
          'Aquí va el NOMBRE del secreto (EWM_QAS_M2M_PRIVATE_KEY), no su valor. El valor se carga en los secrets del servidor.',
      }),
    public_key_ref: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || !describeSecretRefProblem(v), { message: 'Se espera un NOMBRE de secreto' }),
    algorithm: z.enum(['RS256', 'ES256']).or(z.literal('')),
    token_ttl_seconds: z.coerce.number().int().min(TOKEN_TTL_MIN).max(TOKEN_TTL_MAX),
    enabled: z.boolean(),
  })
  .refine((v) => v.type !== 'M2M_ASYMMETRIC_JWT' || Boolean(v.secret_ref), {
    path: ['secret_ref'],
    message: 'Un perfil M2M necesita la referencia del secreto de firma',
  })
  .refine((v) => v.type !== 'M2M_ASYMMETRIC_JWT' || Boolean(v.algorithm), {
    path: ['algorithm'],
    message: 'Un perfil M2M necesita algoritmo',
  })
  .refine((v) => v.type !== 'M2M_ASYMMETRIC_JWT' || Boolean(v.token_ttl_seconds), {
    path: ['token_ttl_seconds'],
    message: 'Un perfil M2M necesita TTL',
  });

type CredentialValues = z.input<typeof credentialSchema>;

export interface CredentialDraft {
  id: string;
  code: string;
  name: string;
  saas_product_id: string | null;
  type: string;
  environment: string;
  algorithm: string | null;
  token_ttl_seconds: number | null;
  enabled: boolean;
  /** Solo se sabe SI hay referencia. Cuál es, lo dice una RPC auditada. */
  secret_configured: boolean;
  secret_ref?: string | null;
  public_key_ref?: string | null;
}

export function CredentialProfileDialog({
  open,
  profile,
  productId,
  onClose,
}: {
  open: boolean;
  profile?: CredentialDraft | null;
  productId?: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const products = useProducts();
  const upsert = useUpsertCredentialProfile();
  const isEdit = Boolean(profile);

  const form = useForm<CredentialValues>({
    resolver: zodResolver(credentialSchema),
    defaultValues: {
      code: '',
      name: '',
      saas_product_id: productId ?? '',
      type: 'M2M_ASYMMETRIC_JWT',
      environment: 'QAS',
      secret_ref: '',
      public_key_ref: '',
      algorithm: 'RS256',
      token_ttl_seconds: 300,
      enabled: false,
    },
  });

  useEffect(() => {
    if (!open) return;
    upsert.reset();
    form.reset({
      code: profile?.code ?? '',
      name: profile?.name ?? '',
      saas_product_id: profile?.saas_product_id ?? productId ?? '',
      type: (profile?.type as CredentialValues['type']) ?? 'M2M_ASYMMETRIC_JWT',
      environment: (profile?.environment as CredentialValues['environment']) ?? 'QAS',
      // La referencia NO se precarga: `authenticated` no tiene privilegio de
      // lectura sobre esa columna. Se vuelve a escribir al editar, y el diálogo
      // lo dice en vez de mostrar un campo misteriosamente vacío.
      secret_ref: profile?.secret_ref ?? '',
      public_key_ref: profile?.public_key_ref ?? '',
      algorithm: (profile?.algorithm as 'RS256' | 'ES256') ?? '',
      token_ttl_seconds: profile?.token_ttl_seconds ?? 300,
      enabled: profile?.enabled ?? false,
    });
  }, [open, profile, productId]);

  const type = form.watch('type');

  const submit = form.handleSubmit(async (values) => {
    try {
      await upsert.mutateAsync({
        p_id: profile?.id,
        p_code: values.code,
        p_name: values.name,
        p_saas_product_id: values.saas_product_id || undefined,
        p_type: values.type,
        p_environment: values.environment,
        p_secret_ref: values.type === 'NONE' ? undefined : values.secret_ref || undefined,
        p_public_key_ref: values.type === 'NONE' ? undefined : values.public_key_ref || undefined,
        p_algorithm: values.type === 'NONE' ? undefined : values.algorithm || undefined,
        p_token_ttl_seconds:
          values.type === 'NONE' || !values.token_ttl_seconds
            ? undefined
            : Number(values.token_ttl_seconds),
        p_enabled: values.enabled,
      });
      toast.success(isEdit ? 'Perfil actualizado' : 'Perfil creado', values.code);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={isEdit ? `Editar ${profile?.code}` : 'Nuevo perfil de credencial'}
      description="Este perfil guarda la REFERENCIA del secreto, nunca su valor. El valor vive en los secrets del servidor y esta base no puede conocerlo."
      submitLabel={isEdit ? 'Guardar cambios' : 'Crear perfil'}
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <FieldRow>
        <TextField
          label="Nombre"
          required
          placeholder="EWM QAS · firma M2M"
          error={form.formState.errors.name}
          {...form.register('name')}
        />
        <TextField
          label="Código"
          required
          placeholder="ewm-qas-m2m"
          error={form.formState.errors.code}
          {...form.register('code')}
        />
      </FieldRow>

      <FieldRow>
        <SelectField
          label="Producto"
          placeholder="Transversal (cualquier producto)"
          options={(products.data ?? []).map((p) => ({ value: p.id, label: p.short_name }))}
          error={form.formState.errors.saas_product_id}
          {...form.register('saas_product_id')}
        />
        <SelectField
          label="Ambiente"
          options={ENVIRONMENT_OPTIONS}
          hint="Debe coincidir con el ambiente del destino que lo use."
          error={form.formState.errors.environment}
          {...form.register('environment')}
        />
      </FieldRow>

      <SelectField
        label="Tipo"
        options={[
          { value: 'M2M_ASYMMETRIC_JWT', label: 'JWT asimétrico M2M' },
          { value: 'NONE', label: 'Sin credencial (manual o simulada)' },
        ]}
        error={form.formState.errors.type}
        {...form.register('type')}
      />

      {type === 'M2M_ASYMMETRIC_JWT' ? (
        <>
          <FieldRow>
            <TextField
              label="Referencia del secreto de firma"
              required
              placeholder="EWM_QAS_M2M_PRIVATE_KEY"
              hint={
                profile?.secret_configured
                  ? 'Ya hay una referencia configurada. No se muestra aquí: escriba el nombre otra vez para cambiarla.'
                  : 'Nombre del secreto en el almacén del servidor. NUNCA pegue aquí la clave.'
              }
              error={form.formState.errors.secret_ref}
              {...form.register('secret_ref')}
            />
            <TextField
              label="Referencia de la clave pública"
              placeholder="EWM_QAS_M2M_PUBLIC_KEY"
              hint="Opcional. También es un nombre, no un valor."
              error={form.formState.errors.public_key_ref}
              {...form.register('public_key_ref')}
            />
          </FieldRow>

          <FieldRow>
            <SelectField
              label="Algoritmo"
              placeholder="Sin definir"
              options={ALGORITHM_OPTIONS}
              error={form.formState.errors.algorithm}
              {...form.register('algorithm')}
            />
            <NumberField
              label="TTL del token (segundos)"
              min={TOKEN_TTL_MIN}
              max={TOKEN_TTL_MAX}
              placeholder="300"
              error={form.formState.errors.token_ttl_seconds}
              {...form.register('token_ttl_seconds')}
            />
          </FieldRow>
        </>
      ) : null}

      <CheckboxField
        label="Perfil habilitado"
        hint="Un destino HTTP no puede declararse listo con la credencial deshabilitada."
        {...form.register('enabled')}
      />
    </FormDialog>
  );
}

/* ==========================================================================
   Propietario técnico
   ========================================================================== */

const ownerSchema = z.object({
  user_id: z.string().min(1, 'Elija a la persona'),
  role: z.enum(['TECHNICAL_OWNER', 'BACKUP_OWNER', 'VIEWER']),
});

type OwnerValues = z.input<typeof ownerSchema>;

export function ProductOwnerDialog({
  open,
  productId,
  productName,
  onClose,
}: {
  open: boolean;
  productId: string;
  productName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const people = usePlatformPeople();
  const upsert = useUpsertProductOwner();

  const form = useForm<OwnerValues>({
    resolver: zodResolver(ownerSchema),
    defaultValues: { user_id: '', role: 'TECHNICAL_OWNER' },
  });

  useEffect(() => {
    if (!open) return;
    upsert.reset();
    form.reset({ user_id: '', role: 'TECHNICAL_OWNER' });
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await upsert.mutateAsync({
        p_saas_product_id: productId,
        p_user_id: values.user_id,
        p_role: values.role,
      });
      toast.success('Propietario asignado', productName);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Propietario técnico de ${productName}`}
      description="Da alcance a la integración, los deployments y el provisioning de ESTE producto, y de ninguno más. No es un rol de plataforma."
      submitLabel="Asignar"
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField
        label="Persona"
        required
        placeholder="Elija a quien responde por el producto"
        options={(people.data ?? []).map((p) => ({
          value: p.id,
          label: `${p.full_name ?? p.email} · ${p.email}`,
        }))}
        error={form.formState.errors.user_id}
        {...form.register('user_id')}
      />
      <SelectField
        label="Rol"
        options={(['TECHNICAL_OWNER', 'BACKUP_OWNER', 'VIEWER'] as const).map((value) => ({
          value,
          label: PRODUCT_OWNER_ROLE_LABEL[value],
        }))}
        hint="El propietario puede ejecutar, reintentar y cancelar provisioning de su producto; no configura la plataforma."
        error={form.formState.errors.role}
        {...form.register('role')}
      />
    </FormDialog>
  );
}
