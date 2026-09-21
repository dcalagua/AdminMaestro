import { describe, it, expect, vi } from 'vitest';
import { EWM_V1_CODEC, buildEwmCreateBody, validateEwmProductConfiguration } from './ewm-v1';
import { HttpM2mAdapter } from './http-m2m';
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
