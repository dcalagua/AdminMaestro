import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useProductIntegrations } from '@/services/queries';
import { useSetCommercialCutoverState } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, DataTable, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { BILLING_AXIS, BILLING_AXIS_ORDER, billingAxisTargets, labelOf } from '@/features/usage/usageLabels';

/**
 * Eje de facturación (BILLING) de cada integración de producto (spec §15.2).
 * Se mueve un paso adelante o atrás con `set_commercial_cutover_state` y
 * motivo obligatorio; BILLING_RETIRED no se alcanza en este programa. D-14
 * (DEV/LOCAL): eExpense y GMAO avanzan SOLO a BILLING_SHADOW con diff 0.
 */
export type Integration = NonNullable<ReturnType<typeof useProductIntegrations>['data']>[number];

interface Transition {
  integration: Integration;
  to: string;
}

export function ShadowAxisTab() {
  const integrations = useProductIntegrations();
  const perms = usePermissions();
  const [transition, setTransition] = useState<Transition | null>(null);
  const rows = integrations.data ?? [];

  return (
    <Card
      title="Eje de facturación por integración"
      description="BILLING_LEGACY: factura el biller local. BILLING_SHADOW: MasterAdmin calcula lo que facturaría y se compara; nadie cobra desde MasterAdmin. Cada paso queda en el historial de cutover con su motivo."
    >
      {integrations.isLoading ? (
        <LoadingState label="Cargando integraciones…" />
      ) : integrations.error ? (
        <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Sin integraciones visibles"
          description="El eje vive en la integración del producto. Si no ves ninguna, tu rol no tiene platform.integration.read."
        />
      ) : (
        <DataTable columns={['Producto', 'Integración', 'Eje BILLING', 'Recorrido', '']}>
          {rows.map((i) => {
            const product = i.saas_products as { code: string; short_name: string } | null;
            const axis = labelOf(BILLING_AXIS, i.cutover_state_billing);
            const current = BILLING_AXIS_ORDER.indexOf(i.cutover_state_billing as (typeof BILLING_AXIS_ORDER)[number]);
            return (
              <tr key={i.id}>
                <td className="ebim-td">
                  <div className="font-semibold">{product?.short_name ?? '—'}</div>
                  <div className="font-mono text-[11px] text-muted">{product?.code}</div>
                </td>
                <td className="ebim-td font-mono text-xs">{i.code}</td>
                <td className="ebim-td">
                  <Badge tone={axis.tone}>{axis.label}</Badge>
                  <div className="mt-0.5 font-mono text-[11px] text-muted">{i.cutover_state_billing}</div>
                </td>
                <td className="ebim-td">
                  <ol className="flex flex-wrap items-center gap-1 text-[11px]" aria-label={`Recorrido de ${i.code}`}>
                    {BILLING_AXIS_ORDER.map((s, idx) => (
                      <li
                        key={s}
                        aria-current={idx === current ? 'step' : undefined}
                        className={idx === current ? 'font-bold text-accent-deep' : idx < current ? 'text-fg' : 'text-muted'}
                      >
                        {idx > 0 ? '→ ' : ''}
                        {s.replace('BILLING_', '')}
                      </li>
                    ))}
                  </ol>
                </td>
                <td className="ebim-td">
                  {perms.canManageCommercial ? (
                    <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                      {billingAxisTargets(i.cutover_state_billing).map((to) => {
                        const forward =
                          BILLING_AXIS_ORDER.indexOf(to as (typeof BILLING_AXIS_ORDER)[number]) > current;
                        return (
                          <button
                            key={to}
                            type="button"
                            className="ebim-link text-[13px]"
                            onClick={() => setTransition({ integration: i, to })}
                          >
                            {forward ? 'Avanzar' : 'Retroceder'} a {to.replace('BILLING_', '')}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}

      <TransitionDialog transition={transition} onClose={() => setTransition(null)} />
    </Card>
  );
}

const reasonSchema = z.object({ reason: z.string().trim().min(3, 'El motivo es obligatorio') });
type ReasonValues = z.input<typeof reasonSchema>;

function TransitionDialog({ transition, onClose }: { transition: Transition | null; onClose: () => void }) {
  const toast = useToast();
  const setState = useSetCommercialCutoverState();
  const form = useForm<ReasonValues>({ resolver: zodResolver(reasonSchema), defaultValues: { reason: '' } });

  useEffect(() => {
    if (!transition) return;
    setState.reset();
    form.reset({ reason: '' });
  }, [transition]);

  const to = transition?.to ?? '';
  const submit = form.handleSubmit(async (values) => {
    if (!transition) return;
    const v = reasonSchema.parse(values);
    try {
      await setState.mutateAsync({
        p_integration_id: transition.integration.id,
        p_axis: 'BILLING',
        p_to_state: transition.to,
        p_reason: v.reason,
      });
      toast.success('Eje de facturación actualizado', `${transition.integration.code} → ${transition.to}`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  const description =
    to === 'BILLING_PRIMARY'
      ? 'MasterAdmin pasaría a ser quien factura este producto. D-14: en DEV/LOCAL eExpense y GMAO solo llegan a BILLING_SHADOW; QAS/PRD exigen aprobación humana explícita. Requiere comparaciones verdes del período.'
      : to === 'BILLING_SHADOW'
        ? 'MasterAdmin calcula lo que facturaría y se registran comparaciones contra el biller local. Nadie cobra desde MasterAdmin.'
        : 'Vuelve al paso anterior del eje. El historial de cutover conserva el motivo.';

  return (
    <FormDialog
      open={Boolean(transition)}
      title={`${transition?.integration.cutover_state_billing ?? ''} → ${to}`}
      description={description}
      submitLabel="Cambiar eje"
      busy={setState.isPending}
      error={setState.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextAreaField label="Motivo" required hint="Queda en commercial_cutover_events (append-only)."
        error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}
