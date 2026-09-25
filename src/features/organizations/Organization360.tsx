import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFinanceConsolidated, useProvisioningTargets } from '@/services/queries';
import { fetchInvoicePage, useInvoicePage, useInvoiceSummary, useRenewalPipeline, type InvoiceRow } from '@/services/financeRead';
import { Card, DataTable, Badge } from '@/components/ui/primitives';
import { PagedTable, type TableColumn } from '@/components/ui/PagedTable';
import { ExportMenu } from '@/components/ui/ExportMenu';
import type { ExportColumn } from '@/lib/export';
import { fromQuery, type DataState } from '@/features/executive/dataState';
import { isoDate, toCurrencyAmounts } from '@/features/executive/reportContext';
import { KpiCard, CurrencyLines, StateMessage } from '@/features/executive/components/StateView';
import { tenantDimensions } from '@/features/tenants/tenantDimensions';
import { TenantDimensionsInline } from '@/features/tenants/TenantDimensionsView';
import { formatMoney, formatNumber, formatDate, formatDateTime } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, INVOICE_STATUS_LABEL } from '@/types/domain';
import {
  useOrgAudit,
  useOrgCommissions,
  useOrgDocuments,
  useOrgInfraRequests,
  useOrgSaasProvisioning,
  useOrgSubscriptions,
  useOrgTenants,
} from './org360Queries';

/**
 * Cliente / partner 360 (spec §11.1, P22).
 *
 * Cada sección consulta SÓLO esta organización en el servidor (E16) y tiene su
 * PROPIO estado: si una fuente falla, esa sección lo dice y las demás siguen; un
 * error nunca se disfraza de «sin movimientos». Clientes y partners comparten la
 * misma ficha; lo que cada rol ve lo decide RLS.
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

function Section({ title, description, state, onRetry, children, empty }: {
  title: string;
  description?: string;
  state: DataState<unknown>;
  onRetry?: () => void;
  children: () => React.ReactNode;
  empty?: string;
}) {
  return (
    <Card title={title} description={description}>
      {state.status === 'ready' || state.status === 'partial' ? (
        children()
      ) : (
        <div className="px-4">
          <StateMessage state={state} onRetry={onRetry} emptyText={empty} />
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- Resumen */

