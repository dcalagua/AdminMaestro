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

/**
 * Muestras para el color de la marca del cliente (V6 · F2). Son DATOS de la
 * organización (se guardan en `accent_color`), no colores de la consola: por
 * eso no son tokens. El código hex queda en el tooltip.
 */
const ACCENT_PRESETS: Array<{ hex: string; name: string }> = [
  { hex: '#056769', name: 'Verde azulado' },
  { hex: '#1F6FB2', name: 'Azul' },
  { hex: '#5B3FA8', name: 'Violeta' },
  { hex: '#B23A6B', name: 'Magenta' },
  { hex: '#C2410C', name: 'Naranja' },
  { hex: '#A16207', name: 'Ocre' },
  { hex: '#2F7D32', name: 'Verde' },
  { hex: '#374151', name: 'Grafito' },
];

/** Título y botón según desde dónde se crea: «Nuevo cliente / Crear cliente», «Nuevo partner / Crear partner». */
function createLabels(capability: Enums<'org_capability'> | undefined): { title: string; submit: string } {
  if (capability === 'CUSTOMER') return { title: 'Nuevo cliente', submit: 'Crear cliente' };
  if (capability === 'PARTNER') return { title: 'Nuevo partner', submit: 'Crear partner' };
  return { title: 'Nueva organización', submit: 'Crear organización' };
}

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
      country_code: '',
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
      // V3: sin país por defecto; el país sugiere el mercado de cada venta.
      country_code: organization?.country_code ?? '',
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
      title={isEdit ? `Editar ${organization?.display_name}` : createLabels(defaultCapability).title}
      description="Las capacidades son acumulables: una misma empresa puede ser partner y cliente a la vez."
      submitLabel={isEdit ? 'Guardar cambios' : createLabels(defaultCapability).submit}
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
          label="Código"
          required
          placeholder="consultora-andina"
          hint="Identificador estable en URLs y referencias."
          error={form.formState.errors.slug}
          {...form.register('slug')}
        />
        <TextField
          label="País"
          required
          placeholder="PE, BO, EC…"
          hint="Código ISO de 2 letras. Sugiere el mercado (y la moneda) de sus ventas."
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
        <AccentSwatches
          value={form.watch('accent_color') ?? ''}
          onChange={(hex) => form.setValue('accent_color', hex, { shouldDirty: true, shouldValidate: true })}
          error={form.formState.errors.accent_color?.message}
        />
      </FieldRow>

      <fieldset className="rounded-lg border border-border p-3">
        <legend className="px-1 text-micro uppercase text-muted">
          Capacidades
        </legend>
        {!perms.canManagePlatform ? (
          <p className="mb-2 text-caption text-muted">
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

/**
 * Color de la marca como paleta de muestras (radio): «Sin color» o una muestra;
 * un color guardado que no está en la paleta aparece como «Actual». El hex
 * solo en el tooltip (antes, un campo de texto con «#056769»).
 */
function AccentSwatches({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (hex: string) => void;
  error?: string;
}) {
  const current = value.trim();
  const custom =
    current && !ACCENT_PRESETS.some((p) => p.hex.toLowerCase() === current.toLowerCase())
      ? [{ hex: current, name: 'Actual' }]
      : [];
  const options = [...ACCENT_PRESETS, ...custom];
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-compact font-semibold text-fg">Color de la marca</legend>
      <div role="radiogroup" aria-label="Color de la marca" className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          role="radio"
          aria-checked={!current}
          onClick={() => onChange('')}
          className={`inline-flex h-8 items-center rounded-full border px-2.5 text-caption font-semibold ${
            !current ? 'border-accent-deep bg-accent-soft text-accent-deep' : 'border-border text-fg-2 hover:bg-hover'
          }`}
        >
          Sin color
        </button>
        {options.map((p) => {
          const selected = current.toLowerCase() === p.hex.toLowerCase();
          return (
            <button
              key={p.hex}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${p.name} (${p.hex.toUpperCase()})`}
              title={`${p.name} · ${p.hex.toUpperCase()}`}
              onClick={() => onChange(p.hex)}
              className={`h-8 w-8 rounded-full border-2 transition-shadow duration-fast ${
                selected ? 'border-fg shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--accent-deep)]' : 'border-card hover:border-border-strong'
              }`}
              // El color es un dato de la organización (su marca), no un color de la consola.
              style={{ backgroundColor: p.hex }}
            />
          );
        })}
      </div>
      <p className={`mt-1 text-caption ${error ? 'text-danger' : 'text-muted'}`}>
        {error ?? 'Se usa en la ficha y en las apps que muestran la marca del cliente.'}
      </p>
    </fieldset>
  );
}
