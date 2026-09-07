import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, SelectField, NumberField, TextAreaField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useOrganizations, useProducts, usePlans, useTenantOverview } from '@/services/queries';
import {
  useCreateSubscription, useSetSubscriptionStatus, useUpsertSubscriptionItem,
} from '@/services/mutations';
import type { Enums } from '@/types/domain';

/* ==========================================================================
   Alta de suscripción
   ========================================================================== */

const subSchema = z.object({
  billed_organization_id: z.string().uuid('Elige a quién se factura'),
  saas_product_id: z.string().uuid('Elige el producto'),
  plan_id: z.string().uuid('Elige el plan'),
  tenant_id: z.string().optional(),
  billing_interval: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME']),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, 'Código ISO de 3 letras'),
  quantity: z.coerce.number().int().min(1, 'Mínimo 1'),
  started_on: z.string().min(1, 'Obligatorio'),
  ends_on: z.string().optional(),
  channel_margin_pct: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().trim().optional(),
});

type SubValues = z.input<typeof subSchema>;

const INTERVALS = [
  { value: 'MONTHLY', label: 'Mensual' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'YEARLY', label: 'Anual' },
  { value: 'ONE_TIME', label: 'Pago único' },
];

export function SubscriptionFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const orgs = useOrganizations();
  const products = useProducts();
  const plans = usePlans();
  const tenants = useTenantOverview();
  const create = useCreateSubscription();

  const form = useForm<SubValues>({
    resolver: zodResolver(subSchema),
    defaultValues: {
      billed_organization_id: '', saas_product_id: '', plan_id: '', tenant_id: '',
      billing_interval: 'MONTHLY', currency: 'USD', quantity: 1,
      started_on: new Date().toISOString().slice(0, 10), ends_on: '',
      channel_margin_pct: 0, notes: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    create.reset();
    form.reset();
  }, [open]);

  // Plan y tenant se acotan al producto elegido: la base rechaza las combinaciones
  // cruzadas (PLAN_INCOMPATIBLE / TENANT_INCOMPATIBLE) y aquí ni se ofrecen.
  const productId = form.watch('saas_product_id');
  const planOptions = (plans.data ?? [])
    .filter((p) => !productId || p.saas_product_id === productId)
    .map((p) => ({ value: p.id, label: p.name }));
  const tenantOptions = (tenants.data ?? [])
    .filter((t) => !productId || t.saas_product_id === productId)
    .map((t) => ({ value: t.tenant_id as string, label: t.name as string }));

  const submit = form.handleSubmit(async (values) => {
    const parsed = subSchema.parse(values);
    try {
      await create.mutateAsync({
        p_billed_organization_id: parsed.billed_organization_id,
        p_saas_product_id: parsed.saas_product_id,
        p_plan_id: parsed.plan_id,
        p_billing_interval: parsed.billing_interval,
        p_currency: parsed.currency,
        p_tenant_id: parsed.tenant_id || undefined,
        p_quantity: parsed.quantity,
        p_started_on: parsed.started_on,
        p_ends_on: parsed.ends_on || undefined,
        p_channel_margin_rate: parsed.channel_margin_pct
          ? Number(parsed.channel_margin_pct) / 100
          : undefined,
        p_notes: parsed.notes || undefined,
      });
      toast.success('Suscripción creada', 'Queda en BORRADOR hasta que la actives.');
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title="Nueva suscripción"
      description="Una suscripción SIN tenant es la licencia base de un partner en modelo Dedicado partner: es del canal, no de un cliente concreto."
      submitLabel="Crear suscripción"
      busy={create.isPending}
      error={create.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <FieldRow>
        <SelectField label="Se factura a" required placeholder="Elige la organización…"
          options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.display_name }))}
          error={form.formState.errors.billed_organization_id}
          {...form.register('billed_organization_id')} />
        <SelectField label="Producto" required placeholder="Elige el producto…"
          options={(products.data ?? []).map((p) => ({ value: p.id, label: p.short_name }))}
          error={form.formState.errors.saas_product_id} {...form.register('saas_product_id')} />
      </FieldRow>

      <FieldRow>
        <SelectField label="Plan" required placeholder="Elige el plan…"
          options={planOptions}
          hint={productId ? undefined : 'Elige antes el producto.'}
          error={form.formState.errors.plan_id} {...form.register('plan_id')} />
        <SelectField label="Tenant" placeholder="Sin tenant (licencia base de partner)"
          options={tenantOptions}
          error={form.formState.errors.tenant_id} {...form.register('tenant_id')} />
      </FieldRow>

      <FieldRow>
        <SelectField label="Periodicidad" options={INTERVALS}
          error={form.formState.errors.billing_interval} {...form.register('billing_interval')} />
        <TextField label="Moneda" required placeholder="USD"
          error={form.formState.errors.currency} {...form.register('currency')} />
      </FieldRow>

      <FieldRow>
        <NumberField label="Cantidad" required min={1} step={1}
          error={form.formState.errors.quantity} {...form.register('quantity')} />
        <NumberField label="Margen del canal (%)" min={0} max={100} step="0.01"
          hint="Snapshot del margen pactado con el partner en el momento de la venta."
          error={form.formState.errors.channel_margin_pct} {...form.register('channel_margin_pct')} />
      </FieldRow>

      <FieldRow>
        <TextField label="Inicio" type="date" required
          error={form.formState.errors.started_on} {...form.register('started_on')} />
        <TextField label="Fin" type="date" hint="Vacío = sin fecha de término."
          error={form.formState.errors.ends_on} {...form.register('ends_on')} />
      </FieldRow>

      <TextAreaField label="Notas" error={form.formState.errors.notes} {...form.register('notes')} />
    </FormDialog>
  );
}

