/**
 * Contrato ebim.entitlements/v1 (spec §7, §8, §9).
 *
 * Igual que `_shared/provisioning/types.ts`, nada de aquí conoce una tabla ni
 * una credencial de ningún SaaS: es la forma del snapshot que MasterAdmin
 * emite y de las respuestas que cada receptor devuelve.
 */

export const ENTITLEMENTS_SCHEMA = 'ebim.entitlements/v1';
export const ENTITLEMENTS_CONTRACT = 'entitlements.v1';
/** Tamaño máximo del snapshot canónico, en bytes UTF-8 (spec §7.2 regla 7). */
export const MAX_SNAPSHOT_BYTES = 65536;

export type EntitlementEnvironment = 'DEV' | 'QAS' | 'DEMO' | 'PRD';
export type ScopeLevel = 'TENANT' | 'COMPANY';
export type CapabilityKind = 'FEATURE' | 'LIMIT' | 'ALLOWANCE' | 'AI_FEATURE';
export type CapabilityStatus = 'DRAFT' | 'ACTIVE' | 'DEPRECATED';
export type GrantSource = 'BASELINE' | 'PLAN' | 'ADDON' | 'OVERRIDE';

/** `companyIds` ausente en COMPANY = todas las compañías del tenant. */
export interface CapabilityScope {
  level: ScopeLevel;
  companyIds?: string[];
}

export interface SnapshotCapability {
  code: string;
  enabled: boolean;
  scope: CapabilityScope;
  sources: GrantSource[];
}

export interface SnapshotLimit {
  code: string;
  value: number;
  unit: string | null;
  enforcement: 'HARD' | 'SOFT';
  scope: CapabilityScope;
  sources: GrantSource[];
}

/**
 * `overageMode` es BLOCK mientras no exista precio de exceso (D-06): sin
 * precio, el consumo por encima de lo incluido no se puede facturar, así que
 * el comportamiento técnico por defecto es cerrado.
 */
export interface SnapshotAllowance {
  code: string;
  meterCode: string;
  included: number;
  unit: string | null;
  period: { start: string; end: string };
  overageMode: 'BLOCK';
  sources: GrantSource[];
}

export interface SnapshotAiCredits {
  weights: { capabilityCode: string; creditsPerUnit: number; unit: string }[];
  weightsVersion: number;
}

export interface EntitlementSnapshot {
  schema: typeof ENTITLEMENTS_SCHEMA;
  environment: EntitlementEnvironment;
  controlPlaneTenantId: string;
  productCode: string;
  external: { tenantId: string; organizationId: string | null; companyIds: string[] };
  snapshotVersion: number;
  previousVersion: number | null;
  effectiveAt: string;
  issuedAt: string;
  appActive: boolean;
  planCode: string | null;
  capabilities: SnapshotCapability[];
  limits: SnapshotLimit[];
  allowances: SnapshotAllowance[];
  aiCredits: SnapshotAiCredits;
  correlationId: string;
  idempotencyKey: string;
  checksum: string;
}

/** Fila del registro de capacidades del producto (`product_capabilities`). */
export interface RegistryCapability {
  code: string;
  kind: CapabilityKind;
  isBaseline: boolean;
  scopeLevel: ScopeLevel;
  unit: string | null;
  meterCode: string | null;
  status: CapabilityStatus;
}

/** Fila de `compute_entitlements`: una por capacidad concedida. */
export interface GrantedCapability {
  code: string;
  value: number | null;
  enforcement: 'HARD' | 'SOFT' | null;
  included: number | null;
  sources: GrantSource[];
  /** null = todas las compañías. */
  companyIds: string[] | null;
}

export interface SnapshotInput {
  environment: EntitlementEnvironment;
  controlPlaneTenantId: string;
  productCode: string;
  external: { tenantId: string; organizationId: string | null; companyIds: string[] };
  snapshotVersion: number;
  previousVersion: number | null;
  effectiveAt: string;
  issuedAt: string;
  appActive: boolean;
  planCode: string | null;
  registry: RegistryCapability[];
  granted: GrantedCapability[];
  allowancePeriod: { start: string; end: string };
  aiCredits: SnapshotAiCredits;
  correlationId: string;
}

// ---------------------------------------------------------------------------
// Receptor (spec §8.2, §8.3)
// ---------------------------------------------------------------------------

export type AppliedStatus = 'NONE' | 'APPLIED' | 'APPLIED_WITH_WARNINGS';
export type EnforcementMode = 'LEGACY' | 'SHADOW' | 'DUAL_READ' | 'PRIMARY';

export type ReceiverErrorCode =
  | 'STALE_SNAPSHOT'
  | 'VERSION_CONFLICT'
  | 'CHECKSUM_MISMATCH'
  | 'ENVIRONMENT_MISMATCH'
  | 'TENANT_NOT_PROVISIONED'
  | 'SNAPSHOT_INVALID'
  | 'SNAPSHOT_TOO_LARGE'
  | 'INSUFFICIENT_SCOPE'
  | 'JTI_REPLAYED'
  | 'UNAUTHENTICATED';

export interface PutAppliedBody {
  appliedVersion: number;
  appliedChecksum: string;
  appliedAt: string;
  status: Exclude<AppliedStatus, 'NONE'>;
  unknownCapabilities: string[];
  replayed: boolean;
}

export interface GetAppliedBody {
  controlPlaneTenantId: string;
  productCode: string;
  appliedVersion: number | null;
  appliedChecksum: string | null;
  appliedAt: string | null;
  status: AppliedStatus;
  unknownCapabilities: string[];
  enforcementMode: EnforcementMode;
}

export interface ReceiverErrorBody {
  error: ReceiverErrorCode;
  message: string;
  appliedVersion?: number | null;
}

export class SnapshotError extends Error {
  constructor(
    readonly code: 'FORBIDDEN_KEY' | 'FORBIDDEN_VALUE' | 'SNAPSHOT_TOO_LARGE' | 'SNAPSHOT_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'SnapshotError';
  }
}
