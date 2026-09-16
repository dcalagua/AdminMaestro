/**
 * Firma M2M del orquestador.
 *
 * MasterAdmin se identifica ante cada SaaS con un JWT ASIMÉTRICO de vida corta,
 * firmado server-side con una clave privada que:
 *   · vive en el almacén de secretos del servidor;
 *   · se resuelve por NOMBRE (`secret_ref`), nunca por valor almacenado;
 *   · no entra en la base de datos, ni en el repositorio, ni en el navegador.
 *
 * POR QUÉ ASIMÉTRICO Y NO HS256: con un secreto compartido, cualquiera que
 * pueda VERIFICAR un token puede también EMITIRLO. Es decir, el propio SaaS
 * podría fabricar tokens "de MasterAdmin" y la auditoría dejaría de significar
 * nada. Con RS256/ES256, el SaaS sólo tiene la clave pública.
 *
 * `alg: none` y HS256 no están soportados y no es un descuido: son los dos
 * caminos clásicos para falsificar un JWT.
 */
import type {
  CredentialConfig,
  IntegrationConfig,
  M2mAlgorithm,
  SecretResolver,
} from './types.ts';
import { ProvisioningError } from './types.ts';

/** Única lista de algoritmos aceptados en todo el orquestador. */
export const ALLOWED_ALGORITHMS: readonly M2mAlgorithm[] = ['RS256', 'ES256'] as const;

/** Techo duro de vida del token, por encima de cualquier configuración. */
export const MAX_TOKEN_TTL_SECONDS = 300;
export const MIN_TOKEN_TTL_SECONDS = 30;

export function isAllowedAlgorithm(alg: string | null | undefined): alg is M2mAlgorithm {
  return typeof alg === 'string' && (ALLOWED_ALGORITHMS as readonly string[]).includes(alg);
}

export interface M2mClaims {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  scope: string;
  /** AUDITORÍA. Dice quién pidió la operación; NO autoriza por sí mismo. */
  actor_id: string | null;
  actor_role: string;
  correlation_id: string;
}

export interface ClaimsInput {
  integration: IntegrationConfig;
  credential: CredentialConfig;
  scopes: string[];
  actorId: string | null;
  actorRole: string;
  correlationId: string;
  /** Inyectable para que las pruebas no dependan del reloj. */
  now?: Date;
  jti?: string;
}

/**
 * Construye los claims y valida la configuración criptográfica.
 *
 * Todo lo que aquí se comprueba podría estar "garantizado" por la base. Se
 * comprueba igual: la Edge Function es el último punto antes de emitir una
 * credencial válida, y un token mal formado emitido es un token que existe.
 */
export function buildM2mClaims(input: ClaimsInput): M2mClaims {
  const { integration, credential } = input;

  if (!integration.audience || integration.audience.trim() === '') {
    throw new ProvisioningError(
      'AUDIENCE_NOT_CONFIGURED',
      'La integración no declara `audience`. Cada producto tiene la suya y MasterAdmin no la adivina',
    );
  }
  if (!integration.issuer || integration.issuer.trim() === '') {
    throw new ProvisioningError('ISSUER_NOT_CONFIGURED', 'La integración no declara `issuer`');
  }

  const algorithm = credential.algorithm ?? integration.algorithm;
  if (!isAllowedAlgorithm(algorithm)) {
    throw new ProvisioningError(
      'ALGORITHM_NOT_ALLOWED',
      `Algoritmo no admitido para provisioning M2M: ${algorithm ?? 'ninguno'}. ` +
        `Sólo ${ALLOWED_ALGORITHMS.join(' o ')}: con un algoritmo simétrico, quien verifica también puede emitir`,
    );
  }

  const scopes = input.scopes.map((s) => s.trim()).filter((s) => s !== '');
  if (scopes.length === 0) {
    throw new ProvisioningError(
      'SCOPE_NOT_CONFIGURED',
      'La operación no tiene scope configurado. Un token sin scope es un token con todos',
    );
  }

  const configured = credential.token_ttl_seconds ?? integration.token_ttl_seconds;
  if (configured == null) {
    throw new ProvisioningError('TTL_NOT_CONFIGURED', 'No hay TTL configurado para el token M2M');
  }
  // El techo se aplica SIEMPRE, aunque la configuración pida más. La base ya lo
  // limita; si alguien relajara ese CHECK, este `min` seguiría en pie.
  const ttl = Math.min(Math.max(configured, MIN_TOKEN_TTL_SECONDS), MAX_TOKEN_TTL_SECONDS);

  const now = input.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);

  return {
    iss: integration.issuer,
    aud: integration.audience,
    // El sujeto es el SISTEMA. Poner aquí el correo del humano convertiría un
    // token de servicio en una identidad personal que el SaaS podría tratar
    // como usuario final.
    sub: integration.subject,
    iat,
    exp: iat + ttl,
    jti: input.jti ?? crypto.randomUUID(),
    scope: Array.from(new Set(scopes)).join(' '),
    actor_id: input.actorId,
    actor_role: input.actorRole,
    correlation_id: input.correlationId,
  };
}

