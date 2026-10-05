import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useExecutiveAging, useFinanceConsolidated } from '@/services/queries';
import { KpiTile } from '@/components/ui/primitives';
import { agingSummary } from './executiveModel';
import { useReceivablesAging } from '@/services/financeRead';
import { fromQuery } from '@/features/executive/dataState';
import type { ReportContext } from '@/features/executive/reportContext';
import { AGING_BUCKETS } from '@/features/executive/kpis';
import { ChartPanel, CurrencyPicker } from '@/features/executive/components/ChartPanel';
import { SingleBars, ComponentBars, type BarDatum, type ComponentDatum } from '@/features/executive/components/charts';
import { StateMessage } from '@/features/executive/components/StateView';
import { formatCompactAmount, formatMoney, formatNumber } from '@/lib/format';
import { formatRateLabel } from '@/lib/consolidated';
import { RegionalFinancePanel } from './RegionalFinancePanel';
import { periodLabel } from './executiveData';

/**
 * Perspectiva FINANZAS (spec §7.2): antigüedad de cartera (G03), cobrado/costo/
 * comisión por SaaS (G04), cartera y contribución por partner (G05) y cobertura
 * FX. «Foto actual» y «movimiento del período» se rotulan por separado.
 */
export function FinancePerspective({ ctx }: { ctx: ReportContext }) {
  const navigate = useNavigate();
  const params = { asOf: ctx.fxDate, periodStart: ctx.period.start, periodEnd: ctx.period.end };
  const byProduct = useFinanceConsolidated({ ...params, groupBy: 'PRODUCT' });
  const byPartner = useFinanceConsolidated({ ...params, groupBy: 'PARTNER' });
  const total = useFinanceConsolidated({ ...params, groupBy: 'TOTAL' });

  return (
    <div className="space-y-6">
      <FinanceKpis query={total} ctx={ctx} />
      <div className="grid gap-4 xl:grid-cols-2">
        <AgingChart onSelect={(bucket) => navigate(`/billing?estado=OPEN&antiguedad=${bucket}`)} />
        <FxCoverage query={total} ctx={ctx} />
      </div>
      <ComponentsChart query={byProduct} ctx={ctx} onSelect={(id) => navigate(id === 'SIN_PRODUCTO' ? '/costs' : `/products/${id}`)} />
      <PartnerChart query={byPartner} ctx={ctx} onSelect={(id) => navigate(id === 'DIRECTO' ? '/customers' : `/organizations/${id}`)} />
      <RegionalFinancePanel />
    </div>
  );
}