export function Org360Summary({ organizationId, capabilities }: { organizationId: string; capabilities: string[] }) {
  const today = isoDate(new Date());
  const finance = useFinanceConsolidated({ asOf: today, groupBy: 'TOTAL', organizationId });
  const invoices = useInvoiceSummary({ search: '', filter: 'ALL', organizationId });
  const subs = useOrgSubscriptions(organizationId);
  const tenants = useOrgTenants(organizationId);
  const renewals = useRenewalPipeline(organizationId);

  const mrr: DataState<unknown> = fromQuery(finance, { isEmpty: (d) => d.groups.length === 0 });
  const invoiceState = fromQuery(invoices, { isEmpty: () => false });
  const own = (tenants.data ?? []).filter((t) => t.customer_organization_id === organizationId).length;
  const managed = (tenants.data ?? []).filter((t) => t.managing_organization_id === organizationId).length;
  const soon = (renewals.data ?? []).filter((r) => r.days_to_renewal !== null && Number(r.days_to_renewal) >= 0 && Number(r.days_to_renewal) <= 60);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">Capacidades:</span>
        {capabilities.length === 0 ? (
          <span className="text-xs text-muted">sin capacidades asignadas</span>
        ) : (
          capabilities.map((c) => (
            <Badge key={c} tone={c === 'CUSTOMER' ? 'info' : 'ok'}>{c === 'CUSTOMER' ? 'Cliente' : c === 'PARTNER' ? 'Partner' : c === 'RESELLER' ? 'Reseller' : c}</Badge>
          ))
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          id="org-mrr"
          label="MRR vigente"
          temporality="Foto actual"
          state={mrr}
          onRetry={() => void finance.refetch()}
          render={() => <CurrencyLines amounts={toCurrencyAmounts(finance.data?.groups[0]?.metrics.MRR?.native)} emptyLabel="Sin recurrente vigente" />}
          hint="Contratos facturados a la organización o administrados como canal"
          detailHref="#contracts"
          detailLabel="Ver contratos"
        />
        <KpiCard
          id="org-balance"
          label="Saldo por cobrar"
          temporality="Foto actual"
          state={invoiceState}
          onRetry={() => void invoices.refetch()}
          render={() => (
            <div>
              <CurrencyLines amounts={toCurrencyAmounts(invoices.data?.receivable)} emptyLabel="Sin saldo pendiente" />
              {Object.keys(toCurrencyAmounts(invoices.data?.overdue)).length ? (
                <p className="mt-1 text-xs font-semibold text-danger">
                  Vencido: {Object.entries(toCurrencyAmounts(invoices.data?.overdue)).map(([c, v]) => formatMoney(v, c)).join(' · ')}
                </p>
              ) : null}
            </div>
          )}
          detailHref="#billing"
          detailLabel="Ver cobros y saldo"
        />
        <KpiCard
          id="org-collected"
          label="Cobrado confirmado"
          temporality="Acumulado"
          state={invoiceState}
          onRetry={() => void invoices.refetch()}
          render={() => <CurrencyLines amounts={toCurrencyAmounts(invoices.data?.collected)} emptyLabel="Sin cobros confirmados" />}
          detailHref="#billing"
          detailLabel="Ver cobros"
        />
        <KpiCard
          id="org-products"
          label="Productos contratados"
          temporality="Contratos visibles"
          state={fromQuery(subs, { isEmpty: () => false })}
          onRetry={() => void subs.refetch()}
          render={() => <p className="tabular-nums">{formatNumber(new Set((subs.data ?? []).map((s) => s.product_code)).size)}</p>}
          detailHref="#contracts"
        />
        <KpiCard
          id="org-methods"
          label="Métodos de cobro distintos"
          temporality="Por suscripción"
          state={fromQuery(subs, { isEmpty: () => false })}
          onRetry={() => void subs.refetch()}
          render={() => {
            const methods = new Set((subs.data ?? []).map((x) => x.collection_method ?? 'MANUAL'));
            return (
              <div>
                <p className="tabular-nums">{formatNumber(methods.size)}</p>
                <p className="mt-1 text-xs font-medium text-muted">
                  {[...methods].map((m) => METHOD_LABEL[m as string] ?? m).join(' · ') || 'Sin contratos'}
                </p>
              </div>
            );
          }}
          hint="El método se define por contrato: cada SaaS puede pagarse de otra forma"
          detailHref="#contracts"
        />
        <KpiCard
          id="org-tenants"
          label="Tenants"
          temporality="Registro actual"
          state={fromQuery(tenants, { isEmpty: () => false })}
          onRetry={() => void tenants.refetch()}
          render={() => (
            <p className="text-base">
              <span className="tabular-nums">{formatNumber(own)}</span> propios ·{' '}
              <span className="tabular-nums">{formatNumber(managed)}</span> administrados
            </p>
          )}
          detailHref="#tenants"
        />
        <KpiCard
          id="org-renewals"
          label="Renovaciones en 60 días"
          temporality="Desde hoy"
          state={fromQuery(renewals, { isEmpty: () => false })}
          onRetry={() => void renewals.refetch()}
          render={() => <p className="tabular-nums">{formatNumber(soon.length)} contratos</p>}
          detailHref="/renewals"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------ Productos y contratos */

export function Org360Contracts({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const subs = useOrgSubscriptions(organizationId);
  const docs = useOrgDocuments(organizationId);
  const renewals = useRenewalPipeline(organizationId);
  const tenants = useOrgTenants(organizationId);

  return (
    <Section
      title="Cobranza por SaaS"
      description="El método se configura por suscripción, no por cliente: un mismo cliente puede pagar cada producto de forma distinta."
      state={fromQuery(subs)}
      onRetry={() => void subs.refetch()}
      empty={`${organizationName} no tiene contratos visibles.`}
    >
      {() => (
        <DataTable columns={['Producto', 'Contrato', 'Tenant', 'Modelo', 'Método de cobro', 'Renueva', 'Documento', 'Estado']}>
          {subs.data!.map((s) => {
            const renewal = (renewals.data ?? []).find((r) => r.subscription_id === s.subscription_id);
            const doc = (docs.data ?? []).find((d) => d.subscription_id === s.subscription_id);
            const tenant = (tenants.data ?? []).find((t) => t.tenant_id === s.tenant_id);
            return (
              <tr key={s.subscription_id as string}>
                <td className="ebim-td font-semibold">{s.product_short_name}</td>
                <td className="ebim-td">
                  <Link className="ebim-link font-mono text-xs" to={`/subscriptions/${s.subscription_id}`}>{s.subscription_code}</Link>
                </td>
                <td className="ebim-td">
                  {s.tenant_id ? <Link className="ebim-link" to={`/tenants/${s.tenant_id}`}>{s.tenant_name}</Link> : <Badge tone="accent">Nivel partner</Badge>}
                </td>
                <td className="ebim-td text-xs text-muted">
                  {tenant?.deployment_mode ? DEPLOYMENT_MODE_LABEL[tenant.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL] : '—'}
                </td>
                <td className="ebim-td">
                  {s.collection_method ? <Badge tone="accent">{METHOD_LABEL[s.collection_method as string] ?? s.collection_method}</Badge> : <Badge tone="warn">Manual (sin perfil)</Badge>}
                </td>
                <td className="ebim-td text-xs">
                  {renewals.error ? <span className="text-danger">No se pudo leer</span> : renewal?.renewal_on ? `${formatDate(renewal.renewal_on)} (${renewal.days_to_renewal} d)` : '—'}
                </td>
                <td className="ebim-td text-xs">
                  {docs.error ? (
                    <span className="text-danger">No se pudo leer</span>
                  ) : !doc?.document_required ? (
                    <span className="text-muted">No aplica</span>
                  ) : doc.document_ok ? (
                    <Badge tone="ok">Vigente</Badge>
                  ) : doc.document_status ? (
                    <Badge tone="warn">{DOC_STATUS_LABEL[doc.document_status] ?? doc.document_status}</Badge>
                  ) : (
                    <Badge tone="danger">Falta</Badge>
                  )}
                </td>
                <td className="ebim-td">
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={s.subscription_status === 'ACTIVE' ? 'ok' : 'neutral'}>{s.subscription_status as string}</Badge>
                    {renewal?.is_past_due ? <Badge tone="warn">Con deuda vencida</Badge> : null}
                    {renewal?.suspension_pending ? <Badge tone="danger">Suspensión pendiente</Badge> : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </Section>
  );
}

/* ---------------------------------------------- Suscripciones, cobros y saldo */

const INVOICE_EXPORT: ExportColumn<InvoiceRow>[] = [
  { header: 'Número', value: (r) => r.number },
  { header: 'Organización', value: (r) => r.organization_name },
  { header: 'Estado', value: (r) => r.status },
  { header: 'Emisión', value: (r) => r.issue_date },
  { header: 'Vencimiento', value: (r) => r.due_date },
  { header: 'Total', value: (r) => r.total, kind: 'amount' },
  { header: 'Cobrado', value: (r) => r.confirmed_paid, kind: 'amount' },
  { header: 'Saldo', value: (r) => r.balance, kind: 'amount' },
  { header: 'Moneda', value: (r) => r.currency },
];

export function Org360Billing({ organizationId }: { organizationId: string }) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<{ by: string; dir: 'asc' | 'desc' }>({ by: 'issue_date', dir: 'desc' });
  const params = {
    search: '',
    filter: 'ALL' as const,
    organizationId,
    page,
    pageSize,
    sortBy: sort.by as 'issue_date',
    sortDir: sort.dir,
  };
  const list = useInvoicePage(params);
  const summary = useInvoiceSummary({ search: '', filter: 'ALL', organizationId });

  const columns: TableColumn<InvoiceRow>[] = [
    { id: 'number', header: 'Factura', sortKey: 'number', cell: (r) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
    { id: 'issue', header: 'Emisión', sortKey: 'issue_date', cell: (r) => formatDate(r.issue_date) },
    { id: 'due', header: 'Vence', sortKey: 'due_date', cell: (r) => (r.due_date ? formatDate(r.due_date) : <span className="text-muted">Sin fecha</span>) },
    { id: 'total', header: 'Total', align: 'right', sortKey: 'total', cell: (r) => formatMoney(Number(r.total), r.currency) },
    { id: 'paid', header: 'Cobrado', align: 'right', cell: (r) => formatMoney(Number(r.confirmed_paid), r.currency) },
    {
      id: 'balance',
      header: 'Saldo',
      align: 'right',
      sortKey: 'balance',
      cell: (r) => (r.balance === null ? <span className="text-muted">No computable</span> : <span className={Number(r.balance) < 0 ? 'text-danger' : ''}>{formatMoney(Number(r.balance), r.currency)}</span>),
    },
    { id: 'status', header: 'Estado', cell: (r) => <Badge tone={r.status === 'PAID' ? 'ok' : r.status === 'VOID' || r.status === 'DRAFT' ? 'neutral' : 'warn'}>{INVOICE_STATUS_LABEL[r.status as keyof typeof INVOICE_STATUS_LABEL] ?? r.status}</Badge> },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard id="org-invoiced" label="Facturado (emitido)" temporality="Acumulado" state={fromQuery(summary, { isEmpty: () => false })} onRetry={() => void summary.refetch()} render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.invoiced)} emptyLabel="Sin facturas emitidas" />} />
        <KpiCard id="org-collected-2" label="Cobrado confirmado" temporality="Acumulado" state={fromQuery(summary, { isEmpty: () => false })} onRetry={() => void summary.refetch()} render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.collected)} emptyLabel="Sin cobros" />} />
        <KpiCard id="org-receivable" label="Saldo por cobrar" temporality="Foto actual" state={fromQuery(summary, { isEmpty: () => false })} onRetry={() => void summary.refetch()} render={() => <CurrencyLines amounts={toCurrencyAmounts(summary.data?.receivable)} emptyLabel="Sin saldo" />} />
      </div>
      <Card
        title="Facturas de la organización"
        description={summary.data ? `${formatNumber(summary.data.row_count)} facturas visibles; el total coincide con la tabla.` : undefined}
        actions={
          <ExportMenu
            filenameBase="organizacion-facturas"
            columns={INVOICE_EXPORT}
            pageRows={list.data?.rows ?? []}
            total={list.data?.total ?? 0}
            fetchPage={(p, size) => fetchInvoicePage({ ...params, page: p, pageSize: size })}
            rowKey={(r) => r.invoice_id ?? ''}
          />
        }
      >
        <PagedTable
          label="Facturas de la organización"
          columns={columns}
          rows={list.data?.rows ?? []}
          rowKey={(r) => r.invoice_id ?? r.number ?? ''}
          sortBy={sort.by}
          sortDir={sort.dir}
          onSortChange={(by, dir) => {
            setSort({ by, dir });
            setPage(0);
          }}
          page={page}
          pageSize={pageSize}
          total={list.data?.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(0);
          }}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          onRetry={() => void list.refetch()}
          emptyTitle="Sin facturas"
          emptyDescription="La organización no tiene facturas visibles para tu rol."
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- Documentos */

export function Org360Documents({ organizationId }: { organizationId: string }) {
  const docs = useOrgDocuments(organizationId);
  const rows = (docs.data ?? []).filter((d) => d.document_required || d.document_id);
  return (
    <Section
      title="Documentos comerciales (OS/OC)"
      description="Se registra la REFERENCIA del documento; la consola no almacena ni muestra el archivo."
      state={docs.data ? (rows.length ? { status: 'ready', data: rows } : { status: 'empty' }) : fromQuery(docs)}
      onRetry={() => void docs.refetch()}
      empty="Ningún contrato de esta organización exige OS/OC."
    >
      {() => (
        <DataTable columns={['Contrato', 'Tipo', 'Número', 'Estado', 'Vigencia', 'Importe', 'Referencia del archivo']}>
          {rows.map((d) => (
            <tr key={`${d.subscription_id}-${d.document_id ?? 'none'}`}>
              <td className="ebim-td">
                <Link className="ebim-link font-mono text-xs" to={`/subscriptions/${d.subscription_id}#documents`}>{d.subscription_code}</Link>
              </td>
              <td className="ebim-td text-xs">{d.document_type === 'SERVICE_ORDER' ? 'Orden de Servicio' : d.document_type === 'PURCHASE_ORDER' ? 'Orden de Compra' : d.document_required ? 'Requerido' : '—'}</td>
              <td className="ebim-td font-mono text-xs">{d.document_number ?? '—'}</td>
              <td className="ebim-td">
                {d.document_ok ? <Badge tone="ok">Vigente</Badge> : d.document_status ? <Badge tone="warn">{DOC_STATUS_LABEL[d.document_status] ?? d.document_status}</Badge> : <Badge tone="danger">Falta</Badge>}
              </td>
              <td className="ebim-td text-xs text-muted">{d.valid_from ? `${formatDate(d.valid_from)} → ${formatDate(d.valid_to)}` : '—'}</td>
              <td className="ebim-td text-right tabular-nums">{d.document_amount !== null ? formatMoney(Number(d.document_amount), d.document_currency) : '—'}</td>
              <td className="ebim-td text-xs">
                {d.external_file_ref ? (
                  <span title="Referencia registrada; no es un archivo cargado en la consola" className="font-mono text-muted">
                    {d.external_file_ref} <span className="font-sans">(referencia)</span>
                  </span>
                ) : (
                  <span className="text-muted">Sin referencia</span>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </Section>
  );
}

/* ------------------------------------------------------- Tenants y acceso */

export function Org360Tenants({ organizationId }: { organizationId: string }) {
  const tenants = useOrgTenants(organizationId);
  const saas = useOrgSaasProvisioning(organizationId);
  const targets = useProvisioningTargets();
  return (
    <Section
      title="Tenants y acceso"
      description="Comercial, alta técnica y acceso del administrador por separado. Ninguno se deduce de otro."
      state={fromQuery(tenants)}
      onRetry={() => void tenants.refetch()}
      empty="La organización no tiene tenants propios ni administrados."
    >
      {() => (
        <>
          {saas.error ? (
            <p className="px-4 pt-3 text-xs font-semibold text-warn" role="status">
              No se pudieron leer las altas SaaS: la columna de alta técnica y acceso puede estar incompleta.
            </p>
          ) : null}
          <DataTable columns={['Tenant', 'Producto', 'Relación', 'Entorno', 'Estado por dimensión']}>
            {tenants.data!.map((t) => {
              const dims = tenantDimensions(t, (saas.data ?? []).filter((r) => r.tenant_id === t.tenant_id), targets.data ?? []);
              return (
                <tr key={t.tenant_id as string}>
                  <td className="ebim-td"><Link className="ebim-link font-semibold" to={`/tenants/${t.tenant_id}`}>{t.name}</Link></td>
                  <td className="ebim-td">{t.product_short_name}</td>
                  <td className="ebim-td text-xs">{t.customer_organization_id === organizationId ? 'Propio (cliente)' : 'Administrado (canal)'}</td>
                  <td className="ebim-td text-xs">{t.environment ?? '—'}</td>
                  <td className="ebim-td"><TenantDimensionsInline dims={dims} /></td>
                </tr>
              );
            })}
          </DataTable>
        </>
      )}
    </Section>
  );
}

/* --------------------------------------------------------------- Actividad */

export function Org360Activity({ organizationId }: { organizationId: string }) {
  const tenants = useOrgTenants(organizationId);
  const tenantIds = tenants.data ? tenants.data.map((t) => t.tenant_id as string) : undefined;
  const audit = useOrgAudit(organizationId);
  const saas = useOrgSaasProvisioning(organizationId);
  const infra = useOrgInfraRequests(organizationId, tenantIds);
  const commissions = useOrgCommissions(organizationId, tenantIds);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="Bitácora de la organización" description="Registro append-only. Sin JSON en la primera lectura." state={fromQuery(audit)} onRetry={() => void audit.refetch()} empty="Sin eventos registrados para esta organización.">
        {() => (
          <ol className="divide-y divide-border">
            {audit.data!.map((e) => (
              <li key={String(e.id)} className="px-4 py-2.5 text-sm">
                <p className="font-semibold text-fg">{e.action}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(e.occurred_at)} · {e.actor_email ?? 'sistema'} · {e.entity_type}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section title="Altas SaaS" description="Solicitudes registradas en el control plane; no se ejecuta nada desde aquí." state={fromQuery(saas)} onRetry={() => void saas.refetch()} empty="Sin altas SaaS para los tenants de esta organización.">
        {() => (
          <DataTable columns={['Producto', 'Tenant', 'Solicitud', 'Mapping', 'Fecha']}>
            {saas.data!.map((r) => (
              <tr key={r.id as string}>
                <td className="ebim-td">{r.product_short_name}</td>
                <td className="ebim-td text-xs">{r.tenant_id ? <Link className="ebim-link" to={`/tenants/${r.tenant_id}`}>Ver tenant</Link> : '—'}</td>
                <td className="ebim-td"><Badge tone={r.status === 'ACTIVE' ? 'ok' : r.status === 'FAILED' ? 'danger' : 'info'}>{r.status as string}</Badge></td>
                <td className="ebim-td text-xs">{r.mapping_status ?? '—'}</td>
                <td className="ebim-td text-xs text-muted">{formatDateTime(r.requested_at as string)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
      <Section title="Solicitudes de infraestructura" description="Cola de infraestructura (distinta de las altas SaaS). DRY_RUN registra la intención." state={fromQuery(infra)} onRetry={() => void infra.refetch()} empty="Sin solicitudes de infraestructura.">
        {() => (
          <DataTable columns={['Acción', 'Tenant', 'Modo', 'Estado', 'Creada']}>
            {(infra.data ?? []).map((p) => (
              <tr key={p.id as string}>
                <td className="ebim-td font-medium">{p.action as string}</td>
                <td className="ebim-td text-muted">{(p.tenants as { name: string } | null)?.name ?? '—'}</td>
                <td className="ebim-td"><Badge tone={p.mode === 'DRY_RUN' ? 'info' : 'warn'}>{p.mode === 'DRY_RUN' ? 'Simulación (DRY_RUN)' : (p.mode as string)}</Badge></td>
                <td className="ebim-td"><Badge tone={p.status === 'SUCCEEDED' ? 'ok' : p.status === 'FAILED' ? 'danger' : 'warn'}>{p.status as string}</Badge></td>
                <td className="ebim-td text-xs text-muted">{formatDate(p.created_at as string)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
      <Section title="Comisiones asociadas" description="Nacen del cobro confirmado; últimas 25." state={fromQuery(commissions)} onRetry={() => void commissions.refetch()} empty="Sin comisiones sobre los tenants de esta organización.">
        {() => (
          <DataTable columns={['Comercial', 'Origen', 'Importe', 'Estado']}>
            {(commissions.data ?? []).map((c) => (
              <tr key={c.commission_event_id as string}>
                <td className="ebim-td">{c.agent_name}</td>
                <td className="ebim-td"><Badge tone={c.is_reversal ? 'danger' : 'info'}>{c.source_label}</Badge></td>
                <td className={`ebim-td text-right tabular-nums ${Number(c.amount) < 0 ? 'text-danger' : ''}`}>{formatMoney(Number(c.amount), c.currency)}</td>
                <td className="ebim-td text-muted">{c.status}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}
