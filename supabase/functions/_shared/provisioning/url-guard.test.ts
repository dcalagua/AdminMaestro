import { describe, it, expect } from 'vitest';
import {
  assertSafeRedirect,
  buildProvisioningUrl,
  isBlockedHost,
  parseBaseUrl,
} from './url-guard';
import { ProvisioningError } from './types';

/*
 * V4 · Endurecimiento SSRF.
 *
 * `base_url` se configura desde la consola. Sin estas comprobaciones, quien
 * pudiera editar un deployment convertiría al orquestador en un proxy que llama
 * a cualquier URL desde dentro de la red del servidor — empezando por el
 * endpoint de metadatos del cloud, que devuelve credenciales de la instancia.
 */

const PRD = { environment: 'PRD' } as const;
const QAS = { environment: 'QAS' } as const;
const DEV = { environment: 'DEV' } as const;

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof ProvisioningError ? error.code : 'NOT_A_PROVISIONING_ERROR';
  }
  return 'NO_THROW';
}

describe('isBlockedHost', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'app.localhost',
    '127.0.0.1',
    '127.1.2.3',
    '0.0.0.0',
    '::1',
    // El endpoint de metadatos: en AWS, Azure y GCP devuelve credenciales.
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.azure.com',
    'instance-data',
    '10.0.0.5',
    '192.168.1.1',
    '172.16.0.1',
    '172.31.255.254',
    '100.64.0.1',
    'db.internal',
    'printer.local',
    'router.home.arpa',
  ])('bloquea %s', (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it.each(['ewm.ebim.pe', 'api.example.com', '8.8.8.8', '172.32.0.1', '11.0.0.1'])(
    'permite %s',
    (host) => {
      expect(isBlockedHost(host)).toBe(false);
    },
  );

  it('172.15 y 172.32 quedan fuera del rango privado: el bloqueo es 172.16-172.31', () => {
    expect(isBlockedHost('172.15.0.1')).toBe(false);
    expect(isBlockedHost('172.16.0.1')).toBe(true);
    expect(isBlockedHost('172.31.0.1')).toBe(true);
    expect(isBlockedHost('172.32.0.1')).toBe(false);
  });
});

describe('parseBaseUrl · esquemas', () => {
  it.each(['file:///etc/passwd', 'ftp://host/x', 'gopher://host', 'data:text/plain,hola'])(
    'rechaza %s',
    (url) => {
      expect(codeOf(() => parseBaseUrl(url, PRD))).toBe('BASE_URL_INSECURE');
    },
  );

  it('rechaza http en PRD y en QAS: un token M2M en claro es un token regalado', () => {
    expect(codeOf(() => parseBaseUrl('http://api.example.com', PRD))).toBe('BASE_URL_INSECURE');
    expect(codeOf(() => parseBaseUrl('http://api.example.com', QAS))).toBe('BASE_URL_INSECURE');
  });

  it('admite http en DEV, que es donde corre el stack local', () => {
    expect(parseBaseUrl('http://127.0.0.1:54321', DEV).hostname).toBe('127.0.0.1');
  });

  it('acepta https con host público en PRD', () => {
    expect(parseBaseUrl('https://api.example.com', PRD).hostname).toBe('api.example.com');
  });
});

describe('parseBaseUrl · formas peligrosas', () => {
  it('rechaza credenciales embebidas', () => {
    expect(codeOf(() => parseBaseUrl('https://user:pass@api.example.com', PRD))).toBe(
      'BASE_URL_INSECURE',
    );
  });

  it('rechaza query y fragmento: una base_url es una BASE', () => {
    expect(codeOf(() => parseBaseUrl('https://api.example.com?x=1', PRD))).toBe(
      'BASE_URL_INSECURE',
    );
    expect(codeOf(() => parseBaseUrl('https://api.example.com#x', PRD))).toBe(
      'BASE_URL_INSECURE',
    );
  });

  it('rechaza espacios y saltos de línea (inyección de cabecera)', () => {
    expect(codeOf(() => parseBaseUrl('https://api.example.com\nHost: evil', PRD))).toBe(
      'BASE_URL_INSECURE',
    );
  });

  it('rechaza la cadena vacía', () => {
    expect(codeOf(() => parseBaseUrl('   ', PRD))).toBe('BASE_URL_MISSING');
  });

  it('bloquea el endpoint de metadatos incluso escrito con puerto', () => {
    expect(codeOf(() => parseBaseUrl('https://169.254.169.254:443', PRD))).toBe(
      'BASE_URL_INSECURE',
    );
  });

  it('el parser deshace el truco de la barra invertida: el host real es evil.com, no good.com', () => {
    // Un filtro por expresión regular que buscara «lo que hay después de @»
    // concluiría que el host es good.com. El parser nativo —que es el que manda
    // en el fetch— resuelve evil.com y deja `@good.com` como ruta. Validar con
    // el mismo parser que ejecuta la llamada es justamente el punto.
    expect(parseBaseUrl('https://evil.com\\@good.com', PRD).hostname).toBe('evil.com');
    expect(
      codeOf(() =>
        parseBaseUrl('https://evil.com\\@good.com', {
          environment: 'PRD',
          allowedHosts: ['good.com'],
        }),
      ),
    ).toBe('BASE_URL_NOT_ALLOWED');
  });
});

