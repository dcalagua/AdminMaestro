import { useState } from 'react';
import { useFinanceConsolidated } from '@/services/queries';
import { Card, Badge, DataTable, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { formatDate, formatNumber } from '@/lib/format';
import { isoDate } from '@/features/executive/reportContext';
import type { ConsolidatedRate } from '@/types/domain';

/**
 * Cobertura FX (P27).
 *
 * Responde «¿con qué tasas se valúa el consolidado a esta fecha, y qué moneda
 * se queda sin convertir?». La respuesta la da la base (`finance_consolidated`:
 * `rates_used` + `completeness`); aquí NO se muestra ningún importe consolidado:
 * esta pantalla es de cobertura, no de totales.
 *
 * La fecha de las tasas es sólo la fecha de VALUACIÓN. No es el período
 * financiero: elegir otra fecha no mueve cobros, costos ni comisiones.
 */

function daysBetween(fromIso: string, toIso: string): number | null {
  const [fy, fm, fd] = fromIso.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = toIso.split('-').map(Number) as [number, number, number];
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function formatRate(value: number | string) {
  return new Intl.NumberFormat('es-PE', { minimumFractionDigits: 4, maximumFractionDigits: 10 }).format(Number(value));
}

export function FxCoveragePanel() {
  const [fxDate, setFxDate] = useState(() => isoDate(new Date()));
  const consolidated = useFinanceConsolidated({ asOf: fxDate, groupBy: 'TOTAL' });
  const data = consolidated.data;
  const maxAge = data?.fx_max_rate_age_days ?? null;
  const missing = data?.completeness.missing_currencies ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <section className="ebim-card p-4" aria-labelledby="fx-date-title">
          <h3 id="fx-date-title" className="text-[11px] font-bold uppercase tracking-wider text-muted">
            Fecha de valuación FX
          </h3>
          <label className="mt-2 block text-sm">
            <span className="text-muted">Fecha de las tasas</span>
            <input
              type="date"
              className="ebim-input mt-1 max-w-[220px]"
              value={fxDate}
              onChange={(e) => {
                if (e.target.value) setFxDate(e.target.value);
              }}
            />
          </label>
          <p className="mt-2 text-xs text-muted">
            Sólo decide qué tasa se usa para convertir: la última publicada hasta esta fecha, dentro de la antigüedad máxima configurada.
          </p>
        </section>
        <section className="ebim-card p-4" aria-labelledby="fx-period-title">
          <h3 id="fx-period-title" className="text-[11px] font-bold uppercase tracking-wider text-muted">
            Período financiero
          </h3>
          <p className="mt-2 text-sm text-fg">No se elige aquí.</p>
          <p className="mt-1 text-xs text-muted">
            El período de cobros, costos y comisiones se elige en el inicio ejecutivo. Cambiar la fecha FX no mueve el
            período, y cambiar el período no cambia las tasas.
          </p>
        </section>
      </div>

      <Card
        title="Cobertura de tasas"
        description="Qué monedas tienen tasa hacia la moneda de reporte a la fecha elegida. Sin tasa, el consolidado de esa moneda no se calcula: nunca se inventa un total."
        actions={
          data ? (
            <Badge tone={data.completeness.complete ? 'ok' : 'warn'}>
              {data.completeness.complete ? 'Cobertura completa' : 'FX incompleto'}
            </Badge>
          ) : null
        }
      >
        {consolidated.isLoading ? (
          <LoadingState />
        ) : consolidated.error ? (
          <ErrorState error={consolidated.error} onRetry={() => void consolidated.refetch()} />
        ) : !data ? (
          <EmptyState title="Sin datos de cobertura" />
        ) : (
          <>
            <dl className="grid gap-3 border-b border-border px-4 py-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">Moneda de reporte</dt>
                <dd className="font-semibold">{data.reporting_currency ?? 'Sin configurar'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Antigüedad máxima de una tasa</dt>
                <dd className="font-semibold">{maxAge === null ? 'Sin límite configurado' : `${formatNumber(maxAge)} días`}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Monedas sin tasa</dt>
                <dd className={`font-semibold ${missing.length > 0 ? 'text-warn' : ''}`}>
                  {missing.length === 0 ? 'Ninguna' : missing.join(', ')}
                </dd>
              </div>
            </dl>
            {missing.length > 0 ? (
              <p className="mx-4 mt-3 rounded-md bg-warn-soft px-3 py-2 text-xs font-semibold text-warn" role="status">
                FX incompleto a {formatDate(fxDate)}: falta tasa para {missing.join(', ')}. El consolidado en{' '}
                {data.reporting_currency ?? 'moneda de reporte'} se marca como no calculable; los importes nativos siguen
                siendo válidos. Publica la tasa en «Tipos de cambio».
              </p>
            ) : null}
            {data.rates_used.length === 0 ? (
              <EmptyState
                title="Ninguna conversión necesaria o posible"
                description="No hay importes en monedas distintas de la de reporte, o no existe ninguna tasa aplicable."
              />
            ) : (
              <DataTable columns={['Conversión', 'Tasa', 'Método', 'Fecha de la tasa', 'Antigüedad', 'Origen']}>
                {data.rates_used.map((r: ConsolidatedRate) => {
                  const age = daysBetween(r.rate_date, fxDate);
                  return (
                    <tr key={`${r.from}-${r.to}`}>
                      <td className="ebim-td font-semibold">
                        1 {r.from} → {r.to}
                      </td>
                      <td className="ebim-td text-right tabular-nums">{formatRate(r.rate)}</td>
                      <td className="ebim-td text-xs">{r.method === 'DIRECT' ? 'Directa' : 'Recíproca'}</td>
                      <td className="ebim-td whitespace-nowrap text-xs text-muted">{formatDate(r.rate_date)}</td>
                      <td className="ebim-td text-xs">
                        {age === null ? '—' : `${formatNumber(age)} días`}
                      </td>
                      <td className="ebim-td">
                        {r.is_demo ? <Badge tone="warn">DEMO (no es cotización)</Badge> : <Badge tone="neutral">Manual</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
