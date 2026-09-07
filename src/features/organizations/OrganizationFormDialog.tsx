import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, SelectField, CheckboxField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useUpsertOrganization } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import type { Enums } from '@/types/domain';

/**
 * Alta y edición de una organización: cliente, partner, reseller o consultora.
 *
 * Las capacidades son ACUMULABLES (decisión D-006 del baseline y Fase 04): la
 * misma Consultora Andina puede ser Partner + Consultora + Cliente. Por eso son
 * checkboxes y no un `<select>` de "tipo de organización".
 *
 * Solo EBIM puede conceder capacidades; un admin de partner puede editar los
 * datos de SU organización pero los checkboxes le aparecen deshabilitados, igual
 * que hace `platform.upsert_organization` en el servidor.
 */

const SLUG = /^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])?$/;

const CAPABILITIES: Array<{ value: Enums<'org_capability'>; label: string; hint: string }> = [
  { value: 'CUSTOMER', label: 'Cliente', hint: 'Contrata SaaS para sí misma.' },
  { value: 'PARTNER', label: 'Partner', hint: 'Administra tenants de sus clientes.' },
  { value: 'RESELLER', label: 'Reseller', hint: 'Revende licencias con margen propio.' },
  { value: 'CONSULTING', label: 'Consultora', hint: 'Implementa y da servicios profesionales.' },
];

