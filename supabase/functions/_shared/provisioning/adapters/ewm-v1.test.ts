import { describe, it, expect, vi } from 'vitest';
import { EWM_V1_CODEC, buildEwmCreateBody, validateEwmProductConfiguration } from './ewm-v1';
import { HttpM2mAdapter } from './http-m2m';
import { GENERIC_CODEC } from './generic';
import { sha256Hex } from '../fingerprint';
import type { ProvisioningContext } from '../types';

/*
 * Codec EWM_V1.
 *
 * El contrato de referencia es `WMS-by-EBIM@origin/qas`
 * (`docs/platform-provisioning/API_CONTRACT.md`, commit 7e45d70). Estas pruebas
 * fijan el cuerpo EXACTO que MasterAdmin envía, porque EWM responde
 * `409 IDEMPOTENCY_CONFLICT` si la misma clave llega con otro contenido: el
 * cuerpo de un reintento tiene que ser byte a byte el del primer envío.
 */

const TENANT_ID = '50000000-0000-4000-a000-000000000008';
const ORG_ID = '30000000-0000-4000-a000-000000000004';
const COMPANY_ID = '31000000-0000-4000-a000-000000000001';

function pc(): Record<string, unknown> {
  return {
    organizationTimezone: 'America/Lima',
    initialWarehouse: { code: 'cd01', name: 'Almacén principal', timezone: 'America/Lima' },
    admin: { fullName: 'Administrador Cliente' },
    resolvedCurrency: 'PEN',
  };
}

function ewmContext(productConfiguration: Record<string, unknown> = pc()): ProvisioningContext {
  return {
    request: {
      id: '9a000000-0000-4000-a000-000000000002',
      status: 'READY_TO_PROVISION',
      idempotency_key: 'ma-prov-v1-ewm',
      correlation_id: '11111111-2222-4333-8444-555555555555',
      attempt_count: 0,
      max_attempts: 3,
      request_version: 1,
      environment: 'QAS',
      policy: 'MANUAL',
      requested_by: 'u1',
      subscription_id: null,
    },
    product: { id: '20000000-0000-4000-a000-000000000002', code: 'ewm', short_name: 'EWM' },
    deployment: {
      id: 'd1',
      code: 'ewm-shared-qas',
      deployment_mode: 'SHARED',
      environment: 'QAS',
      base_url: 'https://ewm-rsxs.onrender.com',
      timeout_ms: 30000,
      retry_count: 2,
      status: 'READY',
      enabled: true,
      health_status: 'HEALTHY',
    },
    integration: {
      id: 'i1',
      code: 'ewm-provisioning-v1',
      type: 'HTTP_M2M',
      contract_version: 'v1',
      status: 'READY',
      enabled: true,
      issuer: 'masteradmin.ebim',
      audience: 'ewm.ebim',
      subject: 'masteradmin-provisioning',
      algorithm: 'ES256',
      token_ttl_seconds: 300,
      create_scope: 'ewm:tenant:create',
      read_scope: 'ewm:tenant:read',
      additional_scopes: [],
      create_path_template: '/internal/platform/v1/tenants',
      status_path_template: '/internal/platform/v1/tenants/{controlPlaneTenantId}',
      health_path_template: '/actuator/health',
      allowed_hosts: ['ewm-rsxs.onrender.com'],
    },
    credential: {
      id: 'c1',
      code: 'ewm-qas-m2m',
      type: 'M2M_ASYMMETRIC_JWT',
      enabled: true,
      algorithm: 'ES256',
      token_ttl_seconds: 300,
      secret_ref: 'EWM_QAS_M2M_PRIVATE_KEY',
      public_key_ref: null,
    },
    payload: {
      tenantCode: 'alpha-ewm',
      tenantName: 'Alpha · EWM',
      adminEmail: 'admin@alpha.ebim.test',
      tenantType: 'PRODUCTION',
      environment: 'QAS',
      deploymentMode: 'SHARED',
      organization: {},
      company: null,
      plan: null,
      masterAdmin: { tenantId: TENANT_ID },
    },
    actor: { id: 'u1', role: 'TECH_LEAD' },
    source: {
      tenant: {
        id: TENANT_ID,
        slug: 'alpha-ewm',
        name: 'Alpha · EWM',
        admin_email: 'Admin@Alpha.ebim.test',
        deployment_mode: 'SHARED',
      },
      organization: {
        id: ORG_ID,
        slug: 'empresa-directa-alpha',
        legal_name: 'Alpha S.A.C.',
        display_name: 'Alpha',
        country_code: 'PE',
        tax_id: '20500000004',
      },
      company: {
        id: COMPANY_ID,
        name: 'Alpha',
        erp_code: 'alpha-01',
        country_code: 'PE',
        currency: 'PEN',
        tax_id: '20500000004',
      },
      mapping: null,
      product_configuration: productConfiguration,
    },
    adapter: { key: 'EWM_V1', capabilities: ['PROVISION', 'GET_STATUS', 'REPLAY_CERTIFICATION'] },
  };
}

