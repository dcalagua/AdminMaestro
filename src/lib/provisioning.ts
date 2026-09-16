/**
 * Dominio de provisioning en el cliente.
 *
 * TODO lo que hay aquí es UX: etiquetas, tonos y qué botones tiene sentido
 * ofrecer. La autorización vive en RLS y en las RPC, y la validación real de una
 * base_url vive en la base y en la Edge Function.
 *
 * La validación de URL que se duplica abajo NO pretende proteger nada: sirve
 * para decirle a quien escribe «esto va a fallar y por qué» antes de enviar el
 * formulario. Si alguien la sortea, la base responde 42501 igual.
 */
import type { Enums } from '@/types/domain';

export type IntegrationType = Enums<'integration_type'>;
export type IntegrationStatus = Enums<'integration_status'>;
export type ProvisioningEnvironment = Enums<'provisioning_environment'>;
export type DeploymentTargetStatus = Enums<'deployment_target_status'>;
export type DeploymentHealth = Enums<'deployment_health'>;
export type SaasProvisioningStatus = Enums<'saas_provisioning_status'>;
export type TenantProductMappingStatus = Enums<'tenant_product_mapping_status'>;
export type ProvisioningPolicy = Enums<'provisioning_policy'>;
export type CredentialProfileType = Enums<'credential_profile_type'>;
export type M2mAlgorithm = Enums<'m2m_algorithm'>;
export type ProductOwnerRole = Enums<'product_owner_role'>;
export type ProvisioningRole = Enums<'provisioning_role'>;

/** Mismos tonos que `Badge`: si divergieran, la traducción se haría en cada pantalla. */
export type Tone = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral' | 'info';

// ---------------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------------

export const INTEGRATION_TYPE_LABEL: Record<IntegrationType, string> = {
  HTTP_M2M: 'API HTTP (M2M)',
  EDGE_FUNCTION: 'Edge Function',
  MANUAL: 'Manual',
  MOCK: 'Simulada (solo DEV)',
};

export const INTEGRATION_TYPE_HINT: Record<IntegrationType, string> = {
  HTTP_M2M:
    'MasterAdmin llama a la API interna del producto con un JWT asimétrico de vida corta.',
  EDGE_FUNCTION: 'Reservado para invocación directa de una función del producto. Aún no implementado.',
  MANUAL: 'El producto todavía no expone API: el alta la registra una persona, con auditoría.',
  MOCK: 'Simula el flujo completo sin contactar con ningún producto. Bloqueado fuera de DEV.',
};

export const INTEGRATION_STATUS_LABEL: Record<IntegrationStatus, string> = {
  DRAFT: 'Borrador',
  READY: 'Lista',
  DEGRADED: 'Degradada',
  DISABLED: 'Deshabilitada',
};

export const PROVISIONING_ENVIRONMENT_LABEL: Record<ProvisioningEnvironment, string> = {
  DEV: 'Desarrollo',
  QAS: 'Calidad',
  DEMO: 'Demo',
  PRD: 'Producción',
};

export const DEPLOYMENT_TARGET_STATUS_LABEL: Record<DeploymentTargetStatus, string> = {
  DRAFT: 'Borrador',
  READY: 'Listo',
  MAINTENANCE: 'En mantenimiento',
  DISABLED: 'Deshabilitado',
};

export const DEPLOYMENT_HEALTH_LABEL: Record<DeploymentHealth, string> = {
  UNKNOWN: 'Sin verificar',
  HEALTHY: 'Saludable',
  DEGRADED: 'Degradado',
  UNHEALTHY: 'Caído',
};

export const SAAS_PROVISIONING_STATUS_LABEL: Record<SaasProvisioningStatus, string> = {
  PENDING: 'Pendiente',
  WAITING_INFRA: 'Infraestructura pendiente',
  READY_TO_PROVISION: 'Listo para provisionar',
  PROVISIONING: 'Provisionando',
  ACTIVE: 'Activo',
  FAILED: 'Fallido',
  CANCELLED: 'Cancelado',
};

export const MAPPING_STATUS_LABEL: Record<TenantProductMappingStatus, string> = {
  PENDING: 'Pendiente',
  ACTIVE: 'Activo',
  FAILED: 'Fallido',
  SUSPENDED: 'Suspendido',
};