const schema = z.object({
  slug: z.string().trim().regex(SLUG, 'Minúsculas, números y guiones (2-48 caracteres)'),
  legal_name: z.string().trim().min(2, 'Obligatorio'),
  display_name: z.string().trim().min(2, 'Obligatorio'),
  country_code: z.string().trim().regex(/^[A-Z]{2}$/, 'Código ISO de 2 letras (PE, CL, CO)'),
  tax_id: z.string().trim().optional(),
  billing_email: z.string().trim().email('Correo inválido').or(z.literal('')).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED']),
  accent_color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color hex (#056769)')
    .or(z.literal(''))
    .optional(),
  cap_CUSTOMER: z.boolean(),
  cap_PARTNER: z.boolean(),
  cap_RESELLER: z.boolean(),
  cap_CONSULTING: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

export interface OrganizationDraft {
  id: string;
  slug: string;
  legal_name: string;
  display_name: string;
  country_code: string;
  tax_id: string | null;
  billing_email: string | null;
  status: string;
  accent_color: string | null;
  capabilities: string[];
}

const STATUSES = [
  { value: 'ACTIVE', label: 'Activa' },
  { value: 'INACTIVE', label: 'Inactiva' },
  { value: 'SUSPENDED', label: 'Suspendida' },
  { value: 'ARCHIVED', label: 'Archivada' },
];

export function OrganizationFormDialog({
  open,
  organization,
  defaultCapability,
  onClose,
}: {
  open: boolean;
  organization?: OrganizationDraft | null;
  /** Capacidad preseleccionada al crear desde «Partners» o «Clientes». */
  defaultCapability?: Enums<'org_capability'>;
  onClose: () => void;
}) {
  const toast = useToast();
  const perms = usePermissions();
  const upsert = useUpsertOrganization();
  const isEdit = Boolean(organization);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      slug: '',
      legal_name: '',
      display_name: '',
      country_code: 'PE',
      tax_id: '',
      billing_email: '',
      status: 'ACTIVE',
      accent_color: '',
      cap_CUSTOMER: true,
      cap_PARTNER: false,
      cap_RESELLER: false,
      cap_CONSULTING: false,
    },
  });

  useEffect(() => {
    if (!open) return;
    upsert.reset();
    const caps = new Set(organization?.capabilities ?? (defaultCapability ? [defaultCapability] : ['CUSTOMER']));
    form.reset({
      slug: organization?.slug ?? '',
      legal_name: organization?.legal_name ?? '',
      display_name: organization?.display_name ?? '',
      country_code: organization?.country_code ?? 'PE',
      tax_id: organization?.tax_id ?? '',
      billing_email: organization?.billing_email ?? '',
      status: (organization?.status as FormValues['status']) ?? 'ACTIVE',
      accent_color: organization?.accent_color ?? '',
      cap_CUSTOMER: caps.has('CUSTOMER'),
      cap_PARTNER: caps.has('PARTNER'),
      cap_RESELLER: caps.has('RESELLER'),
      cap_CONSULTING: caps.has('CONSULTING'),
    });
    // Solo reacciona a la apertura y al registro editado.
  }, [open, organization, defaultCapability]);

  const submit = form.handleSubmit(async (values) => {
    const selected = CAPABILITIES.map((c) => c.value).filter(
      (c) => values[`cap_${c}` as keyof FormValues],
    );

    try {
      await upsert.mutateAsync({
        p_id: organization?.id,
        p_slug: values.slug,
        p_legal_name: values.legal_name,
        p_display_name: values.display_name,
        p_country_code: values.country_code,
        p_tax_id: values.tax_id || undefined,
        p_billing_email: values.billing_email || undefined,
        p_capabilities: selected,
        p_status: values.status,
        p_accent_color: values.accent_color || undefined,
      });
      toast.success(
        isEdit ? 'Organización actualizada' : 'Organización creada',
        values.display_name,
      );
      onClose();
    } catch {
      // El mensaje de la base se muestra dentro del diálogo.
    }
  });

  return (
    <FormDialog
      open={open}
      title={isEdit ? `Editar ${organization?.display_name}` : 'Nueva organización'}
      description="Las capacidades son acumulables: una misma empresa puede ser partner y cliente a la vez."
      submitLabel={isEdit ? 'Guardar cambios' : 'Crear organización'}
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <FieldRow>
        <TextField
          label="Nombre comercial"
          required
          placeholder="Consultora Andina"
          error={form.formState.errors.display_name}
          {...form.register('display_name')}
        />
        <TextField
          label="Razón social"
          required
          placeholder="Consultora Andina SAC"
          error={form.formState.errors.legal_name}
          {...form.register('legal_name')}
        />
      </FieldRow>

      <FieldRow>
        <TextField
          label="Slug"
          required
          placeholder="consultora-andina"
          hint="Identificador estable en URLs y referencias."
          error={form.formState.errors.slug}
          {...form.register('slug')}
        />
        <TextField
          label="País"
          required
          placeholder="PE"
          hint="Código ISO de 2 letras, en mayúsculas."
          error={form.formState.errors.country_code}
          {...form.register('country_code')}
        />
      </FieldRow>

      <FieldRow>
        <TextField
          label="Identificación fiscal"
          placeholder="RUC / NIT"
          hint="Es un atributo, nunca la clave de la organización."
          error={form.formState.errors.tax_id}
          {...form.register('tax_id')}
        />
        <TextField
          label="Correo de facturación"
          type="email"
          placeholder="facturacion@empresa.com"
          error={form.formState.errors.billing_email}
          {...form.register('billing_email')}
        />
      </FieldRow>

      <FieldRow>
        <SelectField
          label="Estado"
          options={STATUSES}
          error={form.formState.errors.status}
          {...form.register('status')}
        />
        <TextField
          label="Color de acento"
          placeholder="#056769"
          hint="Se usa en el branding del tenant si tiene white-label."
          error={form.formState.errors.accent_color}
          {...form.register('accent_color')}
        />
      </FieldRow>

      <fieldset className="rounded-lg border border-border p-3">
        <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">
          Capacidades
        </legend>
        {!perms.canManagePlatform ? (
          <p className="mb-2 text-xs text-muted">
            Solo el equipo de plataforma EBIM puede cambiar las capacidades de una organización.
          </p>
        ) : null}
        <div className="grid gap-2.5 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <CheckboxField
              key={c.value}
              label={c.label}
              hint={c.hint}
              disabled={!perms.canManagePlatform}
              {...form.register(`cap_${c.value}` as keyof FormValues)}
            />
          ))}
        </div>
      </fieldset>
    </FormDialog>
  );
}
