import { useId, useState } from 'react';
import { USAGE_LIST_LIMIT, useUsageEventCogs, useUsageEvents } from '@/services/queries';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { Money } from '@/components/ui/Money';
import { formatDateTime, formatNumber } from '@/lib/format';
import { currentPeriodStart, formatPeriod, formatQuantity, monthOf, periodFromMonth, periodRange } from './usageLabels';
import { useLookups } from './useLookups';

/**
 * Eventos de uso crudos (append-only). Se consultan por tenant y mes: es el
 * «buscador + selector de período» que admite U-06, no un panel de filtros.
 *
 * La metadata interna (proveedor, modelo, tokens, costo) es COGS de EBIM: no
 * tiene grant de columna y solo finanzas la lee por `usage_event_cogs`.
 */
export function EventsTab() {
  const lookups = useLookups();
  const perms = usePermissions();
  const tenantSelectId = useId();
  const monthId = useId();
  const [tenantId, setTenantId] = useState('');
  const [period, setPeriod] = useState(currentPeriodStart());
  const [showCogs, setShowCogs] = useState(false);
  const range = periodRange(period);

  const events = useUsageEvents({ tenantId: tenantId || null, from: range.from, to: range.to });
  const cogs = useUsageEventCogs(showCogs && tenantId && perms.canReadFinance ? { tenantId, ...range } : null);

  const { term, setTerm, filtered } = useSearchFilter(events.data, (e) => [
    e.meter_code, e.subject_ref, e.external_company_id, e.event_id, e.capability_code, lookups.tenantName(e.tenant_id),
  ]);
  const rows = events.data ?? [];

  return (
    <div className="space-y-4">
      <Card
        title="Eventos"
        description={`Eventos aceptados por el ingest, por fecha de ocurrencia (UTC). Se muestran hasta ${USAGE_LIST_LIMIT} por consulta; acota por tenant para ver todo un mes.`}
      >
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <div className="min-w-[220px]">
            <label className="ebim-label" htmlFor={tenantSelectId}>Tenant</label>
            <select
              id={tenantSelectId}
              className="ebim-input"
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                setShowCogs(false);
              }}
            >
              <option value="">Todos los visibles</option>
              {lookups.tenantOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="ebim-label" htmlFor={monthId}>Período</label>
            <input
              id={monthId}
              type="month"
              className="ebim-input"
              value={monthOf(period)}
              onChange={(e) => {
                const next = periodFromMonth(e.target.value);
                if (next) setPeriod(next);
              }}
            />
          </div>
          {perms.canReadFinance ? (
            <button
              type="button"
              className="ebim-btn-secondary h-9 px-3 text-xs"
              disabled={!tenantId}
              title={tenantId ? undefined : 'Elige un tenant para ver su COGS'}
              aria-pressed={showCogs}
              onClick={() => setShowCogs((v) => !v)}
            >
              {showCogs ? 'Ocultar COGS' : 'Ver COGS'}
            </button>
          ) : null}
        </div>
        <SearchBar value={term} onChange={setTerm} placeholder="Buscar por medidor, sujeto, empresa externa o eventId…" />
        {events.isLoading ? (
          <LoadingState label="Cargando eventos…" />
        ) : events.error ? (
          <ErrorState error={events.error} onRetry={() => void events.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={rows.length > 0 ? 'Ningún evento coincide' : `Sin eventos en ${formatPeriod(period)}`}
            description={
              rows.length > 0
                ? 'Prueba con otra búsqueda.'
                : 'El ingest está apagado hasta D-12 o el tenant no emitió uso en este período.'
            }
          />
        ) : (
          <DataTable columns={['Ocurrido', 'Tenant', 'Medidor', 'Cantidad', 'Sujeto / empresa', 'Período', 'Lote']}>
            {filtered.map((e) => (
              <tr key={e.id}>
                <td className="ebim-td whitespace-nowrap text-xs">{formatDateTime(e.occurred_at)}</td>
                <td className="ebim-td text-xs font-semibold">{lookups.tenantName(e.tenant_id)}</td>
                <td className="ebim-td">
                  <div className="font-mono text-xs">{e.meter_code}</div>
                  {e.capability_code ? <div className="font-mono text-[11px] text-muted">{e.capability_code}</div> : null}
                </td>
                <td className="ebim-td text-xs tabular-nums">
                  {formatQuantity(e.quantity)} {e.unit}
                </td>
                <td className="ebim-td text-xs">
                  <div>{e.subject_ref ?? '—'}</div>
                  {e.external_company_id ? <div className="text-[11px] text-muted">{e.external_company_id}</div> : null}
                </td>
                <td className="ebim-td text-xs">
                  {formatPeriod(e.period_start)}
                  {e.late ? (
                    <div className="mt-0.5">
                      <Badge tone="warn">Tardío</Badge>
                    </div>
                  ) : null}
                </td>
                <td className="ebim-td font-mono text-[11px] text-muted" title={e.event_hash}>
                  {e.ingest_batch_id.slice(0, 8)}…
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      {showCogs && perms.canReadFinance && tenantId ? (
        <Card
          title={`COGS interno · ${lookups.tenantName(tenantId)} · ${formatPeriod(period)}`}
          description="Costo de proveedor por evento (solo EBIM_FINANCE). Los tokens son costo interno, nunca la unidad comercial (spec §12.7)."
        >
          {cogs.isLoading ? (
            <LoadingState label="Cargando COGS…" />
          ) : cogs.error ? (
            <ErrorState error={cogs.error} onRetry={() => void cogs.refetch()} />
          ) : (cogs.data ?? []).length === 0 ? (
            <EmptyState title="Sin COGS en este período" description="Ningún evento del tenant trae metadata interna." />
          ) : (
            <DataTable columns={['Ocurrido', 'Medidor', 'Cantidad', 'Proveedor / modelo', 'Tokens (entrada / salida / caché)', 'Latencia', 'Costo']}>
              {(cogs.data ?? []).map((c) => {
                const internal = (c.internal ?? {}) as Record<string, unknown>;
                const num = (k: string) => (typeof internal[k] === 'number' ? (internal[k] as number) : null);
                return (
                  <tr key={c.event_id}>
                    <td className="ebim-td whitespace-nowrap text-xs">{formatDateTime(c.occurred_at)}</td>
                    <td className="ebim-td font-mono text-xs">{c.meter_code}</td>
                    <td className="ebim-td text-xs tabular-nums">{formatQuantity(c.quantity)}</td>
                    <td className="ebim-td text-xs">
                      {String(internal.provider ?? '—')}
                      <div className="text-[11px] text-muted">{String(internal.model ?? '')}</div>
                    </td>
                    <td className="ebim-td text-xs tabular-nums">
                      {formatNumber(num('inputTokens'))} / {formatNumber(num('outputTokens'))} / {formatNumber(num('cacheTokens'))}
                    </td>
                    <td className="ebim-td text-xs tabular-nums">
                      {num('latencyMs') === null ? '—' : `${formatNumber(num('latencyMs'))} ms`}
                    </td>
                    <td className="ebim-td text-xs">
                      {num('costAmount') !== null && typeof internal.costCurrency === 'string' ? (
                        <Money amount={num('costAmount')} currency={internal.costCurrency} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </Card>
      ) : null}
    </div>
  );
}
