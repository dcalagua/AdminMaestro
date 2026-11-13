import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCommercialCutoverAxes, useCommercialCutoverHistory } from '@/services/queries';
import { useSetCommercialCutoverState } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Card,
  DataTable,
  LoadingState,
  ErrorState,
  EmptyState,
  Badge,
} from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { formatDateTime } from '@/lib/format';
import {
  BILLING_AXIS,
  BILLING_AXIS_ORDER,
  billingAxisTargets,
  labelOf,
} from '@/features/usage/usageLabels';
import { CutoverStepper } from '@/features/platform/CutoverStepper';
import { cutoverStepLabel } from '@/features/platform/cutover';

/**
 * Eje de facturación (BILLING) de cada integración de producto (spec §15.2).
 * Se mueve un paso adelante o atrás con `set_commercial_cutover_state` y
 * motivo obligatorio; BILLING_RETIRED no se alcanza en este programa. D-14
 * (DEV/LOCAL): eExpense y GMAO avanzan SOLO a BILLING_SHADOW con diff 0.
 *
 * Lee `v_commercial_cutover_axes` (no `product_integrations`): finanzas ve el
 * eje sin `platform.integration.read` y sin el contrato M2M de la integración.
 */
export type Integration = NonNullable<ReturnType<typeof useCommercialCutoverAxes>['data']>[number];

interface Transition {
  integration: Integration;
  to: string;
}

export function ShadowAxisTab() {
  const integrations = useCommercialCutoverAxes();
  const perms = usePermissions();
  const [transition, setTransition] = useState<Transition | null>(null);
  const rows = integrations.data ?? [];

  return (
    <div className="space-y-4">
      <Card
        title="Migración de cobro por integración"
        description="«Cobra la app»: la app factura por su cuenta. «En comparación»: el Admin Maestro calcula lo que facturaría y se compara; nadie cobra desde aquí. Cada paso queda en el historial con su motivo."
      >
        {integrations.isLoading ? (
          <LoadingState label="Cargando integraciones…" />
        ) : integrations.error ? (
          <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Sin integraciones visibles"
            description="El eje vive en la integración del producto. Si no ves ninguna, tu rol no lee finanzas, lo comercial ni la integración."
          />
        ) : (
          <DataTable columns={['Producto', 'Integración', 'Etapa de cobro', 'Recorrido', { label: 'Acciones', srOnly: true }]}>
            {rows.map((i) => {
              const axis = labelOf(BILLING_AXIS, i.cutover_state_billing);
              const current = BILLING_AXIS_ORDER.indexOf(
                i.cutover_state_billing as (typeof BILLING_AXIS_ORDER)[number],
              );
              return (
                <tr key={i.integration_id}>
                  <td className="ebim-td">
                    <div className="font-semibold">{i.product_short_name ?? '—'}</div>
                    <div className="font-mono text-caption text-muted">{i.product_code}</div>
                  </td>
                  <td className="ebim-td font-mono text-compact">{i.integration_code}</td>
                  <td className="ebim-td">
                    <span title={i.cutover_state_billing ?? undefined}>
                      <Badge tone={axis.tone}>{axis.label}</Badge>
                    </span>
                  </td>
                  <td className="ebim-td min-w-[180px]">
                    {/* V6 · T6: barra compacta con el nombre de negocio; el recorrido completo, en el tooltip. */}
                    <CutoverStepper axis="billing" state={i.cutover_state_billing} heading={false} />
                  </td>
                  <td className="ebim-td">
                    {perms.canManageCommercial ? (
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                        {billingAxisTargets(i.cutover_state_billing).map((to) => {
                          const forward =
                            BILLING_AXIS_ORDER.indexOf(to as (typeof BILLING_AXIS_ORDER)[number]) >
                            current;
                          return (
                            <button
                              key={to}
                              type="button"
                              className="ebim-link text-compact"
                              onClick={() => setTransition({ integration: i, to })}
                            >
                              {forward ? 'Avanzar' : 'Retroceder'} a «{cutoverStepLabel(to)}»
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
      <CutoverHistoryCard />
    </div>
  );
}

/** Historial del eje BILLING (commercial_cutover_events, append-only). */
function CutoverHistoryCard() {
  const history = useCommercialCutoverHistory();
  const rows = history.data ?? [];
  return (
    <Card
      title="Historial de la migración de cobro"
      description="Cada cambio de etapa con su motivo y quién lo hizo. No se edita ni se borra."
    >
      {history.isLoading ? (
        <LoadingState label="Cargando historial…" />
      ) : history.error ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Sin cambios de etapa"
          description="Ninguna integración ha cambiado aún su etapa de cobro."
        />
      ) : (
        <DataTable columns={['Fecha', 'Producto', 'Integración', 'Cambio', 'Motivo', 'Quién']}>
          {rows.map((h) => (
            <tr key={h.id ?? `${h.integration_id}:${h.occurred_at}`}>
              <td className="ebim-td whitespace-nowrap text-compact text-muted">
                {formatDateTime(h.occurred_at)}
              </td>
              <td className="ebim-td text-compact">{h.product_code ?? '—'}</td>
              <td className="ebim-td font-mono text-compact">{h.integration_code}</td>
              <td className="ebim-td whitespace-nowrap text-compact">
                {labelOf(BILLING_AXIS, h.from_state).label} →{' '}
                <strong>{labelOf(BILLING_AXIS, h.to_state).label}</strong>
              </td>
              <td className="ebim-td max-w-[320px] text-compact">{h.reason}</td>
              <td className="ebim-td text-compact">{h.actor_name ?? 'Servidor'}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  );
}

const reasonSchema = z.object({ reason: z.string().trim().min(3, 'El motivo es obligatorio') });
type ReasonValues = z.input<typeof reasonSchema>;

function TransitionDialog({
  transition,
  onClose,
}: {
  transition: Transition | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const setState = useSetCommercialCutoverState();
  const form = useForm<ReasonValues>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: '' },
  });

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
      if (!transition.integration.integration_id) return;
      await setState.mutateAsync({
        p_integration_id: transition.integration.integration_id,
        p_axis: 'BILLING',
        p_to_state: transition.to,
        p_reason: v.reason,
      });
      toast.success(
        'Etapa de cobro actualizada',
        `${transition.integration.integration_code} → ${cutoverStepLabel(transition.to)}`,
      );
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  const description =
    to === 'BILLING_PRIMARY'
      ? 'El Admin Maestro pasaría a ser quien factura este producto. En desarrollo, eExpense y GMAO solo llegan a «En comparación»; Calidad y Producción exigen aprobación humana explícita. Requiere comparaciones verdes del período.'
      : to === 'BILLING_SHADOW'
        ? 'El Admin Maestro calcula lo que facturaría y se registran comparaciones contra el cobro propio de la app. Nadie cobra desde el Admin Maestro.'
        : 'Vuelve al paso anterior. El historial de la migración conserva el motivo.';

  return (
    <FormDialog
      open={Boolean(transition)}
      title={`${cutoverStepLabel(transition?.integration.cutover_state_billing)} → ${cutoverStepLabel(to)}`}
      description={description}
      submitLabel="Cambiar etapa"
      busy={setState.isPending}
      error={setState.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextAreaField
        label="Motivo"
        required
        hint="Queda en el historial de la migración, que no se puede editar ni borrar."
        error={form.formState.errors.reason}
        {...form.register('reason')}
      />
    </FormDialog>
  );
}