/** Texto EXACTO del cuerpo EWM para `ewmContext()`: es la base de la huella. */
const EWM_BODY_LITERAL =
  '{"controlPlaneTenantId":"50000000-0000-4000-a000-000000000008",' +
  '"organization":{"id":"30000000-0000-4000-a000-000000000004","slug":"empresa-directa-alpha","name":"Alpha",' +
  '"legalName":"Alpha S.A.C.","taxId":"20500000004","countryCode":"PE","currency":"PEN","timezone":"America/Lima"},' +
  '"company":{"id":"31000000-0000-4000-a000-000000000001","name":"Alpha","legalName":null,"taxId":"20500000004",' +
  '"erpCode":"ALPHA-01","countryCode":"PE","currency":"PEN"},' +
  '"initialWarehouse":{"code":"CD01","erpCode":null,"name":"Almacén principal","address":null,' +
  '"timezone":"America/Lima","is3pl":false},' +
  '"admin":{"email":"admin@alpha.ebim.test","fullName":"Administrador Cliente"},' +
  '"deploymentMode":"SHARED"}';

function withPc(patch: (c: Record<string, unknown>) => void): ProvisioningContext {
  const c = pc();
  patch(c);
  return ewmContext(c);
}

describe('EWM_V1 · cuerpo de creación', () => {
  it('cuerpo exacto del contrato §2', () => {
    expect(EWM_V1_CODEC.buildCreateBody(ewmContext())).toEqual({
      controlPlaneTenantId: TENANT_ID,
      organization: {
        id: ORG_ID,
        slug: 'empresa-directa-alpha',
        name: 'Alpha',
        legalName: 'Alpha S.A.C.',
        taxId: '20500000004',
        countryCode: 'PE',
        currency: 'PEN',
        timezone: 'America/Lima',
      },
      company: {
        id: COMPANY_ID,
        name: 'Alpha',
        legalName: null,
        taxId: '20500000004',
        erpCode: 'ALPHA-01',
        countryCode: 'PE',
        currency: 'PEN',
      },
      initialWarehouse: {
        code: 'CD01',
        erpCode: null,
        name: 'Almacén principal',
        address: null,
        timezone: 'America/Lima',
        is3pl: false,
      },
      admin: { email: 'admin@alpha.ebim.test', fullName: 'Administrador Cliente' },
      deploymentMode: 'SHARED',
    });
  });

  it('orden de claves estable: el texto serializado es un literal', () => {
    expect(JSON.stringify(buildEwmCreateBody(ewmContext()))).toBe(EWM_BODY_LITERAL);
  });

  it('la moneda sale de resolvedCurrency para organización y sociedad', () => {
    const body = buildEwmCreateBody(withPc((c) => (c.resolvedCurrency = 'USD')));
    expect(body.organization.currency).toBe('USD');
    expect(body.company.currency).toBe('USD');
  });

  it('opcionales del almacén se envían cuando existen', () => {
    const body = buildEwmCreateBody(
      withPc((c) => {
        c.initialWarehouse = {
          code: 'WH-001',
          name: 'Almacén Principal',
          timezone: 'America/Bogota',
          erpCode: 'W01',
          address: 'Av. Siempre Viva 123',
          is3pl: true,
        };
      }),
    );
    expect(body.initialWarehouse).toEqual({
      code: 'WH-001',
      erpCode: 'W01',
      name: 'Almacén Principal',
      address: 'Av. Siempre Viva 123',
      timezone: 'America/Bogota',
      is3pl: true,
    });
  });

  it('buildCreateBody falla cerrado si la configuración no es válida', () => {
    expect(() => EWM_V1_CODEC.buildCreateBody(ewmContext({}))).toThrow();
  });
});

