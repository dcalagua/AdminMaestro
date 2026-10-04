import { useState } from 'react';
import { USAGE_LIST_LIMIT, useUsageAlerts } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import { ALERT_CODE, alertCategory, labelOf, type AlertCategory } from './usageLabels';
import { useLookups } from './useLookups';

/**
 * Alertas de uso, créditos y facturación de uso (append-only, para finanzas).
 * Ninguna factura: avisan de lo que falta decidir (D-xx) o de un exceso.
 */
type Tab = 'ALL' | AlertCategory;

function detailText(detail: unknown): string {
  if (!detail || typeof detail !== 'object') return '';
  return Object.entries(detail as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export function AlertsTab() {
  const alerts = useUsageAlerts();
  const lookups = useLookups();
  const [tab, setTab] = useState<Tab>('ALL');

  const { term, setTerm, filtered } = useSearchFilter(alerts.data, (a) => [
    a.code, ALERT_CODE[a.code]?.label, lookups.tenantName(a.tenant_id), lookups.productName(a.saas_product_id),
    detailText(a.detail),
  ]);
  const count = (t: Tab) => filtered.filter((a) => t === 'ALL' || alertCategory(a.code) === t).length;
  const visible = filtered.filter((a) => tab === 'ALL' || alertCategory(a.code) === tab);
  const hasAny = (alerts.data ?? []).length > 0;

  return (
    <Card
      title="Alertas"
      description={`Últimas ${USAGE_LIST_LIMIT} alertas. Son bitácora append-only: un exceso bajo BLOCK, una política o un peso sin decidir, una tarifa ausente.`}
    >
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder="Buscar por código, tenant, producto o detalle…"
        right={
          <StatusTabs
            value={tab}
            onChange={setTab}
            options={[
              { id: 'ALL', label: 'Todas', count: count('ALL') },
              { id: 'USAGE', label: 'Uso', count: count('USAGE') },
              { id: 'CREDITS', label: 'Créditos IA', count: count('CREDITS') },
              { id: 'BILLING', label: 'Facturación', count: count('BILLING') },
            ]}
          />
        }
      />
      {alerts.isLoading ? (
        <LoadingState label="Cargando alertas…" />
      ) : alerts.error ? (
        <ErrorState error={alerts.error} onRetry={() => void alerts.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={hasAny ? 'Ninguna alerta coincide' : 'Sin alertas'}
          description={hasAny ? 'Prueba con otra búsqueda o cambia de categoría.' : 'Ningún cierre ni consumo ha generado alertas.'}
        />
      ) : (
        <DataTable columns={['Fecha', 'Alerta', 'Tenant', 'Producto', 'Detalle']}>
          {visible.map((a) => {
            const meta = labelOf(ALERT_CODE, a.code);
            return (
              <tr key={a.id}>
                <td className="ebim-td whitespace-nowrap text-xs text-muted">{formatDateTime(a.created_at)}</td>
                <td className="ebim-td">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <div className="mt-0.5 font-mono text-[11px] text-muted">{a.code}</div>
                </td>
                <td className="ebim-td text-xs">{a.tenant_id ? lookups.tenantName(a.tenant_id) : '—'}</td>
                <td className="ebim-td text-xs">{a.saas_product_id ? lookups.productName(a.saas_product_id) : '—'}</td>
                <td className="ebim-td max-w-[360px] break-words font-mono text-[11px] text-muted">
                  {detailText(a.detail) || '—'}
                  {/*
                    TODO(M4-DB): acuse por alerta → acknowledge_usage_alert(p_alert_id, p_note)
                    sobre platform.usage_alert_acks (finanzas o admin de producto).
                    usage_alerts sigue append-only; el acuse vive en su propia tabla.
                    Se añadirá aquí una columna «Acuse» y pestañas Pendientes/Atendidas.
                  */}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </Card>
  );
}
