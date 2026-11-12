/**
 * Contrato ebim.usage/v1 (spec §11.3, contracts/usage/v1/README.md).
 *
 * El SaaS firma con SU clave ES256 (una por producto × ambiente) y MasterAdmin
 * verifica con la pública registrada por referencia en
 * platform.usage_ingest_credentials. La credencial identifica al producto
 * (desviación D-12 del contrato §2.6); cada evento trae su controlPlaneTenantId.
 */
export const USAGE_SCHEMA = 'ebim.usage/v1';
export const USAGE_AUDIENCE = 'masteradmin.ebim';
export const USAGE_SCOPE = 'usage:ingest';
export const MAX_EVENTS = 500;
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_TOKEN_TTL_SECONDS = 300;
export const CLOCK_SKEW_SECONDS = 60;

export type UsageEnvironment = 'DEV' | 'QAS' | 'DEMO' | 'PRD';

export interface UsageInternal {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  latencyMs?: number;
  costAmount?: number;
  costCurrency?: string;
}

export interface UsageEvent {
  eventId: string;
  meterCode: string;
  quantity: number;
  unit: string;
  occurredAt: string;
  controlPlaneTenantId: string;
  externalCompanyId?: string;
  subjectRef?: string;
  capabilityCode?: string;
  internal?: UsageInternal;
}

export interface UsageBatch {
  schema: typeof USAGE_SCHEMA;
  environment: UsageEnvironment;
  productCode?: string;
  batchId: string;
  events: UsageEvent[];
}

export type EventStatus = 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';

export interface EventResult {
  eventId: string | null;
  status: EventStatus;
  code?: string;
}

export interface BatchResult {
  results: EventResult[];
  accepted: number;
  duplicate: number;
  rejected: number;
}

/** Códigos de rechazo por evento que puede devolver ingest_usage_events. */
export const EVENT_REJECTION_CODES = [
  'INVALID_EVENT',
  'UNKNOWN_METER',
  'NEGATIVE_QUANTITY',
  'UNIT_MISMATCH',
  'OCCURRED_AT_IN_FUTURE',
  'INTERNAL_METADATA_INVALID',
  'TENANT_NOT_MAPPED_FOR_PRODUCT',
  'ENVIRONMENT_MISMATCH',
  'CONFLICT',
] as const;

export class UsageIngestError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'UsageIngestError';
  }
}
