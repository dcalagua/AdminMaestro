import { describe, it, expect } from 'vitest';
import {
  EMPTY_PROVISIONING_PERMISSIONS,
  blockerLabel,
  canCancel,
  canProvision,
  canRegisterManually,
  canRetry,
  describeBaseUrlProblem,
  describePathTemplateProblem,
  describeSecretRefProblem,
  describeTtlProblem,
  hasProductPermission,
  healthTone,
  isTerminal,
  providerErrorLabel,
  provisioningStatusTone,
  type ProvisioningPermissions,
} from './provisioning';

/*
 * V4 · Dominio de provisioning en el cliente.
 *
 * Todo esto es UX. Lo que se comprueba es que la consola no OFREZCA acciones que
 * la base va a rechazar, y que explique los bloqueos en lugar de quedarse muda.
 */

describe('acciones ofrecidas por estado', () => {
  it('provisionar sólo desde READY_TO_PROVISION', () => {
    expect(canProvision('READY_TO_PROVISION')).toBe(true);
    expect(canProvision('PENDING')).toBe(false);
    expect(canProvision('WAITING_INFRA')).toBe(false);
    expect(canProvision('PROVISIONING')).toBe(false);
    expect(canProvision('ACTIVE')).toBe(false);
    expect(canProvision('FAILED')).toBe(false);
  });

  it('reintentar sólo un FAILED con intentos disponibles', () => {
    expect(canRetry('FAILED', 1, 3)).toBe(true);
    expect(canRetry('FAILED', 3, 3)).toBe(false);
    expect(canRetry('ACTIVE', 0, 3)).toBe(false);
    expect(canRetry('PROVISIONING', 0, 3)).toBe(false);
  });

  it('cancelar sólo si la operación todavía no ha empezado', () => {
    expect(canCancel('PENDING')).toBe(true);
    expect(canCancel('WAITING_INFRA')).toBe(true);
    expect(canCancel('READY_TO_PROVISION')).toBe(true);
    expect(canCancel('FAILED')).toBe(true);
    // Llamada en vuelo: no sabemos si el alta se completó al otro lado.
    expect(canCancel('PROVISIONING')).toBe(false);
    expect(canCancel('ACTIVE')).toBe(false);
    expect(canCancel('CANCELLED')).toBe(false);
  });

  it('registrar manualmente no se ofrece sobre algo ya activo', () => {
    expect(canRegisterManually('WAITING_INFRA')).toBe(true);
    expect(canRegisterManually('ACTIVE')).toBe(false);
    expect(canRegisterManually('PROVISIONING')).toBe(false);
  });

  it('ACTIVE y CANCELLED son terminales', () => {
    expect(isTerminal('ACTIVE')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('FAILED')).toBe(false);
  });
});

describe('tonos', () => {
  it('UNKNOWN es neutro: no es bueno ni malo, es «nadie lo ha comprobado»', () => {
    expect(healthTone('UNKNOWN')).toBe('neutral');
    expect(healthTone('HEALTHY')).toBe('ok');
    expect(healthTone('DEGRADED')).toBe('warn');
    expect(healthTone('UNHEALTHY')).toBe('danger');
  });

  it('WAITING_INFRA se pinta como aviso, no como error: es un estado del negocio', () => {
    expect(provisioningStatusTone('WAITING_INFRA')).toBe('warn');
    expect(provisioningStatusTone('FAILED')).toBe('danger');
    expect(provisioningStatusTone('ACTIVE')).toBe('ok');
  });
});

describe('explicación de bloqueos y errores', () => {
  it('traduce los códigos conocidos', () => {
    expect(blockerLabel('DEPLOYMENT_UNHEALTHY')).toBe('El destino está caído');
    expect(providerErrorLabel('ADMIN_EMAIL_ALREADY_PROVISIONED')).toBe(
      'Ese correo de administrador ya tiene un tenant en el producto',
    );
  });

  it('un código desconocido se muestra tal cual en vez de desaparecer', () => {
    expect(blockerLabel('ALGO_NUEVO')).toBe('ALGO_NUEVO');
    expect(providerErrorLabel('ALGO_NUEVO')).toBe('ALGO_NUEVO');
  });

  it('sin código no hay mensaje', () => {
    expect(providerErrorLabel(null)).toBeNull();
    expect(providerErrorLabel(undefined)).toBeNull();
  });
});

describe('describeBaseUrlProblem', () => {
  it('acepta lo válido', () => {
    expect(describeBaseUrlProblem('https://api.producto.ebim.pe', 'PRD')).toBeNull();
    expect(describeBaseUrlProblem('https://api.producto.ebim.pe/v1', 'QAS')).toBeNull();
    expect(describeBaseUrlProblem('http://127.0.0.1:54321', 'DEV')).toBeNull();
    expect(describeBaseUrlProblem('', 'PRD')).toBeNull();
  });

  it('exige HTTPS fuera de desarrollo', () => {
    expect(describeBaseUrlProblem('http://api.producto.com', 'PRD')).toContain('HTTPS');
    expect(describeBaseUrlProblem('http://api.producto.com', 'QAS')).toContain('HTTPS');
  });

  it.each(['https://localhost', 'https://169.254.169.254', 'https://10.0.0.1', 'https://db.internal'])(
    'rechaza el host interno %s',
    (url) => {
      expect(describeBaseUrlProblem(url, 'PRD')).toContain('host interno');
    },
  );

  it('explica la barra final en vez de dejar que falle la base', () => {
    expect(describeBaseUrlProblem('https://api.producto.com/', 'PRD')).toContain('barra final');
  });

  it('rechaza credenciales embebidas, query y fragmento', () => {
    expect(describeBaseUrlProblem('https://u:p@api.producto.com', 'PRD')).toContain('contraseña');
    expect(describeBaseUrlProblem('https://api.producto.com?a=1', 'PRD')).toContain('parámetros');
    expect(describeBaseUrlProblem('https://api.producto.com#x', 'PRD')).toContain('parámetros');
  });

  it('rechaza esquemas que no son http/https', () => {
    expect(describeBaseUrlProblem('file:///etc/passwd', 'DEV')).toContain('http y https');
  });

  it('pide una URL absoluta cuando el texto no lo es', () => {
    expect(describeBaseUrlProblem('api.producto.com', 'PRD')).toContain('absoluta');
  });
});

