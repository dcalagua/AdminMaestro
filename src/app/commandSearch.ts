/**
 * Búsqueda de la paleta ⌘K (lógica pura, sin React).
 *
 * Coincidencia sin tildes ni mayúsculas y orden por calidad: primero lo que
 * EMPIEZA por el término en el campo principal, luego el inicio de cualquier
 * palabra, luego «contiene». Cada grupo muestra como máximo `PALETTE_GROUP_LIMIT`.
 * Qué filas existen lo decide RLS en la consulta; aquí solo se filtra lo leído.
 */

export const PALETTE_GROUP_LIMIT = 8;
/** Mínimo de caracteres para buscar organizaciones, tenants y contratos. */
export const PALETTE_MIN_TERM = 2;

export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** 0 = el campo principal empieza por el término · 1 = inicio de palabra · 2 = contiene · null = no coincide. */
export function matchRank(term: string, fields: ReadonlyArray<string | null | undefined>): number | null {
  const t = normalizeSearch(term);
  if (!t) return 2;
  let best: number | null = null;
  fields.forEach((field, index) => {
    if (!field) return;
    const f = normalizeSearch(field);
    const at = f.indexOf(t);
    if (at < 0) return;
    const rank = at === 0 && index === 0 ? 0 : at === 0 || /[\s\-_./·(]/.test(f[at - 1] ?? '') ? 1 : 2;
    if (best === null || rank < best) best = rank;
  });
  return best;
}

/** Filas que coinciden, mejor rango primero (estable), recortadas al límite. */
export function topMatches<T>(
  rows: ReadonlyArray<T>,
  term: string,
  fields: (row: T) => ReadonlyArray<string | null | undefined>,
  limit = PALETTE_GROUP_LIMIT,
): T[] {
  const ranked: Array<{ row: T; rank: number; index: number }> = [];
  rows.forEach((row, index) => {
    const rank = matchRank(term, fields(row));
    if (rank !== null) ranked.push({ row, rank, index });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.slice(0, limit).map((r) => r.row);
}
