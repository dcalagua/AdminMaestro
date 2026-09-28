/**
 * Paridad dual-read hub GMAO ↔ MasterAdmin (spec §15.1, §15.3, fase 16).
 *
 * Compara, por tenant×producto, el estado LEGACY que el hub concede
 * (`mapHubExport` → `legacyTenantState`) con el snapshot que MasterAdmin
 * emitió. Solo QUÉ tiene cada tenant; nunca cuánto cuesta (D-01).
 *
 * BLOQUEANTES (impiden avanzar el eje; un solo caso → BLOCKED):
 *   TENANT_NOT_LINKED              la organización del hub no tiene tenant en MasterAdmin
 *   SNAPSHOT_MISSING               el tenant está vinculado pero no hay snapshot
 *   APP_ACTIVE_MISMATCH            workspace_apps.status='active' ≠ snapshot.appActive
 *   CAPABILITY_ONLY_IN_HUB         el hub la concede y MasterAdmin no
 *   CAPABILITY_ONLY_IN_MASTERADMIN MasterAdmin la concede y el hub no
 *   UNMAPPED_ACTIVE_HUB_CODE       código activo del hub sin capacidad canónica
 * AVISOS (se explican y aprueban; no bloquean):
 *   COMPANY_SCOPE_PARTIAL          activa solo en algunas compañías de la organización
 *   HUB_ITEM_UNAVAILABLE_BUT_ACTIVE ítem `available=false` en el catálogo pero activo
 *   DRAFT_CAPABILITY_IN_HUB        el hub concede una capacidad DRAFT del registro
 *
 * Decisiones:
 *   · las baseline del registro se ignoran en los dos lados (van con la app);
 *   · una capacidad DRAFT concedida por el hub es AVISO y no
 *     CAPABILITY_ONLY_IN_HUB: el snapshot nunca lista DRAFT y el SaaS no está
 *     obligado a hacerla cumplir (spec §4 regla 3), así que no hay decisión de
 *     acceso que cambie al pasar a MasterAdmin;
 *   · MasterAdmin «concede» = capability con `enabled:true`, o cualquier
 *     límite/asignación presente en el snapshot;
 *   · sin vínculo o sin snapshot no se compara capacidad por capacidad (no hay
 *     contra qué), pero sí se informan los hallazgos propios del hub.
 */
import { canonicalize } from '../jcs.ts';
import { sha256Hex } from '../../provisioning/fingerprint.ts';
import type { EntitlementSnapshot, RegistryCapability } from '../types.ts';
import type { LegacyTenantState } from './hub-mapping.ts';

/** Lo que la paridad necesita del snapshot; un EntitlementSnapshot completo lo cumple. */
export type HubParitySnapshotView = Pick<
  EntitlementSnapshot,
  'productCode' | 'controlPlaneTenantId' | 'appActive' | 'capabilities' | 'limits' | 'allowances'
>;

export type HubParityBlockingType =
  | 'TENANT_NOT_LINKED'
  | 'SNAPSHOT_MISSING'
  | 'APP_ACTIVE_MISMATCH'
  | 'CAPABILITY_ONLY_IN_HUB'
  | 'CAPABILITY_ONLY_IN_MASTERADMIN'
  | 'UNMAPPED_ACTIVE_HUB_CODE';
export type HubParityWarningType = 'COMPANY_SCOPE_PARTIAL' | 'HUB_ITEM_UNAVAILABLE_BUT_ACTIVE' | 'DRAFT_CAPABILITY_IN_HUB';
export type HubParityDiffType = HubParityBlockingType | HubParityWarningType;
export type HubParitySeverity = 'BLOCKING' | 'WARNING';
export type HubParityVerdict = 'GREEN' | 'BLOCKED';

export interface HubParityDiff {
  type: HubParityDiffType;
  severity: HubParitySeverity;
  capabilityCode: string | null;
  hubCodes: string[];
  detail: string;
}