describe('describeSecretRefProblem', () => {
  it('acepta un NOMBRE de secreto', () => {
    expect(describeSecretRefProblem('EWM_QAS_M2M_PRIVATE_KEY')).toBeNull();
    expect(describeSecretRefProblem('')).toBeNull();
  });

  it('detecta que alguien pegó la clave en vez del nombre, y lo dice claro', () => {
    // secrets-scan:allow encabezado PEM sintético; el test exige que el formulario lo RECHACE
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----';
    expect(describeSecretRefProblem(pem)).toContain('VALOR del secreto');
  });

  it('detecta un JWT pegado en el campo', () => {
    expect(describeSecretRefProblem('eyJhbGciOiJSUzI1NiJ9.eyJhIjoxfQ.firma')).toContain(
      'VALOR del secreto',
    );
  });

  it('exige forma de identificador en mayúsculas', () => {
    expect(describeSecretRefProblem('ewm-qas-key')).toContain('MAYÚSCULAS');
    expect(describeSecretRefProblem('AB')).toContain('MAYÚSCULAS');
  });
});

describe('describePathTemplateProblem', () => {
  it('acepta una ruta relativa del contrato', () => {
    expect(describePathTemplateProblem('/internal/platform/v1/tenants')).toBeNull();
    expect(describePathTemplateProblem('/v1/tenants/{externalTenantId}')).toBeNull();
  });

  it.each([
    ['v1/tenants', 'relativa'],
    ['/v1/../admin', '..'],
    ['//evil.com', '//'],
    ['/v1?a=1', '?'],
    ['/v1@evil.com', '@'],
  ])('rechaza %s', (path) => {
    expect(describePathTemplateProblem(path)).not.toBeNull();
  });
});

describe('describeTtlProblem', () => {
  it('acepta el rango seguro', () => {
    expect(describeTtlProblem(30)).toBeNull();
    expect(describeTtlProblem(300)).toBeNull();
    expect(describeTtlProblem(null)).toBeNull();
  });

  it('rechaza un token de vida larga y explica por qué', () => {
    expect(describeTtlProblem(3600)).toContain('token robado');
    expect(describeTtlProblem(10)).toContain('30');
  });

  it('rechaza un valor no entero', () => {
    expect(describeTtlProblem(60.5)).toContain('enteros');
  });
});

describe('hasProductPermission', () => {
  const owner: ProvisioningPermissions = {
    permissions: [],
    roles: [],
    is_super_admin: false,
    owned_products: [
      { saas_product_id: 'ewm', role: 'TECHNICAL_OWNER', environment_scope: null },
    ],
  };

  const techLead: ProvisioningPermissions = {
    permissions: ['platform.provisioning.execute', 'platform.integration.manage'],
    roles: ['TECH_LEAD'],
    is_super_admin: false,
    owned_products: [],
  };

  it('un permiso transversal vale para cualquier producto', () => {
    expect(hasProductPermission(techLead, 'platform.provisioning.execute', 'ewm')).toBe(true);
    expect(hasProductPermission(techLead, 'platform.provisioning.execute', 'esupplier')).toBe(true);
  });

  it('un owner obtiene sus permisos SÓLO sobre su producto', () => {
    expect(hasProductPermission(owner, 'platform.provisioning.execute', 'ewm')).toBe(true);
    expect(hasProductPermission(owner, 'platform.provisioning.execute', 'esupplier')).toBe(false);
  });

  it('un owner NO administra la integración ni de su propio producto', () => {
    expect(hasProductPermission(owner, 'platform.integration.manage', 'ewm')).toBe(false);
    expect(hasProductPermission(owner, 'platform.deployment.manage', 'ewm')).toBe(false);
  });

  it('un VIEWER por producto sólo lee', () => {
    const viewer: ProvisioningPermissions = {
      ...owner,
      owned_products: [{ saas_product_id: 'ewm', role: 'VIEWER', environment_scope: null }],
    };
    expect(hasProductPermission(viewer, 'platform.provisioning.read', 'ewm')).toBe(true);
    expect(hasProductPermission(viewer, 'platform.provisioning.execute', 'ewm')).toBe(false);
  });

  it('sin producto, sólo cuenta el permiso transversal', () => {
    expect(hasProductPermission(owner, 'platform.provisioning.execute', null)).toBe(false);
    expect(hasProductPermission(techLead, 'platform.integration.manage', null)).toBe(true);
  });

  it('el estado vacío no concede nada', () => {
    expect(
      hasProductPermission(EMPTY_PROVISIONING_PERMISSIONS, 'platform.provisioning.read', 'ewm'),
    ).toBe(false);
  });
});
