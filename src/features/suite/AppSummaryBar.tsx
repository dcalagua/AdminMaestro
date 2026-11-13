import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/primitives';
import { SummaryBar, SummaryItem } from '@/components/ui/SummaryBar';
import { nativeInline } from '@/features/billing/financeModel';
import { HealthDot, HealthText } from '@/features/platform/EnvironmentHealth';
import type { ObservedHealth } from '@/features/platform/targetHealth';
import { formatNumber, sumByCurrency } from '@/lib/format';
import { useAppLifecycleRows } from './appDetailQueries';
import type { ChannelState, TenantRow } from './suiteModel';

/**
 * Cabecera fija de la ficha de app (V6 · T8): salud, tenants activos, los que
 * esperan confirmación o atención y, con vista financiera, el MRR de la app y lo
 * vencido de sus clientes, ambos por moneda. Antes eran 4 KPI de conteo sin dinero.
 */
export function AppSummaryBar({
  appId,
  appCode,
  health,
  total,
  active,
  pendingConfirm,
  attention,
  finance,
  tenantRows,
}: {
  appId: string;
  appCode: string;
  health: ObservedHealth;
  total: number;
  active: number;
  pendingConfirm: number;
  attention: number;
  finance: boolean;
  tenantRows: TenantRow[];
}) {
  const lifecycle = useAppLifecycleRows(finance);
  const mrr = sumByCurrency(
    tenantRows.filter((t) => t.saas_product_id === appId && Number(t.mrr ?? 0) !== 0),
    (t) => t.mrr,
    (t) => t.currency,
  );
  const overdueRows = (lifecycle.data ?? []).filter((r) => r.saas_product_id === appId && Number(r.overdue_balance ?? 0) > 0);
  const overdue = sumByCurrency(overdueRows, (r) => r.overdue_balance, (r) => r.overdue_currency);
  return (
    <SummaryBar label="Resumen de la app">
      <SummaryItem label="Salud" hint="Última comprobación guardada del entorno principal">
        <span className="inline-flex items-center gap-1.5">
          <HealthDot health={health} />
          <HealthText health={health} />
        </span>
      </SummaryItem>
      <SummaryItem label="Tenants">
        <span className="tabular-nums" data-tenants>
          {formatNumber(active)} <span className="font-normal text-muted">activos de {formatNumber(total)}</span>
        </span>
      </SummaryItem>
      <SummaryItem label="Por confirmar" hint="Activos en la app, «Pendiente» en el Admin Maestro">
        {pendingConfirm > 0 ? (
          <Badge tone="warn" dot>{formatNumber(pendingConfirm)}</Badge>
        ) : (
          <span className="font-normal text-muted">Ninguno</span>
        )}
      </SummaryItem>
      <SummaryItem label="Requieren atención" hint="Altas fallidas, sin alta o suspendidos: se abren en el Centro de la suite">
        {attention > 0 ? (
          <Link className="ebim-link tabular-nums" to={`/suite?mapp=${appCode}&mestado=ATTENTION`}>
            {formatNumber(attention)} · ver
          </Link>
        ) : (
          <span className="font-normal text-muted">Ninguno</span>
        )}
      </SummaryItem>
      {finance ? (
        <>
          <SummaryItem label="MRR de la app" hint="MRR vigente de los tenants de esta app, por moneda (nunca se suman monedas)">
            {Object.keys(mrr).length > 0 ? (
              <span className="tabular-nums" data-mrr>{nativeInline(mrr)}</span>
            ) : (
              <span className="font-normal text-muted">Sin recurrente</span>
            )}
          </SummaryItem>
          <SummaryItem label="Vencido de sus clientes" hint="Saldo vencido de los clientes con tenant en esta app, por moneda">
            {lifecycle.isLoading ? '…' : lifecycle.error ? (
              <span className="font-normal text-muted">No disponible</span>
            ) : Object.keys(overdue).length > 0 ? (
              <span className="tabular-nums text-danger" data-overdue>
                {nativeInline(overdue)}
                <span className="font-normal text-muted"> · {formatNumber(overdueRows.length)} {overdueRows.length === 1 ? 'tenant' : 'tenants'}</span>
              </span>
            ) : (
              <span className="font-normal text-muted">Nada vencido</span>
            )}
          </SummaryItem>
        </>
      ) : null}
    </SummaryBar>
  );
}

/** Canales con la app en una sola fila de insignias; el detalle va en el `title`. */
export function ChannelBadges({ channels }: { channels: ChannelState[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Canales con la app">
      {channels.map((c) => (
        <li key={c.key} className="inline-flex items-center gap-1.5 text-compact" data-channel={c.key} data-active={c.active ? 'true' : 'false'} title={c.detail}>
          <span className="text-fg-2">{c.label}</span>
          <Badge tone={c.tone}>{c.status}</Badge>
          <span className="sr-only">. {c.detail}</span>
        </li>
      ))}
    </ul>
  );
}
