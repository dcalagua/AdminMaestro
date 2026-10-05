import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ env: { supabaseUrl: 'http://127.0.0.1:54421', supabaseAnonKey: 'anon-public' } }));

import { callPortal, readLinkToken } from './portalApi';

const TOKEN = 'a'.repeat(41) + '-_';

afterEach(() => vi.unstubAllGlobals());

describe('portalApi', () => {
  it('lee el token del fragmento y rechaza lo que no tiene su forma', () => {
    expect(readLinkToken(`#${TOKEN}`)).toBe(TOKEN);
    expect(readLinkToken('#abc')).toBeNull();
    expect(readLinkToken('')).toBeNull();
  });

  it('manda el token en el CUERPO, solo con la clave pública y sin credenciales del navegador', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ invoices: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await callPortal('statement', { token: TOKEN });
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:54421/functions/v1/pay-portal/statement');
    expect(url).not.toContain(TOKEN);
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN });
    expect(init.credentials).toBe('omit');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer anon-public');
  });

  it('devuelve el código y el mensaje del portal en los errores, y un mensaje genérico sin red', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'DEMASIADOS_INTENTOS', message: 'Espera una hora.' }), { status: 429 }),
      ),
    );
    expect(await callPortal('charge', { token: TOKEN })).toEqual({
      ok: false, status: 429, error: 'DEMASIADOS_INTENTOS', message: 'Espera una hora.',
    });

    // Cobro en curso sin mensaje en la respuesta: el mensaje de cliente sale del código.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'COBRO_EN_CURSO' }), { status: 409 })));
    expect(await callPortal('charge', { token: TOKEN })).toEqual({
      ok: false, status: 409, error: 'COBRO_EN_CURSO',
      message: 'Ya hay un pago en curso para esta factura. Espera un momento y recarga la página.',
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const offline = await callPortal('statement', { token: TOKEN });
    expect(offline.ok).toBe(false);
    if (!offline.ok) expect(offline.message).toMatch(/No pudimos conectar/);
  });
});
