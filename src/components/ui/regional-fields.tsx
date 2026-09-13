import { SelectField } from '@/components/ui/fields';
import type { FieldIssue } from '@/components/ui/fields';
import type { MarketOption } from '@/lib/regional';

/**
 * Selectores regionales controlados por catálogo (V3).
 *
 * Sustituyen al textbox libre de moneda: un usuario solo puede elegir un mercado
 * activo y, dentro de él, una moneda que ese mercado admite. La base vuelve a
 * validarlo (MONEDA_NO_PERMITIDA_EN_MERCADO); esto evita ofrecer lo imposible.
 *
 * Se registran con React Hook Form por spread, igual que el resto de campos.
 */

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  error?: FieldIssue;
  className?: string;
  placeholder?: string;
};

export function MarketSelectField({
  markets,
  label = 'Mercado',
  placeholder = 'Elige el mercado…',
  ...props
}: SelectProps & { markets: MarketOption[] }) {
  return (
    <SelectField
      label={label}
      placeholder={placeholder}
      options={markets.map((m) => ({ value: m.code, label: `${m.name} (${m.code})` }))}
      {...props}
    />
  );
}

export function CurrencySelectField({
  currencies,
  suggested,
  label = 'Moneda',
  placeholder,
  ...props
}: SelectProps & {
  /** Monedas admitidas por el mercado elegido. Vacío = aún no hay mercado. */
  currencies: string[];
  /** Moneda sugerida por el mercado: se rotula para que se vea el porqué. */
  suggested?: string | null;
}) {
  return (
    <SelectField
      label={label}
      placeholder={currencies.length === 0 ? (placeholder ?? 'Elige antes el mercado') : placeholder}
      options={currencies.map((c) => ({
        value: c,
        label: c === suggested ? `${c} (sugerida)` : c,
      }))}
      {...props}
      disabled={currencies.length === 0 || props.disabled}
    />
  );
}
