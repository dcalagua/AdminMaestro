import { describe, it, expect } from 'vitest';
import {
  ALLOWED_ALGORITHMS,
  MAX_TOKEN_TTL_SECONDS,
  buildM2mClaims,
  isAllowedAlgorithm,
  resolvePrivateKey,
  scopesFor,
  signM2mToken,
} from './m2m';
import { ProvisioningError } from './types';
import type { CredentialConfig, IntegrationConfig } from './types';

/*
 * V4 · Firma M2M.
 *
 * El token que MasterAdmin presenta a un SaaS es una credencial de verdad. Lo
 * que se comprueba aquí es que sea CORTA, ACOTADA en alcance, ASIMÉTRICA y que
 * identifique al sistema —no a la persona— como sujeto.
 */

const integration: IntegrationConfig = {
  id: 'i1',
  code: 'producto-provisioning-v1',
  type: 'HTTP_M2M',
  contract_version: 'v1',
  status: 'READY',
  enabled: true,
  issuer: 'masteradmin.ebim',
  audience: 'producto.ebim',
  subject: 'masteradmin-provisioning',
  algorithm: 'RS256',
  token_ttl_seconds: 300,
  create_scope: 'provisioning:tenant:create',
  read_scope: 'provisioning:tenant:read',
  additional_scopes: [],
  create_path_template: '/internal/platform/v1/tenants',
  status_path_template: '/internal/platform/v1/tenants/{externalTenantId}',
  health_path_template: '/internal/platform/v1/health',
  allowed_hosts: [],
};

const credential: CredentialConfig = {
  id: 'c1',
  code: 'producto-qas-m2m',
  type: 'M2M_ASYMMETRIC_JWT',
  enabled: true,
  algorithm: 'RS256',
  token_ttl_seconds: 300,
  secret_ref: 'PRODUCTO_QAS_M2M_PRIVATE_KEY',
  public_key_ref: 'PRODUCTO_QAS_M2M_PUBLIC_KEY',
};

const NOW = new Date('2026-09-15T12:00:00Z');

function claims(overrides: Partial<Parameters<typeof buildM2mClaims>[0]> = {}) {
  return buildM2mClaims({
    integration,
    credential,
    scopes: ['provisioning:tenant:create'],
    actorId: 'user-1',
    actorRole: 'TECH_LEAD',
    correlationId: 'corr-1',
    now: NOW,
    jti: 'jti-1',
    ...overrides,
  });
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof ProvisioningError ? error.code : 'NOT_A_PROVISIONING_ERROR';
  }
  return 'NO_THROW';
}

describe('algoritmos permitidos', () => {
  it('sólo admite asimétricos', () => {
    expect([...ALLOWED_ALGORITHMS]).toEqual(['RS256', 'ES256']);
  });

  it.each(['none', 'None', 'HS256', 'HS512', '', 'RS512'])('rechaza %s', (alg) => {
    expect(isAllowedAlgorithm(alg)).toBe(false);
  });

  it('HS256 queda fuera porque con secreto compartido quien verifica también emite', () => {
    expect(
      codeOf(() =>
        claims({ credential: { ...credential, algorithm: 'HS256' as never } }),
      ),
    ).toBe('ALGORITHM_NOT_ALLOWED');
  });

  it('`alg: none` no puede firmarse', async () => {
    await expect(
      signM2mToken(claims(), 'none' as never, 'x'),
    ).rejects.toMatchObject({ code: 'ALGORITHM_NOT_ALLOWED' });
  });
});