export interface HubParityResult {
  productCode: string;
  organizationId: string;
  tenantId: string | null;
  verdict: HubParityVerdict;
  blocking: number;
  warnings: number;
  diffs: HubParityDiff[];
}

export interface HubParityProductSummary {
  productCode: string;
  tenants: number;
  green: number;
  blocked: number;
  blocking: number;
  warnings: number;
  verdict: HubParityVerdict;
}

/**
 * Lo que el operador entrega a la RPC service_role de GMAO
 * `platform.ccp_record_hub_parity(...)`: la guarda de autoridad de GMAO solo
 * permite MASTERADMIN_AUTHORITY tras una paridad con `blocking = 0`.
 */
export interface HubParityAttestation {
  productCode: string;
  blocking: number;
  warnings: number;
  tenants: number;
  /** Checksum del export del hub tal como lo firmó GMAO. */
  exportChecksum: string;
  /** `sha256:` del JCS de los resultados del producto, ordenados. */
  reportChecksum: string;
  ranAt: string;
}

export class HubParityError extends Error {
  constructor(message: string) {
    super(`HUB_PARITY_INVALID: ${message}`);
    this.name = 'HubParityError';
  }
}

const SEVERITY: Record<HubParityDiffType, HubParitySeverity> = {
  TENANT_NOT_LINKED: 'BLOCKING',
  SNAPSHOT_MISSING: 'BLOCKING',
  APP_ACTIVE_MISMATCH: 'BLOCKING',
  CAPABILITY_ONLY_IN_HUB: 'BLOCKING',
  CAPABILITY_ONLY_IN_MASTERADMIN: 'BLOCKING',
  UNMAPPED_ACTIVE_HUB_CODE: 'BLOCKING',
  COMPANY_SCOPE_PARTIAL: 'WARNING',
  HUB_ITEM_UNAVAILABLE_BUT_ACTIVE: 'WARNING',
  DRAFT_CAPABILITY_IN_HUB: 'WARNING',
};

const CHECKSUM_RE = /^sha256:[0-9a-f]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function diff(type: HubParityDiffType, capabilityCode: string | null, hubCodes: string[], detail: string): HubParityDiff {
  return { type, severity: SEVERITY[type], capabilityCode, hubCodes: [...new Set(hubCodes)].sort(cmp), detail };
}

function sortDiffs(diffs: HubParityDiff[]): HubParityDiff[] {
  const rank = (s: HubParitySeverity) => (s === 'BLOCKING' ? 0 : 1);
  return diffs.sort(
    (a, b) =>
      rank(a.severity) - rank(b.severity) ||
      cmp(a.type, b.type) ||
      cmp(a.capabilityCode ?? '', b.capabilityCode ?? '') ||
      cmp(a.hubCodes.join(','), b.hubCodes.join(',')),
  );
}

