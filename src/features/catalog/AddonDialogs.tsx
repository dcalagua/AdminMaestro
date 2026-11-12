import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, SelectField, NumberField, TextAreaField, FieldRow } from '@/components/ui/fields';
import { MarketSelectField, CurrencySelectField } from '@/components/ui/regional-fields';
import { useToast } from '@/components/ui/toast-context';
import { useMarkets } from '@/services/queries';
import { useSetCatalogItemLifecycle, useSetCatalogItemPrice } from '@/services/mutations';
import { allowedCurrenciesFor, currencyForMarket, findMarket } from '@/lib/regional';
import { LIFECYCLE_STATUS_LABEL, lifecycleStatusLabel } from './catalogLabels';

export interface AddonRef {
  code: string;
  name: string;
  lifecycle_status?: string | null;
}

/* ==========================================================================
   Tarifa del add-on (versionada, por mercado) — finanzas
   ========================================================================== */

const priceSchema = z.object({
  // La base sólo admite estos cargos para un add-on (CARGO_INVALIDO).
  charge_kind: z.enum(['ADDON', 'IMPLEMENTATION_FEE', 'USAGE_OVERAGE']),
  billing_interval: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME']),
  amount: z.coerce.number().min(0, 'No puede ser negativo'),
  market_code: z.string().min(1, 'Elige el mercado'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Elige la moneda'),
  valid_from: z.string().min(1, 'Obligatorio'),
});

type PriceValues = z.input<typeof priceSchema>;

const CHARGE_KINDS = [
  { value: 'ADDON', label: 'Add-on' },
  { value: 'IMPLEMENTATION_FEE', label: 'Fee de implementación' },
  { value: 'USAGE_OVERAGE', label: 'Exceso de uso' },
];

const INTERVALS = [
  { value: 'MONTHLY', label: 'Mensual' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'YEARLY', label: 'Anual' },
  { value: 'ONE_TIME', label: 'Pago único' },
];

export function AddonPriceDialog({
  open,
  addon,
  onClose,
}: {
  open: boolean;
  addon: AddonRef | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const setPrice = useSetCatalogItemPrice();
  const markets = useMarkets();
  const marketList = markets.data ?? [];

  const form = useForm<PriceValues>({
    resolver: zodResolver(priceSchema),
    defaultValues: {
      charge_kind: 'ADDON', billing_interval: 'MONTHLY', amount: '', market_code: '', currency: '',
      valid_from: new Date().toISOString().slice(0, 10),
    },
  });

  useEffect(() => {
    if (!open) return;
    setPrice.reset();
    form.reset();
  }, [open]);

  const marketCode = form.watch('market_code');
  const currency = form.watch('currency');
  useEffect(() => {
    const next = currencyForMarket(marketList, marketCode, currency);
    if (next !== currency) form.setValue('currency', next, { shouldValidate: Boolean(marketCode) });
  }, [marketCode, marketList]);

  const submit = form.handleSubmit(async (values) => {
    if (!addon) return;
    const parsed = priceSchema.parse(values);
    try {
      await setPrice.mutateAsync({
        p_catalog_item_code: addon.code,
        p_market_code: parsed.market_code,
        p_charge_kind: parsed.charge_kind,
        p_billing_interval: parsed.billing_interval,
        p_amount: parsed.amount,
        p_currency: parsed.currency,
        p_valid_from: parsed.valid_from,
      });
      toast.success(
        'Tarifa registrada',
        `${addon.name} · ${parsed.market_code}/${parsed.currency}: la anterior queda cerrada, no borrada.`,
      );
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Nueva tarifa · ${addon?.name ?? ''}`}
      description="La tarifa es de UN mercado y una moneda. Se cierra la vigente de esa combinación y se abre una nueva; una tarifa histórica nunca se edita."
      submitLabel="Registrar tarifa"
      busy={setPrice.isPending}
      error={setPrice.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <FieldRow>
        <SelectField label="Tipo de cargo" options={CHARGE_KINDS}
          error={form.formState.errors.charge_kind} {...form.register('charge_kind')} />
        <SelectField label="Periodicidad" options={INTERVALS}
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
        hint="No puede ser anterior al inicio de la tarifa que sustituye."
        error={form.formState.errors.valid_from} {...form.register('valid_from')} />
    </FormDialog>
  );
}

/* ==========================================================================
   Ciclo de vida del add-on — producto, con motivo obligatorio
   ========================================================================== */

const lifecycleSchema = z.object({
  status: z.enum(['DRAFT', 'AVAILABLE', 'COMING_SOON', 'RETIRED']),
  reason: z.string().trim().min(3, 'El motivo es obligatorio'),
});

type LifecycleValues = z.input<typeof lifecycleSchema>;

const LIFECYCLE_OPTIONS = Object.entries(LIFECYCLE_STATUS_LABEL).map(([value, label]) => ({ value, label }));

export function AddonLifecycleDialog({
  open,
  addon,
  onClose,
}: {
  open: boolean;
  addon: AddonRef | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const setLifecycle = useSetCatalogItemLifecycle();

  const form = useForm<LifecycleValues>({
    resolver: zodResolver(lifecycleSchema),
    defaultValues: { status: 'AVAILABLE', reason: '' },
  });

  useEffect(() => {
    if (!open) return;
    setLifecycle.reset();
    form.reset({
      status: (addon?.lifecycle_status as LifecycleValues['status'] | undefined) ?? 'AVAILABLE',
      reason: '',
    });
  }, [open, addon]);

  const submit = form.handleSubmit(async (values) => {
    if (!addon) return;
    const parsed = lifecycleSchema.parse(values);
    try {
      await setLifecycle.mutateAsync({ p_code: addon.code, p_status: parsed.status, p_reason: parsed.reason });
      toast.success('Ciclo de vida actualizado', `${addon.name}: ${lifecycleStatusLabel(parsed.status)}`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Ciclo de vida · ${addon?.name ?? ''}`}
      description="Sólo los add-ons «Disponible» se pueden solicitar o aprobar. Retirar un add-on no da de baja a los tenants que ya lo tienen. El motivo queda en auditoría."
      submitLabel="Cambiar ciclo de vida"
      busy={setLifecycle.isPending}
      error={setLifecycle.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField label="Nuevo estado" options={LIFECYCLE_OPTIONS}
        error={form.formState.errors.status} {...form.register('status')} />
      <TextAreaField label="Motivo" required
        error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}
