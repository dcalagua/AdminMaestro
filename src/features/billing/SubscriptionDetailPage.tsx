import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useSubscription, useSubscriptionCollection, useCommercialDocuments, useSubscriptionInvoices,
  useCurrentCollectionProfile,
} from '@/services/queries';
import { useRejectDocument, useCancelDocument, useAutocharge } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { SectionTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatMoney, formatDate, formatDateTime } from '@/lib/format';
import { INVOICE_STATUS_LABEL } from '@/types/domain';
import { formatPeriod } from '@/lib/billing';
import {
  CollectionProfileDialog, RequestDocumentDialog, ReceiveDocumentDialog, ApproveDocumentDialog,
} from './CollectionDialogs';
import { CulqiCardPanel } from './CulqiCardPanel';
import { ChargeAttemptsCard } from './ChargeAttemptsCard';
import { autochargeToast } from './autochargeSummary';
import { ManualPaymentDialog } from './ManualPaymentDialog';
import { PeriodInvoiceAction } from './PeriodInvoiceAction';
import {
  BILLING_INTERVAL_LABEL, CHARGE_KIND_LABEL, SUBSCRIPTION_STATUS_LABEL, SUBSCRIPTION_STATUS_TONE, splitCharges,
} from './subscriptionLabels';


function moneyByCurrency(map: Record<string, number>): string {
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '—';
  return entries.map(([currency, amount]) => formatMoney(amount, currency)).join(' · ');
}

