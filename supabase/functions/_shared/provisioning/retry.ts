/**
 * Clasificación de reintentos.
 *
 * Reintentar lo que no se debe es peor que no reintentar nada:
 *
 *   400 — la petición está mal. Repetirla da el mismo 400 tres veces.
 *   401 — el token no vale. Repetirlo con el mismo token da lo mismo, y
 *         además dispara las alarmas de intrusión del producto.
 *   403 — MasterAdmin no tiene ese permiso. No cambia por insistir.
 *   409 — el tenant YA EXISTE al otro lado. Aquí el reintento es
 *         especialmente dañino: es exactamente el caso en el que el operador
 *         necesita mirar, no la máquina volver a empujar.
 *
 * Sí se reintenta lo que es transitorio POR NATURALEZA: un socket caído, un
 * timeout, un 502/503/504 de un balanceador, un 429 con el servicio saturado.
 *
 * Y siempre con la MISMA clave de idempotencia: el reintento tiene que ser
 * indistinguible del intento original para el SaaS.
 */

/** Estados HTTP reintentables. El resto, no. */
export const RETRYABLE_STATUSES = [408, 425, 429, 502, 503, 504] as const;

/** Estados explícitamente NO reintentables, aunque alguien lo pida. */
export const NON_RETRYABLE_STATUSES = [400, 401, 403, 404, 409, 410, 422] as const;

export function isRetryableStatus(status: number): boolean {
  if ((NON_RETRYABLE_STATUSES as readonly number[]).includes(status)) return false;
  if ((RETRYABLE_STATUSES as readonly number[]).includes(status)) return true;
  // Cualquier otro 5xx se considera transitorio; los 4xx no listados, no.
  return status >= 500 && status <= 599;
}

export type NetworkFailureKind = 'TIMEOUT' | 'NETWORK' | 'ABORT';

export function isRetryableNetworkFailure(kind: NetworkFailureKind): boolean {
  // ABORT es una cancelación deliberada: repetirla contradice la orden.
  return kind === 'TIMEOUT' || kind === 'NETWORK';
}

export interface BackoffOptions {
  /** Base en milisegundos. */
  baseMs?: number;
  /** Techo por espera. */
  maxDelayMs?: number;
  /** Determinista en pruebas; en producción añade dispersión. */
  jitter?: (range: number) => number;
}

/**
 * Backoff exponencial ACOTADO.
 *
 * El techo importa más que la curva: una Edge Function tiene un presupuesto de
 * tiempo, y esperar 30 segundos entre intentos la mata sin haber avanzado.
 * Con base 250 ms y techo 2 s, tres intentos caben de sobra.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 250;
  const max = options.maxDelayMs ?? 2000;
  const safeAttempt = Math.max(1, Math.min(attempt, 10));
  const exponential = Math.min(base * 2 ** (safeAttempt - 1), max);
  const jitter = options.jitter ? options.jitter(exponential * 0.25) : 0;
  return Math.min(Math.round(exponential + jitter), max);
}

/** Presupuesto total de espera, para no sobrepasar el tiempo de la función. */
export function totalBackoffBudgetMs(retries: number, options: BackoffOptions = {}): number {
  let total = 0;
  for (let i = 1; i <= retries; i += 1) total += backoffDelayMs(i, { ...options, jitter: undefined });
  return total;
}

export interface RetryDecision {
  retry: boolean;
  reason: string;
  delayMs: number;
}

/**
 * Decisión completa: ¿se reintenta, por qué, y cuánto se espera?
 *
 * Devuelve el motivo además del booleano para que el timeline diga «no se
 * reintenta: 409 significa que el tenant ya existe» en vez de quedarse mudo.
 */
export function decideRetry(params: {
  attempt: number;
  maxAttempts: number;
  status?: number | null;
  networkFailure?: NetworkFailureKind | null;
  backoff?: BackoffOptions;
}): RetryDecision {
  const { attempt, maxAttempts, status, networkFailure } = params;

  if (attempt >= maxAttempts) {
    return { retry: false, reason: 'ATTEMPTS_EXHAUSTED', delayMs: 0 };
  }

  if (networkFailure) {
    const retry = isRetryableNetworkFailure(networkFailure);
    return {
      retry,
      reason: retry ? `RETRYABLE_${networkFailure}` : `NON_RETRYABLE_${networkFailure}`,
      delayMs: retry ? backoffDelayMs(attempt, params.backoff) : 0,
    };
  }

  if (typeof status === 'number') {
    const retry = isRetryableStatus(status);
    return {
      retry,
      reason: retry ? `RETRYABLE_HTTP_${status}` : `NON_RETRYABLE_HTTP_${status}`,
      delayMs: retry ? backoffDelayMs(attempt, params.backoff) : 0,
    };
  }

  // Sin señal clasificable no se reintenta: repetir a ciegas una operación que
  // pudo haberse completado al otro lado es cómo se duplican tenants.
  return { retry: false, reason: 'UNCLASSIFIED', delayMs: 0 };
}