describe('EWM_V1 · validación previa a firmar', () => {
  const cases: Array<[string, () => ProvisioningContext, string[]]> = [
    ['source ausente', () => ({ ...ewmContext(), source: undefined }), ['SOURCE_MISSING']],
    [
      'sociedad nula',
      () => {
        const c = ewmContext();
        c.source!.company = null;
        return c;
      },
      ['COMPANY_REQUIRED'],
    ],
    [
      'slug de 41 caracteres',
      () => {
        const c = ewmContext();
        c.source!.organization.slug = 'a'.repeat(41);
        return c;
      },
      ['ORGANIZATION_SLUG_INCOMPATIBLE'],
    ],
    ['configuración vacía', () => ewmContext({}), ['PRODUCT_CONFIGURATION_MISSING']],
    ['clave extra en la raíz', () => withPc((c) => (c.script = 'x')), ['PRODUCT_CONFIGURATION_UNKNOWN_KEY']],
    [
      'clave extra en el almacén',
      () => withPc((c) => ((c.initialWarehouse as Record<string, unknown>).foo = 1)),
      ['PRODUCT_CONFIGURATION_UNKNOWN_KEY'],
    ],
    [
      'código con espacio',
      () => withPc((c) => ((c.initialWarehouse as Record<string, unknown>).code = 'WH 001')),
      ['INITIAL_WAREHOUSE_CODE_INVALID'],
    ],
    [
      'código que empieza por guion',
      () => withPc((c) => ((c.initialWarehouse as Record<string, unknown>).code = '-WH')),
      ['INITIAL_WAREHOUSE_CODE_INVALID'],
    ],
    [
      'código de 33 caracteres',
      () => withPc((c) => ((c.initialWarehouse as Record<string, unknown>).code = 'W'.repeat(33))),
      ['INITIAL_WAREHOUSE_CODE_INVALID'],
    ],
    [
      'nombre de almacén vacío',
      () => withPc((c) => ((c.initialWarehouse as Record<string, unknown>).name = '')),
      ['INITIAL_WAREHOUSE_NAME_INVALID'],
    ],
    [
      'nombre de almacén de 201 caracteres',
      () => withPc((c) => ((c.initialWarehouse as Record<string, unknown>).name = 'n'.repeat(201))),
      ['INITIAL_WAREHOUSE_NAME_INVALID'],
    ],
    ['zona de organización inexistente', () => withPc((c) => (c.organizationTimezone = 'Mars/Base')), ['TIMEZONE_INVALID']],
    [
      'zona de almacén vacía',
      () => withPc((c) => ((c.initialWarehouse as Record<string, unknown>).timezone = '')),
      ['TIMEZONE_INVALID'],
    ],
    ['admin ausente', () => withPc((c) => delete c.admin), ['ADMIN_FULL_NAME_REQUIRED']],
    ['fullName en blanco', () => withPc((c) => (c.admin = { fullName: '  ' })), ['ADMIN_FULL_NAME_REQUIRED']],
    ['resolvedCurrency ausente', () => withPc((c) => delete c.resolvedCurrency), ['CURRENCY_SNAPSHOT_MISSING']],
    ['resolvedCurrency inválida', () => withPc((c) => (c.resolvedCurrency = 'pen')), ['CURRENCY_SNAPSHOT_MISSING']],
    [
      'valor con esquema URL',
      () => withPc((c) => ((c.initialWarehouse as Record<string, unknown>).address = 'https://evil.example')),
      ['PRODUCT_CONFIGURATION_VALUE_NOT_ALLOWED'],
    ],
    [
      'valor con ${',
      () => withPc((c) => (c.admin = { fullName: '${jndi:ldap}' })),
      ['PRODUCT_CONFIGURATION_VALUE_NOT_ALLOWED'],
    ],
    [
      'valor con {{',
      () => withPc((c) => ((c.initialWarehouse as Record<string, unknown>).name = '{{7*7}}')),
      ['PRODUCT_CONFIGURATION_VALUE_NOT_ALLOWED'],
    ],
    [
      'is3pl como texto',
      () => withPc((c) => ((c.initialWarehouse as Record<string, unknown>).is3pl = 'true')),
      ['PRODUCT_CONFIGURATION_TYPE_INVALID'],
    ],
  ];

  it.each(cases)('%s', (_name, build, expected) => {
    expect(EWM_V1_CODEC.validateInput(build())).toEqual(expected);
  });

  it('una configuración válida no tiene bloqueos', () => {
    expect(EWM_V1_CODEC.validateInput(ewmContext())).toEqual([]);
  });

  it('varios problemas: lista ordenada y sin duplicados', () => {
    const c = withPc((x) => {
      x.organizationTimezone = 'Mars/Base';
      (x.initialWarehouse as Record<string, unknown>).timezone = 'Venus/Base';
      (x.initialWarehouse as Record<string, unknown>).code = 'WH 1';
      delete x.admin;
    });
    expect(EWM_V1_CODEC.validateInput(c)).toEqual([
      'ADMIN_FULL_NAME_REQUIRED',
      'INITIAL_WAREHOUSE_CODE_INVALID',
      'TIMEZONE_INVALID',
    ]);
  });

  it('validateEwmProductConfiguration rechaza un no-objeto', () => {
    expect(validateEwmProductConfiguration([] as unknown)).toEqual(['PRODUCT_CONFIGURATION_TYPE_INVALID']);
  });

  it('R2 · el adaptador bloquea sin fullName y no llama a fetch', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const adapter = new HttpM2mAdapter(
      { fetchImpl, secretResolver: () => undefined, sleep: () => Promise.resolve() },
      EWM_V1_CODEC,
    );
    expect(adapter.validateInput(withPc((c) => delete c.admin))).toEqual(['ADMIN_FULL_NAME_REQUIRED']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('EWM_V1 · R1, el cuerpo no deriva', () => {
  it('la moneda de source no cuenta: manda la congelada en resolvedCurrency', () => {
    const c = ewmContext();
    c.source!.company!.currency = 'USD';
    const body = buildEwmCreateBody(c);
    expect(body.organization.currency).toBe('PEN');
    expect(body.company.currency).toBe('PEN');
    expect(JSON.stringify(body)).toBe(EWM_BODY_LITERAL);
  });

  it('el cuerpo no cambia si cambia la cascada de config del tenant', () => {
    // `source` no trae zona horaria: el cuerpo sólo puede usar la congelada.
    const c = ewmContext();
    expect(Object.keys(c.source!)).not.toContain('locale');
    (c.source as unknown as Record<string, unknown>).locale = { timezone: 'America/Bogota' };
    expect(JSON.stringify(buildEwmCreateBody(c))).toBe(EWM_BODY_LITERAL);
  });
});

// ---------------------------------------------------------------------------
// Normalización de la respuesta (API_CONTRACT §2–§3)
// ---------------------------------------------------------------------------
const PROVISIONING_ID = '9a1e0000-0000-4000-a000-0000000000aa';
const WAREHOUSE_ID = 'c1d2e3f4-0000-4000-a000-0000000000bb';
const ADMIN_USER_ID = '77aa0000-0000-4000-a000-0000000000cc';

function ewmResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provisioningId: PROVISIONING_ID,
    status: 'ACTIVE',
    replayed: false,
    controlPlaneTenantId: TENANT_ID,
    organizationId: ORG_ID,
    companyId: COMPANY_ID,
    initialWarehouseId: WAREHOUSE_ID,
    adminAppUserId: ADMIN_USER_ID,
    adminProvisioningStatus: 'PREPROVISIONED',
    deploymentMode: 'SHARED',
    createdAt: '2026-09-15T21:23:36.264Z',
    ...overrides,
  };
}

function invalidCode(body: unknown, operation: 'create' | 'read' = 'create'): string {
  try {
    EWM_V1_CODEC.parseResponse(body, operation, ewmContext());
  } catch (error) {
    return (error as { code?: string }).code ?? 'NO_CODE';
  }
  return 'NO_THROW';
}

describe('EWM_V1 · respuesta', () => {
  const EXPECTED = {
    status: 'ACTIVE',
    externalTenantId: COMPANY_ID,
    externalOrganizationId: ORG_ID,
    externalCompanyId: COMPANY_ID,
    resources: {
      initialWarehouseId: WAREHOUSE_ID,
      adminAppUserId: ADMIN_USER_ID,
      adminProvisioningStatus: 'PREPROVISIONED',
      deploymentMode: 'SHARED',
    },
    rawReference: PROVISIONING_ID,
  };

  it('201 completo → AdapterResult con externalTenantId = companyId', () => {
    expect(EWM_V1_CODEC.parseResponse(ewmResponse(), 'create', ewmContext())).toEqual({
      ...EXPECTED,
      replayed: false,
    });
  });

  it('200 replayed:true → mismo resultado con replayed:true', () => {
    expect(EWM_V1_CODEC.parseResponse(ewmResponse({ replayed: true }), 'create', ewmContext())).toEqual({
      ...EXPECTED,
      replayed: true,
    });
  });

  it('GET (read) exige igualmente replayed', () => {
    expect(EWM_V1_CODEC.parseResponse(ewmResponse(), 'read', ewmContext()).replayed).toBe(false);
    const { replayed: _r, ...sinReplayed } = ewmResponse();
    expect(invalidCode(sinReplayed, 'read')).toBe('PROVIDER_RESPONSE_INVALID');
  });

  it.each([
    ['sin companyId', { companyId: undefined }],
    ['sin organizationId', { organizationId: undefined }],
    ['sin provisioningId', { provisioningId: undefined }],
    ['sin replayed', { replayed: undefined }],
    ['replayed no booleano', { replayed: 'false' }],
    ['status PENDING', { status: 'PENDING' }],
    ['companyId no UUID', { companyId: 'no-uuid' }],
    ['controlPlaneTenantId distinto', { controlPlaneTenantId: '50000000-0000-4000-a000-0000000000ff' }],
    ['companyId distinto del enviado', { companyId: '31000000-0000-4000-a000-0000000000ff' }],
  ])('R5 · %s → PROVIDER_RESPONSE_INVALID', (_name, overrides) => {
    expect(invalidCode(ewmResponse(overrides))).toBe('PROVIDER_RESPONSE_INVALID');
  });

  it('R5 · cuerpo null (JSON inválido) → PROVIDER_RESPONSE_INVALID', () => {
    expect(invalidCode(null)).toBe('PROVIDER_RESPONSE_INVALID');
  });

  it('campos extra se toleran y no llegan a resources', () => {
    const result = EWM_V1_CODEC.parseResponse(ewmResponse({ foo: 'bar' }), 'create', ewmContext());
    expect(Object.keys(result.resources)).not.toContain('foo');
    expect(Object.keys(result.resources)).not.toContain('createdAt');
  });

  it('resources pasa por sanitizeResources: un valor de 600 caracteres se descarta', () => {
    const result = EWM_V1_CODEC.parseResponse(
      ewmResponse({ adminAppUserId: 'x'.repeat(600) }),
      'create',
      ewmContext(),
    );
    expect(result.resources).not.toHaveProperty('adminAppUserId');
  });
});

async function ecKeyPem(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  // secrets-scan:allow plantilla PEM de una clave GENERADA EN MEMORIA en este test
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`;
}
const EC_KEY = await ecKeyPem();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Call = { url: string; init: RequestInit };
function ewmAdapter(responses: Response[]) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('sin respuesta programada');
    return Promise.resolve(next);
  }) as unknown as typeof fetch;
  const adapter = new HttpM2mAdapter(
    {
      fetchImpl,
      secretResolver: (ref) => (ref === 'EWM_QAS_M2M_PRIVATE_KEY' ? EC_KEY : undefined),
      sleep: () => Promise.resolve(),
    },
    EWM_V1_CODEC,
  );
  return { adapter, calls };
}

describe('EWM_V1 · R5 recuperación sin duplicar', () => {
  it('201 inválido deja fallo y el reintento con la misma clave acepta 200 replayed:true', async () => {
    const { adapter, calls } = ewmAdapter([
      jsonResponse(201, ewmResponse({ companyId: undefined })),
      jsonResponse(200, ewmResponse({ replayed: true })),
    ]);
    const first = await adapter.provision(ewmContext());
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error('esperaba fallo');
    expect(first.failure.code).toBe('PROVIDER_RESPONSE_INVALID');

    const second = await adapter.provision(ewmContext());
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('esperaba éxito');
    expect(second.result.replayed).toBe(true);
    expect(second.httpStatus).toBe(200);

    expect(calls).toHaveLength(2);
    const key = (c: Call) => (c.init.headers as Record<string, string>)['idempotency-key'];
    expect(key(calls[0])).toBe('ma-prov-v1-ewm');
    expect(key(calls[1])).toBe(key(calls[0]));
    expect(calls[0].init.body).toBe(EWM_BODY_LITERAL);
    expect(calls[1].init.body).toBe(calls[0].init.body);
  });
});

describe('EWM_V1 · marcadores de ruta', () => {
  it('pathParams = { controlPlaneTenantId: source.tenant.id }', () => {
    expect(EWM_V1_CODEC.pathParams(ewmContext())).toEqual({ controlPlaneTenantId: TENANT_ID });
  });

  it('getStatus llama a GET /internal/platform/v1/tenants/{tenants.id}', async () => {
    const { adapter, calls } = ewmAdapter([jsonResponse(200, ewmResponse())]);
    await adapter.getStatus(ewmContext());
    expect(calls[0].url).toBe(`https://ewm-rsxs.onrender.com/internal/platform/v1/tenants/${TENANT_ID}`);
    expect(calls[0].init.method).toBe('GET');
  });

  it('el valor se codifica: sin inyección de ruta', async () => {
    const c = ewmContext();
    c.source!.tenant.id = 'a/b?c';
    const { adapter, calls } = ewmAdapter([jsonResponse(404, { code: 'RESOURCE_NOT_FOUND' })]);
    await adapter.getStatus(c);
    expect(calls[0].url).toBe('https://ewm-rsxs.onrender.com/internal/platform/v1/tenants/a%2Fb%3Fc');
  });

  it('un marcador desconocido → PATH_TEMPLATE_INVALID sin llamar', async () => {
    const c = ewmContext();
    c.integration!.status_path_template = '/internal/platform/v1/tenants/{foo}';
    const { adapter, calls } = ewmAdapter([]);
    const outcome = await adapter.getStatus(c);
    expect(calls).toHaveLength(0);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.code).toBe('PATH_TEMPLATE_INVALID');
  });

  it('los marcadores GENERIC no existen en EWM: {externalTenantId} → PATH_TEMPLATE_INVALID', async () => {
    const c = ewmContext();
    c.integration!.status_path_template = '/internal/platform/v1/tenants/{externalTenantId}';
    const { adapter, calls } = ewmAdapter([]);
    const outcome = await adapter.getStatus(c);
    expect(calls).toHaveLength(0);
    if (!outcome.ok) expect(outcome.failure.code).toBe('PATH_TEMPLATE_INVALID');
  });
});

