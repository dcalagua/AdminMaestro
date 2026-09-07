import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, SelectField, NumberField, CheckboxField, TextAreaField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useUpsertProduct } from '@/services/mutations';
import type { SaasProduct } from '@/types/domain';

/**
 * Alta y edición de un SaaS de la suite.
 *
 * El objetivo de la Fase 03 es que añadir un producto sea INSERTAR UNA FILA: no
 * hay ninguna rama de código por producto ni columna `is_esupplier`. Este
 * formulario es toda la superficie necesaria.
 */

/** Mismo `platform.is_slug()` que protege la columna en la base (CHECK saas_products_code_ck). */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const schema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .regex(SLUG, 'Solo minúsculas, números y guiones (ej. esupplier)'),
  name: z.string().trim().min(2, 'Obligatorio'),
  short_name: z.string().trim().min(2, 'Obligatorio'),
  description: z.string().trim().optional(),
  accent_color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Debe ser un color hex (#5AA97F)')
    .or(z.literal(''))
    .optional(),
  billing_unit: z.enum(['TENANT', 'COMPANY', 'WAREHOUSE', 'USER']),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED']),
  is_billable: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(9999),
});

type FormValues = z.input<typeof schema>;

const BILLING_UNITS = [
  { value: 'TENANT', label: 'Por tenant' },
  { value: 'COMPANY', label: 'Por sociedad' },
  { value: 'WAREHOUSE', label: 'Por almacén' },
  { value: 'USER', label: 'Por usuario' },
];

const STATUSES = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'INACTIVE', label: 'Inactivo' },
  { value: 'SUSPENDED', label: 'Suspendido' },
];

export function ProductFormDialog({
  open,
  product,
  onClose,
}: {
  open: boolean;
  product?: SaasProduct | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const upsert = useUpsertProduct();
  const isEdit = Boolean(product);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: '',
      name: '',
      short_name: '',
      description: '',
      accent_color: '',
      billing_unit: 'TENANT',
      status: 'ACTIVE',
      is_billable: true,
      sort_order: 100,
    },
  });

  useEffect(() => {
    if (!open) return;
    upsert.reset();
    form.reset({
      code: product?.code ?? '',
      name: product?.name ?? '',
      short_name: product?.short_name ?? '',
      description: product?.description ?? '',
      accent_color: product?.accent_color ?? '',
      billing_unit: (product?.billing_unit as FormValues['billing_unit']) ?? 'TENANT',
      status: (product?.status as FormValues['status']) ?? 'ACTIVE',
      is_billable: product?.is_billable ?? true,
      sort_order: product?.sort_order ?? 100,
    });
    // Deliberadamente solo `open`/`product`: `form` y `upsert` son estables entre
    // renders, e incluirlos reejecutaría el reset durante la edición.
  }, [open, product]);

  const submit = form.handleSubmit(async (values) => {
    const parsed = schema.parse(values);
    try {
      await upsert.mutateAsync({
        p_id: product?.id,
        p_code: parsed.code,
        p_name: parsed.name,
        p_short_name: parsed.short_name,
        p_description: parsed.description || undefined,
        p_accent_color: parsed.accent_color || undefined,
        p_status: parsed.status,
        p_is_billable: parsed.is_billable,
        p_billing_unit: parsed.billing_unit,
        p_sort_order: parsed.sort_order,
      });
      toast.success(
        isEdit ? 'Producto actualizado' : 'Producto creado',
        `${parsed.short_name} (${parsed.code})`,
      );
      onClose();
    } catch {
      // El error de negocio ya se pinta dentro del diálogo (FormDialog `error`).
    }
  });

  return (
    <FormDialog
      open={open}
      title={isEdit ? `Editar ${product?.short_name}` : 'Nuevo producto SaaS'}
      description={
        isEdit
          ? 'El código es la clave de integración con la suite y no se puede cambiar.'
          : 'Un SaaS nuevo es una fila del catálogo: no requiere cambios de código ni migraciones.'
      }
      submitLabel={isEdit ? 'Guardar cambios' : 'Crear producto'}
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <FieldRow>
        <TextField
          label="Código"
          required
          placeholder="esupplier"
          hint="Minúsculas y guiones. Inmutable tras el alta."
          disabled={isEdit}
          error={form.formState.errors.code}
          {...form.register('code')}
        />
        <TextField
          label="Nombre corto"
          required
          placeholder="eSupplier"
          hint="Genera el lockup «… by EBIM»."
          error={form.formState.errors.short_name}
          {...form.register('short_name')}
        />
      </FieldRow>

      <TextField
        label="Nombre completo"
        required
        placeholder="EBIM eSupplier"
        error={form.formState.errors.name}
        {...form.register('name')}
      />

      <TextAreaField
        label="Descripción"
        placeholder="Qué resuelve este SaaS dentro de la suite"
        error={form.formState.errors.description}
        {...form.register('description')}
      />

      <FieldRow>
        <SelectField
          label="Unidad de cobro"
          options={BILLING_UNITS}
          error={form.formState.errors.billing_unit}
          {...form.register('billing_unit')}
        />
        <SelectField
          label="Estado"
          options={STATUSES}
          hint="Para archivar usa la acción «Archivar», que valida dependencias."
          error={form.formState.errors.status}
          {...form.register('status')}
        />
      </FieldRow>

      <FieldRow>
        <TextField
          label="Color de acento"
          placeholder="#5AA97F"
          hint="Hex de marca del producto. Opcional."
          error={form.formState.errors.accent_color}
          {...form.register('accent_color')}
        />
        <NumberField
          label="Orden en el menú"
          error={form.formState.errors.sort_order}
          {...form.register('sort_order')}
        />
      </FieldRow>

      <CheckboxField
        label="Es facturable"
        hint="Desmárcalo para productos internos o de cortesía que no generan suscripción."
        {...form.register('is_billable')}
      />
    </FormDialog>
  );
}