/**
 * Detalle de suscripción, con la pestaña **Cobranza** que introduce la Fase 07.
 *
 * La pantalla separa deliberadamente tres cosas que se confunden a menudo:
 *   · el CONTRATO (líneas y periodicidad),
 *   · la COBRANZA (cómo se pretende cobrar),
 *   · el COBRO (facturas y pagos, que es lo único que mueve dinero).
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

const DOC_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral' | 'info'> = {
  REQUESTED: 'warn',
  RECEIVED: 'info',
  APPROVED: 'ok',
  REJECTED: 'danger',
  EXPIRED: 'danger',
  CANCELLED: 'neutral',
};

export function SubscriptionDetailPage() {
  const { subscriptionId } = useParams();
  const subscription = useSubscription(subscriptionId);
  const collection = useSubscriptionCollection(subscriptionId);
  const documents = useCommercialDocuments(subscriptionId);
  const invoices = useSubscriptionInvoices(subscriptionId);
  const currentProfile = useCurrentCollectionProfile(subscriptionId);
  const autocharge = useAutocharge();
  const perms = usePermissions();
  const toast = useToast();
  const rejectDoc = useRejectDocument();
  const cancelDoc = useCancelDocument();

  const [profileOpen, setProfileOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const [approveDoc, setApproveDoc] = useState<{
    id: string; number: string; validTo: string | null;
  } | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ id: string; number: string; currency: string; outstanding: number } | null>(null);
  const [charging, setCharging] = useState<{ id: string; number: string; amount: string } | null>(null);

  if (subscription.isLoading) return <LoadingState />;
  if (subscription.error) return <ErrorState error={subscription.error} />;
  if (!subscription.data) {
    return (
      <PageContainer title="Suscripción no encontrada">
        <Card>
          <EmptyState
            title="No existe o no tienes acceso"
            description="RLS limita las suscripciones visibles a tu organización o a tu rol."
          />
        </Card>
      </PageContainer>
    );
  }

  const s = subscription.data;
  const profile = (collection.data ?? [])[0];
  const items = (s.subscription_items ?? []) as Array<Record<string, unknown>>;
  const docs = documents.data ?? [];
  const subInvoices = invoices.data ?? [];

  const charges = splitCharges(items, s.currency);

  const isCardOnFile =
    (currentProfile.data as { recurring_mode?: string } | null | undefined)?.recurring_mode === 'CARD_ON_FILE';

  async function doChargeNow() {
    if (!charging) return;
    try {
      const summary = await autocharge.mutateAsync({ invoiceId: charging.id });
      const [tone, title, detail] = autochargeToast(summary, charging.number);
      if (tone === 'success') toast.success(title, detail);
      else toast.error(title, detail);
    } catch (error) {
      toast.error('No se pudo cobrar', businessErrorMessage(error));
    } finally {
      setCharging(null);
    }
  }

  const needsDocument =
    profile?.requires_service_order === true || profile?.requires_purchase_order === true;
  const activeDoc = docs.find((d) =>
    ['REQUESTED', 'RECEIVED', 'APPROVED'].includes(d.status as string),
  );

  async function doReject() {
    if (!rejectId) return;
    try {
      await rejectDoc.mutateAsync({
        p_document_id: rejectId,
        p_reason: 'Rechazada desde la consola',
      });
      toast.success('Documento rechazado');
    } catch (error) {
      toast.error('No se pudo rechazar', businessErrorMessage(error));
    } finally {
      setRejectId(null);
    }
  }

  async function doCancel() {
    if (!cancelId) return;
    try {
      await cancelDoc.mutateAsync({
        p_document_id: cancelId,
        p_reason: 'Anulada desde la consola',
      });
      toast.success('Documento anulado');
    } catch (error) {
      toast.error('No se pudo anular', businessErrorMessage(error));
    } finally {
      setCancelId(null);
    }
  }

  return (
    <PageContainer
      title={s.code}
      description={`${(s.saas_products as { lockup_name: string } | null)?.lockup_name} · ${
        (s.organizations as { display_name: string } | null)?.display_name
      }${(s.tenants as { name: string } | null)?.name ? ` · ${(s.tenants as { name: string }).name}` : ' · nivel partner'}`}
      breadcrumbs={
        <Link className="text-xs text-muted hover:text-fg" to="/subscriptions">← Suscripciones</Link>
      }
      actions={
        <Badge tone={SUBSCRIPTION_STATUS_TONE[s.status] ?? 'neutral'}>
          Contrato: {SUBSCRIPTION_STATUS_LABEL[s.status] ?? s.status}
        </Badge>
      }
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Recurrente (mensual)"
          value={charges.recurringCount === 0 ? 'Sin líneas recurrentes' : moneyByCurrency(charges.monthly)}
          hint={`Cadencia de facturación: ${BILLING_INTERVAL_LABEL[s.billing_interval] ?? s.billing_interval}. Líneas normalizadas a mes.`}
          tone="ok"
        />
        <StatCard
          label="Cargos únicos"
          value={charges.oneTimeCount === 0 ? 'Ninguno' : moneyByCurrency(charges.oneTime)}
          hint="Se facturan una vez. No cuentan para el MRR."
        />
        <StatCard
          label="Método de cobro"
          value={
            profile?.collection_method
              ? (METHOD_LABEL[profile.collection_method as string] ?? String(profile.collection_method))
              : 'Sin configurar'
          }
          tone={profile?.collection_method ? 'neutral' : 'warn'}
        />
        <StatCard
          label="Documento vigente"
          value={
            !needsDocument
              ? 'No aplica'
              : activeDoc?.status === 'APPROVED'
                ? 'Aprobado'
                : (DOC_STATUS_LABEL[activeDoc?.status as string] ?? 'Ninguno')
          }
          tone={!needsDocument ? 'neutral' : activeDoc?.status === 'APPROVED' ? 'ok' : 'warn'}
        />
      </div>

      <SectionTabs
        tabs={[
          {
            id: 'contract',
            label: 'Contrato',
            content: (
              <Card
                title="Líneas de la suscripción"
                description="Las líneas recurrentes se facturan con su cadencia; los cargos únicos (implementación, servicios) se facturan una vez y no entran en el MRR."
              >
                {items.length === 0 ? (
                  <EmptyState title="Sin líneas" description="Esta suscripción no tiene cargos." />
                ) : (
                  <DataTable
                    columns={['Concepto', 'Tipo', 'Periodicidad', 'Cantidad', 'Unitario', 'Importe', 'Vigencia']}
                  >
                    {items.map((i) => (
                      <tr key={i.id as string}>
                        <td className="ebim-td font-medium">{i.description as string}</td>
                        <td className="ebim-td">
                          <Badge tone={i.charge_kind === 'IMPLEMENTATION_FEE' ? 'info' : 'accent'}>
                            {CHARGE_KIND_LABEL[i.charge_kind as string] ?? (i.charge_kind as string)}
                          </Badge>
                        </td>
                        <td className="ebim-td">
                          {i.billing_interval === 'ONE_TIME' ? (
                            <Badge tone="neutral">Cargo único</Badge>
                          ) : (
                            <Badge tone="ok">
                              Recurrente · {BILLING_INTERVAL_LABEL[i.billing_interval as string] ?? (i.billing_interval as string)}
                            </Badge>
                          )}
                        </td>
                        <td className="ebim-td tabular-nums">{Number(i.quantity)}</td>
                        <td className="ebim-td tabular-nums">
                          {formatMoney(Number(i.unit_amount), i.currency as string)}
                        </td>
                        <td className="ebim-td tabular-nums font-semibold">
                          {formatMoney(Number(i.amount), i.currency as string)}
                        </td>
                        <td className="ebim-td text-xs text-muted">
                          {formatDate(i.valid_from as string)} →{' '}
                          {i.valid_to ? formatDate(i.valid_to as string) : 'sin fin'}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'collection',
            label: 'Cobranza',
            content: (
              <div className="space-y-4">
                <Card
                  title="Perfil de cobro"
                  description="Cómo se pretende cobrar esta suscripción. Configurarlo no registra ningún cobro."
                  actions={
                    perms.canManageCommercial ? (
                      <button
                        type="button" className="ebim-btn-ghost"
                        onClick={() => setProfileOpen(true)}
                      >
                        {profile?.profile_id ? 'Cambiar método' : 'Configurar cobranza'}
                      </button>
                    ) : null
                  }
                >
                  {collection.isLoading ? (
                    <LoadingState />
                  ) : collection.error ? (
                    <ErrorState error={collection.error} onRetry={() => void collection.refetch()} />
                  ) : !profile?.profile_id ? (
                    <EmptyState
                      title="Sin perfil de cobro"
                      description="Sin perfil, la suscripción se cobra manualmente. No se presupone tarjeta."
                    />
                  ) : (
                    <dl className="divide-y divide-border">
                      {[
                        ['Método', METHOD_LABEL[profile.collection_method as string]],
                        [
                          'Proveedor',
                          profile.provider_account_code
                            ? `${profile.provider_account_code} (${profile.provider_environment})`
                            : 'Ninguno',
                        ],
                        ['Cargo automático', profile.auto_charge ? 'Sí' : 'No'],
                        ['Emitir factura', `${profile.invoice_lead_days} días antes`],
                        ['Aviso de renovación', `${profile.renewal_notice_days} días antes`],
                        ['Vencimiento', `${profile.payment_due_days} días tras emitir`],
                        ['Periodo de gracia', `${profile.grace_period_days} días`],
                        ['Pedir OS/OC', `${profile.document_lead_days} días antes`],
                        ['Suspensión automática', profile.auto_suspend ? 'Sí' : 'No'],
                        ['Vigente desde', formatDate(profile.effective_from as string)],
                      ].map(([k, v]) => (
                        <div key={k as string} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                          <dt className="text-muted">{k}</dt>
                          <dd className="text-right font-medium">{v as string}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </Card>

                <CulqiCardPanel
                  subscriptionId={subscriptionId}
                  organizationId={s.billed_organization_id}
                  collectionMethod={profile?.collection_method as string | null}
                  providerAccountCode={profile?.provider_account_code as string | null}
                  providerEnvironment={profile?.provider_environment as string | null}
                />

                <Card
                  title="Órdenes de Servicio / Compra"
                  description="Documento administrativo del cliente. Aprobarlo habilita el trámite; NO es un cobro ni devenga comisión."
                  actions={
                    perms.canManageCommercial && !activeDoc ? (
                      <button
                        type="button" className="ebim-btn-ghost"
                        onClick={() => setRequestOpen(true)}
                      >
                        Solicitar documento
                      </button>
                    ) : null
                  }
                >
                  {documents.isLoading ? (
                    <LoadingState />
                  ) : documents.error ? (
                    <ErrorState error={documents.error} onRetry={() => void documents.refetch()} />
                  ) : docs.length === 0 ? (
                    <EmptyState
                      title="Sin documentos"
                      description={
                        needsDocument
                          ? 'El método de cobro exige OS/OC: solicita una para habilitar la continuidad.'
                          : 'El método de cobro de esta suscripción no exige documento del cliente.'
                      }
                    />
                  ) : (
                    <DataTable
                      columns={['Tipo', 'Número', 'Estado', 'Importe', 'Vigencia', 'Hitos', '']}
                    >
                      {docs.map((d) => (
                        <tr key={d.id as string}>
                          <td className="ebim-td font-medium">
                            {d.document_type === 'SERVICE_ORDER' ? 'Orden de Servicio' : 'Orden de Compra'}
                          </td>
                          <td className="ebim-td font-mono text-xs">
                            {(d.document_number as string) ?? '—'}
                          </td>
                          <td className="ebim-td">
                            <Badge tone={DOC_TONE[d.status as string] ?? 'neutral'}>
                              {DOC_STATUS_LABEL[d.status as string] ?? (d.status as string)}
                            </Badge>
                          </td>
                          <td className="ebim-td tabular-nums">
                            {d.amount ? formatMoney(Number(d.amount), d.currency as string) : '—'}
                          </td>
                          <td className="ebim-td text-xs text-muted">
                            {d.valid_from ? formatDate(d.valid_from as string) : '—'} →{' '}
                            {d.valid_to ? formatDate(d.valid_to as string) : '—'}
                          </td>
                          <td className="ebim-td text-xs text-muted">
                            <div>Solicitada: {formatDateTime(d.requested_at as string)}</div>
                            {d.received_at ? (
                              <div>Recibida: {formatDateTime(d.received_at as string)}</div>
                            ) : null}
                            {d.approved_at ? (
                              <div>Aprobada: {formatDateTime(d.approved_at as string)}</div>
                            ) : null}
                          </td>
                          <td className="ebim-td">
                            {perms.canManageCommercial ? (
                              <div className="flex items-center justify-end gap-3">
                                {d.status === 'REQUESTED' ? (
                                  <button
                                    type="button" className="ebim-link text-[13px]"
                                    onClick={() => setReceiveId(d.id as string)}
                                  >
                                    Registrar recepción
                                  </button>
                                ) : null}
                                {d.status === 'RECEIVED' ? (
                                  <>
                                    <button
                                      type="button" className="ebim-link text-[13px]"
                                      onClick={() =>
                                        setApproveDoc({
                                          id: d.id as string,
                                          number: (d.document_number as string) ?? '',
                                          validTo: (d.valid_to as string) ?? null,
                                        })
                                      }
                                    >
                                      Aprobar
                                    </button>
                                    <button
                                      type="button"
                                      className="text-[13px] text-danger hover:underline"
                                      onClick={() => setRejectId(d.id as string)}
                                    >
                                      Rechazar
                                    </button>
                                  </>
                                ) : null}
                                {['REQUESTED', 'RECEIVED', 'APPROVED'].includes(d.status as string) ? (
                                  <button
                                    type="button"
                                    className="text-[13px] text-muted hover:underline"
                                    onClick={() => setCancelId(d.id as string)}
                                  >
                                    Anular
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </DataTable>
                  )}
                </Card>
              </div>
            ),
          },
          {
            id: 'invoices',
            label: 'Facturación y cobros',
            hidden: !perms.canReadFinance && !perms.canManagePlatform,
            content: (
              <div className="space-y-4">
              <Card
                title="Facturas de esta suscripción"
                description="Aquí sí hay dinero: una factura PAGADA implica un pago CONFIRMED, y solo eso devenga comisión."
                actions={
                  perms.canReadFinance ? (
                    <Link
                      className="ebim-btn-ghost h-8 px-3 text-xs"
                      to={`/organizations/${s.billed_organization_id}#payment-portal`}
                    >
                      Compartir enlace de pago
                    </Link>
                  ) : null
                }
              >
                {perms.canReadFinance && (s.status === 'ACTIVE' || s.status === 'PAST_DUE') ? (
                  <PeriodInvoiceAction subscriptionId={s.id} currency={s.currency} />
                ) : null}
                {invoices.isLoading ? (
                  <LoadingState />
                ) : invoices.error ? (
                  <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
                ) : subInvoices.length === 0 ? (
                  <EmptyState title="Sin facturas emitidas" />
                ) : (
                  <DataTable columns={['Número', 'Período', 'Emitida', 'Vence', 'Total', 'Estado', 'Cobros', '']}>
                    {subInvoices.map((i) => {
                      const payments = (i.payments ?? []) as Array<Record<string, unknown>>;
                      const confirmed = payments.filter((p) => p.status === 'CONFIRMED');
                      const outstanding =
                        Math.round((Number(i.total) - confirmed.reduce((a, p) => a + Number(p.amount ?? 0), 0)) * 100) / 100;
                      return (
                        <tr key={i.id}>
                          <td className="ebim-td font-mono text-xs font-semibold">{i.number}</td>
                          <td className="ebim-td text-xs text-muted">{formatPeriod(i.period_start)}</td>
                          <td className="ebim-td text-xs text-muted">{formatDate(i.issue_date)}</td>
                          <td className="ebim-td text-xs text-muted">{formatDate(i.due_date)}</td>
                          <td className="ebim-td tabular-nums font-semibold">
                            {formatMoney(Number(i.total), i.currency)}
                          </td>
                          <td className="ebim-td">
                            <Badge
                              tone={
                                i.status === 'PAID' ? 'ok' : i.status === 'VOID' ? 'neutral' : 'warn'
                              }
                            >
                              {INVOICE_STATUS_LABEL[i.status as keyof typeof INVOICE_STATUS_LABEL] ?? i.status}
                            </Badge>
                          </td>
                          <td className="ebim-td text-xs">
                            {confirmed.length === 0 ? (
                              <span className="text-muted">Sin cobros confirmados</span>
                            ) : (
                              confirmed.map((p) => (
                                <div key={p.id as string}>
                                  {formatMoney(Number(p.amount), p.currency as string)} ·{' '}
                                  {(p.method as string) ?? 'sin método'}
                                </div>
                              ))
                            )}
                          </td>
                          <td className="ebim-td text-right">
                            {perms.canReadFinance && (i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID') && outstanding > 0 ? (
                              <div className="flex items-center justify-end gap-3">
                                {isCardOnFile ? (
                                  <button
                                    type="button"
                                    className="ebim-link text-[13px]"
                                    onClick={() =>
                                      setCharging({ id: i.id, number: i.number, amount: formatMoney(outstanding, i.currency) })
                                    }
                                  >
                                    Cobrar ahora
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="ebim-link text-[13px]"
                                  onClick={() => setPaying({ id: i.id, number: i.number, currency: i.currency, outstanding })}
                                >
                                  Registrar cobro
                                </button>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </DataTable>
                )}
              </Card>
              <ChargeAttemptsCard subscriptionId={s.id} />
              </div>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={Boolean(charging)}
        tone="primary"
        title="¿Cobrar ahora con la tarjeta guardada?"
        message={`Se cobrará el saldo de la factura ${charging?.number ?? ''} (${charging?.amount ?? ''}) con la tarjeta autorizada por el cliente. Si el emisor la rechaza, queda registrado como un intento fallido.`}
        confirmLabel="Cobrar ahora"
        busy={autocharge.isPending}
        onConfirm={doChargeNow}
        onCancel={() => setCharging(null)}
      />

      <ManualPaymentDialog invoice={paying} onClose={() => setPaying(null)} />

      <CollectionProfileDialog
        open={profileOpen}
        subscriptionId={subscriptionId ?? null}
        subscriptionCode={s.code}
        current={profile}
        onClose={() => setProfileOpen(false)}
      />

      <RequestDocumentDialog
        open={requestOpen}
        subscriptionId={subscriptionId ?? null}
        subscriptionCode={s.code}
        defaultType={
          profile?.requires_purchase_order ? 'PURCHASE_ORDER' : 'SERVICE_ORDER'
        }
        onClose={() => setRequestOpen(false)}
      />

      <ReceiveDocumentDialog
        open={Boolean(receiveId)}
        documentId={receiveId}
        onClose={() => setReceiveId(null)}
      />

      <ApproveDocumentDialog
        open={Boolean(approveDoc)}
        documentId={approveDoc?.id ?? null}
        documentNumber={approveDoc?.number ?? ''}
        defaultValidTo={approveDoc?.validTo}
        onClose={() => setApproveDoc(null)}
      />

      <ConfirmDialog
        open={Boolean(rejectId)}
        title="¿Rechazar este documento?"
        message="El documento vuelve al cliente. Podrá registrarse de nuevo cuando lo corrija."
        confirmLabel="Rechazar"
        onConfirm={doReject}
        onCancel={() => setRejectId(null)}
      />

      <ConfirmDialog
        open={Boolean(cancelId)}
        title="¿Anular este documento?"
        message="Anular es terminal: habrá que solicitar uno nuevo. El histórico se conserva."
        confirmLabel="Anular"
        onConfirm={doCancel}
        onCancel={() => setCancelId(null)}
      />
    </PageContainer>
  );
}
