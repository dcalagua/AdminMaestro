/**
 * EBIM Commercial Control Plane · Fase 18 · evidencia D-14 (DEV/LOCAL).
 *
 * D-14 (aprobada por el humano para DEV/LOCAL solamente) permite:
 *   · entitlements → MASTERADMIN_PRIMARY cuando la paridad y la seguridad del
 *     producto están en verde (spec §15.1, §19.1(6));
 *   · facturación de eExpense/GMAO → BILLING_SHADOW, con diff material 0
 *     calculado contra MasterAdmin y sin doble cobro (spec §15.2, §19.1(8));
 *   · appActive=false retira lo comercial, no la operación.
 *
 * Cada X-07 termina con una fase "D14" que ejecuta la transición gobernada
 * del producto (un paso por vez, con motivo), NO la revierte, verifica el
 * estado final por GET y escribe este JSON. summarize.mjs deriva los
 * criterios §19.1(6) y §19.1(8) de aquí y del rc del X-07; ningún criterio
 * queda "cumplido" por texto fijo.
 *
 * Sin CCP_EVIDENCE_DIR (corrida suelta del X-07) no escribe nada.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const D14_REASON = 'D-14 DEV/LOCAL aprobado por el humano (2026-09-29)';

export type LegacyTenant = {
  /** id local del SaaS (org/company/tenant) o de MasterAdmin */
  id: string;
  label: string;
  /** ADOPTED solo con mapping determinista desde evidencia existente (regla 4 de D-14). */
  resolution: 'ADOPTED' | 'UNRESOLVED';
  reason: string;
};

export type D14Evidence = {
  product: 'ecommerce' | 'ewm' | 'comerza' | 'tms' | 'esupplier' | 'echange' | 'eexpense' | 'gmao';
  entitlements: {
    /** PRODUCT: todo el producto; COHORT: cada tenant mapeado (PRODUCT queda atrás porque avanzarlo cambiaría tenants legacy sin evidencia). */
    scope: 'PRODUCT' | 'COHORT';
    productScopeMode: string;
    finalMode: string;
    transitions: string[];
    mappedTenants: number;
    mappedTenantsPrimary: number;
    getVerified: { appliedVersion: number; appliedChecksum: string; enforcementMode: string; desiredChecksum: string };
    /** BLOCKED: test negativo server-side en el estado final. NO_LEGACY_PATH: el producto no tiene escritura legacy (con evidencia). */
    legacyWrite: { status: 'BLOCKED' | 'NO_LEGACY_PATH'; evidence: string };
    parityBlocking: number;
  };
  appActiveFalse: { commercialDenied: boolean; operationalContinues: boolean; evidence: string };
  legacyTenants: LegacyTenant[];
  billing: null | {
    authority: string;
    /** Calculado por MasterAdmin (platform.record_billing_shadow_comparison), nunca un literal. */
    comparison: { computedBy: 'masteradmin'; mismatches: number; reportChecksum: string; negativeDetected: boolean; period: string };
    gatewayCalls: number;
    duplicateCharge: boolean;
    masteradminAuthorityReached: boolean;
  };
  checks: { passed: number; failed: number };
};

export function writeD14Evidence(e: D14Evidence): string | null {
  const dir = process.env.CCP_EVIDENCE_DIR;
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `d14-${e.product}.json`);
  writeFileSync(file, JSON.stringify({ schema: 'ebim.ccp.d14-cutover/v1', environment: 'LOCAL_DEV', writtenAt: new Date().toISOString(), ...e }, null, 2) + '\n');
  return file;
}

/** Cuenta PASS/FAIL de las líneas que imprime `check()` de cada X-07. */
export function countChecks(results: string[]): { passed: number; failed: number } {
  return {
    passed: results.filter((r) => r.startsWith('PASS')).length,
    failed: results.filter((r) => r.startsWith('FAIL')).length,
  };
}

const LOCAL_BILLERS = new Set(['eexpense', 'gmao']);
const SAAS_PRIMARY = new Set(['PRIMARY', 'MASTERADMIN_AUTHORITY']);

/** §19.1(6) y regla 2: entitlements en PRIMARY verificado por GET, escritura legacy negada, appActive solo comercial. */
export function entitlementBlockers(e: D14Evidence | null): string[] {
  if (!e) return ['sin evidencia D-14 del X-07'];
  const b: string[] = [];
  const en = e.entitlements;
  if (e.checks.failed !== 0 || e.checks.passed === 0) b.push(`X-07 con ${e.checks.failed} checks en rojo`);
  if (!SAAS_PRIMARY.has(en.finalMode)) b.push(`modo SaaS final ${en.finalMode}`);
  if (en.getVerified.enforcementMode !== 'PRIMARY') b.push(`GET informa ${en.getVerified.enforcementMode}`);
  if (en.getVerified.appliedChecksum !== en.getVerified.desiredChecksum) b.push('checksum aplicado ≠ deseado');
  if (en.mappedTenants < 1 || en.mappedTenantsPrimary !== en.mappedTenants) b.push(`cohorte ${en.mappedTenantsPrimary}/${en.mappedTenants} en PRIMARY`);
  if (!['BLOCKED', 'NO_LEGACY_PATH'].includes(en.legacyWrite.status) || !en.legacyWrite.evidence) b.push('escritura legacy sin test negativo');
  if (en.parityBlocking !== 0) b.push(`${en.parityBlocking} diferencias de paridad BLOCKING`);
  if (!e.appActiveFalse.commercialDenied || !e.appActiveFalse.operationalContinues) b.push('appActive=false no cumple la regla 2');
  return b;
}

/** §19.1(8) y regla 5: biller local solo en BILLING_SHADOW, diff 0 calculado por MasterAdmin, sin doble cobro. */
export function billingBlockers(e: D14Evidence | null): string[] {
  if (!e) return ['sin evidencia D-14 del X-07'];
  if (!LOCAL_BILLERS.has(e.product)) return [];
  const bi = e.billing;
  if (!bi) return ['sin evidencia de facturación'];
  const b: string[] = [];
  if (bi.authority !== 'BILLING_SHADOW') b.push(`facturación SaaS en ${bi.authority}`);
  if (bi.comparison.computedBy !== 'masteradmin' || !/^sha256:[0-9a-f]{64}$/.test(bi.comparison.reportChecksum)) b.push('comparación no calculada por MasterAdmin');
  if (bi.comparison.mismatches !== 0) b.push(`${bi.comparison.mismatches} diferencias materiales`);
  if (!bi.comparison.negativeDetected) b.push('la comparación no detectó la divergencia inyectada');
  if (bi.duplicateCharge) b.push('doble cobro');
  return b;
}

/**
 * Motivos por los que la evidencia SaaS NO autoriza avanzar el eje de
 * MasterAdmin (vacío = verde). Regla 1 de D-14: nunca forzar PRIMARY con un
 * desajuste real; regla 5: biller local solo en BILLING_SHADOW.
 */
export function evidenceBlockers(e: D14Evidence | null): string[] {
  if (!e) return ['sin evidencia D-14 del X-07'];
  return [...entitlementBlockers(e), ...billingBlockers(e)];
}
