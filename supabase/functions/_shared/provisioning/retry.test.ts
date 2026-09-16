import { describe, it, expect } from 'vitest';
import {
  backoffDelayMs,
  decideRetry,
  isRetryableNetworkFailure,
  isRetryableStatus,
  totalBackoffBudgetMs,
} from './retry';

/*
 * V4 · Política de reintentos.
 *
 * La regla que más importa es la negativa: un 409 significa que el tenant YA
 * EXISTE al otro lado. Reintentarlo no arregla nada y sí puede duplicar
 * trabajo humano; es justo el caso en el que alguien tiene que mirar.
 */

describe('clasificación por estado HTTP', () => {
  it.each([408, 425, 429, 500, 502, 503, 504, 599])('reintenta %i', (status) => {
    expect(isRetryableStatus(status)).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 410, 422])('NO reintenta %i', (status) => {
    expect(isRetryableStatus(status)).toBe(false);
  });

  it('un 2xx o 3xx no es un caso de reintento', () => {
    expect(isRetryableStatus(200)).toBe(false);
    expect(isRetryableStatus(302)).toBe(false);
  });

  it('un 4xx desconocido NO se reintenta: el cliente es el que está mal', () => {
    expect(isRetryableStatus(418)).toBe(false);
  });
});

describe('clasificación de fallos de red', () => {
  it('timeout y caída de red son transitorios', () => {
    expect(isRetryableNetworkFailure('TIMEOUT')).toBe(true);
    expect(isRetryableNetworkFailure('NETWORK')).toBe(true);
  });

  it('una cancelación deliberada no se reintenta: repetirla contradice la orden', () => {
    expect(isRetryableNetworkFailure('ABORT')).toBe(false);
  });
});

describe('backoff', () => {
  it('crece exponencialmente desde la base', () => {
    expect(backoffDelayMs(1)).toBe(250);
    expect(backoffDelayMs(2)).toBe(500);
    expect(backoffDelayMs(3)).toBe(1000);
  });

  it('está ACOTADO: una Edge Function tiene presupuesto de tiempo', () => {
    expect(backoffDelayMs(10)).toBe(2000);
    expect(backoffDelayMs(50)).toBe(2000);
  });

  it('respeta un techo configurado', () => {
    expect(backoffDelayMs(9, { baseMs: 100, maxDelayMs: 600 })).toBe(600);
  });

  it('acepta jitter determinista para las pruebas', () => {
    expect(backoffDelayMs(1, { jitter: (r) => r })).toBe(313);
  });

  it('el presupuesto total de tres reintentos cabe en menos de dos segundos', () => {
    expect(totalBackoffBudgetMs(3)).toBe(1750);
    expect(totalBackoffBudgetMs(3)).toBeLessThan(2000);
  });
});

describe('decideRetry', () => {
  it('reintenta un 503 y espera', () => {
    expect(decideRetry({ attempt: 1, maxAttempts: 3, status: 503 })).toEqual({
      retry: true,
      reason: 'RETRYABLE_HTTP_503',
      delayMs: 250,
    });
  });

  it.each([400, 401, 403, 409])('NO reintenta %i, y dice por qué', (status) => {
    expect(decideRetry({ attempt: 1, maxAttempts: 3, status })).toEqual({
      retry: false,
      reason: `NON_RETRYABLE_HTTP_${status}`,
      delayMs: 0,
    });
  });

  it('no reintenta cuando se agotaron los intentos, aunque el error sea transitorio', () => {
    expect(decideRetry({ attempt: 3, maxAttempts: 3, status: 503 })).toEqual({
      retry: false,
      reason: 'ATTEMPTS_EXHAUSTED',
      delayMs: 0,
    });
  });

  it('reintenta un timeout', () => {
    expect(decideRetry({ attempt: 1, maxAttempts: 3, networkFailure: 'TIMEOUT' })).toMatchObject({
      retry: true,
      reason: 'RETRYABLE_TIMEOUT',
    });
  });

  it('sin señal clasificable NO reintenta: repetir a ciegas duplica tenants', () => {
    expect(decideRetry({ attempt: 1, maxAttempts: 3 })).toEqual({
      retry: false,
      reason: 'UNCLASSIFIED',
      delayMs: 0,
    });
  });

  it('el fallo de red manda sobre el estado, si llegan los dos', () => {
    expect(
      decideRetry({ attempt: 1, maxAttempts: 3, status: 400, networkFailure: 'NETWORK' }),
    ).toMatchObject({ retry: true });
  });
});