/* ==========================================================================
   Cambio de estado
   ========================================================================== */

/** Mismo grafo que valida `platform.set_subscription_status`. */
const NEXT_STATUS: Record<string, Array<Enums<'subscription_status'>>> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['PAST_DUE', 'PAUSED', 'CANCELLED'],
  PAST_DUE: ['ACTIVE', 'PAUSED', 'CANCELLED'],
  PAUSED: ['ACTIVE', 'CANCELLED'],
  CANCELLED: [],
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activa',
  PAST_DUE: 'Vencida',
  PAUSED: 'Pausada',
  CANCELLED: 'Cancelada',
};

const statusSchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED']),
  reason: z.string().trim().optional(),
});

type StatusValues = z.infer<typeof statusSchema>;

export function SubscriptionStatusDialog({
  open,
  subscriptionId,
  subscriptionCode,
  currentStatus,
  onClose,
}: {
  open: boolean;
  subscriptionId: string | null;
  subscriptionCode: string;
  currentStatus: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const setStatus = useSetSubscriptionStatus();

  const options = (NEXT_STATUS[currentStatus] ?? []).map((s) => ({
    value: s,
    label: STATUS_LABEL[s],
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

  const submit = form.handleSubmit(async (values) => {
    if (!subscriptionId) return;
    try {
      await setStatus.mutateAsync({
        p_subscription_id: subscriptionId,
        p_status: values.status,
        p_reason: values.reason?.trim() || undefined,
      });
      toast.success('Suscripción actualizada', `${subscriptionCode} → ${STATUS_LABEL[values.status]}`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Cambiar estado de ${subscriptionCode}`}
      description={
        options.length === 0
          ? 'La suscripción está cancelada: es un estado terminal.'
          : `Estado actual: ${STATUS_LABEL[currentStatus] ?? currentStatus}. Activar una suscripción recurrente sobre un tenant DEMO lo rechaza la base.`
      }
      submitLabel="Aplicar cambio"
      busy={setStatus.isPending}
      error={setStatus.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField label="Nuevo estado" required options={options}
        error={form.formState.errors.status} {...form.register('status')} />
      <TextAreaField label="Motivo" placeholder="Se anexa a las notas de la suscripción"
        error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}

/* ==========================================================================
   Línea de suscripción
   ========================================================================== */

const itemSchema = z
  .object({
    charge_kind: z.enum([
      'LICENSE', 'PARTNER_BASE_LICENSE', 'TENANT_LICENSE', 'IMPLEMENTATION_FEE',
      'INFRASTRUCTURE_FEE', 'SUPPORT_FEE', 'ADDON', 'PROFESSIONAL_SERVICES', 'DISCOUNT',
    ]),
    description: z.string().trim().min(2, 'Obligatorio'),
    quantity: z.coerce.number().min(0.01, 'Debe ser mayor que cero'),
    unit_amount: z.coerce.number().min(0, 'No puede ser negativo'),
    billing_interval: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME']),
    valid_from: z.string().min(1, 'Obligatorio'),
    valid_to: z.string().optional(),
  })
  .refine((v) => v.charge_kind !== 'IMPLEMENTATION_FEE' || v.billing_interval === 'ONE_TIME', {
    // Un fee de implementación recurrente inflaría el MRR para siempre.
    path: ['billing_interval'],
    message: 'Un fee de implementación debe ser «Pago único»',
  });

type ItemValues = z.input<typeof itemSchema>;

const CHARGE_KINDS = [
  { value: 'LICENSE', label: 'Licencia' },
  { value: 'TENANT_LICENSE', label: 'Licencia por tenant' },
  { value: 'PARTNER_BASE_LICENSE', label: 'Licencia base de partner' },
  { value: 'IMPLEMENTATION_FEE', label: 'Fee de implementación' },
  { value: 'INFRASTRUCTURE_FEE', label: 'Fee de infraestructura' },
  { value: 'SUPPORT_FEE', label: 'Fee de soporte / SLA' },
  { value: 'ADDON', label: 'Addon' },
  { value: 'PROFESSIONAL_SERVICES', label: 'Servicios profesionales' },
  { value: 'DISCOUNT', label: 'Descuento' },
];

export function SubscriptionItemDialog({
  open,
  subscriptionId,
  subscriptionCode,
  onClose,
}: {
  open: boolean;
  subscriptionId: string | null;
  subscriptionCode: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const upsert = useUpsertSubscriptionItem();

  const form = useForm<ItemValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      charge_kind: 'LICENSE', description: '', quantity: 1, unit_amount: 0,
      billing_interval: 'MONTHLY', valid_from: new Date().toISOString().slice(0, 10), valid_to: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    upsert.reset();
    form.reset();
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    if (!subscriptionId) return;
    const parsed = itemSchema.parse(values);
    try {
      await upsert.mutateAsync({
        p_subscription_id: subscriptionId,
        p_charge_kind: parsed.charge_kind,
        p_description: parsed.description,
        p_quantity: parsed.quantity,
        p_unit_amount: parsed.unit_amount,
        p_billing_interval: parsed.billing_interval,
        p_valid_from: parsed.valid_from,
        p_valid_to: parsed.valid_to || undefined,
      });
      toast.success('Línea añadida', `${parsed.description} en ${subscriptionCode}`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Nueva línea · ${subscriptionCode}`}
      description="Las líneas ONE_TIME (implementación, servicios) no entran en el MRR: la vista v_subscription_mrr solo cuenta lo recurrente."
      submitLabel="Añadir línea"
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <FieldRow>
        <SelectField label="Tipo de cargo" options={CHARGE_KINDS}
          error={form.formState.errors.charge_kind} {...form.register('charge_kind')} />
        <SelectField label="Periodicidad" options={INTERVALS}
          error={form.formState.errors.billing_interval} {...form.register('billing_interval')} />
      </FieldRow>

      <TextField label="Descripción" required placeholder="Licencia eSupplier mensual"
        error={form.formState.errors.description} {...form.register('description')} />

      <FieldRow>
        <NumberField label="Cantidad" required min={0.01} step="0.01"
          error={form.formState.errors.quantity} {...form.register('quantity')} />
        <NumberField label="Importe unitario" required min={0} step="0.01"
          error={form.formState.errors.unit_amount} {...form.register('unit_amount')} />
      </FieldRow>

      <FieldRow>
        <TextField label="Vigente desde" type="date" required
          error={form.formState.errors.valid_from} {...form.register('valid_from')} />
        <TextField label="Vigente hasta" type="date"
          error={form.formState.errors.valid_to} {...form.register('valid_to')} />
      </FieldRow>
    </FormDialog>
  );
}
