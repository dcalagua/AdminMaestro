import { createContext, useContext } from 'react';

/** V6 · T2 · Variante de la `StatStrip` que contiene a un componente (ver `StatStrip.tsx`). */
export type StatStripVariant = 'band' | 'tiles';

export const StatStripContext = createContext<StatStripVariant | null>(null);

/**
 * Variante de la franja que contiene al componente (`null` fuera de una
 * franja). `KpiTile` y `NativeAmountTile` la usan para pintarse compactos
 * dentro de una banda.
 */
export function useStatStripVariant(): StatStripVariant | null {
  return useContext(StatStripContext);
}
