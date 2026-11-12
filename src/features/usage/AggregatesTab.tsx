import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useUsageAggregates } from '@/services/queries';
import { useCloseUsageAggregate, useFinalizeUsageAggregate } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  Card,
  DataTable,
  SearchBar,
  LoadingState,
  ErrorState,
  EmptyState,
  Badge,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatDateTime } from '@/lib/format';
import {
  AGGREGATE_STATUS,
  ALLOWANCE_STATUS,
  formatPeriod,
  formatQuantity,
  labelOf,
  periodEnded,
} from './usageLabels';
import { consumptionVsIncluded, finalizedPeriods, type ConsumptionRow } from './usageSeries';

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
    a.product_code,
    a.tenant_slug,
    a.meter_code,
    a.period_start,
    a.status,
  ]);
  const count = (s: StatusTab) => filtered.filter((a) => s === 'ALL' || a.status === s).length;
  const visible = filtered.filter((a) => tab === 'ALL' || a.status === tab);
  const hasAny = (aggregates.data ?? []).length > 0;
  const lastPeriod = useMemo(
    () => finalizedPeriods(aggregates.data ?? [], 1)[0] ?? null,
    [aggregates.data],
  );
  const consumption = useMemo(
    () => (lastPeriod ? consumptionVsIncluded(aggregates.data ?? [], lastPeriod) : []),
    [aggregates.data, lastPeriod],
  );

  async function confirmFinalize() {
    if (!pending?.id) return;
    try {
      await finalize.mutateAsync({ p_aggregate_id: pending.id });
      toast.success(
        'Agregado finalizado',
        `${pending.tenant_slug} · ${pending.meter_code} · ${formatPeriod(pending.period_start)}`,
      );
    } catch (error) {
      toast.error('No se pudo finalizar', businessErrorMessage(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      {lastPeriod && consumption.length > 0 ? (
        <ConsumptionPanel period={lastPeriod} rows={consumption} />
      ) : null}
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
          <DataTable
            label="Agregados de uso"
            maxHeight={720}
            columns={[
              'Tenant',
              'Medidor · período',
              'Estado',
              { label: 'Cantidad', align: 'right' },
              'Consumo vs incluido',
              'Facturable',
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {visible.map((a) => {
              const st = labelOf(AGGREGATE_STATUS, a.status);
              const finalized = a.status === 'FINALIZED';
              return (
                <tr key={a.id ?? `${a.tenant_id}:${a.meter_code}:${a.period_start}`}>
                  <td className="ebim-td max-w-[200px]">
                    <div className="truncate font-semibold" title={a.tenant_slug ?? undefined}>
                      {a.tenant_slug ?? '—'}
                    </div>
                    <div className="text-caption text-muted">{a.product_code}</div>
                  </td>
                  {/* El período va bajo el medidor: como columna propia la tabla no cabía a 1280. */}
                  <td className="ebim-td">
                    <div className="max-w-[180px] truncate font-mono text-caption" title={a.meter_code ?? undefined}>
                      {a.meter_code}
                    </div>
                    <div className="whitespace-nowrap text-compact text-fg-2">{formatPeriod(a.period_start)}</div>
                  </td>
                  <td className="ebim-td">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {finalized && a.finalized_at ? (
                      <div className="mt-0.5 whitespace-nowrap text-caption text-muted">
                        {formatDateTime(a.finalized_at)}
                      </div>
                    ) : null}
                  </td>
                  <td className="ebim-td ebim-num text-compact">
                    {finalized ? (
                      <>
                        <span className="whitespace-nowrap">
                          <span className="font-semibold">{formatQuantity(a.quantity)}</span>{' '}
                          <span className="font-mono text-caption text-muted">{a.unit}</span>
                        </span>
                        <div className="whitespace-nowrap text-caption text-muted">
                          {a.event_count ?? 0} evento(s)
                          {a.late_event_count ? ` · ${a.late_event_count} tardío(s)` : ''}
                        </div>
                      </>
                    ) : (
                      <span className="whitespace-nowrap text-caption text-muted">Se calcula al finalizar</span>
                    )}
                  </td>
                  <td className="ebim-td text-compact">
                    {a.allowance_status ? (
                      <>
                        <Badge tone={labelOf(ALLOWANCE_STATUS, a.allowance_status).tone}>
                          {labelOf(ALLOWANCE_STATUS, a.allowance_status).label}
                        </Badge>
                        {a.allowance_included !== null && a.allowance_included !== undefined ? (
                          finalized ? (
                            <div className="mt-1.5">
                              <AllowanceBar
                                consumed={Number(a.quantity ?? 0)}
                                included={Number(a.allowance_included)}
                                overage={
                                  a.overage_quantity === null
                                    ? undefined
                                    : Number(a.overage_quantity)
                                }
                              />
                              {a.overage_policy ? (
                                <div className="text-caption text-muted">
                                  Política: {a.overage_policy}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="mt-0.5 text-caption text-muted">
                              Incluye {formatQuantity(a.allowance_included)}
                            </div>
                          )
                        ) : null}
                      </>
                    ) : (
                      <span className="text-caption text-muted">Sin asignación</span>
                    )}
                  </td>
                  <td className="ebim-td">
                    {finalized ? (
                      <Badge tone={a.is_billable ? 'ok' : 'neutral'}>
                        {a.is_billable ? 'Sí' : 'No'}
                      </Badge>
                    ) : (
                      <span className="text-caption text-muted">—</span>
                    )}
                  </td>
                  <td className="ebim-td whitespace-nowrap text-right">
                    {perms.canReadFinance && a.status === 'CLOSING' && a.id ? (
                      <button
                        type="button"
                        className="ebim-link text-compact"
                        onClick={() => setPending(a)}
                      >
                        Finalizar
                      </button>
                    ) : null}
                    {perms.canReadFinance &&
                    a.status === 'OPEN' &&
                    a.id &&
                    periodEnded(a.period_start) ? (
                      <button
                        type="button"
                        className="ebim-link text-compact"
                        onClick={() => setClosing(a)}
                      >
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
    </>
  );
}

/**
 * Barra consumo vs incluido (§6.6, barras HTML): relleno de marca hasta lo
 * incluido y, si se pasa, el exceso en `--warn` separado por 2 px, con icono y
 * texto (el color nunca es la única señal). Sin cantidad incluida no hay barra:
 * no hay contra qué medir.
 */
function AllowanceBar({
  consumed,
  included,
  overage,
}: {
  consumed: number;
  included: number;
  overage?: number;
}) {
  const over = Math.max(0, overage ?? consumed - included);
  const scale = Math.max(consumed, included, 1);
  const within = Math.min(consumed, included);
  return (
    <div className="min-w-[140px]" data-allowance-bar>
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <span
          className="h-full rounded-full bg-chart-1"
          style={{ width: `${(within / scale) * 100}%` }}
        />
        {over > 0 ? (
          <span
            className="h-full rounded-full bg-warn"
            style={{ width: `${(over / scale) * 100}%` }}
          />
        ) : null}
      </div>
      <p className="mt-1 text-caption text-muted tabular-nums">
        <span className="font-semibold text-fg">{formatQuantity(consumed)}</span> de{' '}
        {formatQuantity(included)} incluidas
        {over > 0 ? (
          <span className="font-semibold text-warn"> · exceso {formatQuantity(over)}</span>
        ) : null}
      </p>
    </div>
  );
}

/** Consumo del último mes finalizado por medidor, frente a lo incluido en contrato. */
function ConsumptionPanel({ period, rows }: { period: string; rows: ConsumptionRow[] }) {
  return (
    <Card
      title={`Consumo vs incluido · ${formatPeriod(period)}`}
      description="Último mes finalizado, sumando tenants. Cada medidor tiene su unidad: las barras no se comparan entre sí, solo con lo incluido en contrato."
      className="mb-4"
    >
      <ul
        className="grid gap-x-8 gap-y-4 px-5 py-4 md:grid-cols-2"
        aria-label="Consumo por medidor"
      >
        {rows.map((r) => (
          <li key={r.key} className="min-w-0" data-consumption={r.meterCode}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                <span className="font-mono text-compact text-fg">{r.meterCode}</span>
                <span className="ml-2 text-caption text-muted">{r.productCode}</span>
              </span>
              <span className="shrink-0 text-caption text-muted">
                {r.tenants} {r.tenants === 1 ? 'tenant' : 'tenants'}
              </span>
            </div>
            {r.included !== null ? (
              <AllowanceBar
                consumed={r.consumedWithAllowance}
                included={r.included}
                overage={r.overage}
              />
            ) : (
              <p className="text-compact tabular-nums">
                <span className="text-h3 text-fg">{formatQuantity(r.consumed)}</span>{' '}
                <span className="font-mono text-caption text-muted">{r.unit}</span>
                <span className="block text-caption text-muted">
                  Sin cantidad incluida en contrato: se mide, no se compara.
                </span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

const closeSchema = z.object({ reason: z.string().trim().min(3, 'El motivo es obligatorio') });
type CloseValues = z.input<typeof closeSchema>;

/** OPEN → CLOSING sin esperar al job (D-07): el mes terminó y finanzas lo decide. */
function CloseAggregateDialog({
  aggregate,
  onClose,
}: {
  aggregate: Aggregate | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const close = useCloseUsageAggregate();
  const form = useForm<CloseValues>({
    resolver: zodResolver(closeSchema),
    defaultValues: { reason: '' },
  });

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
      toast.success(
        'Período cerrado',
        `${aggregate.tenant_slug} · ${aggregate.meter_code} · ${formatPeriod(aggregate.period_start)}`,
      );
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
      <TextAreaField
        label="Motivo"
        required
        hint="Queda en la auditoría."
        error={form.formState.errors.reason}
        {...form.register('reason')}
      />
    </FormDialog>
  );
}
