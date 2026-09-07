import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, SelectField, NumberField, CheckboxField, TextAreaField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useProducts } from '@/services/queries';
import { useUpsertProductAgreement } from '@/services/mutations';
import type { Enums } from '@/types/domain';

/**
 * Condiciones comerciales de un canal para UN producto.
 *
 * Esta es la pieza que hace real la frase "un partner puede vender N SaaS con
 * márgenes distintos": Consultora Andina con eSupplier al 25 % y WMS al 18 % son
 * DOS filas de esta tabla, no dos organizaciones ni dos tipos de partner.
 *
 * Los límites (modos permitidos, tipos de tenant, tope) son OPT-IN: un acuerdo
 * sin acotar permite todo, que es como se comportaba el sistema antes de V2.
 */

const MODES: Array<{ value: Enums<'deployment_mode'>; label: string; hint: string }> = [
  { value: 'SHARED', label: 'Compartido', hint: 'N tenants sobre infraestructura común.' },
  { value: 'PARTNER_DEDICATED', label: 'Dedicado partner', hint: 'Infraestructura exclusiva del canal.' },
  { value: 'TENANT_DEDICATED', label: 'Dedicado cliente', hint: 'Infraestructura exclusiva de un cliente.' },
];

const TYPES: Array<{ value: Enums<'tenant_type'>; label: string }> = [
  { value: 'PRODUCTION', label: 'Producción' },
  { value: 'TRIAL', label: 'Trial' },
  { value: 'DEMO', label: 'Demo' },
  { value: 'SANDBOX', label: 'Sandbox' },
];

const schema = z
  .object({
    saas_product_id: z.string().uuid('Elige el producto'),
    can_resell: z.boolean(),
    can_manage_tenants: z.boolean(),
    margin_pct: z.coerce.number().min(0, 'Mínimo 0').max(100, 'Máximo 100'),
    default_deployment_mode: z.enum(['SHARED', 'PARTNER_DEDICATED', 'TENANT_DEDICATED']),
    mode_SHARED: z.boolean(),
    mode_PARTNER_DEDICATED: z.boolean(),
    mode_TENANT_DEDICATED: z.boolean(),
    type_PRODUCTION: z.boolean(),
    type_TRIAL: z.boolean(),
    type_DEMO: z.boolean(),
    type_SANDBOX: z.boolean(),
    billing_responsibility: z.enum(['EBIM', 'PARTNER', 'MIXED']),
    max_tenants: z.string().trim().optional(),
    valid_from: z.string().min(1, 'Obligatorio'),
    valid_to: z.string().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED']),
    notes: z.string().trim().optional(),
  })
  .refine((v) => v.mode_SHARED || v.mode_PARTNER_DEDICATED || v.mode_TENANT_DEDICATED, {
    path: ['mode_SHARED'],
    message: 'El acuerdo debe permitir al menos un modelo de despliegue',
  })
  .refine((v) => v.type_PRODUCTION || v.type_TRIAL || v.type_DEMO || v.type_SANDBOX, {
    path: ['type_PRODUCTION'],
    message: 'El acuerdo debe permitir al menos un tipo de tenant',
  })
  .refine((v) => v[`mode_${v.default_deployment_mode}` as const], {
    path: ['default_deployment_mode'],
    message: 'El modelo por defecto tiene que estar entre los permitidos',
  });

type FormValues = z.input<typeof schema>;

export interface AgreementDraft {
  agreement_id: string;
  saas_product_id: string;
  can_resell: boolean;
  can_manage_tenants: boolean;
  margin_rate: number;
  default_deployment_mode: string;
  allowed_deployment_modes: string[];
  allowed_tenant_types: string[];
  billing_responsibility: string;
  max_tenants: number | null;
  valid_from: string;
  valid_to: string | null;
  status: string;
  notes: string | null;
}

const BILLING = [
  { value: 'EBIM', label: 'EBIM factura al cliente' },
  { value: 'PARTNER', label: 'El partner factura al cliente' },
  { value: 'MIXED', label: 'Mixto (detallar en notas)' },
];

