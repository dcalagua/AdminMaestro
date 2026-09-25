/**
 * Contrato estándar de provisioning de la suite EBIM.
 *
 * MasterAdmin NO habla "EWM", ni "TMS", ni "Java", ni "Supabase". Habla ESTE
 * contrato. Un producto nuevo se integra implementando el contrato del otro
 * lado y configurando una fila en `platform.product_integrations` — no tocando
 * este código.
 *
 * Nada de lo que hay aquí conoce una tabla, un esquema ni una credencial de
 * ningún SaaS. Esa es la frontera del Control Plane y es lo que hace que el
 * modelo escale a productos que ni siquiera están escritos todavía.
 */

export type ProvisioningEnvironment = 'DEV' | 'QAS' | 'DEMO' | 'PRD';

export type AdapterType = 'HTTP_M2M' | 'EDGE_FUNCTION' | 'MANUAL' | 'MOCK';

export type M2mAlgorithm = 'RS256' | 'ES256';

/**
 * Contrato que habla una integración HTTP_M2M. `GENERIC` es el estándar EBIM
 * v1; el resto son codecs compilados para productos que ya tienen un contrato
 * propio y no pueden cambiarlo. Espejo del enum `platform.integration_adapter`.
 */
export type AdapterKey = 'GENERIC' | 'EWM_V1';
export const ADAPTER_KEYS: readonly AdapterKey[] = ['GENERIC', 'EWM_V1'];

export type AdapterCapability = 'PROVISION' | 'GET_STATUS' | 'REPLAY_CERTIFICATION';

/** Configuración del contrato, tal y como la resuelve la base. */
export interface IntegrationConfig {
  id: string;
  code: string;
  type: AdapterType;
  contract_version: string;
  status: string;
  enabled: boolean;
  issuer: string;
  audience: string | null;
  subject: string;
  algorithm: M2mAlgorithm | null;
  token_ttl_seconds: number | null;
  create_scope: string | null;
  read_scope: string | null;
  additional_scopes: string[];
  create_path_template: string | null;
  status_path_template: string | null;
  health_path_template: string | null;
  allowed_hosts: string[];
}

export interface DeploymentConfig {
  id: string;
  code: string;
  deployment_mode: 'SHARED' | 'PARTNER_DEDICATED' | 'TENANT_DEDICATED';
  environment: ProvisioningEnvironment;
  base_url: string | null;
  timeout_ms: number;
  retry_count: number;
  status: string;
  enabled: boolean;
  health_status: string;
}

/**
 * Metadata de credencial. `secret_ref` es el NOMBRE del secreto; el VALOR se
 * resuelve con un `SecretResolver` y nunca se guarda en ningún objeto que pueda
 * acabar serializado en un log o en una respuesta.
 */
export interface CredentialConfig {
  id: string;
  code: string;
  type: 'M2M_ASYMMETRIC_JWT' | 'NONE';
  enabled: boolean;
  algorithm: M2mAlgorithm | null;
  token_ttl_seconds: number | null;
  secret_ref: string | null;
  public_key_ref: string | null;
}

export interface RequestConfig {
  id: string;
  status: string;
  idempotency_key: string;
  correlation_id: string;
  attempt_count: number;
  max_attempts: number;
  request_version: number;
  environment: ProvisioningEnvironment;
  policy: string;
  requested_by: string | null;
  subscription_id: string | null;
}

/** Payload estándar. Es el MISMO para todos los productos de la suite. */
export interface ProvisioningPayload {
  tenantCode: string;
  tenantName: string;
  adminEmail: string;
  tenantType: string;
  environment: ProvisioningEnvironment;
  deploymentMode: string;
  organization: Record<string, unknown>;
  company: Record<string, unknown> | null;
  plan: Record<string, unknown> | null;
  masterAdmin: Record<string, unknown>;
}

/**
 * Identidades y atributos de entidades de MasterAdmin, tal y como los resuelve
 * `provisioning_execution_context`. Nada aquí es específico de un producto: un
 * codec toma de aquí lo que su contrato necesita.
 */