describe('claims', () => {
  it('emite iss, aud, sub, iat, exp, jti, scope y los claims de auditoría', () => {
    expect(claims()).toEqual({
      iss: 'masteradmin.ebim',
      aud: 'producto.ebim',
      sub: 'masteradmin-provisioning',
      iat: Math.floor(NOW.getTime() / 1000),
      exp: Math.floor(NOW.getTime() / 1000) + 300,
      jti: 'jti-1',
      scope: 'provisioning:tenant:create',
      actor_id: 'user-1',
      actor_role: 'TECH_LEAD',
      correlation_id: 'corr-1',
    });
  });

  it('el sujeto es el SISTEMA, no la persona: el humano viaja en actor_id', () => {
    const c = claims({ actorId: 'humano@ebim.pe' });
    expect(c.sub).toBe('masteradmin-provisioning');
    expect(c.actor_id).toBe('humano@ebim.pe');
  });

  it('el TTL configurado se respeta cuando está dentro del rango', () => {
    const c = claims({ credential: { ...credential, token_ttl_seconds: 120 } });
    expect(c.exp - c.iat).toBe(120);
  });

  it('el techo de 300 s se aplica aunque la configuración pida más', () => {
    const c = claims({
      credential: { ...credential, token_ttl_seconds: 86_400 },
      integration: { ...integration, token_ttl_seconds: 86_400 },
    });
    expect(c.exp - c.iat).toBe(MAX_TOKEN_TTL_SECONDS);
  });

  it('un TTL ridículamente corto se eleva al mínimo', () => {
    const c = claims({ credential: { ...credential, token_ttl_seconds: 1 } });
    expect(c.exp - c.iat).toBe(30);
  });

  it('el jti es único entre emisiones', () => {
    const a = buildM2mClaims({
      integration, credential, scopes: ['s'], actorId: null, actorRole: 'X',
      correlationId: 'c', now: NOW,
    });
    const b = buildM2mClaims({
      integration, credential, scopes: ['s'], actorId: null, actorRole: 'X',
      correlationId: 'c', now: NOW,
    });
    expect(a.jti).not.toBe(b.jti);
  });

  it('deduplica scopes y los une con espacios', () => {
    expect(claims({ scopes: ['a', 'b', 'a', '  ', 'c'] }).scope).toBe('a b c');
  });

  it('exige audience: cada producto tiene la suya y no se adivina', () => {
    expect(codeOf(() => claims({ integration: { ...integration, audience: null } }))).toBe(
      'AUDIENCE_NOT_CONFIGURED',
    );
  });

  it('exige issuer', () => {
    expect(codeOf(() => claims({ integration: { ...integration, issuer: '  ' } }))).toBe(
      'ISSUER_NOT_CONFIGURED',
    );
  });

  it('exige scope: un token sin scope es un token con todos', () => {
    expect(codeOf(() => claims({ scopes: [] }))).toBe('SCOPE_NOT_CONFIGURED');
    expect(codeOf(() => claims({ scopes: ['   '] }))).toBe('SCOPE_NOT_CONFIGURED');
  });

  it('exige TTL configurado', () => {
    expect(
      codeOf(() =>
        claims({
          credential: { ...credential, token_ttl_seconds: null },
          integration: { ...integration, token_ttl_seconds: null },
        }),
      ),
    ).toBe('TTL_NOT_CONFIGURED');
  });
});

describe('scopesFor', () => {
  it('usa create_scope para crear y read_scope para consultar', () => {
    expect(scopesFor(integration, 'create')).toEqual(['provisioning:tenant:create']);
    expect(scopesFor(integration, 'read')).toEqual(['provisioning:tenant:read']);
  });

  it('añade los scopes adicionales configurados', () => {
    expect(
      scopesFor({ ...integration, additional_scopes: ['provisioning:audit:write'] }, 'create'),
    ).toEqual(['provisioning:tenant:create', 'provisioning:audit:write']);
  });

  it('descarta vacíos y nulos', () => {
    expect(scopesFor({ ...integration, create_scope: null, additional_scopes: ['  '] }, 'create'))
      .toEqual([]);
  });
});

describe('resolvePrivateKey', () => {
  it('resuelve el valor por su NOMBRE', () => {
    expect(resolvePrivateKey(credential, (ref) =>
      ref === 'PRODUCTO_QAS_M2M_PRIVATE_KEY' ? 'valor' : undefined,
    )).toBe('valor');
  });

  it('falla si el perfil no declara referencia', () => {
    expect(codeOf(() => resolvePrivateKey({ ...credential, secret_ref: null }, () => 'x'))).toBe(
      'SECRET_REF_MISSING',
    );
  });

  it('falla si el secreto no está cargado, nombrando la REFERENCIA y no el valor', () => {
    try {
      resolvePrivateKey(credential, () => undefined);
      expect.unreachable();
    } catch (error) {
      const e = error as ProvisioningError;
      expect(e.code).toBe('SECRET_NOT_AVAILABLE');
      expect(e.message).toContain('PRODUCTO_QAS_M2M_PRIVATE_KEY');
      expect(e.detail).toEqual({ secret_ref: 'PRODUCTO_QAS_M2M_PRIVATE_KEY' });
    }
  });
});

