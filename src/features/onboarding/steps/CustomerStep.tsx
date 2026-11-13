import { MarketSelectField } from '@/components/ui/regional-fields';
import { SelectField } from '@/components/ui/fields';
import type { OnboardingWizard } from '../useOnboardingWizard';

/** Paso 1 · Cliente, mercado y producto (en «Nuevo tenant», sólo cuenta y app). */
export function CustomerStep({ wizard }: { wizard: OnboardingWizard }) {
  const { products, orgs, marketList, form, market, mode } = wizard;
  return (
    <div className="grid gap-4">
      <SelectField
        label="Organización cliente" required placeholder="Elige el cliente…"
        options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.display_name }))}
        hint="Quien recibe el servicio. Puede facturarse a ella o al canal según el acuerdo."
        error={form.formState.errors.customer_organization_id}
        {...form.register('customer_organization_id')}
      />
      {mode === 'APP' ? null : (
      <MarketSelectField
        markets={marketList} required label="País / mercado de la venta"
        hint={
          market
            ? `Moneda sugerida: ${market.defaultCurrency}. Admitidas: ${market.allowedCurrencies.join(', ')}.`
            : 'Se sugiere por el país del cliente. Decide la tarifa y las monedas admitidas.'
        }
        error={form.formState.errors.market_code}
        {...form.register('market_code')}
      />
      )}
      <SelectField
        label="Producto SaaS" required placeholder="Elige el producto…"
        options={(products.data ?? [])
          .filter((p) => p.status === 'ACTIVE')
          .map((p) => ({ value: p.code, label: `${p.short_name} (${p.code})` }))}
        error={form.formState.errors.saas_product_code}
        {...form.register('saas_product_code')}
      />
    </div>
  );
}
