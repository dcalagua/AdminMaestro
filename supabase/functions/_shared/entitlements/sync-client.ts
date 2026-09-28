/**
 * Cliente M2M del contrato entitlements.v1 (spec §8.1–§8.3).
 *
 * Transporte: el MISMO que provisioning —url-guard (SSRF), retry (qué es
 * reintentable), m2m (claims + firma asimétrica)— usado tal cual, sin tocar
 * esos módulos. Lo que cambia:
 *
 *   · scopes: `entitlements_write_scope` / `entitlements_read_scope` de la
 *     integración, nunca los de provisioning (`scopesFor` no se usa);
 *   · un token NUEVO por intento: los receptores registran el `jti` de estas
 *     rutas como de un solo uso, así que el reintento de un token ya visto
 *     sería un 401. La idempotencia la da `Idempotency-Key` + la versión;
 *   · el cuerpo es el JCS exacto del snapshot (los bytes que cubre el checksum);
 *   · un PUT no sigue redirecciones (ni siquiera revalidadas).
 *
 * Nada aquí escribe en la base del SaaS ni decide estados: devuelve un
 * resultado clasificado que la base registra (record_entitlement_*_result).
 */
import { buildProvisioningUrl } from '../provisioning/url-guard.ts';
import { decideRetry, type NetworkFailureKind } from '../provisioning/retry.ts';
import { buildM2mClaims, resolvePrivateKey, signM2mToken } from '../provisioning/m2m.ts';
import {
  ProvisioningError,
  type CredentialConfig,
  type IntegrationConfig,
  type M2mAlgorithm,
  type ProvisioningEnvironment,
  type SecretResolver,
} from '../provisioning/types.ts';
import { canonicalize } from './jcs.ts';
import { verifySnapshot } from './snapshot.ts';
import type { PushResultKind } from './states.ts';
import { ENTITLEMENTS_CONTRACT, type AppliedStatus, type EnforcementMode, type EntitlementSnapshot } from './types.ts';

/** Lo que devuelve `platform.entitlement_delivery_context`. */
export interface EntitlementDeliveryContext {
  tenant: { controlPlaneTenantId: string; productCode: string };
  push_enabled: boolean;
  enrollment: string;
  deployment: {
    id: string;
    environment: ProvisioningEnvironment;
    base_url: string | null;
    timeout_ms: number;
    retry_count: number;
  } | null;
  integration: {
    id: string;
    type: string;
    issuer: string;
    audience: string | null;
    subject: string;
    algorithm: M2mAlgorithm | null;
    token_ttl_seconds: number | null;
    entitlements_path: string | null;
    entitlements_manifest_path: string | null;
    entitlements_write_scope: string | null;
    entitlements_read_scope: string | null;
    allowed_hosts: string[];
  } | null;
  credential: {
    id: string;
    type: 'M2M_ASYMMETRIC_JWT' | 'NONE';
    enabled: boolean;
    algorithm: M2mAlgorithm | null;
    token_ttl_seconds: number | null;
    secret_ref: string | null;
  } | null;
}

