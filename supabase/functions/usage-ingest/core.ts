/**
 * Cableado de usage-ingest: puertos de IngestDeps sobre las RPCs de
 * MasterAdmin (service_role) y el entorno de la Edge Function.
 *
 *   · USAGE_INGEST_ENABLED: flag global; SOLO el literal 'true' lo enciende
 *     (D-12: el ingest queda apagado hasta su aprobación). Además cada producto
 *     tiene su kill-switch product_integrations.usage_ingest_enabled.
 *   · La clave pública del SaaS se resuelve por REFERENCIA (nombre de
 *     variable) y solo si la referencia tiene forma de clave pública
 *     (…_PUBLIC_JWK / …_PUBLIC_KEY): una fila mal configurada no puede hacer
 *     que la función lea otra variable del entorno.
 */
import type { IngestCredential, IngestDeps } from '../_shared/usage/ingest.ts';
import type { BatchResult } from '../_shared/usage/types.ts';

export interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

export type EnvReader = (name: string) => string | undefined;

const PUBLIC_KEY_REF_RE = /^[A-Z][A-Z0-9_]{2,120}_PUBLIC_(JWK|KEY)$/;

export function isIngestEnabled(value: string | undefined): boolean {
  return value === 'true';
}

async function call<T>(client: RpcClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw Object.assign(new Error(`RPC_ERROR:${fn}`), { code: 'RPC_ERROR' });
  return data as T;
}

interface CredentialRow {
  product_code: string;
  environment: string;
  audience: string;
  algorithm: string;
  kid: string | null;
  public_key_ref: string;
  credential_enabled: boolean;
  product_ingest_enabled: boolean;
}

export function buildIngestDeps(client: RpcClient, env: EnvReader, now: () => number = () => Date.now()): IngestDeps {
  return {
    enabled: isIngestEnabled(env('USAGE_INGEST_ENABLED')),
    nowSeconds: () => Math.floor(now() / 1000),
    resolveCredential: async (issuer: string): Promise<IngestCredential | null> => {
      const rows = await call<CredentialRow[] | null>(client, 'usage_ingest_credential', { p_issuer: issuer });
      const row = rows?.[0];
      if (!row) return null;
      return {
        productCode: row.product_code,
        environment: row.environment,
        audience: row.audience,
        algorithm: row.algorithm,
        kid: row.kid,
        publicKeyRef: row.public_key_ref,
        credentialEnabled: row.credential_enabled,
        productIngestEnabled: row.product_ingest_enabled,
      };
    },
    resolvePublicKey: (ref: string) => (PUBLIC_KEY_REF_RE.test(ref) ? env(ref) : undefined),
    consumeJti: async (issuer: string, jti: string, expiresAtSeconds: number) =>
      (await call<boolean>(client, 'consume_m2m_jti', {
        p_issuer: issuer,
        p_jti: jti,
        p_expires_at: new Date(expiresAtSeconds * 1000).toISOString(),
      })) === true,
    ingest: (productCode: string, environment: string, events: unknown[], batchId: string) =>
      call<BatchResult>(client, 'ingest_usage_events', {
        p_product_code: productCode,
        p_environment: environment,
        p_events: events,
        p_batch_id: batchId,
      }),
  };
}
