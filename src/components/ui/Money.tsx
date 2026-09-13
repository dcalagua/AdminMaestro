import { useCurrencies } from '@/services/queries';
import { formatMoney } from '@/lib/format';
import { currencySymbolHint } from '@/lib/regional';

/**
 * Importe con su moneda (V3). Siempre `CÓDIGO importe` (`PEN 1,250.00`); el
 * nombre y el símbolo se ofrecen como ayuda al pasar el cursor, y el símbolo
 * solo cuando no es ambiguo («$» es dólar, peso chileno y peso colombiano).
 */
export function Money({
  amount,
  currency,
  className = '',
}: {
  amount: number | string | null | undefined;
  currency: string | null | undefined;
  className?: string;
}) {
  const currencies = useCurrencies();
  const value = amount === null || amount === undefined || amount === '' ? null : Number(amount);
  const hint = currencySymbolHint(currencies.data ?? [], currency);

  return (
    <span className={`whitespace-nowrap tabular-nums ${className}`} title={hint ?? undefined}>
      {formatMoney(value, currency)}
    </span>
  );
}
