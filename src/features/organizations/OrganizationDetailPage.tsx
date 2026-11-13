import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useOrganization, useOrganizationAgreements, usePartnerAgreements } from '@/services/queries';
import { useEndProductAgreement } from '@/services/mutations';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { isFinance } from '@/features/auth/session';
import { hasFinanceView } from '@/app/navigation';
import { DetailTabs } from '@/components/ui/DetailTabs';
import { PageContainer, Card, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { countryName } from '@/lib/format';

import { AgreementFormDialog } from './AgreementFormDialog';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Avatar } from '@/components/ui/Avatar';
import { capabilityText } from './organizationLabels';
import {
  Org360KpiStrip,
  Org360Activity,
  Org360Apps,
  Org360Billing,
  Org360Contracts,
  Org360Documents,
  Org360Summary,
} from './Organization360';
import { AccountHeader, Org360People } from './Account360';
import { OrgAgreementsCard, OrgIdentityCards, OrgMarginCard } from './OrganizationSections';
import { CompanyFormDialog, type CompanyDraft } from './CompanyFormDialog';
import { BillingContactPanel } from './BillingContactPanel';
import { PaymentPortalPanel } from './PaymentPortalPanel';
import type { AgreementDraft } from './AgreementFormDialog';
import { PlatformFeeDialog, type PlatformFeeTarget } from '@/features/partnerFees/PlatformFeeDialog';
import { PartnerFeeStatementsPanel } from '@/features/partnerFees/PartnerFeeStatementsPanel';
import type { FeeTerms } from '@/features/partnerFees/feeLabels';
import { LifecycleDialog, type LifecycleMode, type LifecycleTarget } from '@/features/suite/LifecycleDialog';
import { useOrgTenants } from './org360Queries';
import { CustomerProgress } from './CustomerProgress';

/**
 * Ficha 360 de la cuenta (P22 → V5 · F3).
 *
 * Cabecera fija (estado, MRR y saldo vencido con vista financiera, apps con su
 * estado y responsable comercial) y cinco pestañas con deep-link `?tab=`:
 * Resumen · Apps y accesos · Contratos y cobranza · Personas · Actividad.
 * Las pestañas anteriores (`#view360`, `#payment-portal`, `?tab=billing`…)
 * redirigen a su nueva casa y bajan hasta su sección.
 *
 * Todas las lecturas van ACOTADAS a esta organización en el servidor (E16).
 */
const ORG_LEGACY_TABS: Record<string, string> = {
  view360: 'resumen',
  overview: 'resumen',
  contracts: 'contratos',
  billing: 'contratos',
  'payment-portal': 'contratos',
  'platform-fee': 'contratos',
  documents: 'contratos',
  products: 'contratos',
  margin: 'contratos',
  tenants: 'apps',
  commercials: 'personas',
  activity: 'actividad',
};

/** Ancla de sección dentro de una pestaña (deja sitio a la cabecera fija). */
function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-40">
      {children}
    </div>
  );
}

