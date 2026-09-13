import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useOrganization, usePartnerAgreements, useTenantOverview, usePartnerMargin, useSalesAgents,
} from '@/services/queries';
import { useEndProductAgreement } from '@/services/mutations';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { isFinance } from '@/features/auth/session';
import { SectionTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatMoney, formatPercent, formatNumber, formatDate } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL } from '@/types/domain';
import { AgreementFormDialog } from './AgreementFormDialog';
import { Organization360 } from './Organization360';
import { BillingContactPanel } from './BillingContactPanel';
import type { AgreementDraft } from './AgreementFormDialog';

/**
 * Detalle de organización, en tabs centrados con deep-link `#hash`
 * (contrato §8 / regla gmao-025).
 */
export function OrganizationDetailPage() {
  const { organizationId } = useParams();
  const { roles } = useAuth();
  const org = useOrganization(organizationId);
  const agreements = usePartnerAgreements(organizationId);
  const tenants = useTenantOverview();
  const margin = usePartnerMargin();
  const agents = useSalesAgents();
  const perms = usePermissions();
  const toast = useToast();
  const endAgreement = useEndProductAgreement();

  const [agreementDialog, setAgreementDialog] = useState<{
    open: boolean;
    agreement: AgreementDraft | null;
  }>({ open: false, agreement: null });
  const [endingAgreement, setEndingAgreement] = useState<{ id: string; product: string } | null>(
    null,
  );

  async function confirmEndAgreement() {
    if (!endingAgreement) return;
    try {
      await endAgreement.mutateAsync({
        p_agreement_id: endingAgreement.id,
        p_reason: 'Cerrado desde la consola',
      });
      toast.success('Acuerdo cerrado', endingAgreement.product);
    } catch (error) {
      // La RPC bloquea si el canal aún administra tenants vivos de ese producto.
      toast.error('No se pudo cerrar el acuerdo', businessErrorMessage(error));
    } finally {
      setEndingAgreement(null);
    }
  }

  if (org.isLoading) return <LoadingState />;
  if (org.error) return <ErrorState error={org.error} />;
  if (!org.data) {
    return (
      <PageContainer title="Organización no encontrada">
        <Card>
          <EmptyState
            title="No existe o no tienes acceso"
            description="Las políticas RLS impiden ver organizaciones fuera de tu alcance. Esto no es un error de la pantalla."
          />
        </Card>
      </PageContainer>
    );
  }

  const o = org.data;
  const companies = (o.companies ?? []) as Array<Record<string, unknown>>;
  const capabilities = ((o.organization_capabilities ?? []) as Array<{ capability: string }>).map(
    (c) => c.capability,
  );

  const asCustomer = (tenants.data ?? []).filter((t) => t.customer_organization_id === o.id);
  const asManager = (tenants.data ?? []).filter((t) => t.managing_organization_id === o.id);
  // V3 · una fila por moneda del canal; nunca un margen mezclado.
  const orgMargins = (margin.data ?? []).filter((m) => m.organization_id === o.id && m.currency);
  const orgAgents = (agents.data ?? []).filter((a) => a.organization_id === o.id);

  return (
    <PageContainer
      title={o.display_name}
      description={`${o.legal_name} · ${o.country_code}${o.tax_id ? ` · ${o.tax_id}` : ''}`}
      breadcrumbs={
        <Link className="text-xs text-muted hover:text-fg" to="/organizations">← Organizaciones</Link>
      }
      actions={
        <div className="flex flex-wrap gap-1">
          {capabilities.map((c) => (
            <Badge key={c} tone={c === 'CUSTOMER' ? 'info' : 'ok'}>{c}</Badge>
          ))}
        </div>
      }
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label="Sociedades" value={formatNumber(companies.length)} />
        <StatCard label="Tenants como cliente" value={formatNumber(asCustomer.length)} />
        <StatCard label="Tenants que administra" value={formatNumber(asManager.length)} />
        <StatCard label="Productos autorizados" value={formatNumber(agreements.data?.length ?? 0)} />
      </div>

      <SectionTabs
        tabs={[
          {
            id: 'view360',
            label: 'Vista 360',
            content: (
              <Organization360
                organizationId={o.id}
                organizationName={o.display_name}
                capabilities={capabilities}
              />
            ),
          },
          {
            id: 'overview',
            label: 'Resumen',
            content: (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Identidad y marca" description="Contrato §4.3: interfaz de branding homologada.">
                  <dl className="divide-y divide-border">
                    {[
                      ['Slug', o.slug],
                      ['Brand slug (link de ingreso)', o.brand_slug ? `?t=${o.brand_slug}` : '—'],
                      ['Color de acento', o.accent_color ?? 'Hereda de EBIM'],
                      ['Marca blanca', o.white_label ? 'Sí' : 'No'],
                      ['Correo de facturación', o.billing_email ?? '—'],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                        <dt className="text-muted">{k}</dt>
                        <dd className="text-right font-medium">{v as string}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>

                <Card title="Sociedades" description="Contrato §3.1: multipaís dentro de la misma cuenta.">
                  {companies.length === 0 ? (
                    <EmptyState title="Sin sociedades registradas" />
                  ) : (
                    <DataTable columns={['Sociedad', 'Mercado', 'País', 'Moneda', 'ERP code']}>
                      {companies.map((c) => (
                        <tr key={c.id as string}>
                          <td className="ebim-td font-semibold">
                            {c.name as string}
                            {c.is_default ? <Badge tone="accent">Principal</Badge> : null}
                          </td>
                          <td className="ebim-td">
                            {(c.markets as { code: string; name: string } | null)?.name ?? (
                              <span className="text-muted">Fuera de mercado</span>
                            )}
                          </td>
                          <td className="ebim-td">{c.country_code as string}</td>
                          <td className="ebim-td">{c.currency as string}</td>
                          <td className="ebim-td font-mono text-xs text-muted">
                            {(c.erp_code as string) ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </DataTable>
                  )}
                </Card>

                {capabilities.includes('CUSTOMER') ? (
                  <div className="lg:col-span-2">
                    <BillingContactPanel organizationId={o.id} />
                  </div>
                ) : null}
              </div>
            ),
          },
          {
            id: 'products',
            label: 'Productos autorizados',
            content: (
              <Card
                description="Un canal multi-SaaS tiene condiciones distintas por producto: eSupplier al 25% y WMS al 18% son dos acuerdos, no dos partners."
                actions={
                  perms.canManagePlatform ? (
                    <button
                      type="button"
                      className="ebim-btn-ghost"
                      onClick={() => setAgreementDialog({ open: true, agreement: null })}
                    >
                      Nuevo acuerdo
                    </button>
                  ) : null
                }
              >
                {(agreements.data ?? []).length === 0 ? (
                  <EmptyState
                    title="Sin acuerdos de producto"
                    description="Esta organización no está habilitada para comercializar ningún SaaS."
                    action={
                      perms.canManagePlatform ? (
                        <button
                          type="button"
                          className="ebim-btn-primary"
                          onClick={() => setAgreementDialog({ open: true, agreement: null })}
                        >
                          Crear el primer acuerdo
                        </button>
                      ) : null
                    }
                  />
                ) : (
                  <DataTable
                    columns={[
                      'Producto', 'Revende', 'Administra', 'Margen', 'Modelos permitidos',
                      'Tipos', 'Tenants', 'Factura', 'Vigencia', '',
                    ]}
                  >
                    {(agreements.data ?? []).map((a) => (
                      <tr key={a.agreement_id as string}>
                        <td className="ebim-td font-semibold">{a.product_short_name}</td>
                        <td className="ebim-td">{a.can_resell ? 'Sí' : 'No'}</td>
                        <td className="ebim-td">{a.can_manage_tenants ? 'Sí' : 'No'}</td>
                        <td className="ebim-td tabular-nums font-semibold">
                          {formatPercent(Number(a.margin_rate))}
                        </td>
                        <td className="ebim-td">
                          <div className="flex flex-wrap gap-1">
                            {((a.allowed_deployment_modes ?? []) as string[]).map((m) => (
                              <Badge
                                key={m}
                                tone={m === a.default_deployment_mode ? 'accent' : 'neutral'}
                              >
                                {DEPLOYMENT_MODE_LABEL[m as keyof typeof DEPLOYMENT_MODE_LABEL]}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="ebim-td text-xs text-muted">
                          {((a.allowed_tenant_types ?? []) as string[]).join(', ')}
                        </td>
                        <td className="ebim-td tabular-nums">
                          {formatNumber(Number(a.managed_tenants))}
                          {a.max_tenants ? (
                            <span className="text-muted"> / {a.max_tenants}</span>
                          ) : null}
                          {Number(a.shared_tenants) > 0 ? (
                            <div className="text-xs text-muted">
                              {formatNumber(Number(a.shared_tenants))} en compartido
                            </div>
                          ) : null}
                        </td>
                        <td className="ebim-td text-xs text-muted">{a.billing_responsibility}</td>
                        <td className="ebim-td text-xs text-muted">
                          {formatDate(a.valid_from as string)} →{' '}
                          {a.valid_to ? formatDate(a.valid_to as string) : 'sin fin'}
                        </td>
                        <td className="ebim-td">
                          {perms.canManagePlatform ? (
                            <div className="flex items-center justify-end gap-3">
                              <button
                                type="button"
                                className="ebim-link text-[13px]"
                                onClick={() =>
                                  setAgreementDialog({
                                    open: true,
                                    agreement: {
                                      agreement_id: a.agreement_id as string,
                                      saas_product_id: a.saas_product_id as string,
                                      can_resell: a.can_resell as boolean,
                                      can_manage_tenants: a.can_manage_tenants as boolean,
                                      margin_rate: Number(a.margin_rate),
                                      default_deployment_mode: a.default_deployment_mode as string,
                                      allowed_deployment_modes:
                                        (a.allowed_deployment_modes ?? []) as string[],
                                      allowed_tenant_types:
                                        (a.allowed_tenant_types ?? []) as string[],
                                      billing_responsibility: a.billing_responsibility as string,
                                      max_tenants: a.max_tenants as number | null,
                                      valid_from: a.valid_from as string,
                                      valid_to: a.valid_to as string | null,
                                      status: a.status as string,
                                      notes: a.notes as string | null,
                                    },
                                  })
                                }
                              >
                                Editar
                              </button>
                              {a.status === 'ACTIVE' ? (
                                <button
                                  type="button"
                                  className="text-[13px] text-danger hover:underline"
                                  onClick={() =>
                                    setEndingAgreement({
                                      id: a.agreement_id as string,
                                      product: a.product_short_name as string,
                                    })
                                  }
                                >
                                  Cerrar
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
            ),
          },
          {
            id: 'tenants',
            label: 'Tenants',
            content: (
              <div className="space-y-4">
                <TenantTable title="Tenants que administra (como partner)" rows={asManager} />
                <TenantTable title="Tenants propios (como cliente)" rows={asCustomer} />
              </div>
            ),
          },
          {
            id: 'commercials',
            label: 'Comerciales',
            content: (
              <Card description="Comerciales afiliados a esta organización.">
                {orgAgents.length === 0 ? (
                  <EmptyState title="Sin comerciales afiliados" />
                ) : (
                  <DataTable columns={['Comercial', 'Tipo', 'Contacto', 'Estado']}>
                    {orgAgents.map((a) => (
                      <tr key={a.id}>
                        <td className="ebim-td font-semibold">{a.full_name}</td>
                        <td className="ebim-td"><Badge tone="info">{a.agent_type}</Badge></td>
                        <td className="ebim-td text-muted">{a.contact_email ?? '—'}</td>
                        <td className="ebim-td">{a.status}</td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'margin',
            label: 'Margen',
            // El margen es información financiera: se oculta a quien no debe verla.
            // Aunque forzara la pestaña, RLS no le devolvería las filas.
            hidden: !isFinance(roles) && roles?.platformRole !== 'EBIM_PRODUCT_ADMIN',
            content: (
              <Card title="Margen de la organización">
                {orgMargins.length > 0 ? (
                  orgMargins.map((orgMargin) => (
                    <div key={orgMargin.currency} className="grid gap-3 p-4 sm:grid-cols-4">
                      <StatCard label={`MRR · ${orgMargin.currency}`} value={formatMoney(Number(orgMargin.mrr), orgMargin.currency)} />
                      <StatCard label="Cobrado" value={formatMoney(Number(orgMargin.collected_revenue), orgMargin.currency)} />
                      <StatCard label="Costo directo" value={formatMoney(Number(orgMargin.direct_cost), orgMargin.currency)} tone="warn" />
                      <StatCard
                        label="Margen bruto"
                        value={formatMoney(Number(orgMargin.gross_margin), orgMargin.currency)}
                        tone={Number(orgMargin.gross_margin) >= 0 ? 'ok' : 'danger'}
                      />
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="Sin margen calculable"
                    description="Aparece cuando la organización administra tenants con cobros registrados."
                  />
                )}
              </Card>
            ),
          },
        ]}
      />

      <AgreementFormDialog
        open={agreementDialog.open}
        organizationId={o.id}
        organizationName={o.display_name}
        agreement={agreementDialog.agreement}
        onClose={() => setAgreementDialog({ open: false, agreement: null })}
      />

      <ConfirmDialog
        open={Boolean(endingAgreement)}
        title={`¿Cerrar el acuerdo de ${endingAgreement?.product}?`}
        message="El canal dejará de poder vender y administrar tenants de este producto. La base lo impide si aún administra tenants vivos."
        confirmLabel="Cerrar acuerdo"
        onConfirm={() => void confirmEndAgreement()}
        onCancel={() => setEndingAgreement(null)}
      />
    </PageContainer>
  );
}

function TenantTable({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <EmptyState title="Sin tenants en esta categoría" />
      ) : (
        <DataTable columns={['Tenant', 'Producto', 'Tipo', 'Modelo', 'MRR', 'Estado']}>
          {rows.map((t) => (
            <tr key={t.tenant_id as string}>
              <td className="ebim-td">
                <Link className="ebim-link" to={`/tenants/${t.tenant_id}`}>{t.name as string}</Link>
              </td>
              <td className="ebim-td">{t.product_short_name as string}</td>
              <td className="ebim-td">
                <Badge tone={t.tenant_type === 'PRODUCTION' ? 'ok' : 'info'}>
                  {TENANT_TYPE_LABEL[t.tenant_type as keyof typeof TENANT_TYPE_LABEL]}
                </Badge>
              </td>
              <td className="ebim-td">
                <Badge tone="accent">
                  {DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}
                </Badge>
              </td>
              <td className="ebim-td tabular-nums">{formatMoney(Number(t.mrr), t.currency as string | null)}</td>
              <td className="ebim-td text-muted">{t.status as string}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  );
}
