import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, SelectField, NumberField, CheckboxField, TextAreaField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useProducts, useMarkets } from '@/services/queries';
import { useUpsertPlan, useSetPlanPrice } from '@/services/mutations';
import { MarketSelectField, CurrencySelectField } from '@/components/ui/regional-fields';
import { allowedCurrenciesFor, currencyForMarket, findMarket } from '@/lib/regional';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/* ==========================================================================
   Plan
   ========================================================================== */

const planSchema = z
  .object({
    code: z.string().trim().regex(SLUG, 'Minúsculas y guiones (ej. esupplier-shared-standard)'),
    name: z.string().trim().min(2, 'Obligatorio'),
    saas_product_id: z.string().uuid('Elige el producto'),
    deployment_mode: z.enum(['', 'SHARED', 'PARTNER_DEDICATED', 'TENANT_DEDICATED']),
    included_companies: z.coerce.number().int().min(1, 'Mínimo 1'),
    multi_country: z.boolean(),
    is_partner_base: z.boolean(),
    description: z.string().trim().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED']),
    sort_order: z.coerce.number().int().min(0),
  })
  .refine((v) => !v.is_partner_base || v.deployment_mode === 'PARTNER_DEDICATED', {
    // Una licencia base describe el contrato del CANAL, no el de un tenant.
    path: ['is_partner_base'],
    message: 'La licencia base de partner solo aplica al modelo Dedicado partner',
  });

type PlanValues = z.input<typeof planSchema>;

export interface PlanDraft {
  id: string;
  code: string;
  name: string;
  saas_product_id: string;
  deployment_mode: string | null;
  included_companies: number;
  multi_country: boolean;
  is_partner_base: boolean;
  description: string | null;
  status: string;
  sort_order: number;
}

const MODES = [
  { value: '', label: 'Cualquiera' },
  { value: 'SHARED', label: 'Compartido' },
  { value: 'PARTNER_DEDICATED', label: 'Dedicado partner' },
  { value: 'TENANT_DEDICATED', label: 'Dedicado cliente' },
];

const STATUSES = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'INACTIVE', label: 'Inactivo' },
  { value: 'ARCHIVED', label: 'Archivado' },
];

