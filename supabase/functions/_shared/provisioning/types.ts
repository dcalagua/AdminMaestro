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
  | { ok: true; result: AdapterResult; attempts: number }
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
  provision(context: ProvisioningContext): Promise<AdapterOutcome>;
  getStatus(context: ProvisioningContext): Promise<AdapterOutcome>;
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