export interface SyncClientDeps {
  fetchImpl?: typeof fetch;
  secretResolver: SecretResolver;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface Actor {
  id: string | null;
  role: string;
}

export interface PushOutcome {
  result: PushResultKind;
  httpStatus: number | null;
  errorCode: string | null;
  appliedVersion: number | null;
  appliedChecksum: string | null;
  status: AppliedStatus | null;
  unknownCapabilities: string[];
  attempts: number;
}

export interface VerifyOutcome {
  result: 'OBSERVED' | 'RETRYABLE' | 'REJECTED';
  httpStatus: number | null;
  errorCode: string | null;
  appliedVersion: number | null;
  appliedChecksum: string | null;
  status: AppliedStatus | null;
  unknownCapabilities: string[];
  enforcementMode: EnforcementMode | null;
  attempts: number;
}

export type ManifestOutcome =
  | { ok: true; manifestVersion: string; activeCodes: string[]; attempts: number }
  | { ok: false; errorCode: string; httpStatus: number | null; retryable: boolean; attempts: number };

const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const CAPABILITY_RE = /^[a-z0-9]+(\.[a-z0-9_]+)+$/;
const APPLIED_STATUSES: AppliedStatus[] = ['NONE', 'APPLIED', 'APPLIED_WITH_WARNINGS'];
const ENFORCEMENT_MODES: EnforcementMode[] = ['LEGACY', 'SHADOW', 'DUAL_READ', 'PRIMARY'];

function errorCodeOf(status: number, body: unknown): string {
  const raw = (body as { error?: unknown } | null)?.error;
  return typeof raw === 'string' && CODE_RE.test(raw) ? raw : `HTTP_${status}`;
}

function capabilities(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((c): c is string => typeof c === 'string' && CAPABILITY_RE.test(c)).slice(0, 50) : [];
}

function intOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * Clasificación pura de la respuesta de un PUT (spec §8.2). La usa el cliente y
 * la prueba contra `contracts/entitlements/v1/expected/put-responses.json`.
 */
export function classifyPutResponse(
  status: number,
  body: unknown,
): Omit<PushOutcome, 'attempts'> {
  const b = (body ?? {}) as Record<string, unknown>;
  const base = {
    httpStatus: status,
    appliedVersion: intOrNull(b.appliedVersion),
    appliedChecksum: typeof b.appliedChecksum === 'string' ? b.appliedChecksum.slice(0, 80) : null,
    status: APPLIED_STATUSES.includes(b.status as AppliedStatus) ? (b.status as AppliedStatus) : null,
    unknownCapabilities: capabilities(b.unknownCapabilities),
  };
  if (status >= 200 && status < 300) {
    return { ...base, result: b.replayed === true ? 'REPLAYED' : 'APPLIED', errorCode: null };
  }
  const errorCode = errorCodeOf(status, body);
  if (status === 409 && errorCode === 'STALE_SNAPSHOT') return { ...base, result: 'STALE', errorCode };
  if (status === 409 && errorCode === 'VERSION_CONFLICT') return { ...base, result: 'CONFLICT', errorCode };
  const retryable = decideRetry({ attempt: 1, maxAttempts: 2, status }).retry;
  return { ...base, result: retryable ? 'RETRYABLE' : 'REJECTED', errorCode };
}

function codeOfThrown(error: unknown): string {
  return error instanceof ProvisioningError && CODE_RE.test(error.code) ? error.code : 'CLIENT_ERROR';
}

interface Attempt {
  status: number | null;
  body: unknown;
  networkFailure: NetworkFailureKind | null;
}

export class EntitlementSyncClient {
  constructor(private readonly deps: SyncClientDeps) {}

  async pushSnapshot(ctx: EntitlementDeliveryContext, snapshot: EntitlementSnapshot, actor: Actor): Promise<PushOutcome> {
    const empty = { httpStatus: null, appliedVersion: null, appliedChecksum: null, status: null, unknownCapabilities: [] };

    const problems = await verifySnapshot(snapshot);
    if (problems.length > 0) {
      return { ...empty, result: 'INVALID_SNAPSHOT', errorCode: problems[0], attempts: 0 };
    }
    if (
      snapshot.controlPlaneTenantId !== ctx.tenant.controlPlaneTenantId ||
      snapshot.productCode !== ctx.tenant.productCode ||
      snapshot.environment !== ctx.deployment?.environment
    ) {
      return { ...empty, result: 'INVALID_SNAPSHOT', errorCode: 'SNAPSHOT_CONTEXT_MISMATCH', attempts: 0 };
    }

    const exchange = await this.exchange(ctx, 'write', ctx.integration?.entitlements_path ?? null, actor, {
      method: 'PUT',
      body: canonicalize(snapshot),
      idempotencyKey: snapshot.idempotencyKey,
      correlationId: snapshot.correlationId,
    });
    if ('failure' in exchange) {
      return { ...empty, ...exchange.failure, attempts: exchange.attempts };
    }
    return { ...classifyPutResponse(exchange.status, exchange.body), attempts: exchange.attempts };
  }

