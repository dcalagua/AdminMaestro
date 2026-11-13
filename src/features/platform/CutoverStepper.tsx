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
 * V5 · F7: nombre de cada paso visible y «Paso n de m» junto al estado actual.
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
  const position = current >= 0 ? `Paso ${current + 1} de ${order.length}` : 'Etapa fuera del recorrido';
  return (
    <div className="min-w-0" data-cutover-axis={axis} data-cutover-state={state ?? ''}>
      <p className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 text-caption">
        <span className="font-semibold text-fg-2">{AXIS_LABEL[axis]}</span>
        <span className="text-muted">
          <span className="font-semibold text-accent-deep">{cutoverStepLabel(state)}</span> · {position}
        </span>
      </p>
      {/* V5 · F7: cada paso lleva su nombre visible debajo del círculo (antes solo
          círculos con texto oculto); el estado sigue leyéndose sin color. */}
      <ol
        aria-label={`Migración de ${AXIS_LABEL[axis].toLowerCase()}: ${cutoverStepLabel(state)}`}
        className="grid"
        style={{ gridTemplateColumns: `repeat(${order.length}, minmax(0, 1fr))` }}
      >
        {order.map((step, i) => {
          const done = current >= 0 && i < current;
          const active = i === current;
          return (
            <li key={step} aria-current={active ? 'step' : undefined} className="flex min-w-0 flex-col items-center" data-step={step}>
              <span className="flex w-full items-center" aria-hidden>
                <span className={`h-0.5 flex-1 rounded-full ${i === 0 ? 'invisible' : done || active ? 'bg-accent' : 'bg-border'}`} />
                <span
                  className={`mx-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                    done
                      ? 'bg-accent text-accent-fg'
                      : active
                        ? 'border-2 border-accent-deep bg-card'
                        : 'border border-border-strong bg-card'
                  }`}
                >
                  {done ? <CheckIcon size={10} weight="bold" /> : null}
                  {active ? <span className="h-1.5 w-1.5 rounded-full bg-accent-deep" /> : null}
                </span>
                <span className={`h-0.5 flex-1 rounded-full ${i === order.length - 1 ? 'invisible' : done ? 'bg-accent' : 'bg-border'}`} />
              </span>
              <span
                className={`mt-1 max-w-full text-center text-caption leading-tight ${
                  active ? 'font-semibold text-fg' : done ? 'text-fg-2' : 'text-muted'
                }`}
              >
                {cutoverStepLabel(step)}
                <span className="sr-only">{done ? ' (completado)' : active ? ' (actual)' : ''}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
