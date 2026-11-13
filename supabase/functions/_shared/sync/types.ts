/**
 * Tipos de la sincronización de tenants (migración 20261021000100).
 *
 * La Edge Function OBSERVA (GET firmados M2M) y la base DECIDE: estos tipos
 * son lo que viaja entre ambas. Ningún campo lleva cuerpos crudos, tokens ni
 * valores de secretos: solo códigos, estados e identificadores del producto.
 */
import type { AdapterCapability, M2mAlgorithm, ProvisioningEnvironment } from '../provisioning/types.ts';

/** Un vínculo ACTIVO (tenant_product_mappings) tal como lo entrega `tenant_sync_plan`. */
export interface SyncPlanLink {
  mapping_id: string;
  tenant_id: string;
  request_id: string | null;
  external_tenant_id: string | null;
  external_organization_id: string | null;
  external_company_id: string | null;
  /** Estado que la app DEBERÍA tener; null = el tenant aún no opera (PENDING). */
  expected_state: 'ACTIVE' | 'SUSPENDED' | null;
}

export interface SyncPlanTarget {
  product: { id: string; code: string; short_name: string };
  deployment: {
    id: string;
    code: string;
    environment: ProvisioningEnvironment | null;
    base_url: string | null;
    timeout_ms: number;
    retry_count: number;
    enabled: boolean;
  };
  integration: {
    id: string;
    code: string;
    type: string;
    enabled: boolean;
    adapter_key: string;
    capabilities: AdapterCapability[];
    issuer: string;
    audience: string | null;
    subject: string;
    algorithm: M2mAlgorithm | null;
    token_ttl_seconds: number | null;
    lifecycle_path: string | null;
    lifecycle_read_scope: string | null;
    inventory_path: string | null;
    inventory_read_scope: string | null;
    allowed_hosts: string[];
  };
  credential: {
    id: string;
    type: 'M2M_ASYMMETRIC_JWT' | 'NONE';
    enabled: boolean;
    algorithm: M2mAlgorithm | null;
    token_ttl_seconds: number | null;
    /** NOMBRE del secreto; el valor lo resuelve el `SecretResolver`. */
    secret_ref: string | null;
  } | null;
  links: SyncPlanLink[];
}

export type LinkExistence = 'FOUND' | 'NOT_FOUND' | 'UNKNOWN';
export type AppState = 'ACTIVE' | 'SUSPENDED';
export type VerifyMethod = 'GET_STATUS' | 'LIFECYCLE' | 'INVENTORY';

export interface LinkObservation {
  mapping_id: string;
  exists: LinkExistence;
  app_state: AppState | null;
  ids_match: boolean | null;
  http_status: number | null;
  error_code: string | null;
}

/** Fila del inventario tenant-inventory.v1 (TENANT_INVENTORY_CONTRACT.md §4). */
export interface InventoryItem {
  externalTenantId: string;
  externalOrganizationId: string | null;
  externalCompanyId: string | null;
  controlPlaneTenantId: string | null;
  code: string | null;
  name: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
}

export interface InventoryObservation {
  status: 'AVAILABLE' | 'NOT_AVAILABLE' | 'FAILED';
  /** true solo si se leyeron TODAS las páginas sin un ítem inválido. */
  complete: boolean;
  error_code: string | null;
  items: InventoryItem[];
}

export interface TargetObservation {
  verify_methods: VerifyMethod[];
  error_code: string | null;
  links: LinkObservation[];
  inventory: InventoryObservation;
}

export interface SyncActor {
  id: string | null;
  role: string;
}

export const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export function codeOf(error: unknown, fallback = 'ERROR'): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CODE_RE.test(code) ? code : fallback;
}