  async getApplied(ctx: EntitlementDeliveryContext, actor: Actor): Promise<VerifyOutcome> {
    const empty = {
      appliedVersion: null,
      appliedChecksum: null,
      status: null,
      unknownCapabilities: [],
      enforcementMode: null,
    };
    const exchange = await this.exchange(ctx, 'read', ctx.integration?.entitlements_path ?? null, actor, { method: 'GET' });
    if ('failure' in exchange) {
      const { result, httpStatus, errorCode } = exchange.failure;
      return { ...empty, result: result === 'RETRYABLE' ? 'RETRYABLE' : 'REJECTED', httpStatus, errorCode, attempts: exchange.attempts };
    }
    const { status, body, attempts } = exchange;
    if (status < 200 || status >= 300) {
      const retryable = decideRetry({ attempt: 1, maxAttempts: 2, status }).retry;
      return { ...empty, result: retryable ? 'RETRYABLE' : 'REJECTED', httpStatus: status, errorCode: errorCodeOf(status, body), attempts };
    }

    const b = (body ?? {}) as Record<string, unknown>;
    const valid =
      b.controlPlaneTenantId === ctx.tenant.controlPlaneTenantId &&
      b.productCode === ctx.tenant.productCode &&
      (b.appliedVersion === null || (Number.isInteger(b.appliedVersion) && (b.appliedVersion as number) >= 1)) &&
      (b.appliedChecksum === null || typeof b.appliedChecksum === 'string') &&
      APPLIED_STATUSES.includes(b.status as AppliedStatus) &&
      ENFORCEMENT_MODES.includes(b.enforcementMode as EnforcementMode) &&
      Array.isArray(b.unknownCapabilities) &&
      (b.status === 'NONE') === (b.appliedVersion === null);
    if (!valid) {
      return { ...empty, result: 'REJECTED', httpStatus: status, errorCode: 'GET_RESPONSE_INVALID', attempts };
    }
    return {
      result: 'OBSERVED',
      httpStatus: status,
      errorCode: null,
      appliedVersion: b.appliedVersion as number | null,
      appliedChecksum: (b.appliedChecksum as string | null)?.slice(0, 80) ?? null,
      status: b.status as AppliedStatus,
      unknownCapabilities: capabilities(b.unknownCapabilities),
      enforcementMode: b.enforcementMode as EnforcementMode,
      attempts,
    };
  }

  async getManifest(ctx: EntitlementDeliveryContext, actor: Actor): Promise<ManifestOutcome> {
    const exchange = await this.exchange(ctx, 'read', ctx.integration?.entitlements_manifest_path ?? null, actor, { method: 'GET' }, false);
    if ('failure' in exchange) {
      return {
        ok: false,
        errorCode: exchange.failure.errorCode ?? 'CLIENT_ERROR',
        httpStatus: exchange.failure.httpStatus,
        retryable: exchange.failure.result === 'RETRYABLE',
        attempts: exchange.attempts,
      };
    }
    const { status, body, attempts } = exchange;
    if (status < 200 || status >= 300) {
      return { ok: false, errorCode: errorCodeOf(status, body), httpStatus: status, retryable: status >= 500, attempts };
    }
    const b = (body ?? {}) as Record<string, unknown>;
    if (
      b.schema !== 'ebim.capabilities/v1' ||
      b.productCode !== ctx.tenant.productCode ||
      typeof b.manifestVersion !== 'string' ||
      !Array.isArray(b.capabilities)
    ) {
      return { ok: false, errorCode: 'MANIFEST_INVALID', httpStatus: status, retryable: false, attempts };
    }
    const activeCodes = (b.capabilities as Record<string, unknown>[])
      .filter((c) => c?.status === 'ACTIVE' && typeof c.code === 'string' && CAPABILITY_RE.test(c.code))
      .map((c) => c.code as string)
      .sort();
    return { ok: true, manifestVersion: b.manifestVersion.slice(0, 64), activeCodes, attempts };
  }