function AgingChart({ onSelect }: { onSelect: (bucket: string) => void }) {
  const aging = useReceivablesAging();
  const state = fromQuery(aging);
  const rows = aging.data ?? [];
  const balanceOf = (c: string) => rows.filter((r) => r.currency === c).reduce((t, r) => t + Math.abs(Number(r.balance)), 0);
  const currencies = [...new Set(rows.map((r) => r.currency))].sort((a, b) => balanceOf(b) - balanceOf(a));
  const [picked, setPicked] = useState('');
  const currency = currencies.includes(picked) ? picked : (currencies[0] ?? '');
  const data: BarDatum[] = AGING_BUCKETS.map((b) => {
    const row = rows.find((r) => r.currency === currency && r.aging_bucket === b.id);
    return { key: b.id, label: b.label, value: row ? Number(row.balance) : 0 };
  });

  return (
    <ChartPanel
      title="¿Qué parte de la cartera está vencida?"
      unit={`Saldo por cobrar en ${currency || 'moneda nativa'}`}
      period="Foto actual · vencimiento contado a hoy"
      source="receivables_aging · v_invoice_balances"
      coverage="Clasificación visual; «Sin fecha» = facturas sin vencimiento"
      state={state}
      onRetry={() => void aging.refetch()}
      emptyText="No hay saldo pendiente de cobro"
      controls={<CurrencyPicker currencies={currencies} value={currency} onChange={setPicked} />}
      detailHref="/billing?estado=OPEN"
      detailLabel="Ver facturas por cobrar"
      chart={() => (
        <SingleBars data={data} currency={currency} ariaLabel={`Saldo por antigüedad en ${currency}`} onSelect={(d) => onSelect(d.key)} />
      )}
      table={() => (
        <table className="w-full text-sm">
          <caption className="sr-only">Saldo por antigüedad</caption>
          <thead>
            <tr>
              <th scope="col" className="ebim-th">Antigüedad</th>
              <th scope="col" className="ebim-th">Moneda</th>
              <th scope="col" className="ebim-th text-right">Facturas</th>
              <th scope="col" className="ebim-th text-right">Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {AGING_BUCKETS.flatMap((b) =>
              rows
                .filter((r) => r.aging_bucket === b.id)
                .map((r) => (
                  <tr key={`${b.id}-${r.currency}`}>
                    <th scope="row" className="ebim-td text-left">
                      <Link className="ebim-link" to={`/billing?estado=OPEN&antiguedad=${b.id}`}>{b.label}</Link>
                    </th>
                    <td className="ebim-td">{r.currency}</td>
                    <td className="ebim-td text-right tabular-nums">{formatNumber(Number(r.invoice_count))}</td>
                    <td className={`ebim-td text-right tabular-nums ${Number(r.balance) < 0 ? 'text-danger' : ''}`}>
                      {formatMoney(Number(r.balance), r.currency)}
                    </td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      )}
    />
  );
}

function ComponentsChart({
  query,
  ctx,
  onSelect,
}: {
  query: ReturnType<typeof useFinanceConsolidated>;
  ctx: ReportContext;
  onSelect: (productId: string) => void;
}) {
  const state = fromQuery(query, { isEmpty: (d) => d.groups.length === 0 });
  const groups = query.data?.groups ?? [];
  const volume = (c: string) =>
    groups.reduce((t, g) => t + Math.abs(Number(g.metrics.COLLECTED?.native?.[c] ?? 0)) + Math.abs(Number(g.metrics.COST?.native?.[c] ?? 0)), 0);
  const currencies = [
    ...new Set(groups.flatMap((g) => ['COLLECTED', 'COST', 'COMMISSION'].flatMap((k) => Object.keys(g.metrics[k as 'COST']?.native ?? {})))),
  ].sort((a, b) => volume(b) - volume(a));
  const [picked, setPicked] = useState('');
  const currency = currencies.includes(picked) ? picked : (currencies[0] ?? '');
  const val = (g: (typeof groups)[number], k: 'COLLECTED' | 'COST' | 'COMMISSION') => Number(g.metrics[k]?.native?.[currency] ?? 0);
  const data: ComponentDatum[] = groups
    .map((g) => ({
      key: g.key,
      label: g.key === 'SIN_PRODUCTO' ? 'No asignado / plataforma' : g.label,
      collected: val(g, 'COLLECTED'),
      cost: val(g, 'COST'),
      commission: val(g, 'COMMISSION'),
    }))
    .filter((d) => d.collected || d.cost || d.commission);

  return (
    <ChartPanel
      title="¿Cómo se compone el margen de cada SaaS?"
      unit={`Cobrado, costo directo y comisión en ${currency || 'moneda nativa'}`}
      period={periodLabel(ctx)}
      source="finance_consolidated (PRODUCT) · v_finance_facts"
      coverage="«No asignado / plataforma» agrupa costos sin producto: no se reparten"
      state={state}
      onRetry={() => void query.refetch()}
      emptyText="Sin cobros, costos ni comisiones en el período"
      controls={<CurrencyPicker currencies={currencies} value={currency} onChange={setPicked} />}
      detailHref="/costs"
      detailLabel="Ver costos y margen"
      chart={() =>
        data.length ? (
          <ComponentBars data={data} currency={currency} ariaLabel={`Componentes del margen por SaaS en ${currency}`} onSelect={(d) => onSelect(d.key)} />
        ) : (
          <p className="py-6 text-sm text-muted">Sin movimientos en {currency} para el período.</p>
        )
      }
      table={() => (
        <table className="w-full text-sm">
          <caption className="sr-only">Componentes del margen por SaaS</caption>
          <thead>
            <tr>
              <th scope="col" className="ebim-th">SaaS</th>
              <th scope="col" className="ebim-th">Moneda</th>
              <th scope="col" className="ebim-th text-right">Cobrado</th>
              <th scope="col" className="ebim-th text-right">Costo directo</th>
              <th scope="col" className="ebim-th text-right">Comisión</th>
              <th scope="col" className="ebim-th text-right">Margen gerencial</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {groups.flatMap((g) =>
              Object.entries(g.native_margin ?? {}).map(([c, margin]) => (
                <tr key={`${g.key}-${c}`}>
                  <th scope="row" className="ebim-td text-left">
                    {g.key === 'SIN_PRODUCTO' ? (
                      'No asignado / plataforma'
                    ) : (
                      <Link className="ebim-link" to={`/products/${g.key}`}>{g.label}</Link>
                    )}
                  </th>
                  <td className="ebim-td">{c}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(Number(g.metrics.COLLECTED?.native?.[c] ?? 0), c)}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(Number(g.metrics.COST?.native?.[c] ?? 0), c)}</td>
                  <td className="ebim-td text-right tabular-nums">{formatMoney(Number(g.metrics.COMMISSION?.native?.[c] ?? 0), c)}</td>
                  <td className={`ebim-td text-right font-semibold tabular-nums ${Number(margin) < 0 ? 'text-danger' : ''}`}>
                    {formatMoney(Number(margin), c)}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
    />
  );
}

function PartnerChart({
  query,
  ctx,
  onSelect,
}: {
  query: ReturnType<typeof useFinanceConsolidated>;
  ctx: ReportContext;
  onSelect: (orgId: string) => void;
}) {
  const state = fromQuery(query, { isEmpty: (d) => d.groups.length === 0 });
  const groups = query.data?.groups ?? [];
  const collectedOf = (c: string) => groups.reduce((t, g) => t + Number(g.metrics.COLLECTED?.native?.[c] ?? 0), 0);
  const currencies = [...new Set(groups.flatMap((g) => Object.keys(g.metrics.COLLECTED?.native ?? {})))].sort(
    (a, b) => collectedOf(b) - collectedOf(a),
  );
  const [picked, setPicked] = useState('');
  const currency = currencies.includes(picked) ? picked : (currencies[0] ?? '');
  const data: BarDatum[] = groups
    .map((g) => ({ key: g.key, label: g.key === 'DIRECTO' ? 'Venta directa' : g.label, value: Number(g.metrics.COLLECTED?.native?.[currency] ?? 0) }))
    .filter((d) => d.value !== 0)
    .sort((a, b) => b.value - a.value);

  return (
    <ChartPanel
      title="¿Cuánto cobramos por cada canal?"
      unit={`Cobrado en ${currency || 'moneda nativa'} por partner`}
      period={periodLabel(ctx)}
      source="finance_consolidated (PARTNER)"
      coverage="Sólo canales visibles para tu perfil; la tabla incluye MRR vigente y margen"
      state={currencies.length === 0 && state.status === 'ready' ? { status: 'empty' } : state}
      onRetry={() => void query.refetch()}
      emptyText="Sin cobros por canal en el período"
      controls={<CurrencyPicker currencies={currencies} value={currency} onChange={setPicked} />}
      detailHref="/partners"
      detailLabel="Ver partners"
      chart={() => (
        <SingleBars data={data} currency={currency} layout="horizontal-bars" ariaLabel={`Cobrado por canal en ${currency}`} onSelect={(d) => onSelect(d.key)} />
      )}
      table={() => (
        <table className="w-full text-sm">
          <caption className="sr-only">Cartera y contribución por partner</caption>
          <thead>
            <tr>
              <th scope="col" className="ebim-th">Canal</th>
              <th scope="col" className="ebim-th">Moneda</th>
              <th scope="col" className="ebim-th text-right">MRR vigente</th>
              <th scope="col" className="ebim-th text-right">Cobrado</th>
              <th scope="col" className="ebim-th text-right">Margen gerencial</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {groups.flatMap((g) => {
              const cs = [...new Set([...Object.keys(g.metrics.MRR?.native ?? {}), ...Object.keys(g.native_margin ?? {})])].sort();
              return cs.map((c) => (
                <tr key={`${g.key}-${c}`}>
                  <th scope="row" className="ebim-td text-left">
                    {g.key === 'DIRECTO' ? 'Venta directa' : <Link className="ebim-link" to={`/organizations/${g.key}`}>{g.label}</Link>}
                  </th>
                  <td className="ebim-td">{c}</td>
                  <td className="ebim-td text-right tabular-nums">{g.metrics.MRR?.native?.[c] !== undefined ? formatMoney(Number(g.metrics.MRR.native[c]), c) : '—'}</td>
                  <td className="ebim-td text-right tabular-nums">{g.metrics.COLLECTED?.native?.[c] !== undefined ? formatMoney(Number(g.metrics.COLLECTED.native[c]), c) : '—'}</td>
                  <td className="ebim-td text-right tabular-nums">{g.native_margin?.[c] !== undefined ? formatMoney(Number(g.native_margin[c]), c) : '—'}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      )}
    />
  );
}

function FxCoverage({ query, ctx }: { query: ReturnType<typeof useFinanceConsolidated>; ctx: ReportContext }) {
  const state = fromQuery(query, { isEmpty: () => false });
  const data = query.data;
  return (
    <section className="ebim-card flex flex-col" aria-labelledby="fx-title">
      <header className="border-b border-border px-4 py-3">
        <h3 id="fx-title" className="text-sm font-bold text-fg">¿Se puede consolidar en una sola moneda?</h3>
        <p className="text-xs text-muted">Tasas al {ctx.fxDate} · período {periodLabel(ctx)}</p>
      </header>
      <div className="flex-1 px-4 py-3 text-sm">
        {state.status !== 'ready' || !data ? (
          <StateMessage state={state} onRetry={() => void query.refetch()} />
        ) : !data.reporting_currency ? (
          <p className="text-warn">No hay moneda de reporte configurada: sólo se muestran importes nativos.</p>
        ) : data.completeness.complete ? (
          <>
            <p className="font-semibold text-ok">Cobertura FX completa en {data.reporting_currency}.</p>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {data.rates_used.map((r) => (
                <li key={`${r.from}-${r.to}-${r.rate_date}`}>
                  {formatRateLabel(r.from, r.to, Number(r.rate))} · {r.rate_date}
                  {r.is_demo ? ' · tasa de demostración' : ''}
                </li>
              ))}
              {data.rates_used.length === 0 ? <li>Sin conversión necesaria.</li> : null}
            </ul>
          </>
        ) : (
          <>
            <p className="font-semibold text-warn">
              Cobertura parcial: falta tasa para {data.completeness.missing_currencies.join(', ')}.
            </p>
            <p className="mt-1 text-xs text-muted">
              Los totales consolidados afectados no se calculan (no se muestran como cero). Los importes nativos siguen siendo exactos.
            </p>
          </>
        )}
      </div>
      <footer className="border-t border-border px-4 py-2 text-xs">
        <Link className="ebim-link" to="/regional">Ver monedas y tipos de cambio →</Link>
      </footer>
    </section>
  );
}

/**
 * Franja de KPI de Finanzas: movimientos del período consolidados a la moneda
 * de reporte (cobrado, margen gerencial) y foto a hoy de la cartera. Un mes en
 * curso se rotula parcial y el margen negativo de un período incompleto se
 * explica en vez de gritar (A04). Si falta una tasa, la cifra queda «—».
 */
function FinanceKpis({ query, ctx }: { query: ReturnType<typeof useFinanceConsolidated>; ctx: ReportContext }) {
  const rc = query.data?.reporting_currency ?? undefined;
  const aging = useExecutiveAging(undefined, rc);
  const group = query.data?.groups[0];
  const collected = group?.metrics.COLLECTED;
  const margin = group?.margin;
  const summary = agingSummary(aging.data);
  const receivable =
    aging.data && aging.data.complete ? aging.data.buckets.reduce((t, b) => t + (b.balance ?? 0), 0) : null;
  const receivableCount = aging.data?.buckets.reduce((t, b) => t + b.invoiceCount, 0) ?? 0;
  const period = periodLabel(ctx);
  const nativeLine = (m?: Record<string, number>) =>
    m ? Object.entries(m).map(([c, v]) => `${c} ${formatCompactAmount(Number(v))}`).join(' · ') : '';
  const missing = (m?: { complete: boolean; missing_currencies: string[] }) =>
    m && !m.complete ? `Sin tasa para ${m.missing_currencies.join(', ')}: no se consolida` : null;
  return (
    <section aria-label="Indicadores de finanzas" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile
        label="Cobrado del período"
        info="Pagos confirmados en el período (K02), consolidados con tasa explícita."
        currency={collected?.reporting_amount != null ? rc : undefined}
        value={collected?.reporting_amount == null ? null : formatCompactAmount(Number(collected.reporting_amount))}
        footer={missing(collected) ?? `${period} · ${nativeLine(collected?.native) || 'sin cobros'}`}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        to={`/billing?desde=${ctx.period.start}&hasta=${ctx.period.end}#cobros`}
      />
      <KpiTile
        label="Margen gerencial"
        info="Cobrado − costo directo − comisión del período (K05). Gestión, no utilidad contable."
        currency={margin?.reporting_amount != null ? rc : undefined}
        value={margin?.reporting_amount == null ? null : formatCompactAmount(Number(margin.reporting_amount))}
        tone={ctx.period.partial ? 'warn' : 'neutral'}
        footer={
          margin && !margin.complete
            ? 'Falta una tasa: el margen consolidado no se calcula'
            : ctx.period.partial
              ? 'Mes en curso: cobros y costos aún incompletos, no es el resultado del mes'
              : period
        }
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        to="/costs"
      />
      <KpiTile
        label="Saldo por cobrar"
        info="Facturas emitidas menos pagos confirmados, a hoy (S05)."
        currency={receivable != null ? aging.data?.reportingCurrency : undefined}
        value={receivable == null ? null : formatCompactAmount(receivable)}
        footer={aging.data && !aging.data.complete ? 'Falta una tasa: no se consolida' : `Foto a hoy · ${formatNumber(receivableCount)} facturas`}
        loading={aging.isLoading}
        error={aging.error}
        onRetry={() => void aging.refetch()}
        to="/billing?estado=OPEN"
      />
      <KpiTile
        label="Cartera vencida"
        info="Saldo con 1 día o más de atraso, a hoy (bandas 1–30 a más de 90 días)."
        currency={summary?.overdue != null ? aging.data?.reportingCurrency : undefined}
        value={summary?.overdue == null ? null : formatCompactAmount(summary.overdue)}
        tone={summary?.segments.some((s) => s.bucket === 'D90_MAS' && s.invoiceCount > 0) ? 'warn' : 'neutral'}
        footer={summary ? `Foto a hoy · ${formatNumber(summary.overdueInvoices)} facturas vencidas` : null}
        loading={aging.isLoading}
        error={aging.error}
        onRetry={() => void aging.refetch()}
        to="/billing?estado=OPEN&antiguedad=VENCIDA"
      />
    </section>
  );
}
