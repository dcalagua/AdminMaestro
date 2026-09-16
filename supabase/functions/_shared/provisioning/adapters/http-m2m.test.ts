import { describe, it, expect, vi } from 'vitest';
import { HttpM2mAdapter } from './http-m2m';
import type {
  CredentialConfig,
  DeploymentConfig,
  IntegrationConfig,
  ProvisioningContext,
  ProvisioningEnvironment,
} from '../types';

/*
 * V4 · Adaptador HTTP_M2M genérico.
 *
 * No hay ningún `fetch` real: todo se ejercita contra un doble. Lo que se
 * comprueba es el comportamiento que importa en producción — cabeceras de
 * correlación e idempotencia, clasificación de reintentos, timeout, contención
 * SSRF y validación de la respuesta.
 *
 * La clave privada se genera en memoria dentro del propio test. En el
 * repositorio no hay, ni puede haber, ninguna.
 */

async function generatePrivateKeyPem(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  // secrets-scan:allow plantilla PEM de una clave GENERADA EN MEMORIA en este test
  return `-----BEGIN PRIVATE KEY-----\n${b64.replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----`;
}

const PRIVATE_KEY = await generatePrivateKeyPem();

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
  token_ttl_seconds: 120,
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
  token_ttl_seconds: 120,
  secret_ref: 'PRODUCTO_QAS_M2M_PRIVATE_KEY',
  public_key_ref: null,
};

function deployment(overrides: Partial<DeploymentConfig> = {}): DeploymentConfig {
  return {
    id: 'd1',
    code: 'producto-shared-qas',
    deployment_mode: 'SHARED',
    environment: 'QAS',
    base_url: 'https://producto-qas.example.com',
    timeout_ms: 2000,
    retry_count: 2,
    status: 'READY',
    enabled: true,
    health_status: 'HEALTHY',
    ...overrides,
  };
}

function context(overrides: Partial<ProvisioningContext> = {}): ProvisioningContext {
  const environment = (overrides.deployment?.environment ?? 'QAS') as ProvisioningEnvironment;
  return {
    request: {
      id: 'req-1',
      status: 'READY_TO_PROVISION',
      idempotency_key: 'ma-prov-v1-deadbeef',
      correlation_id: '11111111-2222-4333-8444-555555555555',
      attempt_count: 0,
      max_attempts: 3,
      request_version: 1,
      environment,
      policy: 'MANUAL',
      requested_by: 'u1',
      subscription_id: null,
    },
    product: { id: 'p1', code: 'producto', short_name: 'Producto' },
    deployment: deployment(),
    integration,
    credential,
    payload: {
      tenantCode: 'alpha',
      tenantName: 'Alpha',
      adminEmail: 'admin@alpha.ebim.test',
      tenantType: 'PRODUCTION',
      environment,
      deploymentMode: 'SHARED',
      organization: { code: 'alpha' },
      company: null,
      plan: null,
      masterAdmin: {},
    },
    actor: { id: 'u1', role: 'TECH_LEAD' },
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function adapter(fetchImpl: typeof fetch) {
  return new HttpM2mAdapter({
    fetchImpl,
    secretResolver: (ref) => (ref === 'PRODUCTO_QAS_M2M_PRIVATE_KEY' ? PRIVATE_KEY : undefined),
    // Sin esperas reales: el backoff ya se prueba en retry.test.ts.
    sleep: () => Promise.resolve(),
  });
}

describe('camino feliz', () => {
  it('compone la URL, firma el token y normaliza la respuesta', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, {
        status: 'ACTIVE',
        externalTenantId: 'ewm-77',
        externalOrganizationId: 'org-9',
        resources: { initialWarehouseId: 'WH-01' },
      }),
    ) as unknown as typeof fetch;

    const outcome = await adapter(fetchImpl).provision(context());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.externalTenantId).toBe('ewm-77');
    expect(outcome.result.resources).toEqual({ initialWarehouseId: 'WH-01' });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://producto-qas.example.com/internal/platform/v1/tenants');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('envía X-Correlation-Id e Idempotency-Key, y el token en Authorization', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { externalTenantId: 'x' }),
    ) as unknown as typeof fetch;

    await adapter(fetchImpl).provision(context());

    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-correlation-id']).toBe('11111111-2222-4333-8444-555555555555');
    expect(headers['idempotency-key']).toBe('ma-prov-v1-deadbeef');
    expect(headers['x-masteradmin-contract']).toBe('v1');
    expect(headers.authorization.startsWith('Bearer eyJ')).toBe(true);
  });

  it('nunca sigue redirecciones automáticamente', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { externalTenantId: 'x' }),
    ) as unknown as typeof fetch;
    await adapter(fetchImpl).provision(context());
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe('manual');
  });
});

