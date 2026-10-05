import { Money } from '@/components/ui/Money';
import { formatDate } from '@/lib/format';
import {
  billingIntervalSuffix, chargeKindLabel, openPrices, splitPrices,
} from './catalogLabels';
import type { PriceRow } from './catalogLabels';

/**
 * Tarifas abiertas de un plan agrupadas por mercado (V3).
 *
 * Una misma moneda puede tener precios distintos en dos mercados (PE/USD ≠
 * EC/USD), así que el mercado se pinta SIEMPRE junto al importe. Una tarifa sin
 * mercado es historia previa a V3 y se rotula como tal: no se usa para vender.
 *
 * Ausencia de precio ≠ gratis (P09): un plan sin tarifa abierta dice «Sin
 * precio definido», nunca «0» ni «Gratis». `kind` separa lo recurrente de los
 * cargos únicos para que no se sumen mentalmente.
 */
export function RegionalPriceList({
  prices,
  kind = 'all',
}: {
  prices: PriceRow[] | null | undefined;
  kind?: 'all' | 'recurring' | 'one-time';
}) {
  const all = openPrices(prices);
  const { recurring, oneTime } = splitPrices(prices);
  const rows = kind === 'recurring' ? recurring : kind === 'one-time' ? oneTime : all;

  if (all.length === 0) {
    return kind === 'one-time' ? (
      <span className="text-compact text-muted">—</span>
    ) : (
      <span className="text-compact font-semibold text-warn">Sin precio definido</span>
    );
  }
  if (rows.length === 0) {
    return (
      <span className="text-compact text-muted">
        {kind === 'one-time' ? 'Sin cargos únicos' : 'Sin precio recurrente definido'}
      </span>
    );
  }

  const marketOf = (pr: PriceRow) => (pr.markets as { code: string } | null)?.code ?? 'LEGACY';

  const sorted = [...rows].sort(
    (a, b) =>
      marketOf(a).localeCompare(marketOf(b)) ||
      String(a.currency).localeCompare(String(b.currency)) ||
      String(a.charge_kind).localeCompare(String(b.charge_kind)),
  );
  const today = new Date().toISOString().slice(0, 10);

  return (
    <ul className="space-y-1">
      {sorted.map((pr) => {
        const market = marketOf(pr);
        const scheduled = String(pr.valid_from) > today;
        return (
          <li key={pr.id as string} className="flex flex-wrap items-baseline gap-x-1 text-compact">
            <span
              className={`rounded px-1 text-caption font-semibold ${
                market === 'LEGACY' ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent-deep'
              }`}
              title={market === 'LEGACY' ? 'Tarifa anterior a V3 sin mercado: no se usa para vender' : `Mercado ${market}`}
            >
              {market === 'LEGACY' ? 'Sin mercado' : market}
            </span>
            <span className="text-muted">{chargeKindLabel(pr.charge_kind as string)}</span>
            {/* Importe y periodicidad no se separan: «/ mes» solo en otra línea se leía suelto. */}
            <span className="whitespace-nowrap">
              <Money className="font-semibold" amount={pr.amount as number} currency={pr.currency as string} />
              <span className="text-muted"> / {billingIntervalSuffix(pr.billing_interval as string)}</span>
            </span>
            {scheduled ? <span className="text-muted">· desde {formatDate(String(pr.valid_from))}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
