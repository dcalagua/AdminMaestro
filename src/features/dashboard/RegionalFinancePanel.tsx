import { useState } from 'react';
import { Card, StatCard, Badge, DataTable, LoadingState, ErrorState, EmptyState } from '@/components/ui/primitives';
import { SelectField, TextField } from '@/components/ui/fields';
import {
  useFinanceConsolidated, useMarkets, useCurrencies, useProducts, useOrganizations,
} from '@/services/queries';
import { metricDisplay, marginDisplay, formatRateLabel, type DashboardMode } from '@/lib/consolidated';
import { formatDate } from '@/lib/format';
import type { ConsolidatedMetricKey } from '@/types/domain';

/**
 * Finanzas regionales (V3 · fase 13).
 *
 * NATIVO: totales separados por moneda, sin tipo de cambio.
 * CONSOLIDADO: equivalentes en la moneda de reporte con la tasa y su fecha a la
 * vista; si falta una tasa, la cifra afectada se marca incompleta y hay un aviso.
 *
 * Los filtros son del tablero analítico, no de un listado (U-06 rige listados):
 * acotan el mismo cálculo de la base (`finance_consolidated`), no filtran filas
 * ya sumadas en el navegador.
 */

const KPIS: Array<{ key: ConsolidatedMetricKey; label: string }> = [
  { key: 'MRR', label: 'MRR' },
  { key: 'ARR', label: 'ARR' },
  { key: 'COLLECTED', label: 'Cobrado' },
  { key: 'COST', label: 'Costos' },
  { key: 'COMMISSION_PENDING', label: 'Comisión pendiente' },
  { key: 'COMMISSION_PAID', label: 'Comisión pagada' },
];

