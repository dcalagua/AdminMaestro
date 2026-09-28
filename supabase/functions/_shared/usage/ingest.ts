/**
 * Ingest firmado de uso: POST {MasterAdmin}/functions/v1/usage-ingest.
 *
 * Orden de las comprobaciones (cada una corta):
 *   1. método, flag global (D-12: apagado hasta aprobación), content-type, tamaño;
 *   2. token: decodificar → credencial por `iss` → firma ES256 → aud/exp/iat/TTL/scope;
 *   3. kill-switch del producto; jti de un solo uso (DESPUÉS de la firma, para
 *      que nadie pueda quemar jti ajenos);
 *   4. cuerpo: schema, batchId, 1..500 eventos, ambiente = el de la credencial,
 *      producto = el de la credencial;
 *   5. RPC ingest_usage_events (validación, idempotencia y autorización
 *      tenant×producto×medidor por evento).
 *
 * Sin E/S propia: todo por los puertos de IngestDeps. Las respuestas son
 * códigos estables; nunca mensajes del runtime ni de la base.
 */
import { checkClaims, decodeUsageToken, importUsagePublicKey, verifySignature } from './jwt-verify.ts';
import {
  type BatchResult,
  MAX_BODY_BYTES,
  MAX_EVENTS,
  USAGE_SCHEMA,
  UsageIngestError,
} from './types.ts';

export interface IngestCredential {
  productCode: string;
  environment: string;
  audience: string;
  algorithm: string;
  kid: string | null;
  publicKeyRef: string;
  credentialEnabled: boolean;
  productIngestEnabled: boolean;
}

export interface IngestDeps {
  /** Flag global de la función (env USAGE_INGEST_ENABLED === 'true'). */
  enabled: boolean;
  nowSeconds: () => number;
  resolveCredential: (issuer: string) => Promise<IngestCredential | null>;
  /** Resuelve la REFERENCIA (nombre de variable) a la clave pública. */
  resolvePublicKey: (ref: string) => string | undefined;
  consumeJti: (issuer: string, jti: string, expiresAtSeconds: number) => Promise<boolean>;
  ingest: (productCode: string, environment: string, events: unknown[], batchId: string) => Promise<BatchResult>;
}

export interface IngestRequest {
  method: string;
  headers: Headers;
  bodyText: string;
}

export interface IngestResponse {
  status: number;
  body: Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code: string, status: number): IngestResponse {
  return { status, body: { error: code } };
}

async function authenticate(req: IngestRequest, deps: IngestDeps): Promise<IngestCredential> {
  const auth = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+([A-Za-z0-9_.-]+)$/.exec(auth.trim());
  if (!match) throw new UsageIngestError('TOKEN_MISSING', 401);

  const decoded = decodeUsageToken(match[1]);
  const credential = await deps.resolveCredential(decoded.claims.iss);
  if (!credential) throw new UsageIngestError('ISSUER_UNKNOWN', 401);
  if (!credential.credentialEnabled) throw new UsageIngestError('CREDENTIAL_DISABLED', 403);
  if (credential.algorithm !== 'ES256') throw new UsageIngestError('ALGORITHM_NOT_ALLOWED', 401);
  if (credential.kid !== null && decoded.header.kid !== undefined && decoded.header.kid !== credential.kid) {
    throw new UsageIngestError('SIGNATURE_INVALID', 401);
  }

  const material = deps.resolvePublicKey(credential.publicKeyRef);
  if (!material) throw new UsageIngestError('CREDENTIAL_NOT_CONFIGURED', 503);
  const key = await importUsagePublicKey(material);
  await verifySignature(decoded, key);
  checkClaims(decoded.claims, credential.audience, deps.nowSeconds());

  if (!credential.productIngestEnabled) throw new UsageIngestError('USAGE_INGEST_DISABLED', 503);
  if (!(await deps.consumeJti(decoded.claims.iss, decoded.claims.jti, decoded.claims.exp))) {
    throw new UsageIngestError('JTI_REPLAYED', 401);
  }
  return credential;
}

function parseBatch(text: string, credential: IngestCredential): { batchId: string; events: unknown[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new UsageIngestError('INVALID_BATCH', 400);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageIngestError('INVALID_BATCH', 400);
  const b = raw as Record<string, unknown>;
  if (b.schema !== USAGE_SCHEMA) throw new UsageIngestError('SCHEMA_UNSUPPORTED', 400);
  if (typeof b.batchId !== 'string' || !UUID_RE.test(b.batchId)) throw new UsageIngestError('INVALID_BATCH', 400);
  if (!Array.isArray(b.events) || b.events.length === 0) throw new UsageIngestError('INVALID_BATCH', 400);
  if (b.events.length > MAX_EVENTS) throw new UsageIngestError('BATCH_TOO_LARGE', 400);
  if (b.environment !== credential.environment) throw new UsageIngestError('ENVIRONMENT_MISMATCH', 400);
  if (b.productCode !== undefined && b.productCode !== credential.productCode) {
    throw new UsageIngestError('PRODUCT_MISMATCH', 400);
  }
  return { batchId: b.batchId, events: b.events };
}

export async function handleUsageIngest(req: IngestRequest, deps: IngestDeps): Promise<IngestResponse> {
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  if (!deps.enabled) return fail('USAGE_INGEST_DISABLED', 503);
  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') return fail('UNSUPPORTED_MEDIA_TYPE', 415);
  if (new TextEncoder().encode(req.bodyText).length > MAX_BODY_BYTES) return fail('PAYLOAD_TOO_LARGE', 413);

  let credential: IngestCredential;
  let batch: { batchId: string; events: unknown[] };
  try {
    credential = await authenticate(req, deps);
    batch = parseBatch(req.bodyText, credential);
  } catch (error) {
    if (error instanceof UsageIngestError) return fail(error.code, error.status);
    return fail('RETRYABLE', 503);
  }

  let result: BatchResult;
  try {
    result = await deps.ingest(credential.productCode, credential.environment, batch.events, batch.batchId);
  } catch {
    return fail('RETRYABLE', 503);
  }
  return {
    status: 200,
    body: {
      schema: USAGE_SCHEMA,
      batchId: batch.batchId,
      results: result.results,
      accepted: result.accepted,
      duplicate: result.duplicate,
      rejected: result.rejected,
    },
  };
}