describe('EWM_V1 · capacidades y scopes', () => {
  const claimsOf = (c: Call) => {
    const token = (c.init.headers as Record<string, string>).authorization.slice('Bearer '.length);
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as Record<string, unknown>;
  };

  it('EWM_V1 declara PROVISION, GET_STATUS y REPLAY_CERTIFICATION; GENERIC sólo PROVISION', () => {
    expect([...EWM_V1_CODEC.capabilities]).toEqual(['PROVISION', 'GET_STATUS', 'REPLAY_CERTIFICATION']);
    expect([...GENERIC_CODEC.capabilities]).toEqual(['PROVISION']);
  });

  it('getStatus firma con ewm:tenant:read y nunca con ewm:tenant:create; GET sin cuerpo', async () => {
    const { adapter, calls } = ewmAdapter([jsonResponse(200, ewmResponse())]);
    await adapter.getStatus(ewmContext());
    expect(claimsOf(calls[0]).scope).toBe('ewm:tenant:read');
    expect(String(claimsOf(calls[0]).scope)).not.toContain('ewm:tenant:create');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('provision firma con ewm:tenant:create, ES256 y exp − iat ≤ 300', async () => {
    const { adapter, calls } = ewmAdapter([jsonResponse(201, ewmResponse())]);
    await adapter.provision(ewmContext());
    const claims = claimsOf(calls[0]);
    expect(claims.scope).toBe('ewm:tenant:create');
    expect(claims.iss).toBe('masteradmin.ebim');
    expect(claims.aud).toBe('ewm.ebim');
    expect(Number(claims.exp) - Number(claims.iat)).toBeLessThanOrEqual(300);
    const token = (calls[0].init.headers as Record<string, string>).authorization.slice('Bearer '.length);
    expect(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())).toEqual({
      alg: 'ES256',
      typ: 'JWT',
    });
  });
});

describe('EWM_V1 · idempotencia y huella', () => {
  it('dos provision() con el mismo contexto: misma clave y mismo texto', async () => {
    const { adapter, calls } = ewmAdapter([
      jsonResponse(201, ewmResponse()),
      jsonResponse(200, ewmResponse({ replayed: true })),
    ]);
    await adapter.provision(ewmContext());
    await adapter.provision(ewmContext());
    const key = (c: Call) => (c.init.headers as Record<string, string>)['idempotency-key'];
    expect(key(calls[1])).toBe(key(calls[0]));
    expect(calls[1].init.body).toBe(calls[0].init.body);
  });

  it('createBodyFingerprint = sha256 del texto enviado', async () => {
    const { adapter, calls } = ewmAdapter([jsonResponse(201, ewmResponse())]);
    await adapter.provision(ewmContext());
    expect(await adapter.createBodyFingerprint(ewmContext())).toBe(await sha256Hex(String(calls[0].init.body)));
  });
});

describe('EWM_V1 · endurecimiento tras revisión', () => {
  it('una zona con otra capitalización se rechaza (Java ZoneId no la acepta)', () => {
    expect(EWM_V1_CODEC.validateInput(withPc((c) => (c.organizationTimezone = 'america/lima')))).toEqual([
      'TIMEZONE_INVALID',
    ]);
  });

  it('un admin del dominio del operador se bloquea antes de enviar', () => {
    const c = ewmContext();
    c.source!.tenant.admin_email = 'alguien@ebim.pe';
    expect(EWM_V1_CODEC.validateInput(c)).toEqual(['ADMIN_EMAIL_NOT_ALLOWED']);
  });

  it('organizationId distinto del enviado → PROVIDER_RESPONSE_INVALID', () => {
    expect(invalidCode(ewmResponse({ organizationId: '30000000-0000-4000-a000-0000000000ff' }))).toBe(
      'PROVIDER_RESPONSE_INVALID',
    );
  });

  it('si el cuerpo no se puede construir, falla sin firmar ni llamar y sin reintentos', async () => {
    const { adapter, calls } = ewmAdapter([]);
    const outcome = await adapter.provision(ewmContext({}));
    expect(calls).toHaveLength(0);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.code).toBe('PRODUCT_CONFIGURATION_INVALID');
      expect(outcome.failure.retryable).toBe(false);
    }
  });
});
