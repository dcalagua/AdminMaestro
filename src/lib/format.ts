/**
 * Formateo para la UI. Todo en español (regla de suite: mercado LATAM).
 *
 * No se convierte entre monedas en ningún punto: los agregados vienen agrupados
 * por `currency` desde la base. Un tipo de cambio implícito produce un número
 * que nadie puede auditar (ver docs/finance/COST_MARGIN_MODEL.md). Los
 * equivalentes en moneda de reporte los calcula la base con una tasa explícita
 * (`finance_consolidated`), nunca este archivo.
 */

const LOCALE = 'es-PE';

/**
 * V3 · Importe con su moneda ISO SIEMPRE visible: `PEN 1,250.00`, `BOB 890.00`,
 * `USD 250.00`. No hay moneda por defecto: un importe sin moneda es un dato
 * incompleto y se dice, no se pinta como USD (G-27).
 *
 * Se usa el CÓDIGO y no el símbolo: «$» es a la vez dólar, peso chileno y
 * colombiano, y es-PE pinta PEN como «S/» pero USD como «USD». El símbolo, cuando
 * es inequívoco, lo añade la UI como ayuda (ver `Money`), nunca en lugar del código.
 */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  if (!currency) {
    // Una entidad sin actividad no tiene moneda: su cero no es «USD 0».
    if (amount === 0) return '—';
    return `${formatNumber(amount)} (sin moneda)`;
  }
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Compacta montos grandes para las tarjetas del dashboard (`USD 27.6 K`). */
export function formatMoneyCompact(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  if (!currency || Math.abs(amount) < 10_000) return formatMoney(amount, currency);
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount);
}

/**
 * Suma importes AGRUPANDO por moneda. Es la única forma legítima de totalizar
 * filas multimoneda en pantalla: `PEN 100 + USD 100` no es «200» (R-7).
 * Las filas sin moneda se ignoran en vez de adivinarles una.
 */
export function sumByCurrency<T>(
  rows: readonly T[] | null | undefined,
  amount: (row: T) => number | string | null | undefined,
  currency: (row: T) => string | null | undefined,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows ?? []) {
    const code = currency(row);
    const value = Number(amount(row) ?? 0);
    if (!code || Number.isNaN(value)) continue;
    totals[code] = Math.round(((totals[code] ?? 0) + value) * 100) / 100;
  }
  return totals;
}

/** Resta mapas por moneda (a − b), sin cruzar monedas. */
export function subtractByCurrency(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [code, value] of Object.entries(b)) {
    out[code] = Math.round(((out[code] ?? 0) - value) * 100) / 100;
  }
  return out;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(LOCALE).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(LOCALE, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * Una fecha SIN hora (`2026-09-13`) es un día de calendario, no un instante:
 * `new Date('2026-09-13')` la interpreta como medianoche UTC y en Lima (UTC−5)
 * se pintaba el día anterior. Se construye en hora local.
 */
function parseDateValue(value: string | Date): Date {
  if (value instanceof Date) return value;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  return new Date(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/**
 * Pinta un mapa `{ USD: 1000, PEN: 500 }` como `PEN 500.00 · USD 1,000.00`:
 * una cifra por moneda, en orden alfabético estable, nunca un total mezclado.
 */
export function formatCurrencyMap(map: Record<string, number | string> | null | undefined): string {
  if (!map || Object.keys(map).length === 0) return '—';
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => formatMoneyCompact(Number(amount), currency))
    .join(' · ');
}
