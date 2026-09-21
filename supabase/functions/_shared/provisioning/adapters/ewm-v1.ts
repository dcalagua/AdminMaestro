/**
 * Codec EWM_V1 — contrato de provisioning propio de EWM.
 *
 * EWM implementó y certificó su propio contrato antes de que existiera el
 * estándar EBIM v1, y no se puede cambiar. Este archivo es el ÚNICO sitio del
 * orquestador que lo conoce. Referencia: `WMS-by-EBIM@origin/qas`,
 * `docs/platform-provisioning/API_CONTRACT.md` (commit 7e45d70).
 *
 * Sólo decide FORMA: qué cuerpo se envía, qué marcadores admite la ruta y cómo
 * se lee la respuesta. El transporte, el guard SSRF, la firma M2M y los
 * reintentos son los de `HttpM2mAdapter`, compartidos con GENERIC.
 *
 * Los datos propios del alta (almacén inicial, nombre del admin, zonas
 * horarias, moneda) vienen de `product_configuration`, que la base congela
 * antes del primer envío: EWM responde `409 IDEMPOTENCY_CONFLICT` si la misma
 * clave llega con otro contenido, así que un reintento tiene que mandar
 * exactamente los mismos bytes.
 */
import type { AdapterResult, ContractCodec, ProvisioningContext, ProvisioningSource } from '../types.ts';
import { ProvisioningError } from '../types.ts';
import { sanitizeResources } from '../response.ts';

export interface EwmCreateBody {
  controlPlaneTenantId: string;
  organization: {
    id: string;
    slug: string;
    name: string;
    legalName: string | null;
    taxId: string | null;
    countryCode: string;
    currency: string;
    timezone: string;
  };
  company: {
    id: string;
    name: string;
    legalName: string | null;
    taxId: string | null;
    erpCode: string | null;
    countryCode: string;
    currency: string;
  };
  initialWarehouse: {
    code: string;
    erpCode: string | null;
    name: string;
    address: string | null;
    timezone: string;
    is3pl: boolean;
  };
  admin: { email: string; fullName: string };
  deploymentMode: 'SHARED' | 'PARTNER_DEDICATED' | 'TENANT_DEDICATED';
}

