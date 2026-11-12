/**
 * Snapshot ebim.entitlements/v1 (spec §7).
 *
 * MasterAdmin EMITE el snapshot en la base (`platform.issue_entitlement_snapshot`),
 * en la misma transacción que asigna la versión monótona: así versión, contenido
 * y checksum no pueden separarse. Este módulo es el espejo en TS de esa
 * composición y se usa para:
 *
 *   · generar los fixtures dorados FIX-ENT-v1 (contracts/entitlements/v1);
 *   · verificar, ANTES de enviar, que lo que la base emitió es seguro y que su
 *     checksum cuadra (`verifySnapshot`): el último punto antes de que el
 *     documento salga del perímetro de MasterAdmin.
 *
 * Reglas de composición (idénticas en SQL):
 *   · capabilities = todas las FEATURE/AI_FEATURE no baseline ACTIVE del
 *     registro, con `enabled` explícito, más las DEPRECATED que siguen
 *     concedidas. Baseline y DRAFT no se listan;
 *   · limits / allowances = solo las concedidas (ACTIVE o DEPRECATED);
 *   · todo ordenado por código; fuentes y compañías ordenadas;
 *   · scope COMPANY sin `companyIds` = todas las compañías.
 */
import { canonicalize, entitlementChecksum } from './jcs.ts';
import { sha256Hex } from '../provisioning/fingerprint.ts';
import {
  ENTITLEMENTS_SCHEMA,
  MAX_SNAPSHOT_BYTES,
  SnapshotError,
  type CapabilityScope,
  type EntitlementSnapshot,
  type GrantedCapability,
  type GrantSource,
  type RegistryCapability,
  type SnapshotInput,
} from './types.ts';

/** Fragmentos de clave prohibidos (spec §7.2 regla 6), en minúsculas. */
const FORBIDDEN_KEY_FRAGMENTS = ['price', 'amount', 'currency', 'cost', 'secret', 'token', 'email', 'key', 'password'];
const ALLOWED_KEYS = new Set(['idempotencyKey']);

const FORBIDDEN_VALUE_PATTERNS: [string, RegExp][] = [
  ['correo', /[^\s@]+@[^\s@]+\.[^\s@]+/],
  ['clave PEM', /-----BEGIN [A-Z ]+-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./],
];

