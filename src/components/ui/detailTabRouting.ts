/**
 * Resolución de la pestaña de una ficha (V5 · F3), lógica pura.
 *
 * Las fichas usan `?tab=` como los hubs. Antes usaban `#hash` y tenían otras
 * pestañas: los enlaces viejos (`#payment-portal`, `?tab=billing`…) se
 * redirigen a la pestaña nueva y el nombre viejo queda como `#ancla` para
 * llevar la vista a esa sección dentro de la pestaña.
 */
export type LegacyTabMap = Readonly<Record<string, string>>;

export type TabResolution =
  | { kind: 'show'; tab: string | null }
  | { kind: 'redirect'; tab: string; anchor: string | null };

export function resolveDetailTab(
  ids: readonly string[],
  legacy: LegacyTabMap,
  query: string | null,
  hash: string,
): TabResolution {
  const known = new Set(ids);
  const h = hash.replace(/^#/, '');
  if (query) {
    if (known.has(query)) return { kind: 'show', tab: query };
    const mapped = legacy[query];
    if (mapped && known.has(mapped)) return { kind: 'redirect', tab: mapped, anchor: h || query };
    return { kind: 'show', tab: null };
  }
  if (h) {
    if (known.has(h)) return { kind: 'redirect', tab: h, anchor: null };
    const mapped = legacy[h];
    if (mapped && known.has(mapped)) return { kind: 'redirect', tab: mapped, anchor: h };
  }
  return { kind: 'show', tab: null };
}
