import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useSubscription, useSubscriptionCollection, useCommercialDocuments, useInvoices,
} from '@/services/queries';
import { useRejectDocument, useCancelDocument } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { SectionTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatMoney, formatDate, formatDateTime } from '@/lib/format';
import {
  CollectionProfileDialog, RequestDocumentDialog, ReceiveDocumentDialog, ApproveDocumentDialog,
} from './CollectionDialogs';

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
  const invoices = useInvoices();
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
  const subInvoices = (invoices.data ?? []).filter((i) => i.subscription_id === subscriptionId);

  const recurringTotal = items
    .filter((i) => i.billing_interval !== 'ONE_TIME')
    .reduce((sum, i) => sum + Number(i.amount ?? 0), 0);
  const oneTimeTotal = items
    .filter((i) => i.billing_interval === 'ONE_TIME')
    .reduce((sum, i) => sum + Number(i.amount ?? 0), 0);

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
        <Badge tone={s.status === 'ACTIVE' ? 'ok' : s.status === 'CANCELLED' ? 'danger' : 'warn'}>
          {s.status}
        </Badge>
      }
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard
          label="Recurrente"
          value={formatMoney(recurringTotal, s.currency)}
          hint={s.billing_interval}
          tone="ok"
        />
        <StatCard
          label="Cargos únicos"
          value={formatMoney(oneTimeTotal, s.currency)}
          hint="No cuentan para el MRR"
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
                description="Las líneas ONE_TIME (implementación, servicios) no entran en el MRR."
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
                            {i.charge_kind as string}
                          </Badge>
                        </td>
                        <td className="ebim-td text-muted">{i.billing_interval as string}</td>
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
                  {!profile?.profile_id ? (
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
                  {docs.length === 0 ? (
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
              <Card
                title="Facturas de esta suscripción"
                description="Aquí sí hay dinero: una factura PAGADA implica un pago CONFIRMED, y solo eso devenga comisión."
              >
                {subInvoices.length === 0 ? (
                  <EmptyState title="Sin facturas emitidas" />
                ) : (
                  <DataTable columns={['Número', 'Emitida', 'Vence', 'Total', 'Estado', 'Cobros']}>
                    {subInvoices.map((i) => {
                      const payments = (i.payments ?? []) as Array<Record<string, unknown>>;
                      const confirmed = payments.filter((p) => p.status === 'CONFIRMED');
                      return (
                        <tr key={i.id}>
                          <td className="ebim-td font-mono text-xs font-semibold">{i.number}</td>
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
                              {i.status}
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
                        </tr>
                      );
                    })}
                  </DataTable>
                )}
              </Card>
            ),
          },
        ]}
      />

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
        onConfirm={() => void doReject()}
        onCancel={() => setRejectId(null)}
      />

      <ConfirmDialog
        open={Boolean(cancelId)}
        title="¿Anular este documento?"
        message="Anular es terminal: habrá que solicitar uno nuevo. El histórico se conserva."
        confirmLabel="Anular"
        onConfirm={() => void doCancel()}
        onCancel={() => setCancelId(null)}
      />
    </PageContainer>
  );
}
