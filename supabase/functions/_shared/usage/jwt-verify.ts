/**
 * Verificación del JWT ES256 que firma el SaaS para el ingest de uso.
 *
 * Solo ES256 (sin `none`, sin HS*, sin RS*): la cabecera no elige el
 * algoritmo, lo fija el contrato. La clave pública llega como JWK EC P-256 o
 * PEM SPKI; una JWK con `d` (privada) o un PEM privado es una
 * misconfiguración y se rechaza. Los mensajes del runtime nunca se propagan.
 */
import { CLOCK_SKEW_SECONDS, MAX_TOKEN_TTL_SECONDS, USAGE_SCOPE, UsageIngestError } from './types.ts';

export interface UsageTokenClaims {
  iss: string;
  aud: string | string[];
  scope?: string;
  scp?: string[];
  iat: number;
  exp: number;
  nbf?: number;
  jti: string;
  [k: string]: unknown;
}

export interface DecodedToken {
  header: Record<string, unknown>;
  claims: UsageTokenClaims;
  signingInput: Uint8Array<ArrayBuffer>;
  signature: Uint8Array<ArrayBuffer>;
}

function b64urlDecode(segment: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) throw new UsageIngestError('TOKEN_INVALID', 401);
  const pad = segment.length % 4 === 0 ? '' : '='.repeat(4 - (segment.length % 4));
  const bin = atob(segment.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function parseJson(bytes: Uint8Array): Record<string, unknown> {
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
  return value as Record<string, unknown>;
}

/** Decodifica sin verificar (para leer `iss` y resolver la credencial). */
export function decodeUsageToken(token: string): DecodedToken {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => p === '')) throw new UsageIngestError('TOKEN_INVALID', 401);
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = parseJson(b64urlDecode(parts[0]));
    claims = parseJson(b64urlDecode(parts[1]));
  } catch {
    throw new UsageIngestError('TOKEN_INVALID', 401);
  }
  if (header.alg !== 'ES256') throw new UsageIngestError('ALGORITHM_NOT_ALLOWED', 401);
  if (header.typ !== undefined && header.typ !== 'JWT') throw new UsageIngestError('TOKEN_INVALID', 401);
  if (header.crit !== undefined) throw new UsageIngestError('TOKEN_INVALID', 401);
  if (typeof claims.iss !== 'string' || claims.iss === '') throw new UsageIngestError('TOKEN_INVALID', 401);
  if (typeof claims.jti !== 'string' || claims.jti === '' || claims.jti.length > 200) {
    throw new UsageIngestError('TOKEN_INVALID', 401);
  }
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) throw new UsageIngestError('TOKEN_INVALID', 401);
  return {
    header,
    claims: claims as UsageTokenClaims,
    signingInput: new Uint8Array(new TextEncoder().encode(`${parts[0]}.${parts[1]}`)),
    signature: b64urlDecode(parts[2]),
  };
}

const EC_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' } as const;

/** Importa la clave pública (JWK EC P-256 o PEM SPKI). */
export async function importUsagePublicKey(material: string): Promise<CryptoKey> {
  const text = material.trim();
  try {
    if (text.startsWith('{')) {
      const jwk = JSON.parse(text) as JsonWebKey;
      if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || 'd' in jwk || !jwk.x || !jwk.y) throw new Error('bad jwk');
      return await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, EC_PARAMS, false, ['verify']);
    }
    if (/^-----BEGIN PUBLIC KEY-----/.test(text)) {
      const body = text.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
      const bin = atob(body);
      const der = new Uint8Array(new ArrayBuffer(bin.length));
      for (let i = 0; i < bin.length; i += 1) der[i] = bin.charCodeAt(i);
      return await crypto.subtle.importKey('spki', der, EC_PARAMS, false, ['verify']);
    }
  } catch {
    // cae al error estable de abajo
  }
  throw new UsageIngestError('CREDENTIAL_NOT_CONFIGURED', 503);
}

export async function verifySignature(decoded: DecodedToken, key: CryptoKey): Promise<void> {
  // JOSE ES256 = r||s de 32 bytes cada uno (IEEE P1363), que es lo que WebCrypto espera.
  if (decoded.signature.length !== 64) throw new UsageIngestError('SIGNATURE_INVALID', 401);
  let ok = false;
  try {
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decoded.signature, decoded.signingInput);
  } catch {
    ok = false;
  }
  if (!ok) throw new UsageIngestError('SIGNATURE_INVALID', 401);
}

/** Reglas temporales, audiencia y scope. Se evalúan SOLO tras verificar la firma. */
export function checkClaims(claims: UsageTokenClaims, audience: string, nowSeconds: number): void {
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(audience)) throw new UsageIngestError('AUDIENCE_INVALID', 401);
  if (claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS) throw new UsageIngestError('TOKEN_EXPIRED', 401);
  if (claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) throw new UsageIngestError('TOKEN_NOT_YET_VALID', 401);
  if (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > nowSeconds + CLOCK_SKEW_SECONDS)) {
    throw new UsageIngestError('TOKEN_NOT_YET_VALID', 401);
  }
  if (claims.exp - claims.iat > MAX_TOKEN_TTL_SECONDS || claims.exp <= claims.iat) {
    throw new UsageIngestError('TOKEN_TTL_TOO_LONG', 401);
  }
  const scopes = [
    ...(typeof claims.scope === 'string' ? claims.scope.split(/\s+/) : []),
    ...(Array.isArray(claims.scp) ? claims.scp.filter((s): s is string => typeof s === 'string') : []),
  ];
  if (!scopes.includes(USAGE_SCOPE)) throw new UsageIngestError('SCOPE_MISSING', 403);
}