export interface ProvisioningSource {
  tenant: { id: string; slug: string; name: string; admin_email: string; deployment_mode: string };
  organization: {
    id: string;
    slug: string;
    legal_name: string;
    display_name: string;
    country_code: string;
    tax_id: string | null;
  };
  company: {
    id: string;
    name: string;
    erp_code: string | null;
    country_code: string;
    currency: string;
    tax_id: string | null;
  } | null;
  mapping: {
    external_tenant_id: string | null;
    external_organization_id: string | null;
    external_company_id: string | null;
  } | null;
  product_configuration: Record<string, unknown>;
}

/** Todo lo que un adaptador necesita. Lo resuelve el SERVIDOR, no el cliente. */
export interface ProvisioningContext {
  request: RequestConfig;
  product: { id: string; code: string; short_name: string };
  deployment: DeploymentConfig | null;
  integration: IntegrationConfig | null;
  credential: CredentialConfig | null;
  payload: ProvisioningPayload;
  /** Usuario humano que inició la operación. Viaja como claim de AUDITORÍA. */
  actor: { id: string | null; role: string };
  source?: ProvisioningSource;
  adapter?: { key: AdapterKey; capabilities: AdapterCapability[] };
}

/**
 * Resultado NORMALIZADO de un adaptador.
 *
 * No hay hueco para el cuerpo crudo del proveedor a propósito: lo que no se
 * puede representar aquí, no llega al frontend. `rawReference` es un
 * identificador opaco del proveedor (una referencia de operación), no su
 * respuesta.
 */
export interface AdapterResult {
  status: 'ACTIVE' | 'PENDING';
  externalTenantId: string;
  externalOrganizationId: string | null;
  externalCompanyId: string | null;
  resources: Record<string, unknown>;
  rawReference: string | null;
  /** Sólo lo asignan codecs cuyo contrato distingue alta nueva de repetición. */
  replayed?: boolean;
}

export interface AdapterFailure {
  /** Código estable y accionable. Nunca el texto del proveedor tal cual. */
  code: string;
  message: string;
  httpStatus: number | null;
  retryable: boolean;
  detail: Record<string, unknown>;
}

export type AdapterOutcome =
  | { ok: true; result: AdapterResult; attempts: number; httpStatus?: number }
  | { ok: false; failure: AdapterFailure; attempts: number };

export interface HealthOutcome {
  health: 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  detail: string;
}

/**
 * Interfaz del adaptador.
 *
 * `suspend` y `activate` NO están aquí todavía a propósito: implementarlos sin
 * un contrato acordado con los productos sería inventar semántica que después
 * habría que romper.
 */
export interface ProvisioningAdapter {
  readonly type: AdapterType;
  readonly capabilities: readonly AdapterCapability[];
  provision(context: ProvisioningContext): Promise<AdapterOutcome>;
  getStatus(context: ProvisioningContext): Promise<AdapterOutcome>;
  /** Bloqueos de datos ANTES de firmar o llamar. Ausente = sin bloqueos. */
  validateInput?(context: ProvisioningContext): string[];
  /** SHA-256 del texto exacto del cuerpo de creación. */
  createBodyFingerprint?(context: ProvisioningContext): Promise<string>;
}

/**
 * Forma de un contrato. Sin E/S: no firma, no llama, no lee secretos. El
 * transporte, el guard SSRF, la firma y los reintentos son del adaptador y son
 * los mismos para todos los codecs.
 */
export interface ContractCodec {
  readonly key: AdapterKey;
  readonly capabilities: readonly AdapterCapability[];
  validateInput(context: ProvisioningContext): string[];
  buildCreateBody(context: ProvisioningContext): unknown;
  pathParams(context: ProvisioningContext): Record<string, string>;
  /** `context` permite contrastar la respuesta con lo enviado; GENERIC lo ignora. */
  parseResponse(body: unknown, operation: 'create' | 'read', context: ProvisioningContext): AdapterResult;
}

/**
 * Resolución del VALOR de un secreto a partir de su nombre.
 *
 * Es una interfaz y no una llamada directa a `Deno.env` para que las pruebas
 * puedan inyectar un resolutor falso sin que el módulo dependa del runtime —
 * y, sobre todo, para que exista UN SOLO sitio por el que un secreto entra al
 * proceso.
 */
export interface SecretResolver {
  (secretRef: string): string | undefined;
}

/** Error de adaptador con código estable, para no clasificar por `message`. */
export class ProvisioningError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number | null = null,
    readonly retryable = false,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ProvisioningError';
  }
}
