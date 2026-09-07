import { Link } from 'react-router-dom';
import {
  useSubscriptionCollection, useRenewalDashboard, useCommercialDocuments,
  useInvoices, useCommissionDetail, usePartnerFinance, useTenantOverview,
  useProvisioningRequests, usePartnerAgreements,
} from '@/services/queries';
import { Card, DataTable, StatCard, EmptyState, Badge, LoadingState } from '@/components/ui/primitives';
import { formatMoney, formatDate, formatNumber, formatPercent } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';

/**
 * Vista 360 de una organización.
 *
 * Es la pantalla que la Fase 14 señala como «la demostración principal del
 * Control Plane»: en un solo lugar, todo lo que gerencia pregunta sobre una
 * cuenta — qué contrató, dónde vive, cómo paga cada cosa, cuándo renueva, si
 * tiene la OS al día, cuánto se cobró, quién se lleva comisión y cuánto margen
 * deja.
 *
 * La fila clave es la de COBRANZA POR SaaS: es donde se ve, de un vistazo, que
 * el mismo cliente paga eSupplier con tarjeta y WMS con Orden de Servicio.
 */

const METHOD_LABEL: Record<string, string> = {
  CULQI_CARD: 'Tarjeta (Culqi)',
  SERVICE_ORDER: 'Orden de Servicio',
  PURCHASE_ORDER: 'Orden de Compra',
  BANK_TRANSFER: 'Transferencia',
  MANUAL: 'Manual',
};

const DOC_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Solicitada',
  RECEIVED: 'Recibida',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  EXPIRED: 'Vencida',
  CANCELLED: 'Anulada',
};

