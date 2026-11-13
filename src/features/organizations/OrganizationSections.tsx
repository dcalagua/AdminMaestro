import { Badge, Card, DataTable, EmptyState, ErrorState } from '@/components/ui/primitives';
import { DetailFacts } from '@/components/ui/DetailFacts';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { formatDate, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL } from '@/types/domain';
import { feeTermsText, type FeeTerms } from '@/features/partnerFees/feeLabels';
import type { PlatformFeeTarget } from '@/features/partnerFees/PlatformFeeDialog';
import { usePermissions } from '@/hooks/usePermissions';
import { BILLING_RESPONSIBILITY_TEXT } from './organizationLabels';
import { useOrgPartnerMargin } from './org360Queries';
import type { AgreementDraft } from './AgreementFormDialog';
import type { CompanyDraft } from './CompanyFormDialog';

/**
 * Secciones de la ficha de la cuenta que antes eran pestañas propias
 * («Identidad y sociedades», «Productos autorizados», «Margen») y que en la V5
 * viven dentro de «Resumen» y de «Contratos y cobranza». Mismo contenido, mismos
 * permisos; los diálogos los sigue abriendo la página.
 */

interface OrgIdentity {
  slug: string | null;
  brand_slug: string | null;
  accent_color: string | null;
  white_label: boolean | null;
  billing_email: string | null;
  companies?: unknown;
}

export function OrgIdentityCards({
  org,
  canManageCompanies,
  onEditCompany,
}: {
  org: OrgIdentity;
  canManageCompanies: boolean;
  onEditCompany: (company: CompanyDraft | null) => void;
}) {
  const companies = (org.companies ?? []) as Array<Record<string, unknown>>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card id="overview" title="Identidad y marca" description="Logo, colores y enlace de ingreso con la marca del cliente.">
        <DetailFacts
          columns={2}
          items={[
            ['Código', <span key="slug" className="font-mono text-caption">{org.slug}</span>],
            ['Código de marca (enlace de ingreso)', org.brand_slug ? `?t=${org.brand_slug}` : '—'],
            ['Color de acento', org.accent_color ?? 'Hereda de EBIM'],
            ['Marca blanca', org.white_label ? 'Sí' : 'No'],
            ['Correo de facturación', org.billing_email ?? '—'],
          ]}
        />
      </Card>

      <Card
        id="companies"
        title="Sociedades"
        description="Multipaís dentro de la misma cuenta."
        actions={
          canManageCompanies ? (
            <button type="button" className="ebim-btn-secondary ebim-btn-sm" onClick={() => onEditCompany(null)}>
              Nueva sociedad
            </button>
          ) : null
        }
      >
        {companies.length === 0 ? (
          <EmptyState title="Sin sociedades registradas" />
        ) : (
          <DataTable columns={['Sociedad', 'Mercado', 'País', 'Moneda', 'Código ERP', '']}>
            {companies.map((c) => (
              <tr key={c.id as string}>
                <td className="ebim-td font-semibold">
                  {c.name as string}
                  {c.is_default ? <span className="ml-1.5"><Badge tone="accent">Principal</Badge></span> : null}
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
                        onEditCompany({
                          id: c.id as string,
                          name: c.name as string,
                          tax_id: (c.tax_id as string | null) ?? null,
                          erp_code: (c.erp_code as string | null) ?? null,
                          market_code: (c.markets as { code: string } | null)?.code ?? null,
                          is_default: Boolean(c.is_default),
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
    </div>
  );
}

type AgreementRow = Record<string, unknown> & {
  agreement_id: string | null;
  product_short_name: string | null;
};

export function OrgAgreementsCard({
  rows,
  organizationName,
  feeById,
  onNewAgreement,
  onEditAgreement,
  onFee,
  onEndAgreement,
}: {
  rows: AgreementRow[];
  organizationName: string;
  feeById: Map<string, FeeTerms>;
  onNewAgreement: () => void;
  onEditAgreement: (agreement: AgreementDraft) => void;
  onFee: (target: PlatformFeeTarget) => void;
  onEndAgreement: (target: { id: string; product: string }) => void;
}) {
  const perms = usePermissions();
  return (
    <Card
      id="products"
      title="Acuerdos de producto"
      description="Un canal multi-SaaS tiene condiciones distintas por producto: eSupplier al 25% y WMS al 18% son dos acuerdos, no dos partners."
      actions={
        perms.canManagePlatform ? (
          <button type="button" className="ebim-btn-ghost" onClick={onNewAgreement}>
            Nuevo acuerdo
          </button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          title="Sin acuerdos de producto"
          description="Esta organización no está habilitada para comercializar ningún SaaS."
          action={
            perms.canManagePlatform ? (
              <button type="button" className="ebim-btn-primary" onClick={onNewAgreement}>
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
          {rows.map((a) => (
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
              <td className="ebim-td ebim-num font-semibold">{formatPercent(Number(a.margin_rate))}</td>
              <td className="ebim-td">
                <div className="flex flex-wrap gap-1">
                  {((a.allowed_deployment_modes ?? []) as string[]).map((m) => (
                    <Badge key={m} tone={m === a.default_deployment_mode ? 'accent' : 'neutral'}>
                      {DEPLOYMENT_MODE_LABEL[m as keyof typeof DEPLOYMENT_MODE_LABEL]}
                    </Badge>
                  ))}
                </div>
              </td>
              <td className="ebim-td text-compact text-fg-2">
                {((a.allowed_tenant_types ?? []) as string[])
                  .map((t) => TENANT_TYPE_LABEL[t as keyof typeof TENANT_TYPE_LABEL] ?? t)
                  .join(', ')}
              </td>
              <td className="ebim-td ebim-num">
                {formatNumber(Number(a.managed_tenants))}
                {a.max_tenants ? <span className="text-muted"> / {a.max_tenants as number}</span> : null}
                {Number(a.shared_tenants) > 0 ? (
                  <div className="text-caption text-muted">{formatNumber(Number(a.shared_tenants))} en compartido</div>
                ) : null}
              </td>
              <td className="ebim-td text-compact text-fg-2">
                {BILLING_RESPONSIBILITY_TEXT[a.billing_responsibility as string] ?? (a.billing_responsibility as string)}
              </td>
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
                            onFee({
                              agreementId: a.agreement_id as string,
                              productName: a.product_short_name as string,
                              partnerName: organizationName,
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
                            onEditAgreement({
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
                            }),
                        }
                      : null,
                    perms.canManagePlatform && a.status === 'ACTIVE'
                      ? {
                          label: 'Cerrar acuerdo…',
                          tone: 'danger' as const,
                          onSelect: () =>
                            onEndAgreement({
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
  );
}

/** Margen del canal: una fila por moneda, nunca un margen mezclado. */
export function OrgMarginCard({ organizationId }: { organizationId: string }) {
  const margin = useOrgPartnerMargin(organizationId);
  const rows = (margin.data ?? []).filter((m) => m.currency);
  return (
    <Card id="margin" title="Margen de la organización" description="Una fila por moneda: el margen del canal nunca mezcla monedas.">
      {margin.error ? (
        <ErrorState error={margin.error} onRetry={() => void margin.refetch()} />
      ) : rows.length > 0 ? (
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
          {rows.map((m) => (
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
  );
}
