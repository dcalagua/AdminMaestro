import { useState } from 'react';
import { useCommissionPlans } from '@/services/queries';
import { useDeactivateCommissionRule } from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, SearchBar, LoadingState, ErrorState, EmptyState, Badge, KpiTile,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { KpiStrip } from '@/features/billing/financeUi';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatDate, formatNumber } from '@/lib/format';
import {
  entityStatusLabel, entityStatusTabs, entityStatusTone, matchesEntityStatusTab,
} from '@/features/catalog/catalogLabels';
import type { EntityStatusTab } from '@/features/catalog/catalogLabels';
import { CommissionPlanFormDialog, CommissionRuleFormDialog } from './CommercialDialogs';
import type { CommissionPlanDraft } from './CommercialDialogs';
import { describeRule, exampleForRule } from './commissionRuleText';

/**
 * Reglas de comisión (P13).
 *
 * Todas las bases parten de un COBRO ("collected"), nunca de un facturado: no se
 * paga comisión sobre una factura impaga (prompt fase 6). Cada regla se lee en
 * castellano y con un ejemplo que usa la MISMA regla; el ejemplo no es una
 * liquidación.
 */
export function CommissionPlansPage() {
  const plans = useCommissionPlans();
  const perms = usePermissions();
  const toast = useToast();
  const deactivate = useDeactivateCommissionRule();

  const [tab, setTab] = useState<EntityStatusTab>('ALL');
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
    (p.saas_products as { short_name: string } | null)?.short_name,
  ]);
  const visible = filtered.filter((p) => matchesEntityStatusTab(p.status, tab));
  const hasAny = (plans.data ?? []).length > 0;

  // Franja: conteos del catálogo ya cargado (sin consultas nuevas).
  const allPlans = plans.data ?? [];
  const activePlans = allPlans.filter((p) => p.status === 'ACTIVE');
  const activeRules = activePlans.flatMap((p) =>
    ((p.commission_rules ?? []) as Array<Record<string, unknown>>).filter((r) => r.status === 'ACTIVE'),
  );
  const coversAll = activePlans.some((p) => !p.saas_product_id);
  const productCount = new Set(activePlans.map((p) => p.saas_product_id).filter(Boolean)).size;
  const withoutRules = activePlans.filter(
    (p) => !((p.commission_rules ?? []) as Array<Record<string, unknown>>).some((r) => r.status === 'ACTIVE'),
  );
  const tileState = { loading: plans.isLoading, error: plans.error, onRetry: () => void plans.refetch() };

  return (
    <PageContainer
      title="Reglas de comisión"
      description="Cuánto cobra un comercial por lo que vendió, siempre sobre cobros confirmados. Las reglas tienen vigencia y no se editan hacia atrás: se cierran y se abre una nueva."
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
      <KpiStrip label="Resumen de reglas de comisión">
        <KpiTile
          label="Planes vigentes"
          value={formatNumber(activePlans.length)}
          footer={`de ${formatNumber(allPlans.length)} planes registrados`}
          {...tileState}
        />
        <KpiTile
          label="Reglas vigentes"
          info="Reglas activas dentro de planes vigentes: son las que generan comisión sobre los próximos cobros."
          value={formatNumber(activeRules.length)}
          footer="Siempre sobre cobros confirmados"
          {...tileState}
        />
        <KpiTile
          label="Productos cubiertos"
          value={coversAll ? 'Todos' : formatNumber(productCount)}
          footer={coversAll ? 'Hay un plan vigente para todos los productos' : 'Productos con un plan vigente propio'}
          {...tileState}
        />
        <KpiTile
          label="Planes sin reglas"
          info="Un plan vigente sin reglas activas no genera comisión."
          value={formatNumber(withoutRules.length)}
          tone={withoutRules.length > 0 ? 'warn' : 'neutral'}
          footer={withoutRules.length > 0 ? withoutRules.map((p) => p.name).slice(0, 2).join(' · ') : 'Todos los planes vigentes tienen reglas'}
          {...tileState}
        />
      </KpiStrip>

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar plan de comisión o producto…"
          right={
            <StatusTabs
              value={tab}
              onChange={setTab}
              options={entityStatusTabs(filtered, { active: 'Vigentes', inactive: 'No vigentes' })}
            />
          }
        />
        {plans.isLoading ? (
          <LoadingState label="Cargando planes de comisión…" />
        ) : plans.error ? (
          <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={hasAny ? 'Ningún plan coincide' : 'Sin planes de comisión'}
            description={
              hasAny
                ? 'Prueba con otra búsqueda o cambia de pestaña.'
                : 'Todavía no hay planes de comisión visibles para tu perfil.'
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {visible.map((p) => {
              const rules = (p.commission_rules ?? []) as Array<Record<string, unknown>>;
              return (
                <section key={p.id} className="px-5 py-4" aria-labelledby={`cplan-${p.id}`}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h2 id={`cplan-${p.id}`} className="text-h3 text-fg">{p.name}</h2>
                    <Badge tone={entityStatusTone(p.status)} dot>{entityStatusLabel(p.status)}</Badge>
                    {p.saas_products ? (
                      <Badge tone="info">
                        {(p.saas_products as { short_name: string }).short_name}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Todos los productos</Badge>
                    )}
                    <span className="font-mono text-caption text-muted">{p.code}</span>
                    {perms.canReadFinance ? (
                      <span className="ml-auto">
                        <ActionMenu
                          variant="page"
                          buttonLabel="Acciones"
                          label={`Acciones del plan ${p.name}`}
                          items={[
                            {
                              label: 'Editar plan',
                              onSelect: () =>
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
                                }),
                            },
                            { label: 'Añadir regla', onSelect: () => setRuleDialog({ planId: p.id, planName: p.name }) },
                          ]}
                        />
                      </span>
                    ) : null}
                  </div>
                  {p.description ? <p className="mb-3 max-w-[72ch] text-body text-fg-2">{p.description}</p> : null}
                  {rules.length === 0 ? (
                    <p className="rounded-card border border-dashed border-border-strong px-4 py-3 text-compact text-muted">
                      Este plan todavía no tiene reglas: no genera comisión.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {rules.map((r) => {
                        const example = exampleForRule(r);
                        const active = r.status === 'ACTIVE';
                        return (
                          <li key={r.id as string} className="ebim-hover-row rounded-card border border-border px-4 py-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-body font-semibold">{r.name as string}</span>
                                  <Badge tone={entityStatusTone(r.status as string)}>
                                    {active ? 'Vigente' : entityStatusLabel(r.status as string)}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-body text-fg">{describeRule(r)}</p>
                                <p className="mt-0.5 text-caption text-muted">
                                  Vigencia {formatDate(r.valid_from as string)} →{' '}
                                  {r.valid_to ? formatDate(r.valid_to as string) : 'sin fin'}
                                </p>
                              </div>
                              {perms.canReadFinance && active ? (
                                <ActionMenu
                                  label={`Acciones de la regla ${r.name as string}`}
                                  items={[
                                    {
                                      label: 'Cerrar regla',
                                      tone: 'danger',
                                      onSelect: () => setClosingRule({ id: r.id as string, name: r.name as string }),
                                    },
                                  ]}
                                />
                              ) : null}
                            </div>
                            {example ? (
                              <p className="mt-2 rounded-field bg-sunken px-3 py-2 text-compact text-fg-2">
                                <span className="font-semibold text-fg">Ejemplo de lectura:</span> {example}{' '}
                                <span className="italic">No sustituye la liquidación real.</span>
                              </p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
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
        busy={deactivate.isPending}
        onConfirm={confirmCloseRule}
        onCancel={() => setClosingRule(null)}
      />
    </PageContainer>
  );
}
