/**
 * V6 · 3.1 · Índices de los puntos que un área no dibuja: un valor rodeado de
 * huecos (`null`, p. ej. meses sin tasa de cambio) no tiene con quién unirse y
 * Recharts no lo pinta, pero sí estira el eje Y (el eje llegaba a 32 K con la
 * serie visible en 3 K). Esos puntos se marcan como un punto suelto: el eje
 * queda explicado por lo que se ve.
 */
export function isolatedIndexes(values: ReadonlyArray<number | null | undefined>): Set<number> {
  const has = (i: number) => i >= 0 && i < values.length && values[i] != null && Number.isFinite(values[i] as number);
  const out = new Set<number>();
  values.forEach((_, i) => {
    if (has(i) && !has(i - 1) && !has(i + 1)) out.add(i);
  });
  return out;
}
