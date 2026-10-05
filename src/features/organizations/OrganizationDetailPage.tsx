import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useOrganization, useOrganizationAgreements, usePartnerAgreements } from '@/services/queries';
import { useEndProductAgreement } from '@/services/mutations';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { isFinance } from '@/features/auth/session';
import { SectionTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { countryName, formatMoney, formatPercent, formatDate, formatNumber } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL } from '@/types/domain';
import { AGENT_TYPE_LABEL } from '@/features/commercial/commercialLabels';

import { AgreementFormDialog } from './AgreementFormDialog';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Avatar } from '@/components/ui/Avatar';
import { entityStatusLabel, entityStatusTone } from '@/features/catalog/catalogLabels';
import { BILLING_RESPONSIBILITY_TEXT, capabilityText } from './organizationLabels';
import {
  Org360KpiStrip,
  Org360Activity,
  Org360Billing,
  Org360Contracts,
  Org360Documents,
  Org360Summary,
  Org360Tenants,
} from './Organization360';
import { useOrgPartnerMargin, useOrgSalesAgents } from './org360Queries';
import { CompanyFormDialog, type CompanyDraft } from './CompanyFormDialog';
import { BillingContactPanel } from './BillingContactPanel';
import { PaymentPortalPanel } from './PaymentPortalPanel';
import type { AgreementDraft } from './AgreementFormDialog';
import { PlatformFeeDialog, type PlatformFeeTarget } from '@/features/partnerFees/PlatformFeeDialog';
import { PartnerFeeStatementsPanel } from '@/features/partnerFees/PartnerFeeStatementsPanel';
import { feeTermsText, type FeeTerms } from '@/features/partnerFees/feeLabels';

/**
 * Cliente / partner 360 (P22), en tabs centrados con deep-link `#hash`
 * (contrato §8 / regla gmao-025). Los hashes existentes (#view360, #overview,
 * #products, #tenants, #commercials, #margin) siguen funcionando.
 *
 * Todas las lecturas van ACOTADAS a esta organización en el servidor (E16).
 */
