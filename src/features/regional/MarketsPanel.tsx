import { Card, Badge, DataTable, EmptyState, LoadingState, ErrorState } from '@/components/ui/primitives';
import { useMarkets, useProviderAccountRoutes } from '@/services/queries';

/**
 * Mercados y rutas de cobro (V3 · fases 02 y 07). Solo lectura.
 *
 * Un mercado no es un país ni una moneda: dice qué monedas se pueden vender y
 * cuál se sugiere. Una cuenta de cobro atiende UN mercado, cobra ciertas monedas
 * y soporta ciertos métodos; el servidor elige la ruta, la UI no.
 */
export function MarketsPanel() {
  const markets = useMarkets();
  const routes = useProviderAccountRoutes();

  return (
    <div className="space-y-4">
      <Card title="Mercados" description="Monedas admitidas por mercado. La primera es la sugerida al vender.">
        {markets.isLoading ? (
          <LoadingState />
        ) : markets.error ? (
          <ErrorState error={markets.error} onRetry={() => void markets.refetch()} />
        ) : (markets.data ?? []).length === 0 ? (
          <EmptyState title="Sin mercados activos" />
        ) : (
          <DataTable columns={['Mercado', 'País', 'Moneda sugerida', 'Monedas admitidas']}>
            {(markets.data ?? []).map((m) => (
              <tr key={m.id}>
                <td className="ebim-td font-semibold">
                  {m.name} <span className="font-mono text-xs text-muted">({m.code})</span>
                </td>
                <td className="ebim-td">{m.countryCode}</td>
                <td className="ebim-td"><Badge tone="accent">{m.defaultCurrency}</Badge></td>
                <td className="ebim-td">
                  <div className="flex flex-wrap gap-1">
                    {m.allowedCurrencies.map((c) => <Badge key={c} tone="neutral">{c}</Badge>)}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <Card
        title="Rutas de cobro"
        description="Cuentas de cobro por mercado, con las monedas que cobran y los métodos que soportan. Sin secretos."
      >
        {routes.isLoading ? (
          <LoadingState />
        ) : routes.error ? (
          <ErrorState error={routes.error} onRetry={() => void routes.refetch()} />
        ) : (routes.data ?? []).length === 0 ? (
          <EmptyState title="Sin cuentas de cobro visibles" />
        ) : (
          <DataTable columns={['Cuenta', 'Mercado', 'Monedas', 'Métodos', 'Entorno', 'Prioridad']}>
            {(routes.data ?? []).map((r) => (
              <tr key={r.provider_account_id ?? undefined}>
                <td className="ebim-td">
                  <div className="font-semibold">{r.name}</div>
                  <div className="font-mono text-xs text-muted">{r.code} · {r.provider_kind}</div>
                </td>
                <td className="ebim-td">{r.market_code ? <Badge tone="accent">{r.market_code}</Badge> : <Badge tone="warn">Sin mercado</Badge>}</td>
                <td className="ebim-td text-xs">{(r.currencies ?? []).join(', ') || '—'}</td>
                <td className="ebim-td text-xs">{(r.supported_methods ?? []).join(', ') || 'Ninguno'}</td>
                <td className="ebim-td">
                  <Badge tone={r.is_live ? 'danger' : 'info'}>{r.environment}</Badge>
                </td>
                <td className="ebim-td tabular-nums">{r.routing_priority}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}