export function Organization360({
  organizationId,
  organizationName,
  capabilities,
}: {
  organizationId: string;
  organizationName: string;
  capabilities: string[];
}) {
  const collection = useSubscriptionCollection();
  const renewals = useRenewalDashboard();
  const documents = useCommercialDocuments();
  const invoices = useInvoices();
  const commissions = useCommissionDetail();
  const partnerFinance = usePartnerFinance();
  const tenants = useTenantOverview();
  const provisioning = useProvisioningRequests();
  const agreements = usePartnerAgreements(organizationId);

  const loading = collection.isLoading || renewals.isLoading || invoices.isLoading;

  // Todo se filtra en cliente sobre datos que RLS ya acotó: si una fila no es
  // visible para este usuario, sencillamente no llegó.
  const orgSubs = (collection.data ?? []).filter(
    (c) => c.billed_organization_id === organizationId,
  );
  const subIds = new Set(orgSubs.map((s) => s.subscription_id as string));

  const orgRenewals = (renewals.data ?? []).filter((r) => subIds.has(r.subscription_id as string));
  const orgDocs = (documents.data ?? []).filter((d) => subIds.has(d.subscription_id as string));
  const orgInvoices = (invoices.data ?? []).filter(
    (i) => i.customer_organization_id === organizationId,
  );
  const orgCommissions = (commissions.data ?? []).filter((c) =>
    orgSubs.some((s) => s.tenant_id && s.tenant_id === c.tenant_id),
  );
  const asCustomer = (tenants.data ?? []).filter((t) => t.customer_organization_id === organizationId);
  const asManager = (tenants.data ?? []).filter((t) => t.managing_organization_id === organizationId);
  const orgProvisioning = (provisioning.data ?? []).filter((p) =>
    [...asCustomer, ...asManager].some((t) => t.tenant_id === p.tenant_id),
  );
  const finance = (partnerFinance.data ?? []).filter((f) => f.organization_id === organizationId);

  const confirmedCollected = orgInvoices.reduce((sum, i) => {
    const payments = (i.payments ?? []) as Array<Record<string, unknown>>;
    return sum + payments
      .filter((p) => p.status === 'CONFIRMED')
      .reduce((a, p) => a + Number(p.amount ?? 0), 0);
  }, 0);

  const distinctMethods = new Set(
    orgSubs.filter((s) => s.collection_method).map((s) => s.collection_method as string),
  );

  if (loading) return <LoadingState label="Componiendo la vista 360…" />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Productos contratados" value={formatNumber(new Set(orgSubs.map((s) => s.product_code)).size)} />
        <StatCard label="Tenants propios" value={formatNumber(asCustomer.length)} />
        <StatCard label="Tenants que administra" value={formatNumber(asManager.length)} />
        <StatCard
          label="Métodos de cobro distintos"
          value={formatNumber(distinctMethods.size)}
          hint={distinctMethods.size > 1 ? 'Cada SaaS puede pagarse de otra forma' : undefined}
          tone={distinctMethods.size > 1 ? 'ok' : 'neutral'}
        />
        <StatCard label="Cobrado confirmado" value={formatMoney(confirmedCollected)} tone="ok" />
      </div>

      <Card
        title="Capacidades y acuerdos"
        description="Las capacidades son acumulables: la misma empresa puede ser cliente y partner."
      >
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {capabilities.length === 0 ? (
            <span className="text-sm text-muted">Sin capacidades asignadas</span>
          ) : (
            capabilities.map((c) => (
              <Badge key={c} tone={c === 'CUSTOMER' ? 'info' : 'ok'}>{c}</Badge>
            ))
          )}
        </div>
        {(agreements.data ?? []).length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">
            No comercializa ningún SaaS: es una cuenta cliente.
          </p>
        ) : (
          <DataTable columns={['Producto', 'Margen', 'Modelos permitidos', 'Tenants', 'Factura']}>
            {(agreements.data ?? []).map((a) => (
              <tr key={a.agreement_id as string}>
                <td className="ebim-td font-semibold">{a.product_short_name}</td>
                <td className="ebim-td tabular-nums">{formatPercent(Number(a.margin_rate))}</td>
                <td className="ebim-td">
                  <div className="flex flex-wrap gap-1">
                    {((a.allowed_deployment_modes ?? []) as string[]).map((m) => (
                      <Badge key={m} tone="neutral">
                        {DEPLOYMENT_MODE_LABEL[m as keyof typeof DEPLOYMENT_MODE_LABEL]}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="ebim-td tabular-nums">
                  {formatNumber(Number(a.managed_tenants))}
                  {a.max_tenants ? <span className="text-muted"> / {a.max_tenants}</span> : null}
                </td>
                <td className="ebim-td text-xs text-muted">{a.billing_responsibility}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      {/* La fila que demuestra el modelo de cobranza por suscripción. */}
      <Card
        title="Cobranza por SaaS"
        description="El método se configura por suscripción, no por cliente: por eso un mismo cliente puede pagar cada producto de forma distinta."
      >
        {orgSubs.length === 0 ? (
          <EmptyState title="Sin suscripciones" description={`${organizationName} no tiene contratos activos.`} />
        ) : (
          <DataTable
            columns={['Producto', 'Suscripción', 'Tenant', 'Modelo', 'Método de cobro', 'Renueva', 'Documento', 'Estado']}
          >
            {orgSubs.map((s) => {
              const renewal = orgRenewals.find((r) => r.subscription_id === s.subscription_id);
              const doc = orgDocs.find(
                (d) =>
                  d.subscription_id === s.subscription_id &&
                  ['REQUESTED', 'RECEIVED', 'APPROVED'].includes(d.status as string),
              );
              const needsDoc = s.requires_service_order || s.requires_purchase_order;
              return (
                <tr key={s.subscription_id as string}>
                  <td className="ebim-td font-semibold">{s.product_short_name}</td>
                  <td className="ebim-td">
                    <Link className="ebim-link font-mono text-xs" to={`/subscriptions/${s.subscription_id}`}>
                      {s.subscription_code}
                    </Link>
                  </td>
                  <td className="ebim-td text-muted">
                    {s.tenant_id ? (
                      <Link className="ebim-link" to={`/tenants/${s.tenant_id}`}>{s.tenant_name}</Link>
                    ) : (
                      <Badge tone="accent">Nivel partner</Badge>
                    )}
                  </td>
                  <td className="ebim-td text-xs text-muted">
                    {asCustomer.find((t) => t.tenant_id === s.tenant_id)?.deployment_mode
                      ? DEPLOYMENT_MODE_LABEL[
                          asCustomer.find((t) => t.tenant_id === s.tenant_id)!
                            .deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL
                        ]
                      : '—'}
                  </td>
                  <td className="ebim-td">
                    {s.collection_method ? (
                      <Badge tone="accent">{METHOD_LABEL[s.collection_method as string]}</Badge>
                    ) : (
                      <Badge tone="warn">Manual (sin perfil)</Badge>
                    )}
                  </td>
                  <td className="ebim-td text-xs">
                    {renewal?.renewal_on ? formatDate(renewal.renewal_on) : '—'}
                    {renewal?.days_to_renewal !== undefined && renewal?.days_to_renewal !== null ? (
                      <span className="text-muted"> ({renewal.days_to_renewal}d)</span>
                    ) : null}
                  </td>
                  <td className="ebim-td text-xs">
                    {!needsDoc ? (
                      <span className="text-muted">No aplica</span>
                    ) : doc ? (
                      <Badge tone={doc.status === 'APPROVED' ? 'ok' : 'warn'}>
                        {DOC_STATUS_LABEL[doc.status as string]}
                      </Badge>
                    ) : (
                      <Badge tone="danger">Falta</Badge>
                    )}
                  </td>
                  <td className="ebim-td">
                    <div className="flex flex-wrap gap-1">
                      {renewal?.is_past_due ? <Badge tone="warn">Vencida</Badge> : null}
                      {renewal?.suspension_pending ? <Badge tone="danger">Suspensión</Badge> : null}
                      {!renewal?.is_past_due && !renewal?.suspension_pending ? (
                        <Badge tone="ok">Al día</Badge>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Cobros confirmados" description="Solo lo cobrado. Una factura emitida no es dinero.">
          {orgInvoices.length === 0 ? (
            <EmptyState title="Sin facturas" />
          ) : (
            <DataTable columns={['Factura', 'Total', 'Estado', 'Cobrado']}>
              {orgInvoices.slice(0, 10).map((i) => {
                const payments = (i.payments ?? []) as Array<Record<string, unknown>>;
                const paid = payments
                  .filter((p) => p.status === 'CONFIRMED')
                  .reduce((a, p) => a + Number(p.amount ?? 0), 0);
                return (
                  <tr key={i.id}>
                    <td className="ebim-td font-mono text-xs">{i.number}</td>
                    <td className="ebim-td tabular-nums">{formatMoney(Number(i.total), i.currency)}</td>
                    <td className="ebim-td">
                      <Badge tone={i.status === 'PAID' ? 'ok' : i.status === 'VOID' ? 'neutral' : 'warn'}>
                        {i.status}
                      </Badge>
                    </td>
                    <td className="ebim-td tabular-nums">{formatMoney(paid, i.currency)}</td>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </Card>

        <Card
          title="Comercial y comisiones"
          description="La comisión nace del cobro confirmado, nunca de la factura ni de la OS/OC."
        >
          {orgCommissions.length === 0 ? (
            <EmptyState title="Sin comisiones asociadas" />
          ) : (
            <DataTable columns={['Comercial', 'Origen', 'Importe', 'Estado']}>
              {orgCommissions.slice(0, 10).map((c) => (
                <tr key={c.commission_event_id as string}>
                  <td className="ebim-td">{c.agent_name}</td>
                  <td className="ebim-td">
                    <Badge tone={c.is_reversal ? 'danger' : 'info'}>{c.source_label}</Badge>
                  </td>
                  <td
                    className={`ebim-td tabular-nums ${Number(c.amount) < 0 ? 'text-danger' : ''}`}
                  >
                    {formatMoney(Number(c.amount), c.currency ?? 'USD')}
                  </td>
                  <td className="ebim-td text-muted">{c.status}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      </div>

      {finance.length > 0 ? (
        <Card
          title="Margen aproximado"
          description="Agrupado por moneda. El margen del canal y la comisión a comerciales son conceptos distintos y no se suman."
        >
          <div className="space-y-4 p-4">
            {finance.map((f) => (
              <div key={(f.currency as string) ?? 'USD'}>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                  Moneda {f.currency}
                </p>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <StatCard label="MRR" value={formatMoney(Number(f.mrr), f.currency ?? 'USD')} />
                  <StatCard
                    label="Cobrado"
                    value={formatMoney(Number(f.collected_revenue), f.currency ?? 'USD')}
                    tone="ok"
                  />
                  <StatCard
                    label="Costo directo"
                    value={formatMoney(Number(f.direct_cost), f.currency ?? 'USD')}
                    tone="warn"
                  />
                  <StatCard
                    label="Margen de canal"
                    value={
                      f.weighted_channel_margin_rate !== null
                        ? formatPercent(Number(f.weighted_channel_margin_rate))
                        : '—'
                    }
                    hint="Descuento pactado"
                  />
                  <StatCard
                    label="Margen bruto"
                    value={formatMoney(Number(f.gross_margin), f.currency ?? 'USD')}
                    tone={Number(f.gross_margin) >= 0 ? 'ok' : 'danger'}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card
        title="Infraestructura y provisioning"
        description="Modo DRY_RUN por defecto: la consola registra la intención, no ejecuta cambios remotos."
      >
        {orgProvisioning.length === 0 ? (
          <EmptyState title="Sin solicitudes de provisioning" />
        ) : (
          <DataTable columns={['Acción', 'Tenant', 'Modo', 'Estado', 'Creada']}>
            {orgProvisioning.slice(0, 10).map((p) => (
              <tr key={p.id as string}>
                <td className="ebim-td font-medium">{p.action as string}</td>
                <td className="ebim-td text-muted">
                  {(p.tenants as { name: string } | null)?.name ?? '—'}
                </td>
                <td className="ebim-td">
                  <Badge tone={p.mode === 'DRY_RUN' ? 'info' : 'warn'}>{p.mode as string}</Badge>
                </td>
                <td className="ebim-td">
                  <Badge
                    tone={p.status === 'SUCCEEDED' ? 'ok' : p.status === 'FAILED' ? 'danger' : 'warn'}
                  >
                    {p.status as string}
                  </Badge>
                </td>
                <td className="ebim-td text-xs text-muted">{formatDate(p.created_at as string)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}
