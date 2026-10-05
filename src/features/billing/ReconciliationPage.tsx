import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useFinanceReconciliation, useProductFinance, usePartnerFinance, useWebhookEvents,
} from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { SectionTabs, StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, KpiTile, type DataColumn,
} from '@/components/ui/primitives';
import { formatMoney, formatPercent, formatNumber, formatDateTime } from '@/lib/format';
import { InfoNote } from './listing';
import { KpiStrip } from './financeUi';

const R = (label: string): DataColumn => ({ label, align: 'right' });

/** Solo una pérdida se marca; un margen positivo no se pinta de verde (A09). */
function lossClass(value: unknown): string {
  return Number(value ?? 0) < 0 ? 'text-danger' : 'text-fg';
}

/**
 * Reconciliación financiera.
 *
 * Esta pantalla DESCRIBE lo que no cuadra; no lo arregla. Corregir un descuadre
 * automáticamente hace que el número cierre y que nadie sepa por qué, que es
 * justo lo contrario de lo que necesita un cierre contable.
 *
 * Todo se agrupa POR MONEDA. Aquí no se convierte: el consolidado con tipo de
 * cambio explícito vive en el inicio ejecutivo. Entrar a esta pantalla sólo LEE
 * (vistas y ledger); no existe ninguna acción que corrija un hallazgo.
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

const SEVERITY_LABEL: Record<string, string> = {
  OK: 'Cuadra',
  REVIEW: 'Revisar',
  ERROR: 'Error',
};

/** Prioridad de la bandeja: primero los errores, luego lo que hay que revisar. */
const SEVERITY_RANK: Record<string, number> = { ERROR: 0, REVIEW: 1, OK: 2 };

/** Dónde nace cada tipo de hallazgo: ayuda a saber a quién preguntar. */
const FINDING_SOURCE: Record<string, string> = {
  PROVIDER_DRIFT: 'Proveedor de pagos vs. suscripción',
  OPEN_INVOICE: 'Facturas',
  EXPIRED_DOCUMENT: 'Documentos del cliente',
  REVERSED_PAYMENT: 'Cobros',
  REJECTED_WEBHOOK: 'Ledger de webhooks',
  MISSING_COLLECTION_PROFILE: 'Perfil de cobro',
};

