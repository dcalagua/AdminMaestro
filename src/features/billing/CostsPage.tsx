import { useCostEntries, useProductMargin, usePartnerMargin, useTenantMargin } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { SectionTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatMoney, formatDate, formatPercent } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';

/**
 * Costos y margen.
 *
 * Fórmula única, documentada en docs/finance/COST_MARGIN_MODEL.md:
 *   margen bruto = ingreso COBRADO − costo directo − comisión
 *
 * "Cobrado", no "facturado": una factura emitida y no pagada no es margen.
 */
export function CostsPage() {
  const costs = useCostEntries();
  const byProduct = useProductMargin();
  const byPartner = usePartnerMargin();
  const byTenant = useTenantMargin();
  const { term, setTerm, filtered } = useSearchFilter(costs.data, (c) => [
    c.description, c.vendor, c.category,
  ]);

  const totalCost = (costs.data ?? []).reduce((s, c) => s + Number(c.amount), 0);
  const totalMargin = (byProduct.data ?? []).reduce((s, p) => s + Number(p.gross_margin), 0);
  const totalRevenue = (byProduct.data ?? []).reduce((s, p) => s + Number(p.collected_revenue), 0);

  return (
    <PageContainer
      title="Costos y margen"
      description="margen bruto = ingreso cobrado − costo directo − comisión. Los agregados van por moneda: no se convierte con un tipo de cambio implícito."
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Costo registrado" value={formatMoney(totalCost)} tone="warn" />
        <StatCard label="Ingreso cobrado" value={formatMoney(totalRevenue)} />
        <StatCard label="Margen bruto" value={formatMoney(totalMargin)} tone={totalMargin >= 0 ? 'ok' : 'danger'} />
        <StatCard
          label="Margen sobre cobrado"
          value={totalRevenue > 0 ? formatPercent(totalMargin / totalRevenue) : '—'}
          tone={totalMargin >= 0 ? 'ok' : 'danger'}
        />
      </div>

      <SectionTabs
        tabs={[
          {
            id: 'by-product',
            label: 'Por producto',
            content: (
              <Card>
                {byProduct.isLoading ? (
                  <LoadingState />
                ) : (byProduct.data ?? []).length === 0 ? (
                  <EmptyState title="Sin datos" />
                ) : (
                  <DataTable columns={['Producto', 'MRR', 'ARR', 'Cobrado recurrente', 'Cobrado one-time', 'Costo', 'Comisión', 'Margen']}>
                    {(byProduct.data ?? []).map((r) => (
                      <tr key={r.saas_product_id as string}>
                        <td className="ebim-td font-semibold">{r.short_name}</td>
                        <td className="ebim-td tabular-nums">{formatMoney(Number(r.mrr), r.currency ?? 'USD')}</td>
                        <td className="ebim-td tabular-nums">{formatMoney(Number(r.arr), r.currency ?? 'USD')}</td>
                        <td className="ebim-td tabular-nums">{formatMoney(Number(r.collected_recurring), r.currency ?? 'USD')}</td>
                        <td className="ebim-td tabular-nums text-muted">{formatMoney(Number(r.collected_one_time), r.currency ?? 'USD')}</td>
                        <td className="ebim-td tabular-nums text-warn">{formatMoney(Number(r.direct_cost), r.currency ?? 'USD')}</td>
                        <td className="ebim-td tabular-nums">{formatMoney(Number(r.commission_total), r.currency ?? 'USD')}</td>
                        <td className={`ebim-td tabular-nums font-semibold ${Number(r.gross_margin) >= 0 ? 'text-ok' : 'text-danger'}`}>
                          {formatMoney(Number(r.gross_margin), r.currency ?? 'USD')}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'by-partner',
            label: 'Por partner',
            content: (
              <Card>
                {(byPartner.data ?? []).length === 0 ? (
                  <EmptyState title="Sin partners con margen calculable" />
                ) : (
                  <DataTable columns={['Partner', 'Tenants', 'MRR', 'Cobrado', 'Costo', 'Comisión', 'Margen']}>
                    {(byPartner.data ?? []).map((r) => (
                      <tr key={r.organization_id as string}>
                        <td className="ebim-td font-semibold">{r.display_name}</td>
                        <td className="ebim-td tabular-nums">{Number(r.managed_tenants)}</td>
                        <td className="ebim-td tabular-nums">{formatMoney(Number(r.mrr), r.currency ?? 'USD')}</td>
                        <td className="ebim-td tabular-nums">{formatMoney(Number(r.collected_revenue), r.currency ?? 'USD')}</td>
                        <td className="ebim-td tabular-nums text-warn">{formatMoney(Number(r.direct_cost), r.currency ?? 'USD')}</td>
                        <td className="ebim-td tabular-nums">{formatMoney(Number(r.commission_total), r.currency ?? 'USD')}</td>
                        <td className={`ebim-td tabular-nums font-semibold ${Number(r.gross_margin) >= 0 ? 'text-ok' : 'text-danger'}`}>
                          {formatMoney(Number(r.gross_margin), r.currency ?? 'USD')}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'by-tenant',
            label: 'Por tenant',
            content: (
              <Card>
                {(byTenant.data ?? []).length === 0 ? (
                  <EmptyState title="Sin tenants con margen calculable" />
                ) : (
                  <DataTable columns={['Tenant', 'Producto', 'Modelo', 'MRR', 'Cobrado', 'Costo', 'Comisión', 'Margen']}>
                    {(byTenant.data ?? []).map((r) => (
                      <tr key={r.tenant_id as string}>
                        <td className="ebim-td font-semibold">{r.name}</td>
                        <td className="ebim-td">{r.product_code}</td>
                        <td className="ebim-td">
                          <Badge tone="accent">
                            {DEPLOYMENT_MODE_LABEL[r.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}
                          </Badge>
                        </td>
                        <td className="ebim-td tabular-nums">{formatMoney(Number(r.mrr), r.currency ?? 'USD')}</td>
                        <td className="ebim-td tabular-nums">{formatMoney(Number(r.collected_revenue), r.currency ?? 'USD')}</td>
                        <td className="ebim-td tabular-nums text-warn">{formatMoney(Number(r.direct_cost), r.currency ?? 'USD')}</td>
                        <td className="ebim-td tabular-nums">{formatMoney(Number(r.commission_total), r.currency ?? 'USD')}</td>
                        <td className={`ebim-td tabular-nums font-semibold ${Number(r.gross_margin) >= 0 ? 'text-ok' : 'text-danger'}`}>
                          {formatMoney(Number(r.gross_margin), r.currency ?? 'USD')}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </Card>
            ),
          },
          {
            id: 'entries',
            label: 'Costos registrados',
            content: (
              <Card description="Un costo compartido se reparte con una regla EXPLÍCITA (weight), nunca con un prorrateo implícito.">
                <SearchBar value={term} onChange={setTerm} placeholder="Buscar costo por concepto, proveedor o categoría…" />
                {costs.isLoading ? (
                  <LoadingState />
                ) : costs.error ? (
                  <ErrorState error={costs.error} />
                ) : filtered.length === 0 ? (
                  <EmptyState title="Sin costos registrados" />
                ) : (
                  <DataTable columns={['Concepto', 'Categoría', 'Proveedor', 'Periodo', 'Monto', 'Imputación']}>
                    {filtered.map((c) => (
                      <tr key={c.id}>
                        <td className="ebim-td font-medium">{c.description}</td>
                        <td className="ebim-td"><Badge tone="info">{c.category}</Badge></td>
                        <td className="ebim-td text-muted">{c.vendor ?? '—'}</td>
                        <td className="ebim-td text-xs text-muted">
                          {formatDate(c.period_start)} → {formatDate(c.period_end)}
                        </td>
                        <td className="ebim-td tabular-nums font-semibold">{formatMoney(Number(c.amount), c.currency)}</td>
                        <td className="ebim-td text-xs">
                          {((c.cost_allocations ?? []) as Array<Record<string, unknown>>).map((a) => (
                            <div key={a.id as string} className="text-muted">
                              {a.scope as string}
                              {a.saas_products ? ` · ${(a.saas_products as { short_name: string }).short_name}` : ''}
                              {a.tenants ? ` · ${(a.tenants as { name: string }).name}` : ''}
                              {a.deployment_targets ? ` · ${(a.deployment_targets as { code: string }).code}` : ''}
                              {Number(a.weight) < 1 ? ` (${formatPercent(Number(a.weight), 0)})` : ''}
                            </div>
                          ))}
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