export const PROVISIONING_POLICY_LABEL: Record<ProvisioningPolicy, string> = {
  MANUAL: 'Manual',
  AFTER_SUBSCRIPTION_ACTIVE: 'Al activar la suscripción',
  AFTER_PAYMENT_CONFIRMED: 'Al confirmarse el pago',
};

export const PROVISIONING_POLICY_HINT: Record<ProvisioningPolicy, string> = {
  MANUAL: 'Nadie aprovisiona por un evento comercial: alguien con permiso decide y ejecuta.',
  AFTER_SUBSCRIPTION_ACTIVE: 'Se habilita cuando la suscripción pasa a ACTIVE.',
  AFTER_PAYMENT_CONFIRMED: 'Se habilita cuando existe un pago CONFIRMED. Un PENDING no cuenta.',
};

export const CREDENTIAL_TYPE_LABEL: Record<CredentialProfileType, string> = {
  M2M_ASYMMETRIC_JWT: 'JWT asimétrico M2M',
  NONE: 'Sin credencial',
};

export const PRODUCT_OWNER_ROLE_LABEL: Record<ProductOwnerRole, string> = {
  TECHNICAL_OWNER: 'Propietario técnico',
  BACKUP_OWNER: 'Suplente',
  VIEWER: 'Consulta',
};

export const PROVISIONING_ROLE_LABEL: Record<ProvisioningRole, string> = {
  TECH_LEAD: 'Tech Lead',
  PROVISIONING_ADMIN: 'Admin de provisioning',
  PRODUCT_OWNER: 'Propietario de producto',
  PROVISIONING_VIEWER: 'Consulta de provisioning',
};

/** Códigos de bloqueo devueltos por `check_provisioning_preconditions`. */
export const BLOCKER_LABEL: Record<string, string> = {
  REQUEST_NOT_READY: 'La solicitud no está en estado listo para provisionar',
  ATTEMPTS_EXHAUSTED: 'Se agotaron los intentos configurados',
  DEPLOYMENT_NOT_CONFIGURED: 'No hay destino de deployment configurado',
  DEPLOYMENT_NOT_READY: 'El destino no está marcado como listo',
  DEPLOYMENT_DISABLED: 'El destino está deshabilitado',
  DEPLOYMENT_UNHEALTHY: 'El destino está caído',
  INTEGRATION_NOT_CONFIGURED: 'El producto no tiene integración configurada',
  INTEGRATION_DISABLED: 'La integración está deshabilitada',
  INTEGRATION_NOT_READY: 'La integración sigue en borrador',
  MOCK_NOT_ALLOWED_IN_ENVIRONMENT: 'El adaptador simulado no puede usarse fuera de desarrollo',
  BASE_URL_MISSING: 'Falta la URL base del destino',
  BASE_URL_INSECURE: 'La URL base no cumple las reglas de seguridad del ambiente',
  CREDENTIAL_PROFILE_MISSING: 'Falta el perfil de credencial M2M',
  CREDENTIAL_PROFILE_DISABLED: 'El perfil de credencial está deshabilitado',
  SECRET_REF_MISSING: 'El perfil no declara referencia de secreto',
  ALGORITHM_NOT_CONFIGURED: 'Falta configurar el algoritmo de firma',
  POLICY_NOT_SATISFIED: 'La política de provisioning todavía no se cumple',
};

export function blockerLabel(code: string): string {
  return BLOCKER_LABEL[code] ?? code;
}

/** Mensajes de error del producto que la consola sabe explicar. */
export const PROVIDER_ERROR_LABEL: Record<string, string> = {
  ADMIN_EMAIL_ALREADY_PROVISIONED: 'Ese correo de administrador ya tiene un tenant en el producto',
  PROVIDER_CONFLICT: 'El producto reporta un conflicto: el recurso ya existe',
  PROVIDER_UNAUTHORIZED: 'El producto rechazó las credenciales de MasterAdmin',
  PROVIDER_FORBIDDEN: 'El producto no autoriza esta operación a MasterAdmin',
  PROVIDER_TIMEOUT: 'El producto no respondió a tiempo',
  PROVIDER_UNREACHABLE: 'No se pudo establecer conexión con el producto',
  PROVIDER_UNAVAILABLE: 'El producto no está disponible en este momento',
  PROVIDER_RESPONSE_INVALID: 'El producto respondió algo que no cumple el contrato',
  MANUAL_REGISTRATION_REQUIRED: 'Esta integración es manual: registre el alta indicando el ID externo',
  SECRET_NOT_AVAILABLE: 'El secreto de firma no está cargado en el servidor',
  MOCK_NOT_ALLOWED_IN_ENVIRONMENT: 'El adaptador simulado está bloqueado en este ambiente',
  BASE_URL_INSECURE: 'La URL configurada no es admisible para este ambiente',
  REDIRECT_BLOCKED: 'El producto redirigió a otro destino y se bloqueó la llamada',
};

