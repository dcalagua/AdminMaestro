import { describe, it, expect, vi } from 'vitest';
import {
  CORS_ALLOWED_HEADERS,
  DEFAULT_ALLOWED_ORIGINS,
  corsHeadersFor,
  parseAllowedOrigins,
  withCors,
} from './cors';

/*
 * CORS del orquestador.
 *
 * Lo que se prueba no es sólo que el navegador pueda llamar: es que el
 * preflight no se convierte en una puerta. CORS decide qué puede LEER el
 * navegador; la autenticación la sigue decidiendo el handler.
 */

const ALLOWED = parseAllowedOrigins(undefined);

/** Handler con la misma forma que el orquestador: sin bearer, 401. */
function authHandler() {
  return vi.fn(async (req: Request) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'METODO_NO_PERMITIDO' }), { status: 405 });
    }
    if (!(req.headers.get('authorization') ?? '').toLowerCase().startsWith('bearer ')) {
      return new Response(JSON.stringify({ error: 'NO_AUTENTICADO' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
}

function preflight(origin: string) {
  return new Request('https://x.supabase.co/functions/v1/provisioning-orchestrator', {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization, apikey, content-type, x-client-info, x-application-name',
    },
  });
}

describe('preflight OPTIONS', () => {
  it.each(DEFAULT_ALLOWED_ORIGINS)('se permite desde %s sin llamar al handler', async (origin) => {
    const handler = authHandler();
    const res = await withCors(handler, ALLOWED)(preflight(origin));

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    expect(res.headers.get('access-control-allow-methods')).toContain('OPTIONS');
    expect(handler).not.toHaveBeenCalled();
  });

  it('declara todas las cabeceras que manda la consola', () => {
    for (const h of [
      'authorization',
      'apikey',
      'content-type',
      'x-client-info',
      'x-application-name',
      'x-correlation-id',
      'idempotency-key',
    ]) {
      expect(CORS_ALLOWED_HEADERS.split(', ')).toContain(h);
    }
  });

  it('un origen fuera de la allowlist no recibe Allow-Origin', async () => {
    const res = await withCors(authHandler(), ALLOWED)(preflight('https://evil.example.com'));
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('nunca habilita credenciales por cookie', async () => {
    const res = await withCors(authHandler(), ALLOWED)(preflight('http://127.0.0.1:5199'));
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });
});

describe('los demás métodos conservan la autenticación', () => {
  it('POST sin bearer sigue siendo 401, ahora legible por la consola', async () => {
    const handler = authHandler();
    const res = await withCors(handler, ALLOWED)(
      new Request('https://x.supabase.co/f', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:5199', 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'NO_AUTENTICADO' });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5199');
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  it('GET llega al handler y conserva su rechazo', async () => {
    const handler = authHandler();
    const res = await withCors(handler, ALLOWED)(
      new Request('https://x.supabase.co/f', { method: 'GET', headers: { origin: 'http://localhost:5199' } }),
    );
    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(405);
  });

  it('POST con bearer llega intacto al handler', async () => {
    const handler = authHandler();
    const res = await withCors(handler, ALLOWED)(
      new Request('https://x.supabase.co/f', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:5199', authorization: 'Bearer t' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(200);
    expect(handler.mock.calls[0][0].headers.get('authorization')).toBe('Bearer t');
  });
});

describe('allowlist configurable', () => {
  it('añade orígenes declarados sin barra final y descarta el comodín', () => {
    const list = parseAllowedOrigins(' https://admin.ebim.pe/ , * ,');
    expect(list).toContain('https://admin.ebim.pe');
    expect(list).not.toContain('*');
    expect(list).toEqual(expect.arrayContaining([...DEFAULT_ALLOWED_ORIGINS]));
  });

  it('sin cabecera Origin no hay Allow-Origin', () => {
    expect(corsHeadersFor(null, ALLOWED)['access-control-allow-origin']).toBeUndefined();
  });
});
