/**
 * EBIM Commercial Control Plane · Fase 18 · eje de MasterAdmin tras la evidencia D-14 (LOCAL).
 *
 *   CCP_EVIDENCE_DIR=<corrida>/d14 SUPABASE_DB_URL=<local> \
 *     node --experimental-transform-types scripts/ccp/d14-masteradmin-axes.mts
 *
 * Último paso de certify-local.sh. Para cada uno de los 8 productos lee
 * d14-<producto>.json (escrito por la fase D14 de su X-07) y SOLO si esa
 * evidencia está en verde lleva el eje de entitlements de MasterAdmin a
 * MASTERADMIN_PRIMARY con set_commercial_cutover_state (un paso por vez,
 * motivo D-14, historial append-only, guarda de cohorte IN_SYNC de la RPC).
 * Un producto sin evidencia o con evidencia en rojo NO avanza (regla 1 de
 * D-14: nunca forzar PRIMARY con un desajuste real).
 *
 * Facturación: eExpense y GMAO deben estar en BILLING_SHADOW (lo dejó su
 * X-07) y nunca más allá (regla 5); los demás productos no tienen biller local
 * y su eje queda en BILLING_LEGACY.
 *
 * Escribe d14-masteradmin.json y sale ≠ 0 si algún producto no quedó en el
 * estado aprobado.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { D14_REASON, evidenceBlockers, type D14Evidence } from './d14-evidence.mts';
import { advanceAxis, axisState, cohortOf, ensureCcpIntegration } from './d14-masteradmin.mts';

const DIR = process.env.CCP_EVIDENCE_DIR ?? '';
if (!DIR) {
  console.error('HARD STOP: CCP_EVIDENCE_DIR es obligatorio (lo fija certify-local.sh)');
  process.exit(2);
}

const ALL = ['ecommerce', 'ewm', 'comerza', 'tms', 'esupplier', 'echange', 'eexpense', 'gmao'] as const;
// certify-local --only: solo los productos de la corrida (sin --only son los 8).
const only = (process.env.CCP_D14_PRODUCTS ?? '').split(/\s+/).filter(Boolean);
const PRODUCTS = only.length ? ALL.filter((p) => only.includes(p)) : ALL;
const LOCAL_BILLERS = new Set(['eexpense', 'gmao']);

const results: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} · ${label}${detail ? ` · ${detail}` : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) process.exitCode = 1;
}

const report: Record<string, unknown> = {};
for (const p of PRODUCTS) {
  const file = path.join(DIR, `d14-${p}.json`);
  const ev = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as D14Evidence) : null;
  const blockers = evidenceBlockers(ev);
  const id = ensureCcpIntegration(p);
  const before = axisState(id);
  let transitions: string[] = [];
  if (blockers.length === 0) {
    transitions = advanceAxis(id, 'ENTITLEMENTS', 'MASTERADMIN_PRIMARY', `${D14_REASON}; evidencia ${path.basename(file)}`);
  }
  const after = axisState(id);
  const cohort = cohortOf(id);
  check(`${p}: evidencia SaaS D-14 en verde`, blockers.length === 0, blockers.join('; '));
  check(`${p}: eje de entitlements de MasterAdmin en MASTERADMIN_PRIMARY`, after.entitlements === 'MASTERADMIN_PRIMARY',
    `${before.entitlements} → ${after.entitlements}`);
  const billingOk = LOCAL_BILLERS.has(p) ? after.billing === 'BILLING_SHADOW' : after.billing === 'BILLING_LEGACY';
  check(`${p}: eje de facturación ${LOCAL_BILLERS.has(p) ? 'BILLING_SHADOW (nunca más allá)' : 'BILLING_LEGACY (sin biller local)'}`,
    billingOk, after.billing);
  report[p] = {
    integrationId: id, before, after, transitions, blockers,
    masteradminCohort: cohort,
    note: cohort.mapped === 0
      ? 'MasterAdmin LOCAL no tiene tenants mapeados a esta integración: la guarda de cohorte de la RPC no tiene a quién exigir IN_SYNC; el IN_SYNC por GET del tenant certificado es el del X-07 (evidencia SaaS).'
      : undefined,
  };
}

const failed = results.filter((r) => r.startsWith('FAIL')).length;
writeFileSync(path.join(DIR, 'd14-masteradmin.json'), JSON.stringify({
  schema: 'ebim.ccp.d14-masteradmin/v1', environment: 'LOCAL_DEV', writtenAt: new Date().toISOString(),
  reason: D14_REASON, products: report, checks: { passed: results.length - failed, failed },
}, null, 2) + '\n');
console.log(`${results.length - failed}/${results.length} PASS`);
