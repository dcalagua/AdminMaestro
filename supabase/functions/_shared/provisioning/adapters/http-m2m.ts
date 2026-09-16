/**
 * Adaptador HTTP_M2M — GENÉRICO.
 *
 * No menciona EWM, ni TMS, ni ningún producto: todo lo que varía entre
 * productos (host, ruta, issuer, audience, scopes, algoritmo, TTL, timeout,
 * reintentos) es CONFIGURACIÓN que llega en el contexto. Cuando el contrato de
 * EWM se confirme, EWM se conecta rellenando una fila desde la consola. Si
 * algún día un producto necesitara semántica realmente distinta, entonces —y
 * sólo entonces— se escribiría un adaptador específico.
 */
import type {
  AdapterOutcome,
  ProvisioningAdapter,
  ProvisioningContext,
  SecretResolver,
} from '../types.ts';
import { ProvisioningError } from '../types.ts';
import { buildProvisioningUrl, assertSafeRedirect } from '../url-guard.ts';
import { buildM2mClaims, resolvePrivateKey, scopesFor, signM2mToken } from '../m2m.ts';
import { decideRetry, type NetworkFailureKind } from '../retry.ts';
import { normalizeProviderFailure, normalizeThrownFailure } from '../errors.ts';
import { parseProvisioningResponse } from '../response.ts';

/** Número máximo de saltos que se sigue, cada uno revalidado. */
const MAX_REDIRECTS = 3;

export interface HttpAdapterDeps {
  fetchImpl?: typeof fetch;
  secretResolver: SecretResolver;
  /** Inyectable para que las pruebas no esperen de verdad. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

interface AttemptOutcome {
  status: number | null;
  body: unknown;
  networkFailure: NetworkFailureKind | null;
}

export class HttpM2mAdapter implements ProvisioningAdapter {
  readonly type = 'HTTP_M2M' as const;

  constructor(private readonly deps: HttpAdapterDeps) {}

  provision(context: ProvisioningContext): Promise<AdapterOutcome> {
    return this.call(context, 'create');
  }

  getStatus(context: ProvisioningContext): Promise<AdapterOutcome> {
    return this.call(context, 'read');
  }

  private async call(
    context: ProvisioningContext,
    operation: 'create' | 'read',
  ): Promise<AdapterOutcome> {
    const { deployment, integration, credential, request } = context;
    let attempts = 0;

    try {
      if (!deployment || !integration || !credential) {
        throw new ProvisioningError(
          'INTEGRATION_NOT_CONFIGURED',
          'Falta destino, integración o perfil de credencial',
        );
      }

      const template =
        operation === 'create'
          ? integration.create_path_template
          : integration.status_path_template;

      if (!template) {
        throw new ProvisioningError(
          'PATH_TEMPLATE_INVALID',
          `La integración no declara plantilla de ruta para la operación "${operation}"`,
        );
      }

      const guard = {
        environment: deployment.environment,
        allowedHosts: integration.allowed_hosts,
      };

      // Validación SSRF antes de nada. Si la URL no es admisible, no se firma
      // ni un token: no tiene sentido emitir una credencial para un destino al
      // que no se va a llamar.
      const url = buildProvisioningUrl(
        deployment.base_url ?? '',
        template,
        { externalTenantId: request.id, tenantCode: context.payload.tenantCode },
        guard,
      );

      const claims = buildM2mClaims({
        integration,
        credential,
        scopes: scopesFor(integration, operation),
        actorId: context.actor.id,
        actorRole: context.actor.role,
        correlationId: request.correlation_id,
        now: this.deps.now?.(),
      });

      const algorithm = credential.algorithm ?? integration.algorithm;
      if (!algorithm) {
        throw new ProvisioningError('ALGORITHM_NOT_ALLOWED', 'No hay algoritmo configurado');
      }

      const token = await signM2mToken(
        claims,
        algorithm,
        resolvePrivateKey(credential, this.deps.secretResolver),
      );

      const maxAttempts = Math.max(1, (deployment.retry_count ?? 0) + 1);
      let last: AttemptOutcome = { status: null, body: null, networkFailure: null };

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        attempts = attempt;
        last = await this.attempt(url, token, context, operation, guard);

        if (last.status !== null && last.status >= 200 && last.status < 300) {
          return { ok: true, result: parseProvisioningResponse(last.body), attempts };
        }

        const decision = decideRetry({
          attempt,
          maxAttempts,
          status: last.status,
          networkFailure: last.networkFailure,
        });

        if (!decision.retry) break;
        await (this.deps.sleep ?? defaultSleep)(decision.delayMs);
      }

      if (last.networkFailure) {
        return {
          ok: false,
          attempts,
          failure: {
            code: last.networkFailure === 'TIMEOUT' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE',
            message:
              last.networkFailure === 'TIMEOUT'
                ? `El producto no respondió en ${deployment.timeout_ms} ms`
                : 'No se pudo establecer la conexión con el producto',
            httpStatus: null,
            retryable: true,
            detail: { network_failure: last.networkFailure },
          },
        };
      }

      return {
        ok: false,
        attempts,
        failure: normalizeProviderFailure({
          status: last.status ?? 0,
          body: last.body,
          retryable:
            decideRetry({ attempt: 1, maxAttempts: 2, status: last.status ?? 0 }).retry,
        }),
      };
    } catch (error) {
      return { ok: false, attempts: Math.max(attempts, 1), failure: normalizeThrownFailure(error) };
    }
  }

  private async attempt(
    startUrl: URL,
    token: string,
    context: ProvisioningContext,
    operation: 'create' | 'read',
    guard: { environment: ProvisioningContext['request']['environment']; allowedHosts: string[] },
  ): Promise<AttemptOutcome> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const { deployment, request, integration } = context;
    const timeout = deployment?.timeout_ms ?? 15000;

    let url = startUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          method: operation === 'create' ? 'POST' : 'GET',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json',
            // Correlación: el mismo identificador cruza los logs de MasterAdmin
            // y los del producto, que es lo que hace diagnosticable un incidente.
            'x-correlation-id': request.correlation_id,
            // Idempotencia: LA MISMA clave en todos los reintentos. Es lo que
            // permite al SaaS reconocer que se trata del mismo intento.
            'idempotency-key': request.idempotency_key,
            'x-masteradmin-contract': integration?.contract_version ?? 'v1',
          },
          body: operation === 'create' ? JSON.stringify(context.payload) : undefined,
          // `fetch` sigue redirecciones por defecto, y eso anularía todo el
          // guard SSRF: bastaría un 302 hacia 169.254.169.254. Se siguen a
          // mano, revalidando cada salto.
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        const aborted = error instanceof Error && error.name === 'AbortError';
        return { status: null, body: null, networkFailure: aborted ? 'TIMEOUT' : 'NETWORK' };
      }
      clearTimeout(timer);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return { status: response.status, body: null, networkFailure: null };
        }
        if (hop === MAX_REDIRECTS) {
          throw new ProvisioningError('REDIRECT_BLOCKED', 'Demasiadas redirecciones');
        }
        url = assertSafeRedirect(location, url, guard);
        continue;
      }

      return { status: response.status, body: await readJson(response), networkFailure: null };
    }

    throw new ProvisioningError('REDIRECT_BLOCKED', 'Demasiadas redirecciones');
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (text.trim() === '') return null;
    return JSON.parse(text) as unknown;
  } catch {
    // Un cuerpo que no es JSON no se propaga como texto: sería la vía directa
    // para que una página de error de un proxy acabara en la consola.
    return null;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
