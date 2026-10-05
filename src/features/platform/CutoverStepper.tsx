import { CheckIcon } from '@phosphor-icons/react';
import { BILLING_AXIS_ORDER } from '@/features/usage/usageLabels';
import { AXIS_LABEL, ENTITLEMENT_AXIS_ORDER, cutoverStepLabel } from './cutover';

/**
 * Recorrido de cutover de una integración como «stepper» (fase 12, §8 PT-CARDS).
 *
 * Solo presenta el estado que la base guarda en `product_integrations`
 * (`cutover_state_entitlements` / `cutover_state_billing`); moverlo sigue siendo
 * `set_commercial_cutover_state` con motivo, en Billing shadow. Pasos hechos en
 * relleno de marca, el actual con anillo y texto en negrita, los siguientes en
 * contorno: el estado se lee también sin color (check, negrita, `aria-current`).
 */

export function CutoverStepper({
  axis,
  state,
}: {
  axis: keyof typeof AXIS_LABEL;
  state: string | null | undefined;
}) {
  const order: readonly string[] = axis === 'entitlements' ? ENTITLEMENT_AXIS_ORDER : BILLING_AXIS_ORDER;
  const current = order.indexOf(state ?? '');
  return (
    <div className="min-w-0" data-cutover-axis={axis} data-cutover-state={state ?? ''}>
      <p className="mb-1.5 flex items-baseline justify-between gap-2 text-caption">
        <span className="font-semibold text-fg-2">{AXIS_LABEL[axis]}</span>
        <span className="truncate font-semibold text-accent-deep">{cutoverStepLabel(state)}</span>
      </p>
      <ol
        aria-label={`Cutover de ${AXIS_LABEL[axis].toLowerCase()}: ${cutoverStepLabel(state)}`}
        className="flex items-center"
      >
        {order.map((step, i) => {
          const done = current >= 0 && i < current;
          const active = i === current;
          return (
            <li
              key={step}
              aria-current={active ? 'step' : undefined}
              className={`flex items-center ${i === order.length - 1 ? '' : 'flex-1'}`}
              title={cutoverStepLabel(step)}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                  done
                    ? 'bg-accent text-accent-fg'
                    : active
                      ? 'border-2 border-accent-deep bg-card'
                      : 'border border-border-strong bg-card'
                }`}
              >
                {done ? <CheckIcon size={10} weight="bold" aria-hidden /> : null}
                {active ? <span className="h-1.5 w-1.5 rounded-full bg-accent-deep" aria-hidden /> : null}
                <span className="sr-only">
                  {cutoverStepLabel(step)}
                  {done ? ' (completado)' : active ? ' (actual)' : ''}
                </span>
              </span>
              {i < order.length - 1 ? (
                <span className={`mx-1 h-0.5 flex-1 rounded-full ${done ? 'bg-accent' : 'bg-border'}`} aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
