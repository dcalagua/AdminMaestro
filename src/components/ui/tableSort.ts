/** V6 · T4 · Orden de un `DataTable` (lo aplica la página; la tabla solo pinta la cabecera). */
export interface DataTableSort {
  key: string;
  dir: 'asc' | 'desc';
}

/** Siguiente orden al pulsar una cabecera: la misma alterna, otra empieza descendente. */
export function nextSort(current: DataTableSort | undefined, key: string): DataTableSort {
  if (current?.key === key) return { key, dir: current.dir === 'desc' ? 'asc' : 'desc' };
  return { key, dir: 'desc' };
}
