import { formatMoney } from '@/lib/format';

/**
 * Tarifas abiertas de un plan agrupadas por mercado (V3).
 *
 * Una misma moneda puede tener precios distintos en dos mercados (PE/USD ≠
 * EC/USD), así que el mercado se pinta SIEMPRE junto al importe. Una tarifa sin
 * mercado es historia previa a V3 y se rotula como tal: no se usa para vender.
 */
export function RegionalPriceList({ prices }: { prices: Array<Record<string, unknown>> | null | undefined }) {
  const open = (prices ?? []).filter((pr) => !pr.valid_to);
  if (open.length === 0) return <span className="text-xs text-muted">Sin precios</span>;

  const marketOf = (pr: Record<string, unknown>) =>
    (pr.markets as { code: string } | null)?.code ?? 'LEGACY';

  const sorted = [...open].sort(
    (a, b) =>
      marketOf(a).localeCompare(marketOf(b)) ||
      String(a.currency).localeCompare(String(b.currency)) ||
      String(a.charge_kind).localeCompare(String(b.charge_kind)),
  );

  return (
    <div className="space-y-0.5">
      {sorted.map((pr) => {
        const market = marketOf(pr);
        const scheduled = String(pr.valid_from) > new Date().toISOString().slice(0, 10);
        return (
          <div key={pr.id as string} className="whitespace-nowrap text-xs">
            <span
              className={`mr-1 rounded px-1 font-mono text-[11px] font-semibold ${
                market === 'LEGACY' ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent-deep'
              }`}
              title={market === 'LEGACY' ? 'Tarifa anterior a V3 sin mercado: no se usa para vender' : `Mercado ${market}`}
            >
              {market === 'LEGACY' ? 'Sin mercado' : market}
            </span>
            <span className="text-muted">{pr.charge_kind as string}</span>{' '}
            <span className="font-semibold tabular-nums">
              {formatMoney(Number(pr.amount), pr.currency as string)}
            </span>
            <span className="text-muted"> / {pr.billing_interval as string}</span>
            {scheduled ? <span className="text-muted"> · desde {String(pr.valid_from)}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