export function RegionalFinancePanel() {
  const [mode, setMode] = useState<DashboardMode>('NATIVE');
  const [marketCode, setMarketCode] = useState('');
  const [currency, setCurrency] = useState('');
  const [productId, setProductId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));

  const markets = useMarkets();
  const currencies = useCurrencies();
  const products = useProducts();
  const orgs = useOrganizations();

  const filters = { asOf, marketCode, currency, saasProductId: productId, organizationId };
  const total = useFinanceConsolidated({ ...filters, groupBy: 'TOTAL' });
  const byMarket = useFinanceConsolidated({ ...filters, groupBy: 'MARKET' });

  const data = total.data;
  const rc = data?.reporting_currency ?? null;
  const group = data?.groups[0] ?? null;
  const incomplete = mode === 'CONSOLIDATED' && data && !data.completeness.complete;

  return (
    <Card
      title="Finanzas regionales"
      description="Perú, Bolivia y Ecuador. NATIVO separa por moneda; CONSOLIDADO convierte cada total a la moneda de reporte con una tasa explícita."
      actions={
        <div role="tablist" aria-label="Modo del tablero financiero" className="flex gap-1">
          {(['NATIVE', 'CONSOLIDATED'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'ebim-btn-primary' : 'ebim-btn-ghost'}
              onClick={() => setMode(m)}
            >
              {m === 'NATIVE' ? 'Nativo' : 'Consolidado'}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-5">
        <SelectField
          label="Mercado" placeholder="Todos los mercados" value={marketCode}
          onChange={(e) => setMarketCode(e.target.value)}
          options={(markets.data ?? []).map((m) => ({ value: m.code, label: `${m.name} (${m.code})` }))}
        />
        <SelectField
          label="Moneda" placeholder="Todas las monedas" value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          options={(currencies.data ?? []).filter((c) => c.status === 'ACTIVE').map((c) => ({ value: c.code, label: c.code }))}
        />
        <SelectField
          label="Producto SaaS" placeholder="Todos los productos" value={productId}
          onChange={(e) => setProductId(e.target.value)}
          options={(products.data ?? []).map((p) => ({ value: p.id, label: p.short_name }))}
        />
        <SelectField
          label="Organización / partner" placeholder="Todas" value={organizationId}
          onChange={(e) => setOrganizationId(e.target.value)}
          options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.display_name }))}
        />
        <TextField
          label="Fecha de las tasas" type="date" value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          disabled={mode === 'NATIVE'}
          hint={mode === 'NATIVE' ? 'Solo aplica al consolidado' : 'Tasa de cierre a esta fecha'}
        />
      </div>

      {total.isLoading ? (
        <LoadingState label="Calculando el consolidado…" />
      ) : total.error ? (
        <ErrorState error={total.error} onRetry={() => void total.refetch()} />
      ) : (
        <div className="space-y-4 p-4">
          {mode === 'CONSOLIDATED' && data ? (
            <div className="rounded-lg border border-border px-3 py-2 text-xs" data-testid="fx-context">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  Moneda de reporte: <strong>{rc ?? 'sin configurar'}</strong>
                </span>
                <span className="text-muted">
                  · tasas al {formatDate(data.as_of)} (antigüedad máxima {data.fx_max_rate_age_days ?? 0} días)
                </span>
              </div>
              {data.rates_used.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {data.rates_used.map((r) => (
                    <Badge key={`${r.from}-${r.to}-${r.rate_date}`} tone={r.is_demo ? 'warn' : 'info'}>
                      {formatRateLabel(r.from, r.to, Number(r.rate))} · {r.method === 'DIRECT' ? 'directa' : 'recíproca'} · {r.rate_date}
                      {r.is_demo ? ' · DEMO' : ''}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {incomplete ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
              <strong>Consolidado incompleto.</strong> Faltan tipos de cambio para{' '}
              {data!.completeness.missing_currencies.join(', ')} ({data!.completeness.missing_fx_count}). Las cifras
              afectadas se muestran como «Incompleto» y el margen consolidado no se calcula. Publica la tasa en
              «Monedas y FX» o revisa los importes en modo Nativo.
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {KPIS.map((k) => {
              const d = metricDisplay(group, k.key, mode, rc);
              return <StatCard key={k.key} label={k.label} value={d.value} hint={d.hint} tone={d.tone} />;
            })}
            {(() => {
              const d = marginDisplay(group, mode, rc);
              return <StatCard label="Margen bruto" value={d.value} hint={d.hint} tone={d.tone} />;
            })()}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Por mercado</h3>
            {byMarket.isLoading ? (
              <LoadingState />
            ) : (byMarket.data?.groups ?? []).length === 0 ? (
              <EmptyState title="Sin actividad para estos filtros" />
            ) : (
              <DataTable columns={['Mercado', 'MRR', 'Cobrado', 'Costos', 'Comisiones', 'Margen']}>
                {(byMarket.data?.groups ?? []).map((g) => (
                  <tr key={g.key}>
                    <td className="ebim-td font-semibold">
                      {g.label}
                      {mode === 'CONSOLIDATED' && (['MRR', 'COLLECTED', 'COST', 'COMMISSION'] as const).some(
                        (m) => g.metrics[m] && !g.metrics[m]!.complete,
                      ) ? (
                        <span className="ml-2"><Badge tone="warn">FX faltante</Badge></span>
                      ) : null}
                    </td>
                    {(['MRR', 'COLLECTED', 'COST', 'COMMISSION'] as const).map((m) => {
                      const d = metricDisplay(g, m, mode, rc);
                      return (
                        <td key={m} className={`ebim-td tabular-nums ${d.complete ? '' : 'text-warn'}`} title={d.hint}>
                          {d.value}
                        </td>
                      );
                    })}
                    {(() => {
                      const d = marginDisplay(g, mode, rc);
                      return (
                        <td className={`ebim-td tabular-nums font-semibold ${d.tone === 'danger' ? 'text-danger' : d.tone === 'warn' ? 'text-warn' : 'text-ok'}`}>
                          {d.value}
                        </td>
                      );
                    })()}
                  </tr>
                ))}
              </DataTable>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
