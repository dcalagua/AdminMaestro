import { useCommissionPlans } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatMoney, formatPercent, formatDate } from '@/lib/format';

const BASIS_LABEL: Record<string, string> = {
  COLLECTED_LICENSE: '% de licencia cobrada',
  COLLECTED_IMPLEMENTATION: '% de implementación cobrada',
  COLLECTED_ANY: '% de cualquier cobro',
  FIXED_AMOUNT: 'Monto fijo',
};

/**
 * Planes y reglas de comisión.
 *
 * Todas las bases parten de un COBRO ("collected"), nunca de un facturado: no se
 * paga comisión sobre una factura impaga (prompt fase 6).
 */
export function CommissionPlansPage() {
  const plans = useCommissionPlans();
  const { term, setTerm, filtered } = useSearchFilter(plans.data, (p) => [
    p.code, p.name, p.description,
  ]);

  return (
    <PageContainer
      title="Planes de comisión"
      description="Las reglas tienen vigencia y no se editan retroactivamente: se cierran y se abre una nueva, para que una comisión histórica siga siendo explicable."
    >
      <Card>
        <SearchBar value={term} onChange={setTerm} placeholder="Buscar plan de comisión…" />
        {plans.isLoading ? (
          <LoadingState />
        ) : plans.error ? (
          <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sin planes de comisión" />
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((p) => (
              <div key={p.id} className="p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{p.name}</span>
                  <span className="font-mono text-xs text-muted">{p.code}</span>
                  <Badge tone={p.status === 'ACTIVE' ? 'ok' : 'neutral'}>{p.status}</Badge>
                  {p.saas_products ? (
                    <Badge tone="info">
                      {(p.saas_products as { short_name: string }).short_name}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Todos los productos</Badge>
                  )}
                </div>
                <p className="mb-3 text-sm text-muted">{p.description}</p>
                <div className="rounded-card border border-border">
                  <DataTable columns={['Regla', 'Base', 'Tasa / Monto', 'Recurrente', 'Tope meses', 'Tope monto', 'Vigencia']}>
                    {((p.commission_rules ?? []) as Array<Record<string, unknown>>).map((r) => (
                      <tr key={r.id as string}>
                        <td className="ebim-td font-medium">{r.name as string}</td>
                        <td className="ebim-td">
                          <Badge tone="accent">{BASIS_LABEL[r.basis as string] ?? (r.basis as string)}</Badge>
                        </td>
                        <td className="ebim-td tabular-nums font-semibold">
                          {r.rate !== null
                            ? formatPercent(Number(r.rate))
                            : formatMoney(Number(r.fixed_amount), r.currency as string)}
                        </td>
                        <td className="ebim-td">{r.is_recurring ? 'Sí' : 'Sólo la primera vez'}</td>
                        <td className="ebim-td tabular-nums">{(r.max_months as number) ?? '—'}</td>
                        <td className="ebim-td tabular-nums">
                          {r.max_total_amount ? formatMoney(Number(r.max_total_amount), r.currency as string) : '—'}
                        </td>
                        <td className="ebim-td text-xs text-muted">
                          {formatDate(r.valid_from as string)} → {r.valid_to ? formatDate(r.valid_to as string) : 'sin fin'}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
