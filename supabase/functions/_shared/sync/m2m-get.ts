/**
 * GET firmado M2M para los canales de LECTURA de la sincronización
 * (`lifecycle.v1` GET y `tenant-inventory.v1`).
 *
 * Mismo transporte que el resto de contratos —url-guard (SSRF), m2m (claims +
 * firma asimétrica), retry— usado tal cual. Reglas propias:
 *   · un token NUEVO por intento (las apps registran el `jti` como de un solo uso);
 *   · solo el scope de lectura del canal: nunca el de alta ni uno de escritura;
 *   · no sigue redirecciones (una redirección es un error, no un salto);
 *   · un cuerpo que no es JSON se descarta: nunca llega texto del proveedor.
 */
import { buildProvisioningUrl } from '../provisioning/url-guard.ts';
import { decideRetry, type NetworkFailureKind } from '../provisioning/retry.ts';
import { buildM2mClaims, resolvePrivateKey, signM2mToken } from '../provisioning/m2m.ts';
import {
  ProvisioningError,
  type CredentialConfig,
  type IntegrationConfig,
  type SecretResolver,
} from '../provisioning/types.ts';
import { CODE_RE, type SyncActor, type SyncPlanTarget } from './types.ts';

export interface M2mGetDeps {
  fetchImpl?: typeof fetch;
  secretResolver: SecretResolver;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  uuid?: () => string;
}

export interface M2mGetResult {
  status: number | null;
  body: unknown;
  /** Fallo antes o durante la llamada (configuración, red, redirección). */
  errorCode: string | null;
  attempts: number;
}

/** Los GET de la sincronización reintentan como mucho una vez: son 8 apps en un día. */
export const MAX_READ_RETRIES = 1;

function configs(target: SyncPlanTarget, contract: string): { integration: IntegrationConfig; credential: CredentialConfig } | null {
  const { integration, credential } = target;
  if (!credential) return null;
  return {
    integration: {
      id: integration.id,
      code: contract,
      type: 'HTTP_M2M',
      contract_version: 'v1',
      status: 'READY',
      enabled: true,
      issuer: integration.issuer,
      audience: integration.audience,
      subject: integration.subject,
      algorithm: integration.algorithm,
      token_ttl_seconds: integration.token_ttl_seconds,
      create_scope: null,
      read_scope: null,
      additional_scopes: [],
      create_path_template: null,
      status_path_template: null,
      health_path_template: null,
      allowed_hosts: integration.allowed_hosts ?? [],
    },
    credential: {
      id: credential.id,
      code: contract,
      type: credential.type,
      enabled: credential.enabled,
      algorithm: credential.algorithm,
      token_ttl_seconds: credential.token_ttl_seconds,
      secret_ref: credential.secret_ref,
      public_key_ref: null,
    },
  };
}

function fail(errorCode: string, attempts = 0): M2mGetResult {
  return { status: null, body: null, errorCode, attempts };
}

export async function m2mGet(
  target: SyncPlanTarget,
  request: {
    pathTemplate: string;
    params?: Record<string, string>;
    query?: Record<string, string>;
    scope: string;
    contract: string;
  },
  actor: SyncActor,
  deps: M2mGetDeps,
): Promise<M2mGetResult> {
  const { deployment, credential } = target;
  if (target.integration.type !== 'HTTP_M2M') return fail('INTEGRATION_NOT_HTTP');
  if (!deployment.base_url || !deployment.environment) return fail('DEPLOYMENT_WITHOUT_URL');
  if (!credential || credential.type !== 'M2M_ASYMMETRIC_JWT' || !credential.enabled) {
    return fail('CREDENTIAL_NOT_USABLE');
  }
  const cfg = configs(target, request.contract)!;
  const algorithm = credential.algorithm ?? target.integration.algorithm;
  const correlationId = (deps.uuid ?? (() => crypto.randomUUID()))();

  let url: URL;
  let privateKey: string;
  try {
    // SSRF primero: sin destino admisible no se resuelve ningún secreto.
    url = buildProvisioningUrl(deployment.base_url, request.pathTemplate, request.params ?? {}, {
      environment: deployment.environment,
      allowedHosts: target.integration.allowed_hosts ?? [],
    });
    for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, value);
    if (!algorithm) throw new ProvisioningError('ALGORITHM_NOT_ALLOWED', 'Sin algoritmo');
    // Valida audience/issuer/TTL antes de tocar el secreto.
    buildM2mClaims({ ...cfg, scopes: [request.scope], actorId: actor.id, actorRole: actor.role, correlationId });
    privateKey = resolvePrivateKey(cfg.credential, deps.secretResolver);
  } catch (error) {
    return fail(error instanceof ProvisioningError && CODE_RE.test(error.code) ? error.code : 'CLIENT_ERROR');
  }

  const maxAttempts = Math.min(Math.max(deployment.retry_count ?? 0, 0), MAX_READ_RETRIES) + 1;
  let last: { status: number | null; body: unknown; network: NetworkFailureKind | null } = {
    status: null,
    body: null,
    network: null,
  };
  let attempts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    let token: string;
    try {
      const claims = buildM2mClaims({
        ...cfg,
        scopes: [request.scope],
        actorId: actor.id,
        actorRole: actor.role,
        correlationId,
        now: deps.now?.(),
      });
      token = await signM2mToken(claims, algorithm, privateKey);
    } catch (error) {
      return fail(error instanceof ProvisioningError && CODE_RE.test(error.code) ? error.code : 'CLIENT_ERROR', attempts);
    }

    last = await once(url, token, deployment.timeout_ms, correlationId, request.contract, deps.fetchImpl);
    if (last.status !== null && last.status >= 300 && last.status < 400) {
      return { status: last.status, body: null, errorCode: 'REDIRECT_BLOCKED', attempts };
    }
    const decision = decideRetry({ attempt, maxAttempts, status: last.status, networkFailure: last.network });
    if ((last.status !== null && last.status < 300) || !decision.retry) break;
    await (deps.sleep ?? defaultSleep)(decision.delayMs);
  }

  if (last.network) {
    return fail(last.network === 'TIMEOUT' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE', attempts);
  }
  return { status: last.status, body: last.body, errorCode: null, attempts };
}

async function once(
  url: URL,
  token: string,
  timeoutMs: number,
  correlationId: string,
  contract: string,
  fetchImpl: typeof fetch | undefined,
): Promise<{ status: number | null; body: unknown; network: NetworkFailureKind | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
  try {
    const response = await (fetchImpl ?? fetch)(url.toString(), {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'x-correlation-id': correlationId,
        'x-masteradmin-contract': contract,
      },
      redirect: 'manual',
      signal: controller.signal,
    });
    return { status: response.status, body: await readJson(response), network: null };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { status: null, body: null, network: aborted ? 'TIMEOUT' : 'NETWORK' };
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text.trim() === '' ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Código estable del cuerpo de error de la app (`{"error":"CODIGO"}`), o null. */
export function bodyErrorCode(body: unknown): string | null {
  const raw = (body as { error?: unknown } | null)?.error;
  return typeof raw === 'string' && CODE_RE.test(raw) ? raw : null;
}