export function PlanFormDialog({
  open,
  plan,
  onClose,
}: {
  open: boolean;
  plan?: PlanDraft | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const products = useProducts();
  const upsert = useUpsertPlan();
  const isEdit = Boolean(plan);

  const form = useForm<PlanValues>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      code: '', name: '', saas_product_id: '', deployment_mode: 'SHARED',
      included_companies: 1, multi_country: false, is_partner_base: false,
      description: '', status: 'ACTIVE', sort_order: 100,
    },
  });

  useEffect(() => {
    if (!open) return;
    upsert.reset();
    form.reset({
      code: plan?.code ?? '',
      name: plan?.name ?? '',
      saas_product_id: plan?.saas_product_id ?? '',
      deployment_mode: (plan?.deployment_mode as PlanValues['deployment_mode']) ?? 'SHARED',
      included_companies: plan?.included_companies ?? 1,
      multi_country: plan?.multi_country ?? false,
      is_partner_base: plan?.is_partner_base ?? false,
      description: plan?.description ?? '',
      status: (plan?.status as PlanValues['status']) ?? 'ACTIVE',
      sort_order: plan?.sort_order ?? 100,
    });
  }, [open, plan]);

  const submit = form.handleSubmit(async (values) => {
    const parsed = planSchema.parse(values);
    try {
      await upsert.mutateAsync({
        p_id: plan?.id,
        p_code: parsed.code,
        p_name: parsed.name,
        p_saas_product_id: parsed.saas_product_id,
        p_deployment_mode: parsed.deployment_mode || undefined,
        p_included_companies: parsed.included_companies,
        p_multi_country: parsed.multi_country,
        p_is_partner_base: parsed.is_partner_base,
        p_description: parsed.description || undefined,
        p_status: parsed.status,
        p_sort_order: parsed.sort_order,
      });
      toast.success(isEdit ? 'Plan actualizado' : 'Plan creado', parsed.name);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={isEdit ? `Editar ${plan?.name}` : 'Nuevo plan'}
      description="El plan define QUÉ se licencia. Cuánto cuesta se fija aparte, con vigencia, desde «Fijar precio»."
      submitLabel={isEdit ? 'Guardar cambios' : 'Crear plan'}
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <FieldRow>
        <TextField label="Nombre" required placeholder="eSupplier Shared Standard"
          error={form.formState.errors.name} {...form.register('name')} />
        <TextField label="Código" required placeholder="esupplier-shared-standard"
          error={form.formState.errors.code} {...form.register('code')} />
      </FieldRow>

      <FieldRow>
        <SelectField label="Producto" required placeholder="Elige el producto…"
          options={(products.data ?? []).map((p) => ({ value: p.id, label: p.short_name }))}
          error={form.formState.errors.saas_product_id} {...form.register('saas_product_id')} />
        <SelectField label="Modelo de despliegue" options={MODES}
          error={form.formState.errors.deployment_mode} {...form.register('deployment_mode')} />
      </FieldRow>

      <TextAreaField label="Descripción" error={form.formState.errors.description}
        {...form.register('description')} />

      <FieldRow>
        <NumberField label="Sociedades incluidas" required min={1} step={1}
          hint="Nombre canónico del contrato §11.1: included_companies."
          error={form.formState.errors.included_companies} {...form.register('included_companies')} />
        <NumberField label="Orden" min={0} step={1}
          error={form.formState.errors.sort_order} {...form.register('sort_order')} />
      </FieldRow>

      <CheckboxField label="Multi-país" hint="Habilita operación en varios países."
        {...form.register('multi_country')} />

      <CheckboxField label="Licencia base de partner"
        hint="Solo para Dedicado partner: es la licencia del canal, no la de un tenant."
        {...form.register('is_partner_base')} />
      {form.formState.errors.is_partner_base ? (
        <p className="-mt-2 text-xs text-danger" role="alert">
          {form.formState.errors.is_partner_base.message}
        </p>
      ) : null}

      <SelectField label="Estado" options={STATUSES}
        error={form.formState.errors.status} {...form.register('status')} />
    </FormDialog>
  );
}

/* ==========================================================================
   Precio del plan (versionado)
   ========================================================================== */

const priceSchema = z.object({
  charge_kind: z.enum([
    'LICENSE', 'PARTNER_BASE_LICENSE', 'TENANT_LICENSE', 'IMPLEMENTATION_FEE',
    'INFRASTRUCTURE_FEE', 'SUPPORT_FEE', 'ADDON', 'PROFESSIONAL_SERVICES', 'DISCOUNT',
  ]),
  billing_interval: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME']),
  amount: z.coerce.number().min(0, 'No puede ser negativo'),
  // V3: la tarifa pertenece a un mercado y su moneda sale del catálogo, no de un textbox.
  market_code: z.string().min(1, 'Elige el mercado'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Elige la moneda'),
  valid_from: z.string().min(1, 'Obligatorio'),
});

type PriceValues = z.input<typeof priceSchema>;

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

const INTERVALS = [
  { value: 'MONTHLY', label: 'Mensual' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'YEARLY', label: 'Anual' },
  { value: 'ONE_TIME', label: 'Pago único' },
];

export function PlanPriceDialog({
  open,
  planId,
  planName,
  onClose,
}: {
  open: boolean;
  planId: string | null;
  planName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const setPrice = useSetPlanPrice();
  const markets = useMarkets();
  const marketList = markets.data ?? [];

  const form = useForm<PriceValues>({
    resolver: zodResolver(priceSchema),
    defaultValues: {
      charge_kind: 'LICENSE', billing_interval: 'MONTHLY', amount: 0, market_code: '', currency: '',
      valid_from: new Date().toISOString().slice(0, 10),
    },
  });

  useEffect(() => {
    if (!open) return;
    setPrice.reset();
    form.reset();
  }, [open]);

  // Al cambiar de mercado, la moneda se ajusta a una que ese mercado admita.
  const marketCode = form.watch('market_code');
  const currency = form.watch('currency');
  useEffect(() => {
    const next = currencyForMarket(marketList, marketCode, currency);
    if (next !== currency) form.setValue('currency', next, { shouldValidate: Boolean(marketCode) });
  }, [marketCode, marketList]);

  const submit = form.handleSubmit(async (values) => {
    if (!planId) return;
    const parsed = priceSchema.parse(values);
    try {
      await setPrice.mutateAsync({
        p_plan_id: planId,
        p_charge_kind: parsed.charge_kind,
        p_billing_interval: parsed.billing_interval,
        p_amount: parsed.amount,
        p_market_code: parsed.market_code,
        p_currency: parsed.currency,
        p_valid_from: parsed.valid_from,
      });
      toast.success(
        'Tarifa versionada',
        `${planName} · ${parsed.market_code}/${parsed.currency}: la anterior queda cerrada, no borrada.`,
      );
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Fijar precio · ${planName}`}
      description="La tarifa es de UN mercado: Perú y Ecuador pueden tener precios distintos aunque ambos cobren en USD. Se cierra la vigente de esa combinación y se abre una nueva; una tarifa histórica nunca se edita."
      submitLabel="Versionar tarifa"
      busy={setPrice.isPending}
      error={setPrice.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <FieldRow>
        <SelectField label="Tipo de cargo" options={CHARGE_KINDS}
          error={form.formState.errors.charge_kind} {...form.register('charge_kind')} />
        <SelectField label="Periodicidad" options={INTERVALS}
          hint="Los fees de implementación deben ser «Pago único»."
          error={form.formState.errors.billing_interval} {...form.register('billing_interval')} />
      </FieldRow>

      <FieldRow>
        <MarketSelectField markets={marketList} required
          hint="Solo mercados activos del catálogo regional."
          error={form.formState.errors.market_code} {...form.register('market_code')} />
        <CurrencySelectField required
          currencies={allowedCurrenciesFor(marketList, marketCode)}
          suggested={findMarket(marketList, marketCode)?.defaultCurrency}
          hint="Solo monedas que el mercado admite."
          error={form.formState.errors.currency} {...form.register('currency')} />
      </FieldRow>

      <NumberField label="Importe" required min={0} step="0.01"
        hint={currency ? `En ${currency}. No se convierte desde otra moneda.` : undefined}
        error={form.formState.errors.amount} {...form.register('amount')} />

      <TextField label="Vigente desde" type="date" required
        hint="Debe ser posterior al inicio de la tarifa que sustituye."
        error={form.formState.errors.valid_from} {...form.register('valid_from')} />
    </FormDialog>
  );
}