describe('parseBaseUrl · allowlist de la integración', () => {
  it('rechaza un host fuera de la allowlist', () => {
    expect(
      codeOf(() =>
        parseBaseUrl('https://otro.example.com', {
          environment: 'PRD',
          allowedHosts: ['api.example.com'],
        }),
      ),
    ).toBe('BASE_URL_NOT_ALLOWED');
  });

  it('acepta un host de la allowlist, sin distinguir mayúsculas', () => {
    expect(
      parseBaseUrl('https://API.example.com', {
        environment: 'PRD',
        allowedHosts: ['api.example.com'],
      }).hostname,
    ).toBe('api.example.com');
  });

  it('allowlist vacía = sólo se aplica el resto de reglas', () => {
    expect(parseBaseUrl('https://api.example.com', { environment: 'PRD', allowedHosts: [] })).toBeInstanceOf(URL);
  });
});

describe('buildProvisioningUrl · contención bajo la base', () => {
  it('compone la ruta del contrato', () => {
    const url = buildProvisioningUrl(
      'https://api.example.com',
      '/internal/platform/v1/tenants',
      {},
      PRD,
    );
    expect(url.toString()).toBe('https://api.example.com/internal/platform/v1/tenants');
  });

  it('respeta un prefijo de ruta en la base', () => {
    const url = buildProvisioningUrl('https://api.example.com/ewm', '/v1/tenants', {}, PRD);
    expect(url.toString()).toBe('https://api.example.com/ewm/v1/tenants');
  });

  it('sustituye marcadores codificando cada segmento', () => {
    const url = buildProvisioningUrl(
      'https://api.example.com',
      '/v1/tenants/{externalTenantId}',
      { externalTenantId: 'abc/../../admin' },
      PRD,
    );
    // El `/` del identificador se codifica: no puede inyectar segmentos.
    expect(url.pathname).toBe('/v1/tenants/abc%2F..%2F..%2Fadmin');
  });

  it.each([
    ['/v1/../../etc', 'escape con ..'],
    ['//evil.com/v1', 'host relativo al protocolo'],
    ['/v1?admin=1', 'query'],
    ['/v1#x', 'fragmento'],
    ['/v1@evil.com', 'userinfo'],
    ['v1/tenants', 'ruta no absoluta'],
    ['', 'ruta vacía'],
  ])('rechaza la plantilla %s (%s)', (template) => {
    expect(codeOf(() => buildProvisioningUrl('https://api.example.com', template, {}, PRD))).toBe(
      'PATH_TEMPLATE_INVALID',
    );
  });

  it('exige que todos los marcadores se resuelvan', () => {
    expect(
      codeOf(() =>
        buildProvisioningUrl('https://api.example.com', '/v1/t/{externalTenantId}', {}, PRD),
      ),
    ).toBe('PATH_TEMPLATE_INVALID');
  });

  it('un parámetro vacío no vale como sustitución', () => {
    expect(
      codeOf(() =>
        buildProvisioningUrl(
          'https://api.example.com',
          '/v1/t/{externalTenantId}',
          { externalTenantId: '   ' },
          PRD,
        ),
      ),
    ).toBe('PATH_TEMPLATE_INVALID');
  });

  it('valida la base antes que la ruta: una base insegura no llega a componerse', () => {
    expect(codeOf(() => buildProvisioningUrl('http://169.254.169.254', '/v1/t', {}, PRD))).toBe(
      'BASE_URL_INSECURE',
    );
  });
});

describe('assertSafeRedirect', () => {
  const from = new URL('https://api.example.com/v1/tenants');

  it('permite una redirección dentro del mismo origen', () => {
    expect(assertSafeRedirect('/v1/tenants/42', from, PRD).toString()).toBe(
      'https://api.example.com/v1/tenants/42',
    );
  });

  it('bloquea la redirección hacia el endpoint de metadatos', () => {
    expect(
      codeOf(() => assertSafeRedirect('http://169.254.169.254/latest/meta-data/', from, PRD)),
    ).toBe('REDIRECT_BLOCKED');
  });

  it('bloquea cualquier cambio de origen, aunque sea a un host público', () => {
    expect(codeOf(() => assertSafeRedirect('https://otro.example.com/x', from, PRD))).toBe(
      'REDIRECT_BLOCKED',
    );
  });

  it('bloquea el salto de https a http del mismo host: el puerto cambia el origen', () => {
    expect(codeOf(() => assertSafeRedirect('http://api.example.com/x', from, PRD))).toBe(
      'REDIRECT_BLOCKED',
    );
  });

  it('bloquea una redirección relativa al protocolo hacia los metadatos', () => {
    // `//169.254.169.254/` hereda el esquema y cambia de host: es la forma más
    // discreta de sacar la llamada del origen validado.
    expect(codeOf(() => assertSafeRedirect('//169.254.169.254/latest/', from, PRD))).toBe(
      'REDIRECT_BLOCKED',
    );
  });

  it('una redirección dentro del origen sigue revalidando el origen', () => {
    // El mismo destino, pero con el origen bloqueado por ambiente: aunque el
    // salto no cambie de host, se vuelve a pasar por parseBaseUrl.
    const local = new URL('http://127.0.0.1:54321/v1/tenants');
    expect(assertSafeRedirect('/v1/tenants/7', local, DEV).pathname).toBe('/v1/tenants/7');
    expect(codeOf(() => assertSafeRedirect('/v1/tenants/7', local, PRD))).toBe(
      'BASE_URL_INSECURE',
    );
  });
});
