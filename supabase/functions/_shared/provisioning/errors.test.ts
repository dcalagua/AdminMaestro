import { describe, it, expect } from 'vitest';
import {
  codeForHttpStatus,
  normalizeProviderCode,
  normalizeProviderFailure,
  normalizeThrownFailure,
  sanitizeProviderMessage,
} from './errors';
import { ProvisioningError } from './types';

/*
 * V4 · Normalización de errores.
 *
 * Dos exigencias opuestas: la consola tiene que poder decir algo accionable, y
 * nada interno del SaaS puede salir por ahí. Lo que se prueba aquí es que se
 * cumplen las dos a la vez.
 */

describe('sanitizeProviderMessage', () => {
  it('redacta un JWT completo', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJtYXN0ZXIifQ.c2lnbmF0dXJlX2FxdWk';
    expect(sanitizeProviderMessage(`token inválido: ${jwt}`)).toBe('token inválido: [token]');
  });

  it('redacta una cabecera Authorization', () => {
    expect(sanitizeProviderMessage('fallo con Bearer abc.def-ghi=')).toContain('[authorization]');
    expect(sanitizeProviderMessage('Authorization: Bearer xyz')).not.toContain('xyz');
  });

  it('redacta una clave PEM', () => {
    // secrets-scan:allow encabezado PEM sintético; el test comprueba que se REDACTA
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----';
    expect(sanitizeProviderMessage(`config: ${pem}`)).toBe('config: [key]');
  });

  it('redacta una cadena de conexión con contraseña', () => {
    // secrets-scan:allow cadena inventada; el test comprueba que se REDACTA
    expect(sanitizeProviderMessage('postgres://user:p4ss@db.interno:5432/ewm')).toBe(
      '[connection]',
    );
  });

  it('corta la traza de pila remota', () => {
    const message = 'NullPointerException\n    at com.ebim.ewm.Tenant.create(Tenant.java:42)';
    expect(sanitizeProviderMessage(message)).toBe('NullPointerException');
  });

  it('oculta rutas de código del servidor remoto', () => {
    expect(sanitizeProviderMessage('fallo en /opt/app/src/main/Tenant.java')).toContain('[source]');
  });

  it('trunca un volcado enorme', () => {
    const out = sanitizeProviderMessage('x'.repeat(5000));
    expect(out.length).toBeLessThanOrEqual(401);
    expect(out.endsWith('…')).toBe(true);
  });

  it('colapsa caracteres de control y espacios repetidos', () => {
    // Escapes explícitos y no bytes literales: un NUL crudo en el fuente
    // sobrevive mal a copias, editores y diffs, y aquí es el dato que se prueba.
    expect(sanitizeProviderMessage('a\u0000\u0001b    c')).toBe('a b c');
  });

  it('un valor que no es texto se convierte en cadena vacía', () => {
    expect(sanitizeProviderMessage({ a: 1 })).toBe('');
    expect(sanitizeProviderMessage(null)).toBe('');
  });
});

describe('normalizeProviderCode', () => {
  it('acepta un código con forma de código', () => {
    expect(normalizeProviderCode('ADMIN_EMAIL_ALREADY_PROVISIONED', 'X')).toBe(
      'ADMIN_EMAIL_ALREADY_PROVISIONED',
    );
  });

  it('normaliza mayúsculas y separadores', () => {
    expect(normalizeProviderCode('admin-email-taken', 'X')).toBe('ADMIN_EMAIL_TAKEN');
  });

  it('descarta texto libre: un párrafo no es un código', () => {
    expect(normalizeProviderCode('el correo ya existe en el sistema', 'FALLBACK')).toBe('FALLBACK');
  });

  it('descarta valores que no son texto', () => {
    expect(normalizeProviderCode(500, 'FALLBACK')).toBe('FALLBACK');
    expect(normalizeProviderCode(undefined, 'FALLBACK')).toBe('FALLBACK');
  });
});

describe('codeForHttpStatus', () => {
  it.each([
    [400, 'PROVIDER_BAD_REQUEST'],
    [401, 'PROVIDER_UNAUTHORIZED'],
    [403, 'PROVIDER_FORBIDDEN'],
    [404, 'PROVIDER_NOT_FOUND'],
    [409, 'PROVIDER_CONFLICT'],
    [422, 'PROVIDER_UNPROCESSABLE'],
    [429, 'PROVIDER_RATE_LIMITED'],
    [503, 'PROVIDER_UNAVAILABLE'],
    [418, 'PROVIDER_ERROR_UNCLASSIFIED'],
  ])('%i → %s', (status, code) => {
    expect(codeForHttpStatus(status)).toBe(code);
  });
});

describe('normalizeProviderFailure', () => {
  it('conserva el código del producto: es lo que hace útil el mensaje', () => {
    const failure = normalizeProviderFailure({
      status: 409,
      body: { code: 'ADMIN_EMAIL_ALREADY_PROVISIONED', message: 'ese correo ya tiene tenant' },
      retryable: false,
    });
    expect(failure.code).toBe('ADMIN_EMAIL_ALREADY_PROVISIONED');
    expect(failure.message).toBe('ese correo ya tiene tenant');
    expect(failure.httpStatus).toBe(409);
    expect(failure.retryable).toBe(false);
  });

  it('cae al código del estado cuando el producto no manda uno utilizable', () => {
    expect(
      normalizeProviderFailure({ status: 503, body: { message: 'mantenimiento' }, retryable: true })
        .code,
    ).toBe('PROVIDER_UNAVAILABLE');
  });

  it('no guarda NADA del cuerpo crudo en el detalle', () => {
    const failure = normalizeProviderFailure({
      status: 500,
      body: {
        code: 'BOOM',
        message: 'fallo',
        internalTable: 'ewm.tenants',
        authorization: 'Bearer secreto',
      },
      retryable: true,
    });
    const serialized = JSON.stringify(failure);
    expect(serialized).not.toContain('ewm.tenants');
    expect(serialized).not.toContain('secreto');
    expect(failure.detail).toEqual({
      provider_http_status: 500,
      provider_error_code: 'BOOM',
      retryable: true,
    });
  });

  it('sanea también el mensaje del producto', () => {
    const failure = normalizeProviderFailure({
      status: 401,
      body: { message: 'token Bearer eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.firmaaqui rechazado' },
      retryable: false,
    });
    expect(failure.message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('un cuerpo vacío deja un mensaje que al menos dice el estado', () => {
    expect(normalizeProviderFailure({ status: 502, body: null, retryable: true }).message).toBe(
      'El producto respondió 502 sin un mensaje utilizable',
    );
  });
});

describe('normalizeThrownFailure', () => {
  it('conserva el código y el detalle de un ProvisioningError', () => {
    const failure = normalizeThrownFailure(
      new ProvisioningError('BASE_URL_INSECURE', 'host bloqueado', null, false, { hostname: 'x' }),
    );
    expect(failure).toEqual({
      code: 'BASE_URL_INSECURE',
      message: 'host bloqueado',
      httpStatus: null,
      retryable: false,
      detail: { hostname: 'x' },
    });
  });

  it('cualquier otra excepción se normaliza sin filtrar la pila', () => {
    const failure = normalizeThrownFailure(
      new Error('boom\n    at Object.<anonymous> (/srv/app/index.js:1:1)'),
    );
    expect(failure.code).toBe('ORCHESTRATOR_ERROR');
    expect(failure.message).toBe('boom');
  });

  it('acepta valores lanzados que no son Error', () => {
    expect(normalizeThrownFailure('algo').code).toBe('ORCHESTRATOR_ERROR');
  });
});
