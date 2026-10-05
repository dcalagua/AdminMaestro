import { Link } from 'react-router-dom';
import { useAiCreditBalances, useAiCreditLedger, useUsageAggregates } from '@/services/queries';
import { Card, DataTable, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import {
  AGGREGATE_STATUS, ALLOWANCE_STATUS, LEDGER_ENTRY, formatPeriod, formatQuantity, labelOf, poolLabel,
} from '@/features/usage/usageLabels';

/**
 * Tenant 360 · «Uso y créditos» (CCP M4, spec §5.4). Solo lectura y acotado a
 * ESTE tenant en el servidor (RLS `can_read_tenant`). Las acciones viven en
 * «Uso» y «Créditos IA».
 */
const RECENT_LEDGER = 20;

export function TenantUsagePanel({ tenantId }: { tenantId: string }) {
  const aggregates = useUsageAggregates(tenantId);
  const balances = useAiCreditBalances(tenantId);
  const ledger = useAiCreditLedger(tenantId, RECENT_LEDGER);

  return (
    <div className="space-y-4">
      <Card
        title="Agregados de uso"
        description="Por medidor y período. La cantidad es definitiva al finalizar; solo lo finalizado y facturable entra en una factura."
        actions={
          <Link className="ebim-link text-xs" to="/usage#aggregates">
            Ir a Uso
          </Link>
        }
      >
        {aggregates.isLoading ? (
          <LoadingState label="Cargando agregados…" />
        ) : aggregates.error ? (
          <ErrorState error={aggregates.error} onRetry={() => void aggregates.refetch()} />
        ) : (aggregates.data ?? []).length === 0 ? (
          <EmptyState title="Sin uso registrado" description="Este tenant no ha emitido eventos de uso (el ingest está apagado hasta D-12)." />
        ) : (
          <DataTable columns={['Medidor', 'Período', 'Estado', 'Cantidad', 'Asignación', 'Facturable']}>
            {(aggregates.data ?? []).map((a) => {
              const st = labelOf(AGGREGATE_STATUS, a.status);
              const finalized = a.status === 'FINALIZED';
              return (
                <tr key={a.id ?? `${a.meter_code}:${a.period_start}`}>
                  <td className="ebim-td">
                    <div className="font-mono text-xs">{a.meter_code}</div>
                    <div className="text-[11px] text-muted">{a.product_code}</div>
                  </td>
                  <td className="ebim-td whitespace-nowrap text-xs">{formatPeriod(a.period_start)}</td>
                  <td className="ebim-td">
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </td>
                  <td className="ebim-td text-xs tabular-nums">
                    {finalized ? `${formatQuantity(a.quantity)} ${a.unit ?? ''}` : <span className="text-muted">Se calcula al finalizar</span>}
                  </td>
                  <td className="ebim-td text-xs">
                    {a.allowance_status ? labelOf(ALLOWANCE_STATUS, a.allowance_status).label : '—'}
                  </td>
                  <td className="ebim-td text-xs">{finalized ? (a.is_billable ? 'Sí' : 'No') : '—'}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <Card
        title="Saldo de créditos IA por pool"
        description="Derivado del ledger. Sin política de créditos (D-03) no hay incluidos: el saldo no se inventa."
        actions={
          <Link className="ebim-link text-xs" to="/ai-credits#balances">
            Ir a Créditos IA
          </Link>
        }
      >
        {balances.isLoading ? (
          <LoadingState label="Cargando saldos…" />
        ) : balances.error ? (
          <ErrorState error={balances.error} onRetry={() => void balances.refetch()} />
        ) : (balances.data ?? []).length === 0 ? (
          <EmptyState title="Sin créditos" description="El tenant no tiene movimientos de créditos IA." />
        ) : (
          <DataTable columns={['Pool', 'Período', 'Incluidos', 'Comprados', 'Bono', 'Usados', 'Saldo']}>
            {(balances.data ?? []).map((b) => (
              <tr key={`${b.pool_key}:${b.period_start}`}>
                <td className="ebim-td text-xs font-semibold">{poolLabel(b.pool_key)}</td>
                <td className="ebim-td whitespace-nowrap text-xs">{formatPeriod(b.period_start)}</td>
                <td className="ebim-td text-xs tabular-nums">{formatQuantity(b.included)}</td>
                <td className="ebim-td text-xs tabular-nums">{formatQuantity(b.purchased)}</td>
                <td className="ebim-td text-xs tabular-nums">{formatQuantity(b.bonus)}</td>
                <td className="ebim-td text-xs tabular-nums">{formatQuantity(b.used)}</td>
                <td className={`ebim-td text-sm font-bold tabular-nums ${Number(b.balance ?? 0) < 0 ? 'text-danger' : ''}`}>
                  {formatQuantity(b.balance)}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <Card title="Últimos movimientos" description={`Los ${RECENT_LEDGER} más recientes del ledger de este tenant.`}>
        {ledger.isLoading ? (
          <LoadingState label="Cargando movimientos…" />
        ) : ledger.error ? (
          <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} />
        ) : (ledger.data ?? []).length === 0 ? (
          <EmptyState title="Sin movimientos" />
        ) : (
          <DataTable columns={['Fecha', 'Tipo', 'Pool', 'Período', 'Créditos', 'Motivo']}>
            {(ledger.data ?? []).map((e) => {
              const t = labelOf(LEDGER_ENTRY, e.entry_type);
              return (
                <tr key={e.id}>
                  <td className="ebim-td whitespace-nowrap text-xs text-muted">{formatDateTime(e.created_at)}</td>
                  <td className="ebim-td">
                    <Badge tone={t.tone}>{t.label}</Badge>
                  </td>
                  <td className="ebim-td text-xs">{poolLabel(e.pool_key)}</td>
                  <td className="ebim-td whitespace-nowrap text-xs">{formatPeriod(e.period_start)}</td>
                  <td className={`ebim-td text-sm font-semibold tabular-nums ${e.credits < 0 ? 'text-danger' : 'text-ok'}`}>
                    {e.credits > 0 ? '+' : ''}
                    {formatQuantity(e.credits)}
                  </td>
                  <td className="ebim-td max-w-[260px] text-xs text-muted">{e.reason ?? '—'}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>
    </div>
  );
}