export function providerErrorLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return PROVIDER_ERROR_LABEL[code] ?? code;
}

// ---------------------------------------------------------------------------
// Tonos
// ---------------------------------------------------------------------------

export function integrationStatusTone(status: IntegrationStatus): Tone {
  switch (status) {
    case 'READY':
      return 'ok';
    case 'DEGRADED':
      return 'warn';
    case 'DISABLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function healthTone(health: DeploymentHealth): Tone {
  switch (health) {
    case 'HEALTHY':
      return 'ok';
    case 'DEGRADED':
      return 'warn';
    case 'UNHEALTHY':
      return 'danger';
    default:
      // UNKNOWN es neutro a propósito: no es bueno ni malo, es «nadie lo ha
      // comprobado». Pintarlo de verde sería mentir.
      return 'neutral';
  }
}

export function targetStatusTone(status: DeploymentTargetStatus): Tone {
  switch (status) {
    case 'READY':
      return 'ok';
    case 'MAINTENANCE':
      return 'warn';
    case 'DISABLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function provisioningStatusTone(status: SaasProvisioningStatus): Tone {
  switch (status) {
    case 'ACTIVE':
      return 'ok';
    case 'PROVISIONING':
    case 'READY_TO_PROVISION':
      return 'accent';
    case 'WAITING_INFRA':
    case 'PENDING':
      return 'warn';
    case 'FAILED':
      return 'danger';
    default:
      return 'neutral';
  }
}

// ---------------------------------------------------------------------------
// Máquina de estados (espejo del trigger de la base)
// ---------------------------------------------------------------------------
// Se duplica aquí SÓLO para no ofrecer un botón que la base va a rechazar. La
// autoridad sigue siendo `platform.enforce_saas_provisioning_transition()`.
// ---------------------------------------------------------------------------

export function canProvision(status: SaasProvisioningStatus): boolean {
  return status === 'READY_TO_PROVISION';
}

export function canRetry(
  status: SaasProvisioningStatus,
  attempts: number,
  maxAttempts: number,
): boolean {
  return status === 'FAILED' && attempts < maxAttempts;
}

/**
 * Cancelar sólo tiene sentido si la operación todavía NO ha empezado.
 * Una solicitud en PROVISIONING tiene una llamada en vuelo y no sabemos si el
 * alta se completó al otro lado; una ACTIVE ya existe en el producto.
 */
export function canCancel(status: SaasProvisioningStatus): boolean {
  return ['PENDING', 'WAITING_INFRA', 'READY_TO_PROVISION', 'FAILED'].includes(status);
}

export function canRegisterManually(status: SaasProvisioningStatus): boolean {
  return ['PENDING', 'WAITING_INFRA', 'READY_TO_PROVISION', 'FAILED'].includes(status);
}

export function isTerminal(status: SaasProvisioningStatus): boolean {
  return status === 'ACTIVE' || status === 'CANCELLED';
}

// ---------------------------------------------------------------------------
// Validación de formulario (UX, no seguridad)
// ---------------------------------------------------------------------------

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^169\.254\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^metadata\./i,
  /\.internal$/i,
  /\.local$/i,
];

/**
 * Explica por qué una base_url no va a ser aceptada.
 *
 * Devuelve `null` si parece válida. NO es la autoridad: la base tiene el mismo
 * CHECK y la Edge Function vuelve a validar antes de cada llamada.
 */
export function describeBaseUrlProblem(
  rawUrl: string,
  environment: ProvisioningEnvironment,
): string | null {
  const value = (rawUrl ?? '').trim();
  if (value === '') return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Escriba una URL absoluta, por ejemplo https://api.producto.ebim.pe';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Solo se admiten http y https';
  }
  if (url.username !== '' || url.password !== '') {
    return 'La URL no puede llevar usuario y contraseña embebidos';
  }
  if (url.search !== '' || url.hash !== '') {
    return 'Es una URL base: no admite parámetros ni fragmento';
  }
  if (value.endsWith('/')) {
    return 'Quite la barra final: la ruta la aporta el contrato de la integración';
  }
  if (environment !== 'DEV') {
    if (url.protocol !== 'https:') {
      return `En ${PROVISIONING_ENVIRONMENT_LABEL[environment]} el transporte debe ser HTTPS`;
    }
    if (BLOCKED_HOST_PATTERNS.some((re) => re.test(url.hostname))) {
      return `«${url.hostname}» es un host interno y no se admite en ${PROVISIONING_ENVIRONMENT_LABEL[environment]}`;
    }
  }
  return null;
}

