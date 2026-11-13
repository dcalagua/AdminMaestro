/**
 * Cliente M2M del contrato lifecycle.v1 (docs/platform-provisioning/LIFECYCLE_CONTRACT.md).
 *
 * Mismo transporte que entitlements.v1 —url-guard (SSRF), retry, m2m (claims +
 * firma asimétrica)— usado tal cual. Lo propio de este contrato:
 *
 *   · scopes `lifecycle_write_scope` / `lifecycle_read_scope` de la integración,
 *     nunca los de alta ni los de entitlements;
 *   · un token NUEVO por intento (los receptores registran el `jti` como de un
 *     solo uso); la idempotencia la dan `Idempotency-Key` y la versión;
 *   · el cuerpo es declarativo: estado + versión. La app rechaza lo viejo (409).
 *   · un PUT no sigue redirecciones.
 *
 * No escribe en la base de nadie ni decide estados: devuelve un resultado
 * clasificado que registra `record_lifecycle_delivery_result`.
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

export const LIFECYCLE_CONTRACT = 'lifecycle.v1';

export type LifecycleState = 'ACTIVE' | 'SUSPENDED';
export type LifecycleReason = 'NON_PAYMENT' | 'MANUAL' | 'TERMINATED';
export type LifecycleResult = 'APPLIED' | 'REPLAYED' | 'STALE' | 'CONFLICT' | 'RETRYABLE' | 'REJECTED' | 'NOT_CONFIGURED';

/** Lo que devuelve `platform.lifecycle_delivery_context`. */
export interface LifecycleDeliveryContext {
  tenant: { controlPlaneTenantId: string; productCode: string };
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
    lifecycle_path: string | null;
    lifecycle_write_scope: string | null;
    lifecycle_read_scope: string | null;
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

export interface LifecycleDesired {
  version: number;
  state: LifecycleState;
  reason: LifecycleReason | null;
  effectiveAt: string;
}

export interface LifecycleBody {
  contract: typeof LIFECYCLE_CONTRACT;
  controlPlaneTenantId: string;
  productCode: string;
  environment: ProvisioningEnvironment;
  version: number;
  state: LifecycleState;
  reason: LifecycleReason | null;
  effectiveAt: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface LifecycleOutcome {
  result: LifecycleResult;
  httpStatus: number | null;
  errorCode: string | null;
  appliedVersion: number | null;
  state: LifecycleState | null;
  attempts: number;
}

export interface LifecycleClientDeps {
  fetchImpl?: typeof fetch;
  secretResolver: SecretResolver;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  uuid?: () => string;
}

export interface Actor {
  id: string | null;
  role: string;
}

const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const STATES: LifecycleState[] = ['ACTIVE', 'SUSPENDED'];

/** Cuerpo exacto del PUT (contrato §3). Puro: lo fija la prueba. */
export function buildLifecycleBody(
  ctx: LifecycleDeliveryContext,
  desired: LifecycleDesired,
  correlationId: string,
): LifecycleBody {
  const { controlPlaneTenantId, productCode } = ctx.tenant;
  return {
    contract: LIFECYCLE_CONTRACT,
    controlPlaneTenantId,
    productCode,
    environment: ctx.deployment?.environment ?? 'DEV',
    version: desired.version,
    state: desired.state,
    reason: desired.state === 'ACTIVE' ? null : desired.reason,
    effectiveAt: desired.effectiveAt,
    idempotencyKey: `lifecycle:${controlPlaneTenantId}:${productCode}:${desired.version}`,
    correlationId,
  };
}

function intOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** Clasificación pura de la respuesta del PUT (contrato §4). */
export function classifyLifecycleResponse(
  status: number,
  body: unknown,
  sent: Pick<LifecycleBody, 'controlPlaneTenantId' | 'productCode' | 'version' | 'state'>,
): Omit<LifecycleOutcome, 'attempts'> {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = b.error;
  const errorCode = typeof raw === 'string' && CODE_RE.test(raw) ? raw : null;
  const appliedVersion = intOrNull(b.appliedVersion);

  if (status >= 200 && status < 300) {
    const valid =
      b.controlPlaneTenantId === sent.controlPlaneTenantId &&
      b.productCode === sent.productCode &&
      appliedVersion === sent.version &&
      b.state === sent.state;
    if (!valid) {
      // Un 2xx que no confirma lo enviado no es una confirmación.
      return { result: 'REJECTED', httpStatus: status, errorCode: 'RESPONSE_INVALID', appliedVersion, state: null };
    }
    return {
      result: b.replayed === true ? 'REPLAYED' : 'APPLIED',
      httpStatus: status,
      errorCode: null,
      appliedVersion,
      state: sent.state,
    };
  }
  const state = STATES.includes(b.state as LifecycleState) ? (b.state as LifecycleState) : null;
  if (status === 409 && errorCode === 'STALE_LIFECYCLE') {
    return { result: 'STALE', httpStatus: status, errorCode, appliedVersion, state };
  }
  if (status === 409 && errorCode === 'VERSION_CONFLICT') {
    return { result: 'CONFLICT', httpStatus: status, errorCode, appliedVersion, state };
  }
  const retryable = decideRetry({ attempt: 1, maxAttempts: 2, status }).retry;
  return {
    result: retryable ? 'RETRYABLE' : 'REJECTED',
    httpStatus: status,
    errorCode: errorCode ?? `HTTP_${status}`,
    appliedVersion,
    state,
  };
}

interface Attempt {
  status: number | null;
  body: unknown;
  networkFailure: NetworkFailureKind | null;
}

export class LifecycleClient {
  constructor(private readonly deps: LifecycleClientDeps) {}