function byCode<T extends { code: string }>(a: T, b: T): number {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

function sortedStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function scopeFor(capability: RegistryCapability, granted: GrantedCapability | undefined): CapabilityScope {
  if (capability.scopeLevel === 'TENANT') return { level: 'TENANT' };
  if (!granted || granted.companyIds === null || granted.companyIds.length === 0) return { level: 'COMPANY' };
  return { level: 'COMPANY', companyIds: sortedStrings(granted.companyIds) };
}

function sourcesOf(granted: GrantedCapability): GrantSource[] {
  return sortedStrings(granted.sources);
}

export async function idempotencyKeyFor(tenantId: string, productCode: string, version: number): Promise<string> {
  return `ma-ent-v1-${await sha256Hex(`${tenantId}:${productCode}:${version}`)}`;
}

/** Recorre claves y valores. Lanza en la primera violación. */
export function assertSnapshotSafe(document: unknown, path = '$'): void {
  if (Array.isArray(document)) {
    document.forEach((item, i) => assertSnapshotSafe(item, `${path}[${i}]`));
    return;
  }
  if (document !== null && typeof document === 'object') {
    for (const [key, value] of Object.entries(document as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (!ALLOWED_KEYS.has(key) && FORBIDDEN_KEY_FRAGMENTS.some((f) => lower.includes(f))) {
        throw new SnapshotError('FORBIDDEN_KEY', `FORBIDDEN_KEY: clave prohibida en el snapshot: ${path}.${key}`);
      }
      assertSnapshotSafe(value, `${path}.${key}`);
    }
    return;
  }
  if (typeof document === 'string') {
    for (const [label, re] of FORBIDDEN_VALUE_PATTERNS) {
      if (re.test(document)) {
        // El mensaje nombra la RUTA y el tipo de hallazgo, nunca el valor.
        throw new SnapshotError('FORBIDDEN_VALUE', `FORBIDDEN_VALUE: ${path} tiene forma de ${label}`);
      }
    }
  }
}

function assertSize(document: unknown): void {
  const bytes = new TextEncoder().encode(canonicalize(document)).length;
  if (bytes > MAX_SNAPSHOT_BYTES) {
    throw new SnapshotError('SNAPSHOT_TOO_LARGE', `El snapshot ocupa ${bytes} bytes; el máximo es ${MAX_SNAPSHOT_BYTES}`);
  }
}

export async function buildSnapshot(input: SnapshotInput): Promise<EntitlementSnapshot> {
  if (!Number.isInteger(input.snapshotVersion) || input.snapshotVersion < 1) {
    throw new SnapshotError('SNAPSHOT_INVALID', 'snapshotVersion debe ser un entero ≥ 1');
  }
  if (input.previousVersion !== null && !(input.previousVersion < input.snapshotVersion)) {
    throw new SnapshotError('SNAPSHOT_INVALID', 'previousVersion debe ser menor que snapshotVersion');
  }
  if (Date.parse(input.effectiveAt) > Date.parse(input.issuedAt)) {
    throw new SnapshotError('SNAPSHOT_INVALID', 'effectiveAt no puede ser posterior a la emisión');
  }

  const grantedByCode = new Map(input.granted.map((g) => [g.code, g]));
  const registry = [...input.registry].sort(byCode);

  const capabilities = registry
    .filter((c) => (c.kind === 'FEATURE' || c.kind === 'AI_FEATURE') && !c.isBaseline)
    .filter((c) => c.status === 'ACTIVE' || (c.status === 'DEPRECATED' && grantedByCode.has(c.code)))
    .map((c) => {
      const g = grantedByCode.get(c.code);
      return { code: c.code, enabled: g !== undefined, scope: scopeFor(c, g), sources: g ? sourcesOf(g) : [] };
    });

  const live = (c: RegistryCapability) => c.status === 'ACTIVE' || c.status === 'DEPRECATED';

  const limits = registry
    .filter((c) => c.kind === 'LIMIT' && live(c) && grantedByCode.get(c.code)?.value != null)
    .map((c) => {
      const g = grantedByCode.get(c.code)!;
      return {
        code: c.code,
        value: g.value as number,
        unit: c.unit,
        enforcement: g.enforcement ?? 'HARD',
        scope: scopeFor(c, g),
        sources: sourcesOf(g),
      };
    });

  const allowances = registry
    .filter((c) => c.kind === 'ALLOWANCE' && live(c) && grantedByCode.get(c.code)?.included != null)
    .map((c) => {
      const g = grantedByCode.get(c.code)!;
      return {
        code: c.code,
        meterCode: c.meterCode as string,
        included: g.included as number,
        unit: c.unit,
        period: { start: input.allowancePeriod.start, end: input.allowancePeriod.end },
        overageMode: 'BLOCK' as const,
        sources: sourcesOf(g),
      };
    });

  const draft: Omit<EntitlementSnapshot, 'checksum'> = {
    schema: ENTITLEMENTS_SCHEMA,
    environment: input.environment,
    controlPlaneTenantId: input.controlPlaneTenantId,
    productCode: input.productCode,
    external: {
      tenantId: input.external.tenantId,
      organizationId: input.external.organizationId,
      companyIds: sortedStrings(input.external.companyIds),
    },
    snapshotVersion: input.snapshotVersion,
    previousVersion: input.previousVersion,
    effectiveAt: input.effectiveAt,
    issuedAt: input.issuedAt,
    appActive: input.appActive,
    planCode: input.planCode,
    capabilities,
    limits,
    allowances,
    aiCredits: {
      weights: [...input.aiCredits.weights].sort((a, b) =>
        a.capabilityCode < b.capabilityCode ? -1 : a.capabilityCode > b.capabilityCode ? 1 : 0,
      ),
      weightsVersion: input.aiCredits.weightsVersion,
    },
    correlationId: input.correlationId,
    idempotencyKey: await idempotencyKeyFor(input.controlPlaneTenantId, input.productCode, input.snapshotVersion),
  };

  assertSnapshotSafe(draft);
  const snapshot: EntitlementSnapshot = {
    ...draft,
    checksum: await entitlementChecksum(draft as unknown as Record<string, unknown>),
  };
  assertSize(snapshot);
  return snapshot;
}

/**
 * Verificación previa al envío. Devuelve la lista de problemas (vacía = OK)
 * en vez de lanzar, para que el job registre el motivo y no empuje.
 */
export async function verifySnapshot(snapshot: EntitlementSnapshot): Promise<string[]> {
  const problems: string[] = [];
  if (snapshot?.schema !== ENTITLEMENTS_SCHEMA) problems.push('SNAPSHOT_INVALID');
  try {
    assertSnapshotSafe(snapshot);
    assertSize(snapshot);
  } catch (error) {
    problems.push(error instanceof SnapshotError ? error.code : 'SNAPSHOT_INVALID');
  }
  try {
    const expected = await entitlementChecksum(snapshot as unknown as Record<string, unknown>);
    if (expected !== snapshot.checksum) problems.push('CHECKSUM_MISMATCH');
  } catch {
    problems.push('SNAPSHOT_INVALID');
  }
  return problems;
}
