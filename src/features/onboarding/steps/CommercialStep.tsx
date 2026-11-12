import { TextField, SelectField, NumberField, FieldRow } from '@/components/ui/fields';
import { formatMoney } from '@/lib/format';
import { SOURCES } from '../onboardingForm';
import type { OnboardingWizard } from '../useOnboardingWizard';

/** Paso 4 · Cargos únicos, soporte y atribución comercial. */
export function CommercialStep({ wizard }: { wizard: OnboardingWizard }) {
  const { agents, commissionPlans, form, values, listedImplementationFee } = wizard;
  return (
    <div className="grid gap-4">
      <FieldRow>
        <TextField
          label={`Fee de implementación${values.currency ? ` (${values.currency})` : ''}`}
          type="number" min={0} step="0.01"
          placeholder={listedImplementationFee !== null ? String(listedImplementationFee) : '0'}
          hint={
            listedImplementationFee !== null
              ? `Tarifa ${values.market_code}/${values.currency}: ${formatMoney(listedImplementationFee, values.currency)}. Pago único, misma moneda del contrato.`
              : 'Pago único en la moneda del contrato: no infla el MRR.'
          }
          error={form.formState.errors.implementation_fee}
          {...form.register('implementation_fee')}
        />
        <TextField
          label="Fee de infraestructura" type="number" min={0} step="0.01"
          placeholder="0"
          hint={
            values.deployment_mode === 'SHARED'
              ? 'No aplica a un tenant compartido.'
              : 'Recurrente, porque el costo de la infraestructura lo es.'
          }
          disabled={values.deployment_mode === 'SHARED'}
          error={form.formState.errors.infrastructure_fee}
          {...form.register('infrastructure_fee')}
        />
      </FieldRow>

      <TextField
        label="Fee de soporte / SLA" type="number" min={0} step="0.01" placeholder="0"
        error={form.formState.errors.support_fee} {...form.register('support_fee')}
      />

      <hr className="border-border" />

      <FieldRow>
        <SelectField
          label="Comercial" placeholder="Sin atribución comercial"
          options={(agents.data ?? []).map((a) => ({
            value: a.id, label: `${a.full_name} (${a.code})`,
          }))}
          hint="Atribuir una venta NO da acceso operativo al tenant."
          error={form.formState.errors.sales_agent_id}
          {...form.register('sales_agent_id')}
        />
        <SelectField
          label="Plan de comisión" placeholder="Sin plan (no devenga)"
          options={(commissionPlans.data ?? []).map((p) => ({
            value: p.id, label: p.name,
          }))}
          error={form.formState.errors.commission_plan_id}
          {...form.register('commission_plan_id')}
        />
      </FieldRow>

      <FieldRow>
        <NumberField
          label="Participación del comercial (%)" min={1} max={100} step={1}
          error={form.formState.errors.attribution_pct}
          {...form.register('attribution_pct')}
        />
        <SelectField
          label="Origen de la venta" options={SOURCES}
          error={form.formState.errors.attribution_source}
          {...form.register('attribution_source')}
        />
      </FieldRow>

      <p className="rounded-lg bg-info-soft px-3 py-2 text-compact text-info">
        <strong>Cobranza:</strong> el método de cobro se configura por suscripción en la
        pestaña «Cobranza» del detalle. Hasta entonces la suscripción queda sin perfil, que
        equivale a cobro manual: no se presupone tarjeta.
      </p>
    </div>
  );
}
