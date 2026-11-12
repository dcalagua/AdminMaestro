/** Iniciales para avatares (listados de clientes, fichas 360, usuarios). */

const LEGAL_SUFFIX = /^(s\.?a\.?c?\.?|s\.?r\.?l\.?|e\.?i\.?r\.?l\.?|ltda\.?|inc\.?|by)$/i;

/**
 * «Transportes Qhapaq Cargo» → TQ; «GRUPASA» → GR; «ana.perez@x.com» → AP;
 * «Dennis Calagua (Operador)» → DC (`mode="person"`: primera y última palabra).
 */
export function initialsOf(name: string, mode: 'org' | 'person' = 'org'): string {
  const base = (name.includes('@') ? name.split('@')[0]!.replace(/[._-]+/g, ' ') : name).replace(/\([^)]*\)/g, ' ');
  const parts = (base.match(/\p{L}[\p{L}\p{N}.]*/gu) ?? []).filter((p) => !LEGAL_SUFFIX.test(p));
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.replace(/\./g, '').slice(0, 2).toUpperCase();
  const second = mode === 'person' ? parts[parts.length - 1]! : parts[1]!;
  return `${parts[0]![0]}${second[0]}`.toUpperCase();
}
