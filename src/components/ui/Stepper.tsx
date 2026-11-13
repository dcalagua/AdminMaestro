/**
 * V6 · T6 · Avance por etapas en poco espacio (`CompactStepper`).
 *
 * Una barra segmentada (un segmento de 6 px por etapa) y, debajo, SOLO el
 * nombre de la etapa actual. La lista completa va en el `title` (tooltip) y en
 * una lista `sr-only` con «(completado)» / «(actual)». Así nunca hay etiquetas
 * encimadas, aunque sean 5 etapas en una celda de 140 px.
 *
 * El estado se lee sin color: hechas = relleno de marca, actual = marca
 * profunda, siguientes = hairline; el nombre de la actual va escrito.
 * Los asistentes con pocos pasos y espacio de sobra (Nueva venta) conservan su
 * stepper grande: este es para tablas, tarjetas y fichas.
 *
 * @example
 * <CompactStepper
 *   label="Migración de cobro"
 *   steps={[{ id: 'A', label: 'Cobra la app' }, { id: 'B', label: 'En comparación' }]}
 *   current="A"
 * />
 */
export interface StepDefinition {
  id: string;
  /** Nombre de negocio de la etapa. */
  label: string;
}

export function CompactStepper({
  steps,
  current,
  label,
  heading,
  showPosition = false,
  unknownLabel,
  className = '',
}: {
  steps: readonly StepDefinition[];
  /** Id de la etapa actual. Uno desconocido no marca ninguna (se dice con `unknownLabel`). */
  current: string | null | undefined;
  /** Nombre accesible del recorrido («Migración de cobro»). */
  label: string;
  /** Título visible encima de la barra (p. ej. el eje en una ficha). En tablas, la cabecera ya lo dice. */
  heading?: string;
  /** Muestra «2 de 5» junto al nombre de la etapa (por defecto solo en el tooltip y el lector). */
  showPosition?: boolean;
  /** Texto cuando `current` no es ninguna etapa (por defecto, el valor tal cual o «Sin etapa»). */
  unknownLabel?: string;
  className?: string;
}) {
  const index = steps.findIndex((s) => s.id === current);
  const active = index >= 0 ? steps[index]! : null;
  const name = active?.label ?? unknownLabel ?? (current || 'Sin etapa');
  const position = active ? `${index + 1} de ${steps.length}` : null;
  const tooltip = steps
    .map((s, i) => `${i + 1}. ${s.label}${i < index ? ' ✓' : i === index ? ' ← actual' : ''}`)
    .join('\n');

  return (
    <div className={`min-w-0 ${className}`} title={tooltip} data-stepper={current ?? ''}>
      {heading ? <p className="mb-1 text-caption font-semibold text-fg-2">{heading}</p> : null}
      <div className="flex gap-0.5" aria-hidden data-stepper-bar>
        {steps.map((s, i) => (
          <span
            key={s.id}
            className={`h-1.5 min-w-[10px] flex-1 rounded-full ${
              index < 0 ? 'bg-border' : i < index ? 'bg-accent' : i === index ? 'bg-accent-deep' : 'bg-border'
            }`}
          />
        ))}
      </div>
      <p className="mt-1 flex min-w-0 items-baseline gap-1.5 text-caption">
        <span className={`truncate font-semibold ${active ? 'text-fg' : 'text-muted'}`}>{name}</span>
        {showPosition && position ? <span className="shrink-0 text-muted">{position}</span> : null}
      </p>
      <ol aria-label={`${label}: ${name}${position ? ` (${position})` : ''}`} className="sr-only">
        {steps.map((s, i) => (
          <li key={s.id} aria-current={i === index ? 'step' : undefined} data-step={s.id}>
            {s.label}
            {i < index ? ' (completado)' : i === index ? ' (actual)' : ''}
          </li>
        ))}
      </ol>
    </div>
  );
}
