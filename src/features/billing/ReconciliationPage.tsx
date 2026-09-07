import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useFinanceReconciliation, useProductFinance, usePartnerFinance, useWebhookEvents,
} from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { SectionTabs, StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatMoney, formatPercent, formatNumber, formatDateTime } from '@/lib/format';

/**
 * Reconciliación financiera.
 *
 * Esta pantalla DESCRIBE lo que no cuadra; no lo arregla. Corregir un descuadre
 * automáticamente hace que el número cierre y que nadie sepa por qué, que es
 * justo lo contrario de lo que necesita un cierre contable.
 *
 * Todo se agrupa POR MONEDA. No hay tabla de tipos de cambio, así que consolidar
 * PEN y USD produciría un total que nadie puede auditar. Está documentado como
 * fuera de alcance de V2.
 */

const FINDING_LABEL: Record<string, string> = {
  PROVIDER_DRIFT: 'Deriva con el proveedor',
  OPEN_INVOICE: 'Factura abierta vencida',
  EXPIRED_DOCUMENT: 'OS/OC vencida',
  REVERSED_PAYMENT: 'Cobro revertido',
  REJECTED_WEBHOOK: 'Webhook rechazado',
  MISSING_COLLECTION_PROFILE: 'Sin perfil de cobro',
};

const SEVERITY_TONE: Record<string, 'ok' | 'warn' | 'danger'> = {
  OK: 'ok',
  REVIEW: 'warn',
  ERROR: 'danger',
};

type Filter = 'ALL' | 'ERROR' | 'REVIEW';