/** Compara un tenant×producto. `snapshot` null = MasterAdmin no emitió snapshot. */
export function compareHubWithMasterAdmin(
  state: LegacyTenantState,
  snapshot: HubParitySnapshotView | null,
  registry: RegistryCapability[],
): HubParityResult {
  if (snapshot && (snapshot.productCode !== state.productCode || snapshot.controlPlaneTenantId !== state.tenantId)) {
    throw new HubParityError('el snapshot no corresponde al tenant×producto del estado legacy');
  }
  const byCode = new Map(registry.map((c) => [c.code, c]));
  const isBaseline = (code: string) => byCode.get(code)?.isBaseline === true;
  const isDraft = (code: string) => byCode.get(code)?.status === 'DRAFT';

  const diffs: HubParityDiff[] = [];

  // Hallazgos propios del hub: se informan siempre.
  const hubGranted = new Map<string, string[]>();
  const capabilityOfHubCode = new Map<string, string>();
  for (const [code, cap] of Object.entries(state.capabilities)) {
    if (isBaseline(code)) continue;
    for (const hubCode of cap.hubCodes) capabilityOfHubCode.set(hubCode, code);
    if (cap.activeCompanies === 0 && !cap.viaSubscription) continue;
    hubGranted.set(code, cap.hubCodes);
    if (!cap.viaSubscription && cap.activeCompanies < cap.totalCompanies) {
      diffs.push(
        diff('COMPANY_SCOPE_PARTIAL', code, cap.hubCodes, `activa en ${cap.activeCompanies} de ${cap.totalCompanies} compañías`),
      );
    }
    if (isDraft(code)) diffs.push(diff('DRAFT_CAPABILITY_IN_HUB', code, cap.hubCodes, 'capacidad DRAFT en el registro'));
  }
  for (const hubCode of state.unmappedActiveCodes) {
    diffs.push(diff('UNMAPPED_ACTIVE_HUB_CODE', null, [hubCode], 'código activo del hub sin capacidad canónica'));
  }
  for (const hubCode of state.unavailableActiveCodes) {
    const code = capabilityOfHubCode.get(hubCode) ?? null;
    if (code !== null && isBaseline(code)) continue;
    diffs.push(diff('HUB_ITEM_UNAVAILABLE_BUT_ACTIVE', code, [hubCode], 'ítem no disponible en el catálogo del hub pero activo'));
  }

  if (!state.linked || state.tenantId === null) {
    diffs.push(diff('TENANT_NOT_LINKED', null, [], 'la organización del hub no tiene tenant en MasterAdmin'));
  } else if (!snapshot) {
    diffs.push(diff('SNAPSHOT_MISSING', null, [], 'MasterAdmin no tiene snapshot para este tenant×producto'));
  } else {
    if (snapshot.appActive !== state.appActive) {
      diffs.push(
        diff('APP_ACTIVE_MISMATCH', null, [], `hub appActive=${String(state.appActive)} · MasterAdmin appActive=${String(snapshot.appActive)}`),
      );
    }
    const maGranted = new Set<string>([
      ...snapshot.capabilities.filter((c) => c.enabled).map((c) => c.code),
      ...snapshot.limits.map((l) => l.code),
      ...snapshot.allowances.map((a) => a.code),
    ]);
    for (const code of [...maGranted].filter((c) => isBaseline(c))) maGranted.delete(code);

    for (const [code, hubCodes] of hubGranted) {
      if (!maGranted.has(code) && !isDraft(code)) {
        diffs.push(diff('CAPABILITY_ONLY_IN_HUB', code, hubCodes, 'el hub la concede y MasterAdmin no'));
      }
    }
    for (const code of maGranted) {
      if (!hubGranted.has(code)) {
        diffs.push(diff('CAPABILITY_ONLY_IN_MASTERADMIN', code, [], 'MasterAdmin la concede y el hub no'));
      }
    }
  }

  const sorted = sortDiffs(diffs);
  const blocking = sorted.filter((d) => d.severity === 'BLOCKING').length;
  return {
    productCode: state.productCode,
    organizationId: state.organizationId,
    tenantId: state.tenantId,
    verdict: blocking === 0 ? 'GREEN' : 'BLOCKED',
    blocking,
    warnings: sorted.length - blocking,
    diffs: sorted,
  };
}

function sortResults(results: HubParityResult[]): HubParityResult[] {
  return [...results].sort((a, b) => cmp(a.productCode, b.productCode) || cmp(a.organizationId, b.organizationId));
}

/** Agregado por producto. GREEN solo con al menos un tenant y 0 bloqueantes. */
export function summarizeHubParity(results: HubParityResult[]): HubParityProductSummary[] {
  const byProduct = new Map<string, HubParityResult[]>();
  for (const r of results) byProduct.set(r.productCode, [...(byProduct.get(r.productCode) ?? []), r]);
  return [...byProduct.keys()].sort(cmp).map((productCode) => {
    const list = byProduct.get(productCode) as HubParityResult[];
    const blocking = list.reduce((n, r) => n + r.blocking, 0);
    return {
      productCode,
      tenants: list.length,
      green: list.filter((r) => r.verdict === 'GREEN').length,
      blocked: list.filter((r) => r.verdict === 'BLOCKED').length,
      blocking,
      warnings: list.reduce((n, r) => n + r.warnings, 0),
      verdict: blocking === 0 ? 'GREEN' : 'BLOCKED',
    };
  });
}