export function OrganizationDetailPage() {
  const { organizationId } = useParams();
  const { roles, persona } = useAuth();
  const showFinance = hasFinanceView(persona, roles);
  const org = useOrganization(organizationId);
  const agreements = usePartnerAgreements(organizationId);
  // Términos de la tarifa de plataforma (M3): columnas del acuerdo, no de la vista de uso.
  const agreementRows = useOrganizationAgreements(organizationId);
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
  const [lifecycle, setLifecycle] = useState<LifecycleMode | null>(null);
  const orgTenants = useOrgTenants(organizationId ?? '');

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
  const capabilities = ((o.organization_capabilities ?? []) as Array<{ capability: string }>).map(
    (c) => c.capability,
  );

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
  // Suspender / reactivar la cuenta = sus tenants PROPIOS (los que administra como canal son de otro cliente).
  const ownTenants: LifecycleTarget[] = (orgTenants.data ?? [])
    .filter((t) => t.customer_organization_id === o.id && t.tenant_id)
    .map((t) => ({
      tenantId: t.tenant_id as string,
      tenantName: (t.name as string) ?? '—',
      productName: (t.product_short_name as string) ?? '—',
      tenantStatus: (t.status as string) ?? 'PENDING',
    }));
  const canSuspend = perms.canManagePlatform && ownTenants.some((t) => t.tenantStatus === 'ACTIVE');
  const canResume = perms.canManagePlatform && ownTenants.some((t) => t.tenantStatus === 'SUSPENDED');

  return (
    <PageContainer
      title={o.display_name}
      leading={<Avatar name={o.display_name} size="lg" ringColor={o.accent_color} />}
      titleAside={
        // El estado va en la cabecera fija; aquí, qué es la cuenta.
        <>
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
              canResume ? { label: 'Reactivar el servicio', onSelect: () => setLifecycle('RESUME') } : null,
              canSuspend ? { label: 'Suspender el servicio', tone: 'danger' as const, onSelect: () => setLifecycle('SUSPEND') } : null,
            ]}
          />
        ) : null
      }
    >
      <AccountHeader organizationId={o.id} status={o.status} showFinance={showFinance} />
      <DetailTabs
        label={`Secciones de ${o.display_name}`}
        legacy={ORG_LEGACY_TABS}
        tabs={[
          {
            id: 'resumen',
            label: 'Resumen',
            content: (
              <div className="space-y-4">
                {capabilities.includes('CUSTOMER') ? (
                  <CustomerProgress
                    organizationId={o.id}
                    organizationName={o.display_name}
                    billingEmail={o.billing_email}
                    showFinance={showFinance}
                  />
                ) : null}
                {showFinance ? <Org360KpiStrip organizationId={o.id} /> : null}
                <Org360Summary
                  organizationId={o.id}
                  organizationName={o.display_name}
                  capabilities={capabilities}
                  showFinance={showFinance}
                />
                <OrgIdentityCards
                  org={o}
                  canManageCompanies={canManageCompanies}
                  onEditCompany={(company) => setCompanyDialog({ open: true, company })}
                />
              </div>
            ),
          },
          {
            id: 'apps',
            label: 'Apps y accesos',
            content: <Org360Apps organizationId={o.id} organizationName={o.display_name} />,
          },
          {
            id: 'contratos',
            label: 'Contratos y cobranza',
            content: (
              <div className="space-y-4">
                <Anchor id="contracts">
                  <Org360Contracts organizationId={o.id} organizationName={o.display_name} />
                </Anchor>
                <Anchor id="billing">
                  <Org360Billing organizationId={o.id} />
                </Anchor>
                {perms.canReadFinance ? (
                  <Anchor id="payment-portal">
                    <PaymentPortalPanel
                      organizationId={o.id}
                      organizationName={o.display_name}
                      billingEmail={o.billing_email}
                    />
                  </Anchor>
                ) : null}
                {capabilities.includes('CUSTOMER') ? (
                  <Anchor id="billing-contact">
                    <BillingContactPanel organizationId={o.id} />
                  </Anchor>
                ) : null}
                <Anchor id="documents">
                  <Org360Documents organizationId={o.id} />
                </Anchor>
                <OrgAgreementsCard
                  rows={(agreements.data ?? []) as never}
                  organizationName={o.display_name}
                  feeById={feeById}
                  onNewAgreement={() => setAgreementDialog({ open: true, agreement: null })}
                  onEditAgreement={(agreement) => setAgreementDialog({ open: true, agreement })}
                  onFee={setFeeTarget}
                  onEndAgreement={setEndingAgreement}
                />
                {/* M3: lo ve finanzas y el admin del propio partner (RLS lo exige igual). */}
                {isPartner && (perms.canReadFinance || perms.isOrgAdmin(o.id)) ? (
                  <Anchor id="platform-fee">
                    <PartnerFeeStatementsPanel organizationId={o.id} />
                  </Anchor>
                ) : null}
                {/* El margen es información financiera: se oculta a quien no debe verla.
                    Aunque forzara la sección, RLS no le devolvería las filas. */}
                {isFinance(roles) || roles?.platformRole === 'EBIM_PRODUCT_ADMIN' ? (
                  <OrgMarginCard organizationId={o.id} />
                ) : null}
              </div>
            ),
          },
          {
            id: 'personas',
            label: 'Personas',
            content: <Org360People organizationId={o.id} />,
          },
          {
            id: 'actividad',
            label: 'Actividad',
            content: <Org360Activity organizationId={o.id} />,
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

      <LifecycleDialog
        open={lifecycle !== null}
        mode={lifecycle ?? 'SUSPEND'}
        subject={`el servicio de ${o.display_name}`}
        organizationId={o.id}
        targets={ownTenants}
        onClose={() => setLifecycle(null)}
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
