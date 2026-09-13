/**
 * Reglas regionales para la UI: mercados, monedas admitidas y tarifa regional.
 *
 * La autoridad es la base (`is_currency_allowed_in_market`, `current_plan_price`,
 * `onboard_customer_subscription`). Estas funciones replican la regla SOLO para
 * que la pantalla no ofrezca lo que la base va a rechazar: si divergen, gana la
 * base y el error se muestra tal cual.
 *
 * Son puras a propósito: se prueban sin red y sin React.
 */

/** Fila de `markets` con sus monedas embebidas, tal como la devuelve PostgREST. */
export interface MarketRow {
  id: string;
  code: string;
  name: string;
  country_code: string;
  default_currency_code: string;
  status: string;
  sort_order: number;
  market_currencies?: Array<{
    currency_code: string;
    status: string;
    currencies?: { status: string; name?: string } | null;
  }> | null;
}

export interface MarketOption {
  id: string;
  code: string;
  name: string;
  countryCode: string;
  defaultCurrency: string;
  /** Monedas admitidas y activas, con la sugerida primero. */
  allowedCurrencies: string[];
}

/** Mercados ACTIVOS con sus monedas admitidas ACTIVAS, en el orden del catálogo. */
export function toMarketOptions(rows: MarketRow[] | null | undefined): MarketOption[] {
  return (rows ?? [])
    .filter((m) => m.status === 'ACTIVE')
    .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code))
    .map((m) => {
      const allowed = (m.market_currencies ?? [])
        .filter((mc) => mc.status === 'ACTIVE' && (mc.currencies?.status ?? 'ACTIVE') === 'ACTIVE')
        .map((mc) => mc.currency_code.trim())
        .sort((a, b) =>
          a === m.default_currency_code ? -1 : b === m.default_currency_code ? 1 : a.localeCompare(b),
        );
      return {
        id: m.id,
        code: m.code,
        name: m.name,
        countryCode: m.country_code.trim(),
        defaultCurrency: m.default_currency_code.trim(),
        allowedCurrencies: allowed,
      };
    });
}

export function findMarket(markets: MarketOption[], marketCode: string | null | undefined) {
  return markets.find((m) => m.code === marketCode) ?? null;
}

export function allowedCurrenciesFor(markets: MarketOption[], marketCode: string | null | undefined): string[] {
  return findMarket(markets, marketCode)?.allowedCurrencies ?? [];
}

export function isCurrencyAllowed(
  markets: MarketOption[],
  marketCode: string | null | undefined,
  currency: string | null | undefined,
): boolean {
  if (!currency) return false;
  return allowedCurrenciesFor(markets, marketCode).includes(currency);
}

/**
 * Moneda que debe quedar seleccionada tras elegir mercado: la actual si el
 * mercado la admite, si no la sugerida. Nunca devuelve una moneda no admitida;
 * sin mercado devuelve cadena vacía (no hay moneda por defecto global).
 */
export function currencyForMarket(
  markets: MarketOption[],
  marketCode: string | null | undefined,
  current: string | null | undefined,
): string {
  const market = findMarket(markets, marketCode);
  if (!market) return '';
  if (current && market.allowedCurrencies.includes(current)) return current;
  return market.allowedCurrencies.includes(market.defaultCurrency)
    ? market.defaultCurrency
    : (market.allowedCurrencies[0] ?? '');
}

/**
 * Mercado sugerido para una organización: el único mercado activo de su país.
 * Si hay cero o varios, no se sugiere nada (misma regla que DV3-005).
 */
export function suggestedMarketForCountry(
  markets: MarketOption[],
  countryCode: string | null | undefined,
): string {
  if (!countryCode) return '';
  const candidates = markets.filter((m) => m.countryCode === countryCode.trim());
  return candidates.length === 1 ? candidates[0].code : '';
}

/** Fila de `v_plan_price_catalog` (o equivalente) necesaria para resolver precio. */
export interface RegionalPriceRow {
  plan_id: string | null;
  market_code: string | null;
  charge_kind: string | null;
  billing_interval: string | null;
  amount: number | string | null;
  currency: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

export interface RegionalPriceQuery {
  planId: string;
  marketCode: string;
  currency: string;
  billingInterval: string;
  /** Tipos de cargo en orden de preferencia (como el `coalesce` de la base). */
  chargeKinds: string[];
  /** Fecha ISO `YYYY-MM-DD`. */
  asOf: string;
}

/**
 * Tarifa vigente de un plan en un mercado y moneda. `null` si no existe.
 * Una tarifa legacy (sin mercado) nunca coincide: igual que `current_plan_price`.
 */
export function resolveRegionalPrice(
  prices: RegionalPriceRow[] | null | undefined,
  q: RegionalPriceQuery,
): number | null {
  if (!q.planId || !q.marketCode || !q.currency) return null;
  for (const kind of q.chargeKinds) {
    const match = (prices ?? [])
      .filter(
        (p) =>
          p.plan_id === q.planId &&
          p.market_code === q.marketCode &&
          p.currency === q.currency &&
          p.billing_interval === q.billingInterval &&
          p.charge_kind === kind &&
          p.valid_from !== null &&
          p.valid_from <= q.asOf &&
          (p.valid_to === null || p.valid_to >= q.asOf),
      )
      .sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)))[0];
    if (match) return Number(match.amount);
  }
  return null;
}

/** ¿Tiene el plan alguna tarifa vigente en ese mercado y moneda? (plan DEMO incluido). */
export function planHasRegionalPrice(
  prices: RegionalPriceRow[] | null | undefined,
  planId: string,
  marketCode: string,
  currency: string,
  asOf: string,
): boolean {
  return (prices ?? []).some(
    (p) =>
      p.plan_id === planId &&
      p.market_code === marketCode &&
      p.currency === currency &&
      p.valid_from !== null &&
      p.valid_from <= asOf &&
      (p.valid_to === null || p.valid_to >= asOf),
  );
}

/** Fila mínima de `currencies` para describir una moneda. */
export interface CurrencyRow {
  code: string;
  name: string;
  symbol: string | null;
  status: string;
}

/**
 * Ayuda legible de una moneda: «Sol peruano · S/». El símbolo se omite cuando
 * lo comparte con otra moneda del catálogo o es un «$» genérico: mostrarlo
 * sugeriría una equivalencia que no existe.
 */
export function currencySymbolHint(currencies: CurrencyRow[], code: string | null | undefined): string | null {
  if (!code) return null;
  const row = currencies.find((c) => c.code.trim() === code);
  if (!row) return code;
  const symbol = row.symbol?.trim() ?? '';
  const ambiguous =
    !symbol ||
    symbol === '$' ||
    currencies.some((c) => c.code.trim() !== code && (c.symbol?.trim() ?? '') === symbol);
  return ambiguous ? row.name : `${row.name} · ${symbol}`;
}
