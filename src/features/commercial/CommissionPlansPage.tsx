import { useState } from 'react';
import { useCommissionPlans } from '@/services/queries';
import { useDeactivateCommissionRule } from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatMoney, formatPercent, formatDate } from '@/lib/format';
import { CommissionPlanFormDialog, CommissionRuleFormDialog } from './CommercialDialogs';
import type { CommissionPlanDraft } from './CommercialDialogs';

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
  const perms = usePermissions();
  const toast = useToast();
  const deactivate = useDeactivateCommissionRule();

  const [planDialog, setPlanDialog] = useState<{ open: boolean; plan: CommissionPlanDraft | null }>({
    open: false,
    plan: null,
  });
  const [ruleDialog, setRuleDialog] = useState<{ planId: string; planName: string } | null>(null);
  const [closingRule, setClosingRule] = useState<{ id: string; name: string } | null>(null);

  async function confirmCloseRule() {
    if (!closingRule) return;
    try {
      await deactivate.mutateAsync({
        p_rule_id: closingRule.id,
        p_reason: 'Cerrada desde la consola',
      });
      toast.success('Regla cerrada', closingRule.name);
    } catch (error) {
      toast.error('No se pudo cerrar la regla', businessErrorMessage(error));
    } finally {
      setClosingRule(null);
    }
  }

  const { term, setTerm, filtered } = useSearchFilter(plans.data, (p) => [
    p.code, p.name, p.description,
  ]);

  return (
    <PageContainer
      title="Planes de comisión"
      description="Las reglas tienen vigencia y no se editan retroactivamente: se cierran y se abre una nueva, para que una comisión histórica siga siendo explicable."
      actions={
        perms.canReadFinance ? (
          <button
            type="button"
            className="ebim-btn-primary"
            onClick={() => setPlanDialog({ open: true, plan: null })}
          >
            Nuevo plan de comisión
          </button>
        ) : null
      }
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
                  {perms.canReadFinance ? (
                    <span className="ml-auto flex gap-3">
                      <button
                        type="button"
                        className="ebim-link text-[13px]"
                        onClick={() =>
                          setPlanDialog({
                            open: true,
                            plan: {
                              id: p.id,
                              code: p.code,
                              name: p.name,
                              description: p.description,
                              saas_product_id: p.saas_product_id,
                              status: p.status,
                              valid_from: p.valid_from,
                              valid_to: p.valid_to,
                            },
                          })
                        }
                      >
                        Editar plan
                      </button>
                      <button
                        type="button"
                        className="ebim-link text-[13px]"
                        onClick={() => setRuleDialog({ planId: p.id, planName: p.name })}
                      >
                        Añadir regla
                      </button>
                    </span>
                  ) : null}
                </div>
                <p className="mb-3 text-sm text-muted">{p.description}</p>
                <div className="rounded-card border border-border">
                  <DataTable columns={['Regla', 'Base', 'Tasa / Monto', 'Recurrente', 'Tope meses', 'Tope monto', 'Vigencia', '']}>
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
                        <td className="ebim-td text-right">
                          {perms.canReadFinance && r.status === 'ACTIVE' ? (
                            <button
                              type="button"
                              className="text-[13px] text-danger hover:underline"
                              onClick={() =>
                                setClosingRule({ id: r.id as string, name: r.name as string })
                              }
                            >
                              Cerrar
                            </button>
                          ) : null}
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

      <CommissionPlanFormDialog
        open={planDialog.open}
        plan={planDialog.plan}
        onClose={() => setPlanDialog({ open: false, plan: null })}
      />

      <CommissionRuleFormDialog
        open={Boolean(ruleDialog)}
        planId={ruleDialog?.planId ?? null}
        planName={ruleDialog?.planName ?? ''}
        onClose={() => setRuleDialog(null)}
      />

      <ConfirmDialog
        open={Boolean(closingRule)}
        title={`¿Cerrar la regla "${closingRule?.name}"?`}
        message="Dejará de aplicarse a cobros futuros. Las comisiones ya devengadas con esta regla se conservan intactas."
        confirmLabel="Cerrar regla"
        onConfirm={() => void confirmCloseRule()}
        onCancel={() => setClosingRule(null)}
      />
    </PageContainer>
  );
}
