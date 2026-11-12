/**
 * Contrato de presentación de datos — spec §9.2 (AC11).
 *
 * Cada bloque de la consola distingue explícitamente:
 *   cargando · completo (incluido el CERO real) · vacío · parcial · error ·
 *   sin acceso · no disponible por falta de fuente.
 *
 * La regla que protege al lector: un error NUNCA se convierte en `[]` y luego en
 * «0». Un cero es un dato observado; la ausencia de dato se dice como tal.
 */
export type DataState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T; observedAt?: string }
  | { status: 'empty'; observedAt?: string }
  | { status: 'partial'; data: T; reasons: string[] }
  | { status: 'error'; message: string }
  | { status: 'forbidden' }
  | { status: 'unavailable'; reason: string };

/** Subconjunto de `UseQueryResult` que necesita el adaptador (probable sin React). */
export interface QueryLike<T> {
  data?: T;
  error?: unknown;
  isLoading?: boolean;
  isPending?: boolean;
  dataUpdatedAt?: number;
}

/** Códigos de PostgREST/Postgres que significan «no te corresponde», no «falló». */
const FORBIDDEN_HINTS = ['permission denied', '42501', 'PGRST301', 'JWT', 'not authorized'];
/** Objeto inexistente en el backend (entorno sin la migración nueva). */
const MISSING_HINTS = ['PGRST202', 'PGRST205', 'Could not find the function', 'does not exist', '42883', '42P01'];

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return 'Ocurrió un error inesperado.';
}

/**
 * Adapta una consulta a `DataState`.
 *
 * `isEmpty` decide qué significa «sin actividad» para ese dato. Por defecto un
 * array vacío es vacío; un objeto o un número (aunque sea 0) es un dato.
 */
export function fromQuery<T>(
  query: QueryLike<T>,
  options: { isEmpty?: (data: T) => boolean; enabled?: boolean } = {},
): DataState<T> {
  if (options.enabled === false) return { status: 'unavailable', reason: 'No aplica a este contexto' };
  if (query.error) {
    const message = errorMessage(query.error);
    if (FORBIDDEN_HINTS.some((h) => message.includes(h))) return { status: 'forbidden' };
    if (MISSING_HINTS.some((h) => message.includes(h))) {
      return {
        status: 'unavailable',
        reason: 'Este entorno todavía no tiene la lectura agregada necesaria (migración pendiente).',
      };
    }
    return { status: 'error', message };
  }
  if (query.data === undefined) return { status: 'loading' };
  const observedAt = query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : undefined;
  const isEmpty = options.isEmpty ?? defaultIsEmpty;
  if (isEmpty(query.data)) return { status: 'empty', observedAt };
  return { status: 'ready', data: query.data, observedAt };
}

function defaultIsEmpty(data: unknown): boolean {
  if (Array.isArray(data)) return data.length === 0;
  return data === null;
}

/** ¿Hay un valor presentable (completo o parcial)? */
export function hasData<T>(state: DataState<T>): state is Extract<DataState<T>, { data: T }> {
  return state.status === 'ready' || state.status === 'partial';
}

/**
 * Combina varias fuentes que componen UNA cifra (p. ej. margen = cobrado −
 * costo − comisión). Si una fuente falla, el resultado NO es «completo»: es
 * error (si no hay nada) o parcial con el motivo. Nunca se rellena con cero.
 */
export function combineStates<T extends Record<string, unknown>>(
  parts: { [K in keyof T]: DataState<T[K]> },
  labels: { [K in keyof T]: string },
): DataState<Partial<T>> {
  const entries = Object.entries(parts) as Array<[keyof T, DataState<T[keyof T]>]>;
  if (entries.some(([, s]) => s.status === 'loading')) return { status: 'loading' };
  if (entries.every(([, s]) => s.status === 'forbidden')) return { status: 'forbidden' };

  const data: Partial<T> = {};
  const reasons: string[] = [];
  for (const [key, s] of entries) {
    if (s.status === 'ready' || s.status === 'partial') data[key] = s.data;
    if (s.status === 'partial') reasons.push(...s.reasons);
    if (s.status === 'error') reasons.push(`${labels[key]}: no se pudo leer (${s.message})`);
    if (s.status === 'forbidden') reasons.push(`${labels[key]}: sin acceso`);
    if (s.status === 'unavailable') reasons.push(`${labels[key]}: ${s.reason}`);
  }
  const present = Object.keys(data).length;
  if (reasons.length === 0) {
    if (entries.every(([, s]) => s.status === 'empty')) return { status: 'empty' };
    return { status: 'ready', data };
  }
  if (present === 0) {
    const firstError = entries.find(([, s]) => s.status === 'error');
    return firstError
      ? { status: 'error', message: reasons.join(' · ') }
      : { status: 'unavailable', reason: reasons.join(' · ') };
  }
  return { status: 'partial', data, reasons };
}
