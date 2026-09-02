import { Link, useParams } from 'react-router-dom';
import {
  useOrganization, useOrganizationAgreements, useTenantOverview, usePartnerMargin, useSalesAgents,
} from '@/services/queries';
import { useAuth } from '@/hooks/useAuth';
import { isFinance } from '@/features/auth/session';
import { SectionTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatMoney, formatPercent, formatNumber, formatDate } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL } from '@/types/domain';

/**
 * Detalle de organización, en tabs centrados con deep-link `#hash`
 * (contrato §8 / regla gmao-025).
 */
export function OrganizationDetailPage() {
  const { organizationId } = useParams();
  const { roles } = useAuth();
  const org = useOrganization(organizationId);
  const agreements = useOrganizationAgreements(organizationId);
  const tenants = useTenantOverview();
  const margin = usePartnerMargin();
  const agents = useSalesAgents();

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
  const orgMargin = (margin.data ?? []).find((m) => m.organization_id === o.id);
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
                    <DataTable columns={['Sociedad', 'País', 'Moneda', 'ERP code']}>
                      {companies.map((c) => (
                        <tr key={c.id as string}>
                          <td className="ebim-td font-semibold">
                            {c.name as string}
                            {c.is_default ? <Badge tone="accent">Principal</Badge> : null}
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
              </div>
            ),
          },
          {
            id: 'products',
            label: 'Productos autorizados',
            content: (
              <Card description="Un partner multi-SaaS tiene condiciones potencialmente distintas por producto (contrato §11.1).">
                {(agreements.data ?? []).length === 0 ? (
                  <EmptyState title="Sin acuerdos de producto" description="Esta organización no está habilitada para comercializar ningún SaaS." />
                ) : (
                  <DataTable columns={['Producto', 'Revende', 'Administra', 'Margen', 'Modelo por defecto', 'Vigencia']}>
                    {(agreements.data ?? []).map((a) => (
                      <tr key={a.id as string}>
                        <td className="ebim-td font-semibold">
                          {(a.saas_products as { lockup_name: string } | null)?.lockup_name}
                        </td>
                        <td className="ebim-td">{a.can_resell ? 'Sí' : 'No'}</td>
                        <td className="ebim-td">{a.can_manage_tenants ? 'Sí' : 'No'}</td>
                        <td className="ebim-td tabular-nums font-semibold">{formatPercent(Number(a.margin_rate))}</td>
                        <td className="ebim-td">
                          <Badge tone="accent">
                            {DEPLOYMENT_MODE_LABEL[a.default_deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}
                          </Badge>
                        </td>
                        <td className="ebim-td text-xs text-muted">
                          {formatDate(a.valid_from as string)} → {a.valid_to ? formatDate(a.valid_to as string) : 'sin fin'}
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
                {orgMargin ? (
                  <div className="grid gap-3 p-4 sm:grid-cols-4">
                    <StatCard label="MRR" value={formatMoney(Number(orgMargin.mrr), orgMargin.currency ?? 'USD')} />
                    <StatCard label="Cobrado" value={formatMoney(Number(orgMargin.collected_revenue), orgMargin.currency ?? 'USD')} />
                    <StatCard label="Costo directo" value={formatMoney(Number(orgMargin.direct_cost), orgMargin.currency ?? 'USD')} tone="warn" />
                    <StatCard
                      label="Margen bruto"
                      value={formatMoney(Number(orgMargin.gross_margin), orgMargin.currency ?? 'USD')}
                      tone={Number(orgMargin.gross_margin) >= 0 ? 'ok' : 'danger'}
                    />
                  </div>
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
              <td className="ebim-td tabular-nums">{formatMoney(Number(t.mrr), (t.currency as string) ?? 'USD')}</td>
              <td className="ebim-td text-muted">{t.status as string}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  );
}