export function ReconciliationPage() {
  const findings = useFinanceReconciliation();
  const products = useProductFinance();
  const partners = usePartnerFinance();
  const events = useWebhookEvents(50);
  const [filter, setFilter] = useState<Filter>('ALL');

  const { term, setTerm, filtered } = useSearchFilter(findings.data, (f) => [
    f.subject, f.organization_name, f.detail, f.finding_type,
  ]);

  const rows = filtered.filter((f) => (filter === 'ALL' ? true : f.severity === filter));
  const all = findings.data ?? [];

  const errors = all.filter((f) => f.severity === 'ERROR').length;
  const reviews = all.filter((f) => f.severity === 'REVIEW').length;

  return (
    <PageContainer
      title="Reconciliación"
      description="Diferencias entre lo que dice el proveedor, lo que dice la factura y lo que dice el cobro. La pantalla diagnostica; las correcciones las decide una persona."
      actions={
        <Badge tone={errors > 0 ? 'danger' : reviews > 0 ? 'warn' : 'ok'}>
          {errors > 0 ? 'ERROR' : reviews > 0 ? 'REVIEW' : 'OK'}
        </Badge>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Hallazgos con error" value={formatNumber(errors)} tone={errors > 0 ? 'danger' : 'ok'} />
        <StatCard label="Para revisar" value={formatNumber(reviews)} tone={reviews > 0 ? 'warn' : 'ok'} />
        <StatCard label="Total de hallazgos" value={formatNumber(all.length)} />
      </div>

      <SectionTabs
        tabs={[
          {
            id: 'findings',
            label: 'Hallazgos',
            content: (
              <Card>
                <SearchBar
                  value={term}
                  onChange={setTerm}
                  placeholder="Buscar por documento, cliente o detalle…"
                  right={
                    <StatusTabs
                      value={filter}
                      onChange={setFilter}
                      options={[
                        { id: 'ALL', label: 'Todos', count: filtered.length },
                        { id: 'ERROR', label: 'Errores' },
                        { id: 'REVIEW', label: 'Revisar' },
                      ]}
                    />
                  }
                />
                {findings.isLoading ? (
                  <LoadingState />
                ) : findings.error ? (
                  <ErrorState error={findings.error} onRetry={() => void findings.refetch()} />
                ) : rows.length === 0 ? (
                  <EmptyState
                    title="Todo cuadra"
                    description="No hay diferencias entre el proveedor, las facturas y los cobros registrados."
                  />
                ) : (
                  <DataTable columns={['Tipo', 'Sujeto', 'Organización', 'Detalle', 'Importe', '']}>
                    {rows.map((f, idx) => (
                      <tr key={`${f.finding_type}-${f.subject}-${idx}`}>
                        <td className="ebim-td">
                          <Badge tone={SEVERITY_TONE[f.severity as string] ?? 'neutral'}>
                            {FINDING_LABEL[f.finding_type as string] ?? f.finding_type}
                          </Badge>
                        </td>
                        <td className="ebim-td font-mono text-xs font-semibold">{f.subject}</td>
                        <td className="ebim-td text-muted">{f.organization_name}</td>
                        <td className="ebim-td text-xs text-muted">{f.detail}</td>
                        <td className="ebim-td tabular-nums">
                          {f.amount !== null
                            ? formatMoney(Number(f.amount), (f.currency as string) ?? 'USD')
                            : '—'}
                        </td>
                        <td className="ebim-td text-right">
                          {f.subscription_id ? (
                            <Link
                              className="ebim-link text-[13px]"
                              to={`/subscriptions/${f.subscription_id}`}
                            >
                              Ver
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'products',
            label: 'Por producto',
            content: (
              <Card
                title="Panel gerencial por producto"
                description="Agrupado por moneda: sin tabla de tipos de cambio, consolidar PEN y USD daría un número no auditable."
              >
                {products.isLoading ? (
                  <LoadingState />
                ) : (products.data ?? []).length === 0 ? (
                  <EmptyState title="Sin datos financieros" />
                ) : (
                  <DataTable
                    columns={[
                      'Producto', 'Moneda', 'MRR', 'Licencia cobrada', 'Implementación',
                      'Infraestructura', 'Costo', 'Comisiones', 'Margen', '%',
                    ]}
                  >
                    {(products.data ?? [])
                      .filter((p) => Number(p.collected_revenue) > 0 || Number(p.mrr) > 0)
                      .map((p) => (
                        <tr key={`${p.saas_product_id}-${p.currency}`}>
                          <td className="ebim-td font-semibold">{p.short_name}</td>
                          <td className="ebim-td text-muted">{p.currency}</td>
                          <td className="ebim-td tabular-nums">
                            {formatMoney(Number(p.mrr), p.currency ?? 'USD')}
                          </td>
                          <td className="ebim-td tabular-nums">
                            {formatMoney(Number(p.collected_license), p.currency ?? 'USD')}
                          </td>
                          <td className="ebim-td tabular-nums">
                            {formatMoney(Number(p.collected_implementation), p.currency ?? 'USD')}
                          </td>
                          <td className="ebim-td tabular-nums">
                            {formatMoney(Number(p.collected_infrastructure), p.currency ?? 'USD')}
                          </td>
                          <td className="ebim-td tabular-nums text-warn">
                            {formatMoney(Number(p.direct_cost), p.currency ?? 'USD')}
                          </td>
                          <td className="ebim-td tabular-nums text-warn">
                            {formatMoney(Number(p.commission_total), p.currency ?? 'USD')}
                          </td>
                          <td
                            className={`ebim-td tabular-nums font-semibold ${
                              Number(p.gross_margin) >= 0 ? 'text-ok' : 'text-danger'
                            }`}
                          >
                            {formatMoney(Number(p.gross_margin), p.currency ?? 'USD')}
                          </td>
                          <td className="ebim-td tabular-nums text-muted">
                            {p.margin_rate !== null ? formatPercent(Number(p.margin_rate)) : '—'}
                          </td>
                        </tr>
                      ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'partners',
            label: 'Por canal',
            content: (
              <Card
                title="Panel por partner"
                description="El margen del canal y la comisión de los comerciales son conceptos DISTINTOS: van en columnas separadas para que nadie los sume dos veces."
              >
                {partners.isLoading ? (
                  <LoadingState />
                ) : (partners.data ?? []).length === 0 ? (
                  <EmptyState title="Sin canales con actividad" />
                ) : (
                  <DataTable
                    columns={[
                      'Organización', 'Moneda', 'MRR', 'Cobrado', 'Costo directo',
                      'Margen bruto', 'Margen de canal', 'Comisión a comerciales', 'Tenants',
                    ]}
                  >
                    {(partners.data ?? []).map((p) => (
                      <tr key={`${p.organization_id}-${p.currency}`}>
                        <td className="ebim-td">
                          <Link className="ebim-link" to={`/organizations/${p.organization_id}`}>
                            {p.organization_name}
                          </Link>
                        </td>
                        <td className="ebim-td text-muted">{p.currency}</td>
                        <td className="ebim-td tabular-nums">
                          {formatMoney(Number(p.mrr), p.currency ?? 'USD')}
                        </td>
                        <td className="ebim-td tabular-nums">
                          {formatMoney(Number(p.collected_revenue), p.currency ?? 'USD')}
                        </td>
                        <td className="ebim-td tabular-nums text-warn">
                          {formatMoney(Number(p.direct_cost), p.currency ?? 'USD')}
                        </td>
                        <td
                          className={`ebim-td tabular-nums font-semibold ${
                            Number(p.gross_margin) >= 0 ? 'text-ok' : 'text-danger'
                          }`}
                        >
                          {formatMoney(Number(p.gross_margin), p.currency ?? 'USD')}
                        </td>
                        <td className="ebim-td tabular-nums">
                          {p.weighted_channel_margin_rate !== null
                            ? formatPercent(Number(p.weighted_channel_margin_rate))
                            : '—'}
                        </td>
                        <td className="ebim-td tabular-nums">
                          {formatMoney(Number(p.agent_commissions), p.currency ?? 'USD')}
                        </td>
                        <td className="ebim-td tabular-nums">{formatNumber(Number(p.managed_tenants))}</td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'events',
            label: 'Eventos del proveedor',
            content: (
              <Card
                title="Últimos eventos de webhook"
                description="Ledger de idempotencia. Un evento IGNORADO no es un fallo: es la defensa funcionando ante una entrega repetida."
              >
                {events.isLoading ? (
                  <LoadingState />
                ) : (events.data ?? []).length === 0 ? (
                  <EmptyState
                    title="Sin eventos registrados"
                    description="No se ha recibido ningún webhook del proveedor todavía."
                  />
                ) : (
                  <DataTable columns={['Recibido', 'Cuenta', 'Tipo', 'Estado', 'Resultado']}>
                    {(events.data ?? []).map((e) => (
                      <tr key={e.id}>
                        <td className="ebim-td text-xs text-muted">{formatDateTime(e.received_at)}</td>
                        <td className="ebim-td font-mono text-xs">
                          {(e.payment_provider_accounts as { code: string } | null)?.code}
                        </td>
                        <td className="ebim-td">{e.event_type}</td>
                        <td className="ebim-td">
                          <Badge
                            tone={
                              e.status === 'PROCESSED'
                                ? 'ok'
                                : e.status === 'REJECTED'
                                  ? 'danger'
                                  : 'neutral'
                            }
                          >
                            {e.status}
                          </Badge>
                        </td>
                        <td className="ebim-td text-xs text-muted">
                          {e.error_message ?? (e.payment_id ? 'Cobro registrado' : '—')}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
        ]}
      />
    </PageContainer>
  );
}