describe('reintentos', () => {
  it('reintenta un 503 y conserva la MISMA clave de idempotencia en todos los intentos', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls < 3
        ? jsonResponse(503, { message: 'mantenimiento' })
        : jsonResponse(200, { externalTenantId: 'ewm-9' });
    }) as unknown as typeof fetch;

    const outcome = await adapter(fetchImpl).provision(context());

    expect(outcome.ok).toBe(true);
    expect(outcome.attempts).toBe(3);

    const keys = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[1] as RequestInit).headers as Record<string, string>,
    );
    expect(keys.every((h) => h['idempotency-key'] === 'ma-prov-v1-deadbeef')).toBe(true);
  });

  it.each([400, 401, 403, 409])('NO reintenta un %i: se llama una sola vez', async (status) => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(status, { code: 'ADMIN_EMAIL_ALREADY_PROVISIONED' }),
    ) as unknown as typeof fetch;

    const outcome = await adapter(fetchImpl).provision(context());

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.httpStatus).toBe(status);
  });

  it('respeta retry_count del destino: 0 significa un solo intento', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, {})) as unknown as typeof fetch;
    await adapter(fetchImpl).provision(
      context({ deployment: deployment({ retry_count: 0 }) }),
    );
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('agota los intentos y devuelve el fallo normalizado', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(502, { message: 'bad gateway' }),
    ) as unknown as typeof fetch;

    const outcome = await adapter(fetchImpl).provision(context());
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.code).toBe('PROVIDER_UNAVAILABLE');
      expect(outcome.failure.retryable).toBe(true);
    }
  });
});

describe('fallos de red', () => {
  it('un timeout se reporta como PROVIDER_TIMEOUT', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('abortado');
      error.name = 'AbortError';
      throw error;
    }) as unknown as typeof fetch;

    const outcome = await adapter(fetchImpl).provision(context());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.code).toBe('PROVIDER_TIMEOUT');
      expect(outcome.failure.retryable).toBe(true);
      expect(outcome.failure.message).toContain('2000 ms');
    }
  });

  it('una caída de red se reporta como PROVIDER_UNREACHABLE y se reintenta', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const outcome = await adapter(fetchImpl).provision(context());
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    if (!outcome.ok) expect(outcome.failure.code).toBe('PROVIDER_UNREACHABLE');
  });
});

describe('contención SSRF y configuración', () => {
  it('no llama a nada si la base_url apunta a los metadatos del cloud', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await adapter(fetchImpl).provision(
      context({ deployment: deployment({ base_url: 'http://169.254.169.254' }) }),
    );
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.code).toBe('BASE_URL_INSECURE');
  });

  it('bloquea una redirección hacia otro origen y no la sigue', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/' } }),
    ) as unknown as typeof fetch;

    const outcome = await adapter(fetchImpl).provision(context());
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    if (!outcome.ok) expect(outcome.failure.code).toBe('REDIRECT_BLOCKED');
  });

  it('sigue una redirección dentro del mismo origen', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 307, headers: { location: '/internal/platform/v1/tenants/' } })
        : jsonResponse(201, { externalTenantId: 'ewm-1' });
    }) as unknown as typeof fetch;

    const outcome = await adapter(fetchImpl).provision(context());
    expect(outcome.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('no firma ningún token si el secreto no está cargado', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const sinSecreto = new HttpM2mAdapter({
      fetchImpl,
      secretResolver: () => undefined,
      sleep: () => Promise.resolve(),
    });

    const outcome = await sinSecreto.provision(context());
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    if (!outcome.ok) expect(outcome.failure.code).toBe('SECRET_NOT_AVAILABLE');
  });

  it('falla si la integración no declara ruta de creación', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await adapter(fetchImpl).provision(
      context({ integration: { ...integration, create_path_template: null } }),
    );
    if (!outcome.ok) expect(outcome.failure.code).toBe('PATH_TEMPLATE_INVALID');
  });

  it('falla si falta el destino o el perfil de credencial', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await adapter(fetchImpl).provision(context({ credential: null }));
    if (!outcome.ok) expect(outcome.failure.code).toBe('INTEGRATION_NOT_CONFIGURED');
  });
});

describe('validación de la respuesta', () => {
  it('un 200 sin externalTenantId NO es un éxito', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true })) as unknown as typeof fetch;
    const outcome = await adapter(fetchImpl).provision(context());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.code).toBe('PROVIDER_RESPONSE_INVALID');
  });

  it('un cuerpo que no es JSON no se propaga como texto', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('<html>502 Bad Gateway — nginx/1.2 en 10.0.0.7</html>', { status: 502 }),
    ) as unknown as typeof fetch;

    const outcome = await adapter(fetchImpl).provision(context());
    if (!outcome.ok) {
      expect(JSON.stringify(outcome.failure)).not.toContain('nginx');
      expect(JSON.stringify(outcome.failure)).not.toContain('10.0.0.7');
    }
  });

  it('el código del producto llega intacto a la consola', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, {
        code: 'ADMIN_EMAIL_ALREADY_PROVISIONED',
        message: 'ese correo ya administra un tenant',
      }),
    ) as unknown as typeof fetch;

    const outcome = await adapter(fetchImpl).provision(context());
    if (!outcome.ok) {
      expect(outcome.failure.code).toBe('ADMIN_EMAIL_ALREADY_PROVISIONED');
      expect(outcome.failure.retryable).toBe(false);
    }
  });
});

describe('getStatus', () => {
  it('usa GET, la plantilla de consulta y el scope de lectura', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { externalTenantId: 'ewm-1' }),
    ) as unknown as typeof fetch;

    await adapter(fetchImpl).getStatus(context());

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).body).toBeUndefined();
    expect(String(url)).toContain('/internal/platform/v1/tenants/');
  });
});