/** Resuelve el VALOR de la clave privada. Único punto de entrada de un secreto. */
export function resolvePrivateKey(credential: CredentialConfig, resolver: SecretResolver): string {
  if (!credential.secret_ref) {
    throw new ProvisioningError(
      'SECRET_REF_MISSING',
      'El perfil de credencial no declara ninguna referencia de secreto',
    );
  }
  const value = resolver(credential.secret_ref);
  if (!value || value.trim() === '') {
    // El mensaje nombra la REFERENCIA, no el valor: es exactamente el dato que
    // necesita quien tiene que cargar el secreto, y no filtra nada.
    throw new ProvisioningError(
      'SECRET_NOT_AVAILABLE',
      `El secreto "${credential.secret_ref}" no está disponible en el almacén del servidor`,
      null,
      false,
      { secret_ref: credential.secret_ref },
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Firma
// ---------------------------------------------------------------------------

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeSegment(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  if (body === '') {
    throw new ProvisioningError('PRIVATE_KEY_INVALID', 'La clave privada está vacía o mal formada');
  }
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function importParams(algorithm: M2mAlgorithm): {
  algorithm: RsaHashedImportParams | EcKeyImportParams;
  sign: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
} {
  if (algorithm === 'RS256') {
    return {
      algorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      sign: { name: 'RSASSA-PKCS1-v1_5' },
    };
  }
  return {
    algorithm: { name: 'ECDSA', namedCurve: 'P-256' },
    sign: { name: 'ECDSA', hash: 'SHA-256' },
  };
}

/**
 * Firma el JWT con WebCrypto.
 *
 * Se exige PKCS#8 en PEM porque es lo que exporta cualquier herramienta moderna
 * y lo único que `importKey` acepta para clave privada. Un error de formato se
 * traduce a un código estable en vez de dejar escapar el mensaje del runtime,
 * que en algunos casos incluye fragmentos del material de clave.
 */
export async function signM2mToken(
  claims: M2mClaims,
  algorithm: M2mAlgorithm,
  privateKeyPem: string,
): Promise<string> {
  if (!isAllowedAlgorithm(algorithm)) {
    throw new ProvisioningError('ALGORITHM_NOT_ALLOWED', `Algoritmo no admitido: ${algorithm}`);
  }

  const { algorithm: importAlg, sign: signAlg } = importParams(algorithm);

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'pkcs8',
      pemToArrayBuffer(privateKeyPem),
      importAlg,
      false,
      ['sign'],
    );
  } catch (error) {
    if (error instanceof ProvisioningError) throw error;
    throw new ProvisioningError(
      'PRIVATE_KEY_INVALID',
      `No se pudo importar la clave privada para ${algorithm}. Se espera PKCS#8 en PEM`,
    );
  }

  const header = { alg: algorithm, typ: 'JWT' };
  const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`;

  const signature = await crypto.subtle.sign(
    signAlg,
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

/** Scopes de una operación, sin duplicados y sin vacíos. */
export function scopesFor(
  integration: IntegrationConfig,
  operation: 'create' | 'read',
): string[] {
  const primary = operation === 'create' ? integration.create_scope : integration.read_scope;
  return [primary, ...(integration.additional_scopes ?? [])]
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map((s) => s.trim());
}