/** Explica por qué una referencia de secreto no es una referencia. */
export function describeSecretRefProblem(rawRef: string): string | null {
  const value = (rawRef ?? '').trim();
  if (value === '') return null;
  if (/BEGIN[\s\S]*KEY/i.test(value) || value.split('.').length === 3) {
    return 'Esto parece el VALOR del secreto. Aquí va solo su NOMBRE: el valor se carga en los secrets del servidor.';
  }
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(value)) {
    return 'Use un nombre en MAYÚSCULAS con guiones bajos, por ejemplo EWM_QAS_M2M_PRIVATE_KEY';
  }
  return null;
}

/** Explica por qué una plantilla de ruta no es segura. */
export function describePathTemplateProblem(rawPath: string): string | null {
  const value = (rawPath ?? '').trim();
  if (value === '') return null;
  if (!value.startsWith('/')) return 'La ruta debe ser relativa y empezar por «/»';
  if (value.includes('..')) return 'La ruta no puede contener «..»';
  if (value.includes('//')) return 'La ruta no puede contener «//»';
  if (/[?#@\\]/.test(value)) return 'La ruta no admite «?», «#», «@» ni «\\»';
  return null;
}

export const TOKEN_TTL_MIN = 30;
export const TOKEN_TTL_MAX = 300;

export function describeTtlProblem(ttl: number | null | undefined): string | null {
  if (ttl == null) return null;
  if (!Number.isInteger(ttl)) return 'El TTL se expresa en segundos enteros';
  if (ttl < TOKEN_TTL_MIN || ttl > TOKEN_TTL_MAX) {
    return `El TTL debe estar entre ${TOKEN_TTL_MIN} y ${TOKEN_TTL_MAX} segundos: un token de provisioning de vida larga es un token robado de vida larga`;
  }
  return null;
}

/** Permisos efectivos devueltos por `platform.my_provisioning_permissions()`. */
export interface ProvisioningPermissions {
  permissions: string[];
  roles: ProvisioningRole[];
  is_super_admin: boolean;
  owned_products: Array<{
    saas_product_id: string;
    role: ProductOwnerRole;
    environment_scope: ProvisioningEnvironment[] | null;
  }>;
}

export const EMPTY_PROVISIONING_PERMISSIONS: ProvisioningPermissions = {
  permissions: [],
  roles: [],
  is_super_admin: false,
  owned_products: [],
};

/**
 * ¿Tiene el usuario este permiso sobre este producto?
 *
 * Espeja `platform.has_product_permission()`. Si el permiso es transversal vale
 * para todo; si viene de la propiedad técnica, sólo para ese producto.
 */
export function hasProductPermission(
  perms: ProvisioningPermissions,
  code: string,
  productId: string | null | undefined,
): boolean {
  if (perms.permissions.includes(code)) return true;
  if (!productId) return false;

  const owned = perms.owned_products.find((p) => p.saas_product_id === productId);
  if (!owned) return false;

  const grants = owned.role === 'VIEWER' ? VIEWER_PERMISSIONS : PRODUCT_OWNER_PERMISSIONS;
  return grants.includes(code);
}

/** Espejo de `provisioning_role_permissions` para PRODUCT_OWNER. */
const PRODUCT_OWNER_PERMISSIONS = [
  'platform.integration.read',
  'platform.deployment.read',
  'platform.provisioning.read',
  'platform.provisioning.execute',
  'platform.provisioning.retry',
  'platform.provisioning.cancel',
  'platform.credentials.read',
];

const VIEWER_PERMISSIONS = [
  'platform.integration.read',
  'platform.deployment.read',
  'platform.provisioning.read',
  'platform.credentials.read',
];
