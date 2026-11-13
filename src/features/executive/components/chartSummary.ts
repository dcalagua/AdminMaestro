/**
 * V5 · F7 · Descripción equivalente de un gráfico, en texto, para quien no lo ve
 * (lector de pantalla) mientras la tabla alternativa del `ChartPanel` está
 * oculta. Resume lo que se lee del dibujo: cuántos puntos, el rango, el máximo,
 * el mínimo y el último valor. Un punto sin dato (sin tasa) no cuenta como 0.
 */
export interface SummaryPoint {
  label: string;
  value: number | null | undefined;
}

export function summarizeSeries(
  name: string,
  points: readonly SummaryPoint[],
  format: (n: number) => string,
): string {
  const valid = points.filter((p): p is { label: string; value: number } => p.value != null && Number.isFinite(p.value));
  if (valid.length === 0) return `${name}: sin datos.`;
  if (valid.length === 1) return `${name}: ${valid[0]!.label}, ${format(valid[0]!.value)}.`;
  let max = valid[0]!;
  let min = valid[0]!;
  for (const p of valid) {
    if (p.value > max.value) max = p;
    if (p.value < min.value) min = p;
  }
  const first = points[0]!;
  const last = valid[valid.length - 1]!;
  const missing = points.length - valid.length;
  return [
    `${name}: ${points.length} puntos, de ${first.label} a ${points[points.length - 1]!.label}.`,
    `Máximo en ${max.label}, ${format(max.value)}.`,
    `Mínimo en ${min.label}, ${format(min.value)}.`,
    `Último: ${last.label}, ${format(last.value)}.`,
    missing > 0 ? `${missing} sin dato.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Cada cuántas etiquetas del eje X se dibuja una (`interval` de Recharts) para
 * que quepan: en móvil, como mucho `maxTicks` etiquetas (a 390 px, ~6 meses).
 */
export function axisInterval(count: number, compact: boolean, maxTicks = 6): number {
  if (!compact || count <= maxTicks) return 0;
  return Math.ceil(count / maxTicks) - 1;
}
