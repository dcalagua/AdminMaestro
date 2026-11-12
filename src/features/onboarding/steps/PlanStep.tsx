import { CurrencySelectField } from '@/components/ui/regional-fields';
import { allowedCurrenciesFor } from '@/lib/regional';
import { TextField, SelectField, NumberField, FieldRow } from '@/components/ui/fields';
import { formatMoney } from '@/lib/format';
import { INTERVALS } from '../onboardingForm';
import type { OnboardingWizard } from '../useOnboardingWizard';

/** Paso 3 · Plan, periodicidad, moneda y licencia. */
export function PlanStep({ wizard }: { wizard: OnboardingWizard }) {
  const {
    marketList, form, values, plan, market, planOptions, listedPrice, isDemo, isRecurringSale,
    regionalPriceMissing,
  } = wizard;
  return (
    <div className="grid gap-4">
      <SelectField
        label="Plan" required placeholder="Elige el plan…" options={planOptions}
        hint={
          planOptions.length === 0
            ? 'No hay planes para ese producto y modelo. Créalo primero en el catálogo.'
            : 'Solo se listan planes del producto y modelo elegidos.'
        }
        error={form.formState.errors.plan_id} {...form.register('plan_id')}
      />

      <FieldRow>
        <SelectField
          label="Periodicidad" options={INTERVALS}
          error={form.formState.errors.billing_interval}
          {...form.register('billing_interval')}
        />
        <CurrencySelectField
          required
          currencies={allowedCurrenciesFor(marketList, values.market_code)}
          suggested={market?.defaultCurrency}
          hint={`Moneda contractual en ${market?.name ?? 'el mercado'}: licencia, fees, facturas y cobros la heredan.`}
          error={form.formState.errors.currency} {...form.register('currency')}
        />
      </FieldRow>

      <FieldRow>
        <NumberField
          label="Cantidad" required min={1} step={1}
          error={form.formState.errors.quantity} {...form.register('quantity')}
        />
        <TextField
          label="Inicio" type="date" required
          error={form.formState.errors.started_on} {...form.register('started_on')}
        />
      </FieldRow>

      <TextField
        label="Importe de la licencia" type="number" min={0} step="0.01"
        placeholder={listedPrice !== null ? String(listedPrice) : 'Sin tarifa regional'}
        disabled={listedPrice === null}
        hint={
          listedPrice !== null
            ? `Tarifa ${values.market_code}/${values.currency}: ${formatMoney(listedPrice, values.currency)}. Vacío = tarifa; un importe = precio negociado sobre esa tarifa.`
            : isRecurringSale
              ? 'Sin tarifa regional no se puede fijar un importe: la base no crea contratos sin tarifa.'
              : 'Una venta sin recurrente no usa licencia.'
        }
        error={form.formState.errors.license_amount}
        {...form.register('license_amount')}
      />

      {regionalPriceMissing ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-compact text-warn" role="alert">
          {plan?.name} no tiene tarifa vigente en {values.market_code}/{values.currency} (
          {values.billing_interval}). No se puede continuar: la base rechazaría la venta con
          TARIFA_REGIONAL_NO_DEFINIDA.
        </p>
      ) : null}

      {isDemo ? (
        <p className="rounded-lg bg-info-soft px-3 py-2 text-compact text-info">
          El tenant es DEMO: no se creará ninguna línea de licencia recurrente. Solo se
          generará contrato si añades cargos únicos en el paso siguiente.
        </p>
      ) : null}
    </div>
  );
}