export function OrganizationDetailPage() {
  const { organizationId } = useParams();
  const { roles } = useAuth();
  const org = useOrganization(organizationId);
  const agreements = usePartnerAgreements(organizationId);
  // Términos de la tarifa de plataforma (M3): columnas del acuerdo, no de la vista de uso.
  const agreementRows = useOrganizationAgreements(organizationId);
  const margin = useOrgPartnerMargin(organizationId ?? '');
  const agents = useOrgSalesAgents(organizationId ?? '');
  const [companyDialog, setCompanyDialog] = useState<{ open: boolean; company: CompanyDraft | null }>({
    open: false,
    company: null,
  });
  const perms = usePermissions();
  const toast = useToast();
  const endAgreement = useEndProductAgreement();

  const [agreementDialog, setAgreementDialog] = useState<{
    open: boolean;
    agreement: AgreementDraft | null;
  }>({ open: false, agreement: null });
  const [feeTarget, setFeeTarget] = useState<PlatformFeeTarget | null>(null);
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

  if (org.isLoading) return <LoadingState variant="page" />;
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

  // V3 · una fila por moneda del canal; nunca un margen mezclado.
  const orgMargins = (margin.data ?? []).filter((m) => m.currency);
  const orgAgents = agents.data ?? [];
  const canManageCompanies = perms.canManageOrganization(o.id);
  const feeById = new Map<string, FeeTerms>(
    (agreementRows.data ?? []).map((a) => [
      a.id,
      {
        platform_fee_model: a.platform_fee_model,
        platform_fee_rate: a.platform_fee_rate,
        platform_fee_fixed_amount: a.platform_fee_fixed_amount,
        platform_fee_currency: a.platform_fee_currency,
      },
    ]),
  );
  const isPartner = (agreements.data ?? []).length > 0;

  return (
    <PageContainer
      title={o.display_name}
      leading={<Avatar name={o.display_name} size="lg" ringColor={o.accent_color} />}
      titleAside={
        <>
          <Badge tone={entityStatusTone(o.status)} dot>
            {entityStatusLabel(o.status)}
          </Badge>
          {capabilities.map((c) => (
            <Badge key={c} tone={c === 'CUSTOMER' ? 'info' : 'neutral'}>{capabilityText(c)}</Badge>
          ))}
        </>
      }
      description={`${o.legal_name} · ${countryName(o.country_code)}${o.tax_id ? ` · ${o.tax_id}` : ''}`}
      meta={o.billing_email ? `Facturación a ${o.billing_email}` : undefined}
      actions={
        perms.canManageOrganization(o.id) ? (
          <ActionMenu
            variant="page"
            label={`Más acciones de ${o.display_name}`}
            items={[
              canManageCompanies ? { label: 'Nueva sociedad', onSelect: () => setCompanyDialog({ open: true, company: null }) } : null,
              perms.canManagePlatform ? { label: 'Nuevo acuerdo de producto', onSelect: () => setAgreementDialog({ open: true, agreement: null }) } : null,
            ]}
          />
        ) : null
      }
    >
      <Org360KpiStrip organizationId={o.id} />
      <SectionTabs
        tabs={[
          {
            id: 'view360',
            label: 'Vista 360',
            content: <Org360Summary organizationId={o.id} organizationName={o.display_name} capabilities={capabilities} />,
          },
          {
            id: 'contracts',
            label: 'Productos y contratos',
            content: <Org360Contracts organizationId={o.id} organizationName={o.display_name} />,
          },
          {
            id: 'billing',
            label: 'Cobros y saldo',
            content: <Org360Billing organizationId={o.id} />,
          },
          {
            id: 'payment-portal',
            label: 'Portal de pago',
            hidden: !perms.canReadFinance,
            content: (
              <PaymentPortalPanel
                organizationId={o.id}
                organizationName={o.display_name}
                billingEmail={o.billing_email}
              />
            ),
          },
          {
            id: 'platform-fee',
            label: 'Tarifa de plataforma',
            // M3: lo ve finanzas y el admin del propio partner (RLS lo exige igual).
            hidden: !isPartner || !(perms.canReadFinance || perms.isOrgAdmin(o.id)),
            content: <PartnerFeeStatementsPanel organizationId={o.id} />,
          },
          {
            id: 'documents',
            label: 'Documentos',
            content: <Org360Documents organizationId={o.id} />,
          },
          {
            id: 'tenants',
            label: 'Tenants y acceso',
            content: <Org360Tenants organizationId={o.id} />,
          },
          {
            id: 'activity',
            label: 'Actividad',
            content: <Org360Activity organizationId={o.id} />,
          },
          {
            id: 'overview',
            label: 'Identidad y sociedades',
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
                      <div key={k as string} className="flex justify-between gap-4 px-5 py-2.5 text-body">
                        <dt className="text-muted">{k}</dt>
                        <dd className="text-right font-medium">{v as string}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>

                <Card
                  title="Sociedades"
                  description="Contrato §3.1: multipaís dentro de la misma cuenta."
                  actions={
                    canManageCompanies ? (
                      <button
                        type="button"
                        className="ebim-btn-secondary ebim-btn-sm"
                        onClick={() => setCompanyDialog({ open: true, company: null })}
                      >
                        Nueva sociedad
                      </button>
                    ) : null
                  }
                >
                  {companies.length === 0 ? (
                    <EmptyState title="Sin sociedades registradas" />
                  ) : (
                    <DataTable columns={['Sociedad', 'Mercado', 'País', 'Moneda', 'ERP code', '']}>
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
                          <td className="ebim-td whitespace-nowrap font-mono text-compact text-fg-2">
                            {(c.erp_code as string) ?? '—'}
                          </td>
                          <td className="ebim-td text-right">
                            {canManageCompanies ? (
                              <button
                                type="button"
                                className="ebim-link text-compact"
                                onClick={() =>
                                  setCompanyDialog({
                                    open: true,
                                    company: {
                                      id: c.id as string,
                                      name: c.name as string,
                                      tax_id: (c.tax_id as string | null) ?? null,
                                      erp_code: (c.erp_code as string | null) ?? null,
                                      market_code: (c.markets as { code: string } | null)?.code ?? null,
                                      is_default: Boolean(c.is_default),
                                    },
                                  })
                                }
                              >
                                Editar
                              </button>
                            ) : null}
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
                      'Producto · permisos', { label: 'Margen', align: 'right' }, 'Modelos permitidos',
                      'Tipos', { label: 'Tenants', align: 'right' }, 'Factura', 'Tarifa plataforma', 'Vigencia',
                      { label: 'Acciones', srOnly: true },
                    ]}
                  >
                    {(agreements.data ?? []).map((a) => (
                      <tr key={a.agreement_id as string}>
                        {/* Revende / administra bajo el producto: once columnas no cabían a 1280. */}
                        <td className="ebim-td">
                          <span className="block font-semibold">{a.product_short_name}</span>
                          <span className="block whitespace-nowrap text-caption text-fg-2">
                            {a.can_resell && a.can_manage_tenants
                              ? 'Revende y administra'
                              : a.can_resell
                                ? 'Solo revende'
                                : a.can_manage_tenants
                                  ? 'Solo administra'
                                  : 'Sin reventa ni administración'}
                          </span>
                        </td>
                        <td className="ebim-td ebim-num font-semibold">
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
                        <td className="ebim-td text-compact text-fg-2">
                          {((a.allowed_tenant_types ?? []) as string[]).map((t) => TENANT_TYPE_LABEL[t as keyof typeof TENANT_TYPE_LABEL] ?? t).join(', ')}
                        </td>
                        <td className="ebim-td ebim-num">
                          {formatNumber(Number(a.managed_tenants))}
                          {a.max_tenants ? (
                            <span className="text-muted"> / {a.max_tenants}</span>
                          ) : null}
                          {Number(a.shared_tenants) > 0 ? (
                            <div className="text-caption text-muted">
                              {formatNumber(Number(a.shared_tenants))} en compartido
                            </div>
                          ) : null}
                        </td>
                        <td className="ebim-td text-compact text-fg-2">{BILLING_RESPONSIBILITY_TEXT[a.billing_responsibility as string] ?? a.billing_responsibility}</td>
                        <td className="ebim-td text-compact">{feeTermsText(feeById.get(a.agreement_id as string))}</td>
                        <td className="ebim-td whitespace-nowrap text-compact text-fg-2">
                          {formatDate(a.valid_from as string)} →
                          <span className="block">{a.valid_to ? formatDate(a.valid_to as string) : 'sin fin'}</span>
                        </td>
                        <td className="ebim-td w-12 text-right">
                          <ActionMenu
                            label={`Acciones del acuerdo de ${a.product_short_name}`}
                            items={[
                              perms.canReadFinance && a.status === 'ACTIVE'
                                ? {
                                    label: 'Tarifa de plataforma',
                                    onSelect: () =>
                                      setFeeTarget({
                                        agreementId: a.agreement_id as string,
                                        productName: a.product_short_name as string,
                                        partnerName: o.display_name,
                                        billingResponsibility: a.billing_responsibility as string,
                                        ...(feeById.get(a.agreement_id as string) ?? {
                                          platform_fee_model: 'NONE',
                                          platform_fee_rate: null,
                                          platform_fee_fixed_amount: null,
                                          platform_fee_currency: null,
                                        }),
                                      }),
                                  }
                                : null,
                              perms.canManagePlatform
                                ? {
                                    label: 'Editar acuerdo',
                                    onSelect: () =>
                                      setAgreementDialog({
                                        open: true,
                                        agreement: {
                                          agreement_id: a.agreement_id as string,
                                          saas_product_id: a.saas_product_id as string,
                                          can_resell: a.can_resell as boolean,
                                          can_manage_tenants: a.can_manage_tenants as boolean,
                                          margin_rate: Number(a.margin_rate),
                                          default_deployment_mode: a.default_deployment_mode as string,
                                          allowed_deployment_modes: (a.allowed_deployment_modes ?? []) as string[],
                                          allowed_tenant_types: (a.allowed_tenant_types ?? []) as string[],
                                          billing_responsibility: a.billing_responsibility as string,
                                          max_tenants: a.max_tenants as number | null,
                                          valid_from: a.valid_from as string,
                                          valid_to: a.valid_to as string | null,
                                          status: a.status as string,
                                          notes: a.notes as string | null,
                                        },
                                      }),
                                  }
                                : null,
                              perms.canManagePlatform && a.status === 'ACTIVE'
                                ? {
                                    label: 'Cerrar acuerdo…',
                                    tone: 'danger' as const,
                                    onSelect: () =>
                                      setEndingAgreement({
                                        id: a.agreement_id as string,
                                        product: a.product_short_name as string,
                                      }),
                                  }
                                : null,
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'commercials',
            label: 'Comerciales',
            content: (
              <Card description="Comerciales afiliados a esta organización.">
                {agents.error ? (
                  <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />
                ) : orgAgents.length === 0 ? (
                  <EmptyState title="Sin comerciales afiliados" />
                ) : (
                  <DataTable columns={['Comercial', 'Tipo', 'Contacto', 'Estado']}>
                    {orgAgents.map((a) => (
                      <tr key={a.id}>
                        <td className="ebim-td">
                          <div className="flex items-center gap-3">
                            <Avatar name={a.full_name} mode="person" />
                            <span className="font-semibold">{a.full_name}</span>
                          </div>
                        </td>
                        <td className="ebim-td"><Badge tone="neutral">{AGENT_TYPE_LABEL[a.agent_type] ?? a.agent_type}</Badge></td>
                        <td className="ebim-td text-fg-2">{a.contact_email ?? '—'}</td>
                        <td className="ebim-td">
                          <Badge tone={entityStatusTone(a.status)} dot>{entityStatusLabel(a.status)}</Badge>
                        </td>
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
              <Card title="Margen de la organización" description="Una fila por moneda: el margen del canal nunca mezcla monedas.">
                {margin.error ? (
                  <ErrorState error={margin.error} onRetry={() => void margin.refetch()} />
                ) : orgMargins.length > 0 ? (
                  <DataTable
                    label="Margen por moneda"
                    columns={[
                      'Moneda',
                      { label: 'MRR', align: 'right' },
                      { label: 'Cobrado', align: 'right' },
                      { label: 'Costo directo', align: 'right' },
                      { label: 'Margen bruto', align: 'right' },
                    ]}
                  >
                    {orgMargins.map((m) => (
                      <tr key={m.currency}>
                        <td className="ebim-td font-semibold">{m.currency}</td>
                        <td className="ebim-td ebim-num">{formatMoney(Number(m.mrr), m.currency)}</td>
                        <td className="ebim-td ebim-num">{formatMoney(Number(m.collected_revenue), m.currency)}</td>
                        <td className="ebim-td ebim-num">{formatMoney(Number(m.direct_cost), m.currency)}</td>
                        <td className={`ebim-td ebim-num font-semibold ${Number(m.gross_margin) < 0 ? 'text-danger' : ''}`}>
                          {formatMoney(Number(m.gross_margin), m.currency)}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
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

      <PlatformFeeDialog target={feeTarget} onClose={() => setFeeTarget(null)} />

      <CompanyFormDialog
        open={companyDialog.open}
        organizationId={o.id}
        company={companyDialog.company}
        onClose={() => setCompanyDialog({ open: false, company: null })}
      />

      <ConfirmDialog
        open={Boolean(endingAgreement)}
        title={`¿Cerrar el acuerdo de ${endingAgreement?.product}?`}
        message="El canal dejará de poder vender y administrar tenants de este producto. La base lo impide si aún administra tenants vivos."
        confirmLabel="Cerrar acuerdo"
        onConfirm={confirmEndAgreement}
        onCancel={() => setEndingAgreement(null)}
      />
    </PageContainer>
  );
}
