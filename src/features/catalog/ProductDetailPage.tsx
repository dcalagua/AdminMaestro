import { Link, useParams } from 'react-router-dom';
import { useProduct, useTenantOverview, useOrganizationAgreements, usePlans } from '@/services/queries';
import { SectionTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, LoadingState, ErrorState, EmptyState, Badge, StatCard,
} from '@/components/ui/primitives';
import { formatMoney, formatPercent, formatNumber } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL } from '@/types/domain';

export function ProductDetailPage() {
  const { productId } = useParams();
  const product = useProduct(productId);
  const tenants = useTenantOverview();
  const agreements = useOrganizationAgreements();
  const plans = usePlans();

  if (product.isLoading) return <LoadingState />;
  if (product.error) return <ErrorState error={product.error} />;
  if (!product.data) {
    return (
      <PageContainer title="Producto no encontrado">
        <Card><EmptyState title="No existe ese producto" description="Puede haber sido archivado o no tienes acceso." /></Card>
      </PageContainer>
    );
  }

  const p = product.data;
  const productTenants = (tenants.data ?? []).filter((t) => t.saas_product_id === p.id);
  const productAgreements = (agreements.data ?? []).filter((a) => a.saas_product_id === p.id);
  const productPlans = (plans.data ?? []).filter((pl) => pl.saas_product_id === p.id);

  return (
    <PageContainer
      title={p.lockup_name ?? p.name}
      description={p.description ?? undefined}
      breadcrumbs={<Link className="text-xs text-muted hover:text-fg" to="/products">← SaaS Products</Link>}
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label="Tenants" value={formatNumber(productTenants.length)} />
        <StatCard label="Organizaciones habilitadas" value={formatNumber(productAgreements.length)} />
        <StatCard label="Planes" value={formatNumber(productPlans.length)} />
        <StatCard label="Unidad de cobro" value={p.billing_unit} />
      </div>

      <SectionTabs
        tabs={[
          {
            id: 'tenants',
            label: 'Tenants',
            content: (
              <Card>
                {productTenants.length === 0 ? (
                  <EmptyState title="Sin tenants para este producto" />
                ) : (
                  <DataTable columns={['Tenant', 'Cliente', 'Partner', 'Tipo', 'Modelo', 'Estado']}>
                    {productTenants.map((t) => (
                      <tr key={t.tenant_id as string}>
                        <td className="ebim-td">
                          <Link className="ebim-link" to={`/tenants/${t.tenant_id}`}>{t.name}</Link>
                        </td>
                        <td className="ebim-td">{t.customer_name}</td>
                        <td className="ebim-td text-muted">{t.managing_name ?? 'Directo EBIM'}</td>
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
                        <td className="ebim-td text-muted">{t.status}</td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'partners',
            label: 'Organizaciones habilitadas',
            content: (
              <Card description="Un partner puede vender varios SaaS con condiciones DISTINTAS por producto.">
                {productAgreements.length === 0 ? (
                  <EmptyState title="Ninguna organización habilitada" description="Nadie puede comercializar este producto todavía." />
                ) : (
                  <DataTable columns={['Organización', 'Puede revender', 'Administra tenants', 'Margen', 'Modelo por defecto']}>
                    {productAgreements.map((a) => (
                      <tr key={a.id as string}>
                        <td className="ebim-td font-semibold">
                          {(a.organizations as { display_name: string } | null)?.display_name}
                        </td>
                        <td className="ebim-td">{a.can_resell ? 'Sí' : 'No'}</td>
                        <td className="ebim-td">{a.can_manage_tenants ? 'Sí' : 'No'}</td>
                        <td className="ebim-td tabular-nums">{formatPercent(Number(a.margin_rate))}</td>
                        <td className="ebim-td">
                          <Badge tone="accent">
                            {DEPLOYMENT_MODE_LABEL[a.default_deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'plans',
            label: 'Planes',
            content: (
              <Card>
                {productPlans.length === 0 ? (
                  <EmptyState title="Sin planes definidos" />
                ) : (
                  <DataTable columns={['Plan', 'Modelo', 'Sociedades incluidas', 'Precios vigentes']}>
                    {productPlans.map((pl) => (
                      <tr key={pl.id as string}>
                        <td className="ebim-td">
                          <div className="font-semibold">{pl.name}</div>
                          <div className="text-xs text-muted">{pl.description}</div>
                        </td>
                        <td className="ebim-td">
                          {pl.deployment_mode
                            ? DEPLOYMENT_MODE_LABEL[pl.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]
                            : 'Cualquiera'}
                        </td>
                        <td className="ebim-td tabular-nums">{pl.included_companies}</td>
                        <td className="ebim-td">
                          <div className="space-y-0.5">
                            {((pl.plan_prices ?? []) as Array<Record<string, unknown>>)
                              .filter((pr) => !pr.valid_to)
                              .map((pr) => (
                                <div key={pr.id as string} className="text-xs">
                                  <span className="text-muted">{pr.charge_kind as string}:</span>{' '}
                                  <span className="font-semibold tabular-nums">
                                    {formatMoney(Number(pr.amount), pr.currency as string)}
                                  </span>
                                  <span className="text-muted"> / {pr.billing_interval as string}</span>
                                </div>
                              ))}
                          </div>
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
