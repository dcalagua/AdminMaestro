import { CompactStepper } from '@/components/ui/Stepper';
import { BILLING_AXIS_ORDER } from '@/features/usage/usageLabels';
import { AXIS_LABEL, ENTITLEMENT_AXIS_ORDER, cutoverStepLabel } from './cutover';

/**
 * Recorrido de cutover de una integración (fase 12, §8 PT-CARDS).
 *
 * Solo presenta el estado que la base guarda en `product_integrations`
 * (`cutover_state_entitlements` / `cutover_state_billing`); moverlo sigue siendo
 * `set_commercial_cutover_state` con motivo, en Configuración › Avanzado.
 *
 * V6 · T6: barra segmentada compacta con el nombre de la etapa actual (las 5
 * etiquetas en columnas se encimaban); la lista completa va al tooltip y al
 * lector de pantalla. `heading` muestra el eje encima (fichas); en una tabla, la
 * cabecera de la columna ya lo dice.
 */
export function CutoverStepper({
  axis,
  state,
  heading = true,
}: {
  axis: keyof typeof AXIS_LABEL;
  state: string | null | undefined;
  heading?: boolean;
}) {
  const order: readonly string[] = axis === 'entitlements' ? ENTITLEMENT_AXIS_ORDER : BILLING_AXIS_ORDER;
  return (
    <div className="min-w-0" data-cutover-axis={axis} data-cutover-state={state ?? ''}>
      <CompactStepper
        label={`Migración de ${AXIS_LABEL[axis].toLowerCase()}`}
        heading={heading ? AXIS_LABEL[axis] : undefined}
        steps={order.map((id) => ({ id, label: cutoverStepLabel(id) }))}
        current={state}
        unknownLabel={state ? 'Etapa fuera del recorrido' : 'Sin etapa'}
      />
    </div>
  );
}