  /**
   * Una operación con reintentos. Devuelve la última respuesta HTTP o un fallo
   * local ya clasificado (configuración, secreto, red, redirección).
   */
  private async exchange(
    ctx: EntitlementDeliveryContext,
    access: 'write' | 'read',
    pathTemplate: string | null,
    actor: Actor,
    request: { method: 'PUT' | 'GET'; body?: string; idempotencyKey?: string; correlationId?: string },
    tenantPath = true,
  ): Promise<
    | { status: number; body: unknown; attempts: number }
    | { failure: { result: 'REJECTED' | 'RETRYABLE'; httpStatus: number | null; errorCode: string }; attempts: number }
  > {
    const { deployment, integration, credential } = ctx;
    const scope = access === 'write' ? integration?.entitlements_write_scope : integration?.entitlements_read_scope;
    const reject = (errorCode: string) => ({ failure: { result: 'REJECTED' as const, httpStatus: null, errorCode }, attempts: 0 });

    if (!deployment || !integration || !credential || integration.type !== 'HTTP_M2M' || !pathTemplate || !scope) {
      return reject('ENTITLEMENTS_NOT_CONFIGURED');
    }
    if (credential.type !== 'M2M_ASYMMETRIC_JWT' || !credential.enabled) {
      return reject('CREDENTIAL_NOT_USABLE');
    }

    let url: URL;
    let privateKey: string;
    const correlationId = request.correlationId ?? crypto.randomUUID();
    const integrationConfig: IntegrationConfig = {
      id: integration.id,
      code: 'entitlements',
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
    };
    const credentialConfig: CredentialConfig = {
      id: credential.id,
      code: 'entitlements',
      type: credential.type,
      enabled: credential.enabled,
      algorithm: credential.algorithm,
      token_ttl_seconds: credential.token_ttl_seconds,
      secret_ref: credential.secret_ref,
      public_key_ref: null,
    };
    const algorithm = credential.algorithm ?? integration.algorithm;

    try {
      // SSRF primero: sin destino válido no se resuelve ningún secreto.
      url = buildProvisioningUrl(
        deployment.base_url ?? '',
        pathTemplate,
        tenantPath ? { controlPlaneTenantId: ctx.tenant.controlPlaneTenantId } : {},
        { environment: deployment.environment, allowedHosts: integration.allowed_hosts ?? [] },
      );
      // Valida la configuración criptográfica antes de tocar el secreto.
      buildM2mClaims({ integration: integrationConfig, credential: credentialConfig, scopes: [scope], actorId: actor.id, actorRole: actor.role, correlationId });
      if (!algorithm) throw new ProvisioningError('ALGORITHM_NOT_ALLOWED', 'Sin algoritmo');
      privateKey = resolvePrivateKey(credentialConfig, this.deps.secretResolver);
    } catch (error) {
      return reject(codeOfThrown(error));
    }

    const maxAttempts = Math.max(1, (deployment.retry_count ?? 0) + 1);
    let last: Attempt = { status: null, body: null, networkFailure: null };
    let attempts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      let token: string;
      try {
        const claims = buildM2mClaims({
          integration: integrationConfig,
          credential: credentialConfig,
          scopes: [scope],
          actorId: actor.id,
          actorRole: actor.role,
          correlationId,
          now: this.deps.now?.(),
        });
        token = await signM2mToken(claims, algorithm, privateKey);
      } catch (error) {
        return { failure: { result: 'REJECTED', httpStatus: null, errorCode: codeOfThrown(error) }, attempts };
      }

      last = await this.once(url, token, deployment.timeout_ms, request, correlationId);
      if (last.status !== null && last.status >= 300 && last.status < 400) {
        return { failure: { result: 'REJECTED', httpStatus: last.status, errorCode: 'REDIRECT_BLOCKED' }, attempts };
      }
      const decision = decideRetry({ attempt, maxAttempts, status: last.status, networkFailure: last.networkFailure });
      if ((last.status !== null && last.status < 300) || !decision.retry) break;
      await (this.deps.sleep ?? defaultSleep)(decision.delayMs);
    }

    if (last.networkFailure) {
      return {
        failure: {
          result: last.networkFailure === 'ABORT' ? 'REJECTED' : 'RETRYABLE',
          httpStatus: null,
          errorCode: last.networkFailure === 'TIMEOUT' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE',
        },
        attempts,
      };
    }
    return { status: last.status ?? 0, body: last.body, attempts };
  }

  private async once(
    url: URL,
    token: string,
    timeoutMs: number,
    request: { method: 'PUT' | 'GET'; body?: string; idempotencyKey?: string },
    correlationId: string,
  ): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'x-correlation-id': correlationId,
      'x-masteradmin-contract': ENTITLEMENTS_CONTRACT,
    };
    if (request.body !== undefined) headers['content-type'] = 'application/json';
    if (request.idempotencyKey) headers['idempotency-key'] = request.idempotencyKey;
    try {
      const response = await (this.deps.fetchImpl ?? fetch)(url.toString(), {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
        signal: controller.signal,
      });
      return { status: response.status, body: await readJson(response), networkFailure: null };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      return { status: null, body: null, networkFailure: aborted ? 'TIMEOUT' : 'NETWORK' };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text.trim() === '' ? null : (JSON.parse(text) as unknown);
  } catch {
    // Una página de error de un proxy no se propaga como texto.
    return null;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
