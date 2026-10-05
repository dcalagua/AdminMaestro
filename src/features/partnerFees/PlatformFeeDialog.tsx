import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCurrencies } from '@/services/queries';
import { useSetAgreementPlatformFee } from '@/services/mutations';
import { FormDialog } from '@/components/ui/FormDialog';
import { FieldRow, NumberField, SelectField, TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { FEE_MODEL_LABEL, feeTermsText, type FeeModel, type FeeTerms } from './feeLabels';

/**
 * «Tarifa de plataforma» de un acuerdo (spec §4.1): lo que el partner le paga a
 * EBIM por usar la plataforma cuando ÉL factura al cliente final.
 *
 * Es una acción aparte del formulario del acuerdo a propósito: el acuerdo lo
 * edita producto (EBIM_PRODUCT_ADMIN) y la tarifa la decide finanzas, con su
 * propia RPC (`set_agreement_platform_fee`) y motivo. La base es la autoridad:
 * si el acuerdo lo factura EBIM, solo admite «Sin tarifa».
 */
export interface PlatformFeeTarget extends FeeTerms {
  agreementId: string;
  productName: string;
  partnerName: string;
  billingResponsibility: string;
}

const MODELS: FeeModel[] = ['NONE', 'PERCENT_OF_LIST', 'FIXED_PER_TENANT', 'PERCENT_PLUS_FIXED'];
const hasPercent = (m: string) => m === 'PERCENT_OF_LIST' || m === 'PERCENT_PLUS_FIXED';
const hasFixed = (m: string) => m === 'FIXED_PER_TENANT' || m === 'PERCENT_PLUS_FIXED';

const schema = z
  .object({
    model: z.enum(['NONE', 'PERCENT_OF_LIST', 'FIXED_PER_TENANT', 'PERCENT_PLUS_FIXED']),
    percent: z.string().trim(),
    fixed: z.string().trim(),
    currency: z.string(),
    reason: z.string().trim().min(3, 'El motivo es obligatorio'),
  })
  .superRefine((v, ctx) => {
    if (hasPercent(v.model)) {
      const p = Number(v.percent);
      if (v.percent === '' || Number.isNaN(p) || p <= 0 || p > 100) {
        ctx.addIssue({ code: 'custom', path: ['percent'], message: 'Porcentaje entre 0 (excluido) y 100' });
      }
    }
    if (hasFixed(v.model)) {
      const f = Number(v.fixed);
      if (v.fixed === '' || Number.isNaN(f) || f <= 0) {
        ctx.addIssue({ code: 'custom', path: ['fixed'], message: 'El fijo por tenant debe ser mayor que 0' });
      }
      if (!v.currency) ctx.addIssue({ code: 'custom', path: ['currency'], message: 'Elige la moneda del fijo' });
    }
  });
type Values = z.input<typeof schema>;

export function PlatformFeeDialog({ target, onClose }: { target: PlatformFeeTarget | null; onClose: () => void }) {
  const toast = useToast();
  const setFee = useSetAgreementPlatformFee();
  const currencies = useCurrencies();
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const ebimBills = target?.billingResponsibility === 'EBIM';

  useEffect(() => {
    if (!target) return;
    setFee.reset();
    form.reset({
      model: (target.platform_fee_model as FeeModel) ?? 'NONE',
      percent: target.platform_fee_rate !== null ? String(Math.round(Number(target.platform_fee_rate) * 10000) / 100) : '',
      fixed: target.platform_fee_fixed_amount !== null ? String(target.platform_fee_fixed_amount) : '',
      currency: target.platform_fee_currency ?? '',
      reason: '',
    });
  }, [target]);

  const model = form.watch('model');

  const submit = form.handleSubmit(async (values) => {
    if (!target) return;
    const v = schema.parse(values);
    try {
      await setFee.mutateAsync({
        p_agreement_id: target.agreementId,
        p_model: v.model,
        p_rate: hasPercent(v.model) ? Math.round(Number(v.percent) * 100) / 10000 : undefined,
        p_fixed_amount: hasFixed(v.model) ? Number(v.fixed) : undefined,
        p_currency: hasFixed(v.model) ? v.currency : undefined,
        p_reason: v.reason,
      });
      toast.success('Tarifa de plataforma actualizada', `${target.partnerName} · ${target.productName}`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={Boolean(target)}
      wide
      title={`Tarifa de plataforma · ${target?.productName ?? ''}`}
      description={`Lo que ${target?.partnerName ?? 'el partner'} paga a EBIM cada mes por usar la plataforma con sus clientes. Vigente: ${feeTermsText(target)}. Se cobra con el estado de cuenta mensual (Finanzas → Tarifas de partners); no es una comisión.`}
      submitLabel="Guardar tarifa"
      busy={setFee.isPending}
      error={setFee.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      {ebimBills ? (
        <p role="note" className="rounded-lg border border-warn bg-warn-soft px-3 py-2 text-sm text-fg">
          Este acuerdo lo factura <strong>EBIM</strong> al cliente final: el partner no le debe una tarifa a EBIM. Solo se
          admite «Sin tarifa». Para cobrarle una tarifa, el acuerdo debe pasar a facturación del partner.
        </p>
      ) : null}
      <SelectField label="Modelo" required
        options={(ebimBills ? (['NONE'] as FeeModel[]) : MODELS).map((m) => ({ value: m, label: FEE_MODEL_LABEL[m] }))}
        error={form.formState.errors.model} {...form.register('model')} />
      <FieldRow>
        {hasPercent(model) ? (
          <NumberField label="Porcentaje sobre la base mensual (%)" required step="any"
            hint="Base: licencias y add-ons recurrentes de los tenants activos, mensualizados."
            error={form.formState.errors.percent} {...form.register('percent')} />
        ) : null}
        {hasFixed(model) ? (
          <NumberField label="Fijo por tenant activo" required min={0} step="any"
            error={form.formState.errors.fixed} {...form.register('fixed')} />
        ) : null}
        {hasFixed(model) ? (
          <SelectField label="Moneda del fijo" required placeholder="Elige…"
            options={(currencies.data ?? []).map((c) => ({ value: c.code, label: c.code }))}
            error={form.formState.errors.currency} {...form.register('currency')} />
        ) : null}
      </FieldRow>
      <TextAreaField label="Motivo" required hint="Queda en la auditoría del acuerdo."
        error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}
