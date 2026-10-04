import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useUsageAggregates } from '@/services/queries';
import { useCloseUsageAggregate, useFinalizeUsageAggregate } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatDateTime } from '@/lib/format';
import { AGGREGATE_STATUS, ALLOWANCE_STATUS, formatPeriod, formatQuantity, labelOf, periodEnded } from './usageLabels';

/**
 * Agregados de uso por tenant × medidor × período (spec §11.4). La única fuente
 * de facturación de uso: nunca se factura desde eventos crudos.
 *
 * OPEN → CLOSING (job de servidor tras la gracia del medidor, o finanzas con
 * «Cerrar período» si el mes ya terminó) → FINALIZED (finanzas o job). Mientras
 * no está FINALIZED la cantidad no es definitiva: se recalcula desde los
 * eventos al finalizar.
 */

type Aggregate = NonNullable<ReturnType<typeof useUsageAggregates>['data']>[number];
type StatusTab = 'ALL' | 'OPEN' | 'CLOSING' | 'FINALIZED';

export function AggregatesTab() {
  const aggregates = useUsageAggregates();
  const finalize = useFinalizeUsageAggregate();
  const perms = usePermissions();
  const toast = useToast();
  const [tab, setTab] = useState<StatusTab>('ALL');
  const [pending, setPending] = useState<Aggregate | null>(null);
  const [closing, setClosing] = useState<Aggregate | null>(null);

  const { term, setTerm, filtered } = useSearchFilter(aggregates.data, (a) => [
    a.product_code, a.tenant_slug, a.meter_code, a.period_start, a.status,
  ]);
  const count = (s: StatusTab) => filtered.filter((a) => s === 'ALL' || a.status === s).length;
  const visible = filtered.filter((a) => tab === 'ALL' || a.status === tab);
  const hasAny = (aggregates.data ?? []).length > 0;

  async function confirmFinalize() {
    if (!pending?.id) return;
    try {
      await finalize.mutateAsync({ p_aggregate_id: pending.id });
      toast.success('Agregado finalizado', `${pending.tenant_slug} · ${pending.meter_code} · ${formatPeriod(pending.period_start)}`);
    } catch (error) {
      toast.error('No se pudo finalizar', businessErrorMessage(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <Card
      title="Agregados por período"
      description="Mes calendario UTC (D-10). La cantidad es definitiva solo al finalizar; un evento tardío va al período siguiente y nunca reabre uno finalizado."
    >
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder="Buscar por producto, tenant o medidor…"
        right={
          <StatusTabs
            value={tab}
            onChange={setTab}
            options={[
              { id: 'ALL', label: 'Todos', count: count('ALL') },
              { id: 'OPEN', label: 'Abiertos', count: count('OPEN') },
              { id: 'CLOSING', label: 'En cierre', count: count('CLOSING') },
              { id: 'FINALIZED', label: 'Finalizados', count: count('FINALIZED') },
            ]}
          />
        }
      />
      {aggregates.isLoading ? (
        <LoadingState label="Cargando agregados…" />
      ) : aggregates.error ? (
        <ErrorState error={aggregates.error} onRetry={() => void aggregates.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={hasAny ? 'Ningún agregado coincide' : 'Sin agregados de uso'}
          description={
            hasAny
              ? 'Prueba con otra búsqueda o cambia de estado.'
              : 'Un agregado se abre con el primer evento aceptado de un tenant en un medidor y período.'
          }
        />
      ) : (
        <DataTable columns={['Tenant', 'Medidor', 'Período', 'Estado', 'Cantidad', 'Asignación', 'Facturable', '']}>
          {visible.map((a) => {
            const st = labelOf(AGGREGATE_STATUS, a.status);
            const finalized = a.status === 'FINALIZED';
            return (
              <tr key={a.id ?? `${a.tenant_id}:${a.meter_code}:${a.period_start}`}>
                <td className="ebim-td">
                  <div className="font-semibold">{a.tenant_slug ?? '—'}</div>
                  <div className="text-[11px] text-muted">{a.product_code}</div>
                </td>
                <td className="ebim-td font-mono text-xs">{a.meter_code}</td>
                <td className="ebim-td whitespace-nowrap text-xs">{formatPeriod(a.period_start)}</td>
                <td className="ebim-td">
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {finalized && a.finalized_at ? (
                    <div className="mt-0.5 text-[11px] text-muted">{formatDateTime(a.finalized_at)}</div>
                  ) : null}
                </td>
                <td className="ebim-td text-xs tabular-nums">
                  {finalized ? (
                    <>
                      <span className="font-semibold">{formatQuantity(a.quantity)}</span> {a.unit}
                      <div className="text-[11px] text-muted">
                        {a.event_count ?? 0} evento(s){a.late_event_count ? ` · ${a.late_event_count} tardío(s)` : ''}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted">Se calcula al finalizar</span>
                  )}
                </td>
                <td className="ebim-td text-xs">
                  {a.allowance_status ? (
                    <>
                      <Badge tone={labelOf(ALLOWANCE_STATUS, a.allowance_status).tone}>
                        {labelOf(ALLOWANCE_STATUS, a.allowance_status).label}
                      </Badge>
                      {a.allowance_included !== null && a.allowance_included !== undefined ? (
                        <div className="mt-0.5 text-[11px] text-muted">
                          Incluye {formatQuantity(a.allowance_included)}
                          {a.overage_quantity ? ` · exceso ${formatQuantity(a.overage_quantity)}` : ''}
                          {a.overage_policy ? ` · ${a.overage_policy}` : ''}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="ebim-td">
                  {finalized ? (
                    <Badge tone={a.is_billable ? 'ok' : 'neutral'}>{a.is_billable ? 'Sí' : 'No'}</Badge>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </td>
                <td className="ebim-td whitespace-nowrap text-right">
                  {perms.canReadFinance && a.status === 'CLOSING' && a.id ? (
                    <button type="button" className="ebim-link text-[13px]" onClick={() => setPending(a)}>
                      Finalizar
                    </button>
                  ) : null}
                  {perms.canReadFinance && a.status === 'OPEN' && a.id && periodEnded(a.period_start) ? (
                    <button type="button" className="ebim-link text-[13px]" onClick={() => setClosing(a)}>
                      Cerrar período
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}

      <ConfirmDialog
        open={pending !== null}
        title="¿Finalizar este agregado?"
        message={
          pending
            ? `${pending.tenant_slug} · ${pending.meter_code} · ${formatPeriod(pending.period_start)}. Se recalcula desde los eventos, queda inmutable y, si el medidor es de IA, consume créditos. No se puede deshacer: un evento tardío irá al período siguiente.`
            : ''
        }
        confirmLabel="Finalizar"
        tone="primary"
        busy={finalize.isPending}
        onConfirm={confirmFinalize}
        onCancel={() => setPending(null)}
      />
      <CloseAggregateDialog aggregate={closing} onClose={() => setClosing(null)} />
    </Card>
  );
}

const closeSchema = z.object({ reason: z.string().trim().min(3, 'El motivo es obligatorio') });
type CloseValues = z.input<typeof closeSchema>;

/** OPEN → CLOSING sin esperar al job (D-07): el mes terminó y finanzas lo decide. */
function CloseAggregateDialog({ aggregate, onClose }: { aggregate: Aggregate | null; onClose: () => void }) {
  const toast = useToast();
  const close = useCloseUsageAggregate();
  const form = useForm<CloseValues>({ resolver: zodResolver(closeSchema), defaultValues: { reason: '' } });

  useEffect(() => {
    if (!aggregate) return;
    close.reset();
    form.reset({ reason: '' });
  }, [aggregate]);

  const submit = form.handleSubmit(async (values) => {
    if (!aggregate?.id) return;
    const v = closeSchema.parse(values);
    try {
      await close.mutateAsync({ p_aggregate_id: aggregate.id, p_reason: v.reason });
      toast.success('Período cerrado', `${aggregate.tenant_slug} · ${aggregate.meter_code} · ${formatPeriod(aggregate.period_start)}`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={Boolean(aggregate)}
      title={`Cerrar período · ${aggregate ? formatPeriod(aggregate.period_start) : ''}`}
      description={
        aggregate
          ? `${aggregate.tenant_slug} · ${aggregate.meter_code}. Pasa a «En cierre» sin esperar la ventana de gracia del medidor; después se puede finalizar. Un evento que llegue luego sigue entrando hasta finalizar.`
          : ''
      }
      submitLabel="Cerrar período"
      busy={close.isPending}
      error={close.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextAreaField label="Motivo" required hint="Queda en la auditoría."
        error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}
