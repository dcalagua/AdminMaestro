import { Money } from '@/components/ui/Money';
import { formatDate } from '@/lib/format';
import type { Database } from '@/types/database.types';
import { billingIntervalSuffix, chargeKindLabel } from './catalogLabels';

export type CatalogItemPriceRow = Database['platform']['Views']['v_catalog_item_current_prices']['Row'];

/**
 * Tarifas de UN add-on por mercado (CCP fase 07). Espeja `RegionalPriceList`:
 *
 *  · el mercado se pinta SIEMPRE junto al importe (PE/USD ≠ EC/USD);
 *  · sólo cuentan la tarifa vigente y la programada; la historia no vende;
 *  · una tarifa programada se marca «desde <fecha>»;
 *  · ausencia de tarifa ≠ gratis: dice «Sin precio definido», nunca «0».
 *
 * La vista es `security_invoker`: si RLS no deja ver tarifas, llegan cero filas
 * y se lee lo mismo que sin tarifa. Un importe nulo tampoco se pinta como 0.
 */
export function AddonPriceList({ prices }: { prices: CatalogItemPriceRow[] | null | undefined }) {
  const open = (prices ?? []).filter(
    (pr) => (pr.is_current || pr.is_scheduled) && pr.amount !== null && pr.amount !== undefined,
  );

  if (open.length === 0) {
    return <span className="text-compact font-semibold text-warn">Sin precio definido</span>;
  }

  const sorted = [...open].sort(
    (a, b) =>
      String(a.market_code ?? '').localeCompare(String(b.market_code ?? '')) ||
      String(a.currency ?? '').localeCompare(String(b.currency ?? '')) ||
      String(a.charge_kind ?? '').localeCompare(String(b.charge_kind ?? '')) ||
      String(a.valid_from ?? '').localeCompare(String(b.valid_from ?? '')),
  );

  return (
    <ul className="space-y-1">
      {sorted.map((pr) => (
        <li
          key={pr.price_id ?? `${pr.market_code}-${pr.charge_kind}-${pr.valid_from}`}
          className="flex flex-wrap items-baseline gap-x-1 text-compact"
        >
          <span
            className="rounded bg-accent-soft px-1 text-caption font-semibold text-accent-deep"
            title={pr.market_name ? `Mercado ${pr.market_name}` : undefined}
          >
            {pr.market_code ?? 'Sin mercado'}
          </span>
          <span className="text-muted">{chargeKindLabel(pr.charge_kind)}</span>
          <Money className="font-semibold" amount={pr.amount} currency={pr.currency} />
          <span className="text-muted">/ {billingIntervalSuffix(pr.billing_interval)}</span>
          {pr.is_scheduled && !pr.is_current ? (
            <span className="text-muted">· desde {formatDate(pr.valid_from)}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