const EVENT_STATUS_LABEL: Record<string, string> = {
  RECEIVED: 'Recibido',
  PROCESSED: 'Procesado',
  IGNORED: 'Ignorado (repetido)',
  REJECTED: 'Rechazado',
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

  const rows = filtered
    .filter((f) => (filter === 'ALL' ? true : f.severity === filter))
    .sort((a, b) => (SEVERITY_RANK[a.severity ?? ''] ?? 9) - (SEVERITY_RANK[b.severity ?? ''] ?? 9));
  const all = findings.data ?? [];
  const rejectedEvents = (events.data ?? []).filter((e) => e.status === 'REJECTED').length;

  const errors = all.filter((f) => f.severity === 'ERROR').length;
  const reviews = all.filter((f) => f.severity === 'REVIEW').length;

  return (
    <PageContainer
      title="Reconciliación"
      description="Diferencias entre lo que dice el proveedor, lo que dice la factura y lo que dice el cobro. La pantalla diagnostica; las correcciones las decide una persona."
      actions={
        findings.data ? (
          <Badge tone={errors > 0 ? 'danger' : reviews > 0 ? 'warn' : 'ok'}>
            {errors > 0 ? 'Con errores' : reviews > 0 ? 'Hay que revisar' : 'Todo cuadra'}
          </Badge>
        ) : null
      }
    >
      <KpiStrip label="Indicadores de reconciliación">
        <KpiTile
          label="Hallazgos con error"
          info="Diferencias que no deberían existir: hay que corregirlas desde el contrato o la factura."
          value={findings.data ? formatNumber(errors) : null}
          tone={errors > 0 ? 'danger' : 'neutral'}
          footer="Foto actual"
          loading={findings.isLoading}
          error={findings.error}
          onRetry={() => void findings.refetch()}
        />
        <KpiTile
          label="Para revisar"
          info="Situaciones que pueden ser correctas pero piden una mirada (OS/OC vencida, factura abierta vencida…)."
          value={findings.data ? formatNumber(reviews) : null}
          tone={reviews > 0 ? 'warn' : 'neutral'}
          footer="Foto actual"
          loading={findings.isLoading}
          error={findings.error}
          onRetry={() => void findings.refetch()}
        />
        <KpiTile
          label="Total de hallazgos"
          value={findings.data ? formatNumber(all.length) : null}
          footer={all.length === 0 ? 'Todo cuadra' : 'Proveedor, facturas y cobros'}
          loading={findings.isLoading}
          error={findings.error}
          onRetry={() => void findings.refetch()}
        />
        <KpiTile
          label="Webhooks rechazados"
          info="Eventos del proveedor que el ledger rechazó. Un evento IGNORADO (repetido) no es un fallo."
          value={events.data ? formatNumber(rejectedEvents) : null}
          tone={rejectedEvents > 0 ? 'warn' : 'neutral'}
          footer={events.data ? `de los últimos ${formatNumber(events.data.length)} eventos` : undefined}
          loading={events.isLoading}
          error={events.error}
          onRetry={() => void events.refetch()}
        />
      </KpiStrip>

      <div className="mb-4">
        <InfoNote>
          <strong>Sólo diagnóstico.</strong> Abrir esta pantalla no corrige, reintenta ni registra nada. Cada hallazgo indica
          su causa y su fuente; la corrección la decide una persona desde el contrato o la factura.
        </InfoNote>
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
                  <DataTable
                    maxHeight={640}
                    label="Hallazgos"
                    columns={['Prioridad', 'Hallazgo', 'Sujeto', 'Organización', 'Detalle', R('Importe')]}
                  >
                    {rows.map((f, idx) => (
                      <tr key={`${f.finding_type}-${f.subject}-${idx}`}>
                        <td className="ebim-td">
                          <Badge tone={SEVERITY_TONE[f.severity as string] ?? 'neutral'}>
                            {SEVERITY_LABEL[f.severity as string] ?? f.severity}
                          </Badge>
                        </td>
                        <td className="ebim-td">
                          <span className="block whitespace-nowrap font-semibold">{FINDING_LABEL[f.finding_type as string] ?? f.finding_type}</span>
                          <span className="block max-w-[220px] truncate text-compact text-fg-2" title={`Fuente: ${FINDING_SOURCE[f.finding_type as string] ?? 'Sin clasificar'}`}>
                            {FINDING_SOURCE[f.finding_type as string] ?? 'Sin clasificar'}
                          </span>
                        </td>
                        <td className="ebim-td">
                          {/* El sujeto lleva al contrato: la corrección se decide ahí (acción primaria de la fila). */}
                          {f.subscription_id ? (
                            <Link
                              className="ebim-link block max-w-[180px] truncate whitespace-nowrap font-mono text-compact"
                              title={`${f.subject ?? ''} · abrir el contrato`}
                              to={`/subscriptions/${f.subscription_id}`}
                            >
                              {f.subject}
                            </Link>
                          ) : (
                            <span className="block max-w-[180px] truncate whitespace-nowrap font-mono text-compact font-semibold" title={f.subject ?? undefined}>
                              {f.subject}
                            </span>
                          )}
                        </td>
                        <td className="ebim-td">
                          <span className="block max-w-[170px] truncate text-fg-2" title={f.organization_name ?? undefined}>
                            {f.organization_name}
                          </span>
                        </td>
                        <td className="ebim-td">
                          <span className="line-clamp-2 block min-w-[220px] max-w-[340px] text-compact text-fg-2" title={f.detail ?? undefined}>
                            {f.detail}
                          </span>
                        </td>
                        <td className="ebim-td ebim-num whitespace-nowrap">
                          {f.amount !== null
                            ? formatMoney(Number(f.amount), f.currency as string | null)
                            : '—'}
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
                description="Una fila por producto y moneda: aquí no se convierte. El consolidado con tipo de cambio explícito está en el inicio. Margen gerencial, no contable."
              >
                {products.isLoading ? (
                  <LoadingState />
                ) : products.error ? (
                  <ErrorState error={products.error} onRetry={() => void products.refetch()} />
                ) : (products.data ?? []).length === 0 ? (
                  <EmptyState title="Sin datos financieros" />
                ) : (
                  <DataTable
                    label="Panel gerencial por producto"
                    columns={[
                      'Producto', 'Moneda', R('MRR'), R('Licencia cobrada'), R('Implementación'),
                      R('Infraestructura'), R('Costo'), R('Comisiones'), R('Margen gerencial'), R('% sobre cobrado'),
                    ]}
                  >
                    {(products.data ?? [])
                      .filter((p) => Number(p.collected_revenue) > 0 || Number(p.mrr) > 0)
                      .map((p) => (
                        <tr key={`${p.saas_product_id}-${p.currency}`}>
                          <td className="ebim-td font-semibold">{p.short_name}</td>
                          <td className="ebim-td text-muted">{p.currency}</td>
                          <td className="ebim-td ebim-num whitespace-nowrap">
                            {formatMoney(Number(p.mrr), p.currency)}
                          </td>
                          <td className="ebim-td ebim-num whitespace-nowrap">
                            {formatMoney(Number(p.collected_license), p.currency)}
                          </td>
                          <td className="ebim-td ebim-num whitespace-nowrap">
                            {formatMoney(Number(p.collected_implementation), p.currency)}
                          </td>
                          <td className="ebim-td ebim-num whitespace-nowrap">
                            {formatMoney(Number(p.collected_infrastructure), p.currency)}
                          </td>
                          <td className="ebim-td ebim-num whitespace-nowrap">
                            {formatMoney(Number(p.direct_cost), p.currency)}
                          </td>
                          <td className="ebim-td ebim-num whitespace-nowrap">
                            {formatMoney(Number(p.commission_total), p.currency)}
                          </td>
                          <td
                            className={`ebim-td ebim-num whitespace-nowrap font-semibold ${lossClass(p.gross_margin)}`}
                          >
                            {formatMoney(Number(p.gross_margin), p.currency)}
                          </td>
                          <td className="ebim-td ebim-num whitespace-nowrap text-fg-2">
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
                ) : partners.error ? (
                  <ErrorState error={partners.error} onRetry={() => void partners.refetch()} />
                ) : (partners.data ?? []).length === 0 ? (
                  <EmptyState title="Sin canales con actividad" />
                ) : (
                  <DataTable
                    label="Panel por partner"
                    columns={[
                      'Organización', 'Moneda', R('MRR'), R('Cobrado'), R('Costo directo'),
                      R('Margen gerencial'), R('Margen de canal'), R('Comisión a comerciales'), R('Tenants'),
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
                        <td className="ebim-td ebim-num whitespace-nowrap">
                          {formatMoney(Number(p.mrr), p.currency)}
                        </td>
                        <td className="ebim-td ebim-num whitespace-nowrap">
                          {formatMoney(Number(p.collected_revenue), p.currency)}
                        </td>
                        <td className="ebim-td ebim-num whitespace-nowrap">
                          {formatMoney(Number(p.direct_cost), p.currency)}
                        </td>
                        <td
                          className={`ebim-td ebim-num whitespace-nowrap font-semibold ${lossClass(p.gross_margin)}`}
                        >
                          {formatMoney(Number(p.gross_margin), p.currency)}
                        </td>
                        <td className="ebim-td ebim-num whitespace-nowrap">
                          {p.weighted_channel_margin_rate !== null
                            ? formatPercent(Number(p.weighted_channel_margin_rate))
                            : '—'}
                        </td>
                        <td className="ebim-td ebim-num whitespace-nowrap">
                          {formatMoney(Number(p.agent_commissions), p.currency)}
                        </td>
                        <td className="ebim-td ebim-num whitespace-nowrap">{formatNumber(Number(p.managed_tenants))}</td>
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
                ) : events.error ? (
                  <ErrorState error={events.error} onRetry={() => void events.refetch()} />
                ) : (events.data ?? []).length === 0 ? (
                  <EmptyState
                    title="Sin eventos registrados"
                    description="No se ha recibido ningún webhook del proveedor todavía."
                  />
                ) : (
                  <DataTable label="Últimos eventos de webhook" columns={['Recibido', 'Cuenta', 'Tipo', 'Estado', 'Resultado']}>
                    {(events.data ?? []).map((e) => (
                      <tr key={e.id}>
                        <td className="ebim-td whitespace-nowrap text-compact text-fg-2">{formatDateTime(e.received_at)}</td>
                        <td className="ebim-td whitespace-nowrap font-mono text-compact">
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
                            {EVENT_STATUS_LABEL[e.status] ?? e.status}
                          </Badge>
                        </td>
                        <td className="ebim-td text-compact text-fg-2">
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
