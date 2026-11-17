/**
 * Cliente M2M del contrato trial.v1 (docs/platform-provisioning/TRIAL_CONTRACT.md).
 *
 * Mismo transporte que lifecycle.v1 —url-guard (SSRF), retry, m2m (claims +
 * firma asimétrica)— usado tal cual. Lo propio de este contrato:
 *
 *   · scope `trial_write_scope` de la integración (en eChange,
 *     `echange:lifecycle:write`), nunca los de alta ni los de entitlements;
 *   · un token NUEVO por intento (los receptores registran el `jti`);
 *   · el cuerpo es declarativo y sin versión: «la prueba vence en X» o, con
 *     `endsAt: null`, «ya no vence» (convertida). Repetirlo no cambia nada;
 *   · un 200 solo cuenta si confirma lo enviado (mismo tenant y mismo endsAt);
 *   · un PUT no sigue redirecciones.
 *
 * No escribe en la base de nadie: devuelve un resultado clasificado que
 * registra `record_trial_delivery_result`.
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

export const TRIAL_CONTRACT = 'trial.v1';

export type TrialReason = 'STARTED' | 'EXTENDED' | 'CONVERTED' | 'MANUAL';
export type TrialState = 'TRIAL' | 'EXPIRED' | 'CONVERTED';
export type TrialResult = 'APPLIED' | 'RETRYABLE' | 'REJECTED' | 'NOT_CONFIGURED';

/** Lo que devuelve `platform.trial_delivery_context`. */
export interface TrialDeliveryContext {
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
    trial_path: string | null;
    trial_write_scope: string | null;
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

export interface TrialDesired {
  /** Fecha tal cual la entrega la base (timestamptz) o null = convertida. */
  endsAt: string | null;
  reason: TrialReason;
}

export interface TrialBody {
  contractVersion: typeof TRIAL_CONTRACT;
  productCode: string;
  controlPlaneTenantId: string;
  endsAt: string | null;
  reason: TrialReason;
}

export interface TrialOutcome {
  result: TrialResult;
  httpStatus: number | null;
  errorCode: string | null;
  state: TrialState | null;
  attempts: number;
}

export interface TrialClientDeps {
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
const STATES: TrialState[] = ['TRIAL', 'EXPIRED', 'CONVERTED'];

/**
 * ISO-8601 UTC sin milisegundos (`2026-11-24T15:04:05Z`), la misma forma que
 * `platform.trial_iso_utc` pone en el payload de provisioning.
 */
export function toTrialIso(value: string | null): string | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new ProvisioningError('INVALID_TRIAL', 'Fecha de vencimiento ilegible');
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Cuerpo exacto del PUT (contrato §3). Puro: lo fija la prueba. */
export function buildTrialBody(ctx: TrialDeliveryContext, desired: TrialDesired): TrialBody {
  return {
    contractVersion: TRIAL_CONTRACT,
    productCode: ctx.tenant.productCode,
    controlPlaneTenantId: ctx.tenant.controlPlaneTenantId,
    endsAt: desired.reason === 'CONVERTED' ? null : toTrialIso(desired.endsAt),
    reason: desired.reason,
  };
}

function sameInstant(a: unknown, b: string | null): boolean {
  if (b === null) return a === null;
  if (typeof a !== 'string') return false;
  const ms = Date.parse(a);
  return !Number.isNaN(ms) && Math.floor(ms / 1000) === Math.floor(Date.parse(b) / 1000);
}

/** Clasificación pura de la respuesta del PUT (contrato §4). */
export function classifyTrialResponse(
  status: number,
  body: unknown,
  sent: Pick<TrialBody, 'controlPlaneTenantId' | 'endsAt'>,
): Omit<TrialOutcome, 'attempts'> {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = b.error;
  const errorCode = typeof raw === 'string' && CODE_RE.test(raw) ? raw : null;
  const state = STATES.includes(b.state as TrialState) ? (b.state as TrialState) : null;

  if (status >= 200 && status < 300) {
    const valid =
      b.controlPlaneTenantId === sent.controlPlaneTenantId && sameInstant(b.endsAt, sent.endsAt) && state !== null;
    if (!valid) {
      // Un 2xx que no confirma lo enviado no es una confirmación.
      return { result: 'REJECTED', httpStatus: status, errorCode: 'RESPONSE_INVALID', state: null };
    }
    return { result: 'APPLIED', httpStatus: status, errorCode: null, state };
  }
  const retryable = decideRetry({ attempt: 1, maxAttempts: 2, status }).retry;
  return {
    result: retryable ? 'RETRYABLE' : 'REJECTED',
    httpStatus: status,
    errorCode: errorCode ?? `HTTP_${status}`,
    state,
  };
}

interface Attempt {
  status: number | null;
  body: unknown;
  networkFailure: NetworkFailureKind | null;
}

export class TrialClient {
  constructor(private readonly deps: TrialClientDeps) {}

  async putTrial(ctx: TrialDeliveryContext, desired: TrialDesired, actor: Actor): Promise<TrialOutcome> {
    const empty = { httpStatus: null, state: null };
    const notConfigured = (errorCode: string): TrialOutcome => ({
      ...empty,
      result: 'NOT_CONFIGURED',
      errorCode,
      attempts: 0,
    });
    const { deployment, integration, credential } = ctx;

    if (!deployment || !integration || integration.type !== 'HTTP_M2M' || !integration.trial_path || !integration.trial_write_scope) {
      return notConfigured('TRIAL_NOT_CONFIGURED');
    }
    if (!credential || credential.type !== 'M2M_ASYMMETRIC_JWT' || !credential.enabled) {
      return notConfigured('CREDENTIAL_NOT_USABLE');
    }

    const correlationId = (this.deps.uuid ?? (() => crypto.randomUUID()))();
    const scope = integration.trial_write_scope;
    const integrationConfig: IntegrationConfig = {
      id: integration.id,
      code: 'trial',
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
      code: 'trial',
      type: credential.type,
      enabled: credential.enabled,
      algorithm: credential.algorithm,
      token_ttl_seconds: credential.token_ttl_seconds,
      secret_ref: credential.secret_ref,
      public_key_ref: null,
    };
    const algorithm = credential.algorithm ?? integration.algorithm;

    let body: TrialBody;
    let url: URL;
    let privateKey: string;
    try {
      body = buildTrialBody(ctx, desired);
      // SSRF primero: sin destino válido no se resuelve ningún secreto.
      url = buildProvisioningUrl(
        deployment.base_url ?? '',
        integration.trial_path,
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

      last = await this.once(url, token, deployment.timeout_ms, text, correlationId);
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
    return { ...classifyTrialResponse(last.status ?? 0, last.body, body), attempts };
  }

  private async once(url: URL, token: string, timeoutMs: number, text: string, correlationId: string): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
    try {
      const response = await (this.deps.fetchImpl ?? fetch)(url.toString(), {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          'content-type': 'application/json',
          'x-correlation-id': correlationId,
          'x-masteradmin-contract': TRIAL_CONTRACT,
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