function cell(value: string | number | null): string {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function tenantLabel(r: HubParityResult): string {
  return r.tenantId ?? `sin vínculo (org ${r.organizationId})`;
}

export interface HubParityReportMeta {
  environment: string;
  generatedAt: string;
  exportContentChecksum?: string;
  mappingChecksum?: string;
}

/** Reporte markdown. Sin precios ni secretos: solo códigos, conteos y checksums. */
export function renderHubParityReport(results: HubParityResult[], meta: HubParityReportMeta): string {
  const sorted = sortResults(results);
  const summary = summarizeHubParity(sorted);
  const out: string[] = [
    '# Hub GMAO · paridad dual-read hub vs MasterAdmin',
    '',
    `Entorno: ${cell(meta.environment)} · generado: ${cell(meta.generatedAt)}`,
  ];
  if (meta.exportContentChecksum) out.push('', `Export (contenido): \`${meta.exportContentChecksum}\``);
  if (meta.mappingChecksum) out.push('', `Mapeo: \`${meta.mappingChecksum}\``);
  out.push(
    '',
    'Solo QUÉ concede cada fuente (app activa, capacidades); nunca cuánto cuesta (D-01).',
    'GREEN = 0 diferencias bloqueantes. Las capacidades baseline no se comparan.',
    '',
    '## Productos',
    '',
    '| Producto | Tenants | GREEN | BLOCKED | Bloqueantes | Avisos | Veredicto |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...summary.map(
      (s) =>
        `| ${cell(s.productCode)} | ${s.tenants} | ${s.green} | ${s.blocked} | ${s.blocking} | ${s.warnings} | ${s.verdict} |`,
    ),
    '',
    '## Tenants',
    '',
    '| Producto | Tenant | Organización hub | Bloqueantes | Avisos | Veredicto |',
    '| --- | --- | --- | --- | --- | --- |',
    ...sorted.map(
      (r) =>
        `| ${cell(r.productCode)} | ${cell(tenantLabel(r))} | ${cell(r.organizationId)} | ${r.blocking} | ${r.warnings} | ${r.verdict} |`,
    ),
    '',
    '## Diferencias',
    '',
  );
  const rows = sorted.flatMap((r) => r.diffs.map((d) => ({ r, d })));
  if (rows.length === 0) {
    out.push('Ninguna.');
  } else {
    out.push('| Producto | Tenant | Severidad | Tipo | Capacidad | Códigos hub | Detalle |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const { r, d } of rows) {
      out.push(
        `| ${cell(r.productCode)} | ${cell(tenantLabel(r))} | ${d.severity} | ${d.type} | ${cell(d.capabilityCode)} | ${cell(d.hubCodes.join(', ') || null)} | ${cell(d.detail)} |`,
      );
    }
  }
  out.push('');
  return out.join('\n');
}

/**
 * Atestación de paridad de UN producto, para la RPC de GMAO. Determinista
 * salvo `ranAt` (inyectable; por defecto, ahora en UTC).
 */
export async function buildParityAttestation(
  productCode: string,
  results: HubParityResult[],
  exportChecksum: string,
  ranAt: string = new Date().toISOString(),
): Promise<HubParityAttestation> {
  if (!CHECKSUM_RE.test(exportChecksum)) throw new HubParityError('exportChecksum debe ser sha256:<hex>');
  if (!ISO_RE.test(ranAt) || Number.isNaN(Date.parse(ranAt))) throw new HubParityError('ranAt debe ser ISO-8601 con zona');
  const product = sortResults(results.filter((r) => r.productCode === productCode));
  return {
    productCode,
    blocking: product.reduce((n, r) => n + r.blocking, 0),
    warnings: product.reduce((n, r) => n + r.warnings, 0),
    tenants: product.length,
    exportChecksum,
    reportChecksum: `sha256:${await sha256Hex(canonicalize(product))}`,
    ranAt,
  };
}