// ---------------------------------------------------------------------------
// Firma real con WebCrypto. Las claves se generan en memoria en el propio test:
// no hay ni puede haber una clave privada en el repositorio.
// ---------------------------------------------------------------------------
async function generatePkcs8(algorithm: 'RS256' | 'ES256'): Promise<{
  pem: string;
  publicKey: CryptoKey;
}> {
  const params =
    algorithm === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: 'P-256' };

  const pair = (await crypto.subtle.generateKey(params as never, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;

  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  // secrets-scan:allow plantilla PEM de una clave GENERADA EN MEMORIA en este test
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64.replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----`;
  return { pem, publicKey: pair.publicKey };
}

function decodeSegment(segment: string): Record<string, unknown> {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))) as Record<string, unknown>;
}

describe('signM2mToken', () => {
  it('firma con RS256 y la clave pública correspondiente lo verifica', async () => {
    const { pem, publicKey } = await generatePkcs8('RS256');
    const token = await signM2mToken(claims(), 'RS256', pem);

    const [header, payload, signature] = token.split('.');
    expect(decodeSegment(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decodeSegment(payload).aud).toBe('producto.ebim');

    const sigBytes = Uint8Array.from(
      atob(signature.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0),
    );
    const valid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      sigBytes,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(valid).toBe(true);
  });

  it('firma con ES256', async () => {
    const { pem, publicKey } = await generatePkcs8('ES256');
    const token = await signM2mToken(claims(), 'ES256', pem);
    const [header, payload, signature] = token.split('.');
    expect(decodeSegment(header)).toEqual({ alg: 'ES256', typ: 'JWT' });

    const sigBytes = Uint8Array.from(
      atob(signature.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0),
    );
    expect(
      await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        sigBytes,
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).toBe(true);
  });

  it('una clave de otro algoritmo no sirve: falla con código estable', async () => {
    const { pem } = await generatePkcs8('ES256');
    await expect(signM2mToken(claims(), 'RS256', pem)).rejects.toMatchObject({
      code: 'PRIVATE_KEY_INVALID',
    });
  });

  it('una clave vacía o mal formada falla sin filtrar el mensaje del runtime', async () => {
    await expect(signM2mToken(claims(), 'RS256', '')).rejects.toMatchObject({
      code: 'PRIVATE_KEY_INVALID',
    });
    await expect(signM2mToken(claims(), 'RS256', 'no-es-una-clave')).rejects.toMatchObject({
      code: 'PRIVATE_KEY_INVALID',
    });
  });
});

// ---------------------------------------------------------------------------
// Formato EXACTO que acepta el firmante (plan EWM, Task 13.A)
// ---------------------------------------------------------------------------
// La clave EWM QAS existe en SEC1 (`BEGIN EC PRIVATE KEY`) y se carga como
// secret convertida a PKCS#8 en UNA línea. Estas pruebas fijan que ese formato
// firma, sin tocar `m2m.ts`, y que SEC1 falla cerrado sin filtrar la clave.
describe('formato de clave ES256 aceptado', () => {
  async function p256(): Promise<{ pair: CryptoKeyPair; pkcs8B64: string; jwk: JsonWebKey }> {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    return { pair, pkcs8B64: btoa(String.fromCharCode(...pkcs8)), jwk };
  }

  async function verifies(token: string, publicKey: CryptoKey): Promise<boolean> {
    const [h, p, s] = token.split('.');
    const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      sig,
      new TextEncoder().encode(`${h}.${p}`),
    );
  }

  const fromB64Url = (v: string) =>
    Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

  it('acepta PKCS#8 PEM en una sola línea', async () => {
    const { pair, pkcs8B64 } = await p256();
    // secrets-scan:allow plantilla PEM de una clave GENERADA EN MEMORIA en este test
    const pem = `-----BEGIN PRIVATE KEY-----${pkcs8B64}-----END PRIVATE KEY-----`;
    expect(pem).not.toContain('\n');
    const token = await signM2mToken(claims(), 'ES256', pem);
    expect(await verifies(token, pair.publicKey)).toBe(true);
  });

  it('acepta PKCS#8 PEM multilínea', async () => {
    const { pair, pkcs8B64 } = await p256();
    // secrets-scan:allow plantilla PEM de una clave GENERADA EN MEMORIA en este test
    const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8B64.replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
    const token = await signM2mToken(claims(), 'ES256', pem);
    expect(await verifies(token, pair.publicKey)).toBe(true);
  });

  it('rechaza SEC1 con PRIVATE_KEY_INVALID sin filtrar material de clave', async () => {
    const { jwk } = await p256();
    const d = fromB64Url(jwk.d!);
    const x = fromB64Url(jwk.x!);
    const y = fromB64Url(jwk.y!);
    // ECPrivateKey (RFC 5915): SEQUENCE { 1, OCTET STRING d, [0] prime256v1, [1] BIT STRING 04||x||y }
    const sec1 = new Uint8Array([
      0x30, 0x77, 0x02, 0x01, 0x01, 0x04, 0x20, ...d,
      0xa0, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
      0xa1, 0x44, 0x03, 0x42, 0x00, 0x04, ...x, ...y,
    ]);
    const b64 = btoa(String.fromCharCode(...sec1));
    // secrets-scan:allow plantilla PEM de una clave GENERADA EN MEMORIA en este test
    const pem = `-----BEGIN EC PRIVATE KEY-----\n${b64}\n-----END EC PRIVATE KEY-----`;

    let caught: unknown;
    try {
      await signM2mToken(claims(), 'ES256', pem);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProvisioningError);
    expect((caught as ProvisioningError).code).toBe('PRIVATE_KEY_INVALID');
    const message = (caught as ProvisioningError).message;
    for (let i = 0; i + 16 <= b64.length; i += 16) {
      expect(message).not.toContain(b64.slice(i, i + 16));
    }
  });
});