/** Forma de `product_configuration` para EWM_V1. `resolvedCurrency` la escribe el servidor. */
export interface EwmProductConfiguration {
  organizationTimezone: string;
  initialWarehouse: {
    code: string;
    name: string;
    timezone: string;
    erpCode?: string | null;
    address?: string | null;
    is3pl?: boolean;
  };
  admin: { fullName: string };
  resolvedCurrency: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const WAREHOUSE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEPLOYMENT_MODES = ['SHARED', 'PARTNER_DEDICATED', 'TENANT_DEDICATED'];

/** Un valor de configuración es DATO: nada que parezca URL o plantilla. */
const FORBIDDEN_VALUE_RE = /^[a-z][a-z0-9+.-]*:\/\/|\$\{|\{\{/i;

const ROOT_KEYS = ['organizationTimezone', 'initialWarehouse', 'admin', 'resolvedCurrency'];
const WAREHOUSE_KEYS = ['code', 'name', 'timezone', 'erpCode', 'address', 'is3pl'];
const ADMIN_KEYS = ['fullName'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function lengthBetween(value: unknown, min: number, max: number): boolean {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

function optionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (isPlainObject(value)) for (const v of Object.values(value)) collectStrings(v, out);
}

/**
 * Valida `product_configuration` con una lista CERRADA de claves, tipos,
 * longitudes y expresiones. Devuelve códigos estables, ordenados y sin
 * duplicados; `[]` significa válida.
 */
export function validateEwmProductConfiguration(raw: unknown): string[] {
  if (!isPlainObject(raw)) return ['PRODUCT_CONFIGURATION_TYPE_INVALID'];
  if (Object.keys(raw).length === 0) return ['PRODUCT_CONFIGURATION_MISSING'];

  const blockers = new Set<string>();

  if (Object.keys(raw).some((k) => !ROOT_KEYS.includes(k))) {
    blockers.add('PRODUCT_CONFIGURATION_UNKNOWN_KEY');
  }

  const strings: string[] = [];
  collectStrings(raw, strings);
  if (strings.some((s) => FORBIDDEN_VALUE_RE.test(s))) {
    blockers.add('PRODUCT_CONFIGURATION_VALUE_NOT_ALLOWED');
  }

  // Zona horaria de la organización
  if (raw.organizationTimezone !== undefined && typeof raw.organizationTimezone !== 'string') {
    blockers.add('PRODUCT_CONFIGURATION_TYPE_INVALID');
  } else if (!isValidTimezone(raw.organizationTimezone)) {
    blockers.add('TIMEZONE_INVALID');
  }

  // Almacén inicial
  const wh = raw.initialWarehouse;
  if (wh === undefined) {
    blockers.add('INITIAL_WAREHOUSE_REQUIRED');
  } else if (!isPlainObject(wh)) {
    blockers.add('PRODUCT_CONFIGURATION_TYPE_INVALID');
  } else {
    if (Object.keys(wh).some((k) => !WAREHOUSE_KEYS.includes(k))) {
      blockers.add('PRODUCT_CONFIGURATION_UNKNOWN_KEY');
    }
    const typesOk =
      optionalString(wh.code) &&
      optionalString(wh.name) &&
      optionalString(wh.timezone) &&
      optionalString(wh.erpCode) &&
      optionalString(wh.address) &&
      (wh.is3pl === undefined || typeof wh.is3pl === 'boolean');
    if (!typesOk) {
      blockers.add('PRODUCT_CONFIGURATION_TYPE_INVALID');
    } else {
      if (typeof wh.code !== 'string' || !WAREHOUSE_CODE_RE.test(wh.code.trim())) {
        blockers.add('INITIAL_WAREHOUSE_CODE_INVALID');
      }
      if (!lengthBetween(wh.name, 1, 200)) blockers.add('INITIAL_WAREHOUSE_NAME_INVALID');
      if (!isValidTimezone(wh.timezone)) blockers.add('TIMEZONE_INVALID');
      if (typeof wh.erpCode === 'string' && wh.erpCode.trim().length > 32) {
        blockers.add('INITIAL_WAREHOUSE_ERP_CODE_INVALID');
      }
      if (typeof wh.address === 'string' && wh.address.trim().length > 500) {
        blockers.add('INITIAL_WAREHOUSE_ADDRESS_INVALID');
      }
    }
  }

  // Administrador
  const admin = raw.admin;
  if (admin === undefined) {
    blockers.add('ADMIN_FULL_NAME_REQUIRED');
  } else if (!isPlainObject(admin) || !optionalString(admin.fullName)) {
    blockers.add('PRODUCT_CONFIGURATION_TYPE_INVALID');
  } else {
    if (Object.keys(admin).some((k) => !ADMIN_KEYS.includes(k))) {
      blockers.add('PRODUCT_CONFIGURATION_UNKNOWN_KEY');
    }
    const fullName = typeof admin.fullName === 'string' ? admin.fullName.trim() : '';
    if (fullName === '') blockers.add('ADMIN_FULL_NAME_REQUIRED');
    else if (fullName.length > 200) blockers.add('ADMIN_FULL_NAME_INVALID');
  }

  // Moneda congelada por el servidor (enmienda A2)
  if (typeof raw.resolvedCurrency !== 'string' || !CURRENCY_RE.test(raw.resolvedCurrency)) {
    blockers.add('CURRENCY_SNAPSHOT_MISSING');
  }

  return [...blockers].sort();
}

/** Atributos de MasterAdmin que EWM exige con otra forma o límite. */
function validateSource(source: ProvisioningSource): string[] {
  const blockers = new Set<string>();
  const { tenant, organization: org, company } = source;

  if (!UUID_RE.test(tenant.id ?? '')) blockers.add('CONTROL_PLANE_TENANT_ID_INVALID');
  if (!UUID_RE.test(org.id ?? '')) blockers.add('ORGANIZATION_ID_INVALID');
  if (typeof org.slug !== 'string' || !SLUG_RE.test(org.slug)) {
    blockers.add('ORGANIZATION_SLUG_INCOMPATIBLE');
  }
  if (!lengthBetween(org.display_name, 1, 200)) blockers.add('ORGANIZATION_NAME_INVALID');
  if (org.legal_name != null && !lengthBetween(org.legal_name, 0, 200)) {
    blockers.add('ORGANIZATION_LEGAL_NAME_INVALID');
  }
  if (org.tax_id != null && !lengthBetween(org.tax_id, 0, 32)) blockers.add('ORGANIZATION_TAX_ID_INVALID');
  if (!COUNTRY_RE.test(org.country_code ?? '')) blockers.add('COUNTRY_CODE_INVALID');

  if (!company) {
    blockers.add('COMPANY_REQUIRED');
  } else {
    if (!UUID_RE.test(company.id ?? '')) blockers.add('COMPANY_ID_INVALID');
    if (!lengthBetween(company.name, 1, 200)) blockers.add('COMPANY_NAME_INVALID');
    if (company.tax_id != null && !lengthBetween(company.tax_id, 0, 32)) {
      blockers.add('COMPANY_TAX_ID_INVALID');
    }
    if (!COUNTRY_RE.test(company.country_code ?? '')) blockers.add('COUNTRY_CODE_INVALID');
  }

  if (typeof tenant.admin_email !== 'string' || !EMAIL_RE.test(tenant.admin_email.trim())) {
    blockers.add('ADMIN_EMAIL_INVALID');
  }
  if (!DEPLOYMENT_MODES.includes(tenant.deployment_mode)) blockers.add('DEPLOYMENT_MODE_INVALID');

  return [...blockers];
}

function validateEwmInput(context: ProvisioningContext): string[] {
  const source = context.source;
  if (!source) return ['SOURCE_MISSING'];
  const all = new Set([
    ...validateSource(source),
    ...validateEwmProductConfiguration(source.product_configuration),
  ]);
  return [...all].sort();
}

function nullableTrim(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/**
 * Cuerpo exacto de `POST /internal/platform/v1/tenants`.
 *
 * Se envía la forma CANÓNICA que EWM guarda (códigos en mayúsculas, correo en
 * minúsculas): así el cuerpo de un reintento o de un replay es byte a byte el
 * mismo que EWM ya tiene. El orden de las claves es fijo, porque su texto es
 * la base de la huella de la certificación de replay.
 */
export function buildEwmCreateBody(context: ProvisioningContext): EwmCreateBody {
  const blockers = validateEwmInput(context);
  if (blockers.length > 0) {
    throw new ProvisioningError(
      'PRODUCT_CONFIGURATION_INVALID',
      'La solicitud no cumple el contrato EWM_V1',
      null,
      false,
      { blockers },
    );
  }

  const source = context.source as ProvisioningSource;
  const company = source.company as NonNullable<ProvisioningSource['company']>;
  const pc = source.product_configuration as unknown as EwmProductConfiguration;
  const wh = pc.initialWarehouse;
  const currency = pc.resolvedCurrency;

  return {
    controlPlaneTenantId: source.tenant.id,
    organization: {
      id: source.organization.id,
      slug: source.organization.slug,
      name: source.organization.display_name.trim(),
      legalName: nullableTrim(source.organization.legal_name),
      taxId: nullableTrim(source.organization.tax_id),
      countryCode: source.organization.country_code,
      currency,
      timezone: pc.organizationTimezone,
    },
    company: {
      id: company.id,
      name: company.name.trim(),
      legalName: null,
      taxId: nullableTrim(company.tax_id),
      erpCode: nullableTrim(company.erp_code)?.toUpperCase() ?? null,
      countryCode: company.country_code,
      currency,
    },
    initialWarehouse: {
      code: wh.code.trim().toUpperCase(),
      erpCode: nullableTrim(wh.erpCode),
      name: wh.name.trim(),
      address: nullableTrim(wh.address),
      timezone: wh.timezone,
      is3pl: wh.is3pl ?? false,
    },
    admin: {
      email: source.tenant.admin_email.trim().toLowerCase(),
      fullName: pc.admin.fullName.trim(),
    },
    deploymentMode: source.tenant.deployment_mode as EwmCreateBody['deploymentMode'],
  };
}

/** Marcadores de ruta EWM: `{controlPlaneTenantId}` = `tenants.id`. */
export function ewmPathParams(context: ProvisioningContext): Record<string, string> {
  const id = context.source?.tenant.id;
  return typeof id === 'string' && id !== '' ? { controlPlaneTenantId: id } : {};
}

function invalid(message: string): never {
  throw new ProvisioningError('PROVIDER_RESPONSE_INVALID', message);
}

function requiredText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') {
    invalid(`La respuesta de EWM no trae "${field}"`);
  }
  if (value.length > 200) invalid(`El campo "${field}" excede 200 caracteres`);
  return value.trim();
}

function sameId(a: string | undefined | null, b: string): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

/**
 * Normaliza la respuesta de EWM (201, 200 replay o GET) al `AdapterResult`
 * común. `parseProvisioningResponse` no se toca: EWM tiene su propia lectura.
 *
 * EWM declara que `company.id` ES su `tenant_id`, así que el identificador
 * externo del tenant es `companyId`, y tiene que ser el mismo que se envió.
 * `provisioningId` es una referencia de operación y va a `rawReference`.
 * Cualquier respuesta incompleta o incoherente deja la solicitud SIN pasar a
 * ACTIVE: un reintento con la misma clave recupera el alta con `200 replayed`.
 */
export function parseEwmResponse(
  body: unknown,
  _operation: 'create' | 'read',
  context: ProvisioningContext,
): AdapterResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('La respuesta de EWM no es un objeto JSON');
  }
  const record = body as Record<string, unknown>;

  if (record.status !== 'ACTIVE') {
    invalid(`Estado no contemplado en el contrato EWM: "${String(record.status)}". Sólo ACTIVE`);
  }
  if (typeof record.replayed !== 'boolean') invalid('La respuesta de EWM no trae "replayed" booleano');

  const provisioningId = requiredText(record, 'provisioningId');
  const organizationId = requiredText(record, 'organizationId');
  const companyId = requiredText(record, 'companyId');
  if (!UUID_RE.test(companyId)) invalid('"companyId" no es un UUID');

  const sentTenant = context.source?.tenant.id;
  const sentCompany = context.source?.company?.id;
  if (!sameId(sentTenant, String(record.controlPlaneTenantId ?? ''))) {
    invalid('"controlPlaneTenantId" no coincide con el tenant enviado');
  }
  if (!sameId(sentCompany, companyId)) invalid('"companyId" no coincide con la sociedad enviada');

  return {
    status: 'ACTIVE',
    externalTenantId: companyId,
    externalOrganizationId: organizationId,
    externalCompanyId: companyId,
    resources: sanitizeResources({
      initialWarehouseId: record.initialWarehouseId,
      adminAppUserId: record.adminAppUserId,
      adminProvisioningStatus: record.adminProvisioningStatus,
      deploymentMode: record.deploymentMode,
    }),
    rawReference: provisioningId,
    replayed: record.replayed,
  };
}

export const EWM_V1_CODEC: ContractCodec = {
  key: 'EWM_V1',
  capabilities: ['PROVISION'],
  validateInput: validateEwmInput,
  buildCreateBody: buildEwmCreateBody,
  pathParams: ewmPathParams,
  parseResponse: parseEwmResponse,
};