  async putState(ctx: LifecycleDeliveryContext, desired: LifecycleDesired, actor: Actor): Promise<LifecycleOutcome> {
    const empty = { httpStatus: null, appliedVersion: null, state: null };
    const notConfigured = (errorCode: string): LifecycleOutcome => ({
      ...empty,
      result: 'NOT_CONFIGURED',
      errorCode,
      attempts: 0,
    });
    const { deployment, integration, credential } = ctx;

    if (!deployment || !integration || integration.type !== 'HTTP_M2M' || !integration.lifecycle_path || !integration.lifecycle_write_scope) {
      return notConfigured('LIFECYCLE_NOT_CONFIGURED');
    }
    if (!credential || credential.type !== 'M2M_ASYMMETRIC_JWT' || !credential.enabled) {
      return notConfigured('CREDENTIAL_NOT_USABLE');
    }

    const correlationId = (this.deps.uuid ?? (() => crypto.randomUUID()))();
    const body = buildLifecycleBody(ctx, desired, correlationId);
    const scope = integration.lifecycle_write_scope;
    const integrationConfig: IntegrationConfig = {
      id: integration.id,
      code: 'lifecycle',
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
      code: 'lifecycle',
      type: credential.type,
      enabled: credential.enabled,
      algorithm: credential.algorithm,
      token_ttl_seconds: credential.token_ttl_seconds,
      secret_ref: credential.secret_ref,
      public_key_ref: null,
    };
    const algorithm = credential.algorithm ?? integration.algorithm;

    let url: URL;
    let privateKey: string;
    try {
      // SSRF primero: sin destino válido no se resuelve ningún secreto.
      url = buildProvisioningUrl(
        deployment.base_url ?? '',
        integration.lifecycle_path,
        { controlPlaneTenantId: ctx.tenant.controlPlaneTenantId },
        { environment: deployment.environment, allowedHosts: integration.allowed_hosts ?? [] },
      );
      buildM2mClaims({ integration: integrationConfig, credential: credentialConfig, scopes: [scope], actorId: actor.id, actorRole: actor.role, correlationId });
      if (!algorithm) throw new ProvisioningError('ALGORITHM_NOT_ALLOWED', 'Sin algoritmo');
      privateKey = resolvePrivateKey(credentialConfig, this.deps.secretResolver);
    } catch (error) {
      const code = error instanceof ProvisioningError && CODE_RE.test(error.code) ? error.code : 'CLIENT_ERROR';
      return { ...empty, result: 'REJECTED', errorCode: code, attempts: 0 };
    }

    const text = JSON.stringify(body);
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
        const code = error instanceof ProvisioningError && CODE_RE.test(error.code) ? error.code : 'CLIENT_ERROR';
        return { ...empty, result: 'REJECTED', errorCode: code, attempts };
      }

      last = await this.once(url, token, deployment.timeout_ms, text, body);
      if (last.status !== null && last.status >= 300 && last.status < 400) {
        return { ...empty, result: 'REJECTED', httpStatus: last.status, errorCode: 'REDIRECT_BLOCKED', attempts };
      }
      const decision = decideRetry({ attempt, maxAttempts, status: last.status, networkFailure: last.networkFailure });
      if ((last.status !== null && last.status < 300) || !decision.retry) break;
      await (this.deps.sleep ?? defaultSleep)(decision.delayMs);
    }

    if (last.networkFailure) {
      return {
        ...empty,
        result: last.networkFailure === 'ABORT' ? 'REJECTED' : 'RETRYABLE',
        errorCode: last.networkFailure === 'TIMEOUT' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE',
        attempts,
      };
    }
    return { ...classifyLifecycleResponse(last.status ?? 0, last.body, body), attempts };
  }

  private async once(url: URL, token: string, timeoutMs: number, text: string, body: LifecycleBody): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
    try {
      const response = await (this.deps.fetchImpl ?? fetch)(url.toString(), {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          'content-type': 'application/json',
          'idempotency-key': body.idempotencyKey,
          'x-correlation-id': body.correlationId,
          'x-masteradmin-contract': LIFECYCLE_CONTRACT,
        },
        body: text,
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