const STATUSES = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'INACTIVE', label: 'Inactivo' },
  { value: 'SUSPENDED', label: 'Suspendido' },
];

export function AgreementFormDialog({
  open,
  organizationId,
  organizationName,
  agreement,
  onClose,
}: {
  open: boolean;
  organizationId: string;
  organizationName: string;
  agreement?: AgreementDraft | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const products = useProducts();
  const upsert = useUpsertProductAgreement();
  const isEdit = Boolean(agreement);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      saas_product_id: '', can_resell: true, can_manage_tenants: true, margin_pct: 20,
      default_deployment_mode: 'SHARED',
      mode_SHARED: true, mode_PARTNER_DEDICATED: false, mode_TENANT_DEDICATED: false,
      type_PRODUCTION: true, type_TRIAL: true, type_DEMO: true, type_SANDBOX: false,
      billing_responsibility: 'EBIM', max_tenants: '',
      valid_from: new Date().toISOString().slice(0, 10), valid_to: '',
      status: 'ACTIVE', notes: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    upsert.reset();
    const modes = new Set(agreement?.allowed_deployment_modes ?? ['SHARED']);
    const types = new Set(agreement?.allowed_tenant_types ?? ['PRODUCTION', 'TRIAL', 'DEMO']);
    form.reset({
      saas_product_id: agreement?.saas_product_id ?? '',
      can_resell: agreement?.can_resell ?? true,
      can_manage_tenants: agreement?.can_manage_tenants ?? true,
      margin_pct: agreement ? Number(agreement.margin_rate) * 100 : 20,
      default_deployment_mode:
        (agreement?.default_deployment_mode as FormValues['default_deployment_mode']) ?? 'SHARED',
      mode_SHARED: modes.has('SHARED'),
      mode_PARTNER_DEDICATED: modes.has('PARTNER_DEDICATED'),
      mode_TENANT_DEDICATED: modes.has('TENANT_DEDICATED'),
      type_PRODUCTION: types.has('PRODUCTION'),
      type_TRIAL: types.has('TRIAL'),
      type_DEMO: types.has('DEMO'),
      type_SANDBOX: types.has('SANDBOX'),
      billing_responsibility:
        (agreement?.billing_responsibility as FormValues['billing_responsibility']) ?? 'EBIM',
      max_tenants: agreement?.max_tenants != null ? String(agreement.max_tenants) : '',
      valid_from: agreement?.valid_from ?? new Date().toISOString().slice(0, 10),
      valid_to: agreement?.valid_to ?? '',
      status: (agreement?.status as FormValues['status']) ?? 'ACTIVE',
      notes: agreement?.notes ?? '',
    });
  }, [open, agreement]);

  const submit = form.handleSubmit(async (values) => {
    const parsed = schema.parse(values);
    const modes = MODES.map((m) => m.value).filter(
      (m) => parsed[`mode_${m}` as keyof typeof parsed],
    );
    const types = TYPES.map((t) => t.value).filter(
      (t) => parsed[`type_${t}` as keyof typeof parsed],
    );

    try {
      await upsert.mutateAsync({
        p_id: agreement?.agreement_id,
        p_organization_id: organizationId,
        p_saas_product_id: parsed.saas_product_id,
        p_can_resell: parsed.can_resell,
        p_can_manage_tenants: parsed.can_manage_tenants,
        // La base guarda el margen como fracción; la UI lo pide en porcentaje.
        p_margin_rate: parsed.margin_pct / 100,
        p_default_deployment_mode: parsed.default_deployment_mode,
        p_allowed_deployment_modes: modes,
        p_allowed_tenant_types: types,
        p_billing_responsibility: parsed.billing_responsibility,
        p_max_tenants: parsed.max_tenants ? Number(parsed.max_tenants) : undefined,
        p_valid_from: parsed.valid_from,
        p_valid_to: parsed.valid_to || undefined,
        p_status: parsed.status,
        p_notes: parsed.notes || undefined,
      });
      toast.success(
        isEdit ? 'Acuerdo actualizado' : 'Acuerdo creado',
        `${organizationName} · margen ${parsed.margin_pct}%`,
      );
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={isEdit ? 'Editar acuerdo de canal' : `Nuevo acuerdo · ${organizationName}`}
      description="Condiciones para UN producto. Un canal puede tener varios acuerdos con márgenes y límites distintos."
      submitLabel={isEdit ? 'Guardar acuerdo' : 'Crear acuerdo'}
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <FieldRow>
        <SelectField label="Producto" required placeholder="Elige el producto…"
          options={(products.data ?? []).map((p) => ({ value: p.id, label: p.short_name }))}
          hint={isEdit ? 'El producto de un acuerdo no se cambia; crea otro acuerdo.' : undefined}
          disabled={isEdit}
          error={form.formState.errors.saas_product_id} {...form.register('saas_product_id')} />
        <NumberField label="Margen del canal (%)" required min={0} max={100} step="0.01"
          hint="Margen comercial del partner. No es la comisión de un sales agent."
          error={form.formState.errors.margin_pct} {...form.register('margin_pct')} />
      </FieldRow>

      <FieldRow>
        <CheckboxField label="Puede revender"
          hint="Comercializa el SaaS a sus propios clientes."
          {...form.register('can_resell')} />
        <CheckboxField label="Puede administrar tenants"
          hint="Sin esto, la base impide asignarle tenants (PARTNER_SIN_ACUERDO)."
          {...form.register('can_manage_tenants')} />
      </FieldRow>

      <fieldset className="rounded-lg border border-border p-3">
        <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">
          Modelos de despliegue permitidos
        </legend>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {MODES.map((m) => (
            <CheckboxField key={m.value} label={m.label} hint={m.hint}
              {...form.register(`mode_${m.value}` as keyof FormValues)} />
          ))}
        </div>
        {form.formState.errors.mode_SHARED ? (
          <p className="mt-2 text-xs text-danger" role="alert">
            {form.formState.errors.mode_SHARED.message}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted">
          Un partner con 20 tenants en «Compartido» sigue siendo Shared: tener muchos clientes
          no lo convierte en Dedicado.
        </p>
      </fieldset>

      <fieldset className="rounded-lg border border-border p-3">
        <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">
          Tipos de tenant que puede dar de alta
        </legend>
        <div className="grid gap-2.5 sm:grid-cols-4">
          {TYPES.map((t) => (
            <CheckboxField key={t.value} label={t.label}
              {...form.register(`type_${t.value}` as keyof FormValues)} />
          ))}
        </div>
        {form.formState.errors.type_PRODUCTION ? (
          <p className="mt-2 text-xs text-danger" role="alert">
            {form.formState.errors.type_PRODUCTION.message}
          </p>
        ) : null}
      </fieldset>

      <FieldRow>
        <SelectField label="Modelo por defecto"
          options={MODES.map((m) => ({ value: m.value, label: m.label }))}
          error={form.formState.errors.default_deployment_mode}
          {...form.register('default_deployment_mode')} />
        <SelectField label="Responsabilidad de facturación" options={BILLING}
          error={form.formState.errors.billing_responsibility}
          {...form.register('billing_responsibility')} />
      </FieldRow>

      <FieldRow>
        <TextField label="Tope de tenants" type="number" min={1} placeholder="Sin límite"
          hint="Vacío = ilimitado. Cuenta solo tenants vivos."
          error={form.formState.errors.max_tenants} {...form.register('max_tenants')} />
        <SelectField label="Estado" options={STATUSES}
          error={form.formState.errors.status} {...form.register('status')} />
      </FieldRow>

      <FieldRow>
        <TextField label="Vigente desde" type="date" required
          error={form.formState.errors.valid_from} {...form.register('valid_from')} />
        <TextField label="Vigente hasta" type="date"
          error={form.formState.errors.valid_to} {...form.register('valid_to')} />
      </FieldRow>

      <TextAreaField label="Notas del acuerdo"
        placeholder="Condiciones particulares, reparto en modelo mixto, etc."
        error={form.formState.errors.notes} {...form.register('notes')} />
    </FormDialog>
  );
}
