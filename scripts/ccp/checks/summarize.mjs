#!/usr/bin/env node
// ============================================================================
// EBIM Commercial Control Plane · Fase 18 · veredicto por producto (MA-62)
// ----------------------------------------------------------------------------
// Lee <out>/steps.tsv (pasos ejecutados por certify-local.sh) y escribe
// <out>/<producto>.json + <out>/summary.json con:
//   · los 15 checks del prompt 18: PASS si TODOS los pasos que lo evidencian
//     salieron 0; FAIL si alguno falló; NOT_RUN si falta un paso; N/A con
//     motivo cuando el producto no tiene esa superficie;
//   · los criterios de spec §19.1: por pasos, por evidencia D-14
//     (<corrida>/d14/d14-<producto>.json + d14-masteradmin.json; §19.1(6),
//     §19.1(8) y la regla 2 de appActive) o fijos con motivo (products.mjs);
//   · synchronized = todos los checks PASS/N/A ∧ criterios §19.1 cumplidos.
// No inventa: un criterio sin evidencia queda NOT_MET.
// ============================================================================
// Se ejecuta con `node --experimental-transform-types` (importa la puerta .mts).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKS, PRODUCTS } from './products.mjs';
import { billingBlockers, entitlementBlockers } from '../d14-evidence.mts';

const out = process.argv[2];
if (!out) {
  console.error('uso: summarize.mjs <directorio de la corrida>');
  process.exit(2);
}

const steps = new Map();
for (const line of readFileSync(join(out, 'steps.tsv'), 'utf8').trim().split('\n').slice(1)) {
  const [product, step, rc, startedAt, endedAt, log] = line.split('\t');
  steps.set(`${product}:${step}`, { rc: Number(rc), startedAt, endedAt, log });
}

function evaluate(refs) {
  const found = refs.map((r) => ({ ref: r, ...(steps.get(r) ?? { rc: null }) }));
  if (found.some((s) => s.rc === null)) return { status: 'NOT_RUN', evidence: found };
  if (found.some((s) => s.rc !== 0)) return { status: 'FAIL', evidence: found };
  return { status: 'PASS', evidence: found };
}

const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const maAxes = readJson(join(out, 'd14', 'd14-masteradmin.json'));

// Criterio derivado de la evidencia D-14: pasos en verde ∧ evidencia SaaS ∧ eje de MasterAdmin.
function evaluateD14(code, c, ev) {
  const r = evaluate(c.steps);
  const blockers = r.status === 'PASS' ? [] : [`pasos: ${r.status}`];
  const axis = maAxes?.products?.[code]?.after;
  if (c.d14 === 'entitlements') {
    blockers.push(...entitlementBlockers(ev));
    if (axis?.entitlements !== 'MASTERADMIN_PRIMARY') blockers.push(`eje MasterAdmin de entitlements en ${axis?.entitlements ?? 'desconocido'}`);
  } else if (c.d14 === 'billing') {
    blockers.push(...billingBlockers(ev));
    if (axis?.billing !== 'BILLING_SHADOW') blockers.push(`eje MasterAdmin de facturación en ${axis?.billing ?? 'desconocido'}`);
  } else if (c.d14 === 'appActive') {
    if (!ev) blockers.push('sin evidencia D-14 del X-07');
    else if (!ev.appActiveFalse.commercialDenied || !ev.appActiveFalse.operationalContinues) blockers.push('appActive=false no cumple la regla 2');
  }
  return { met: blockers.length === 0, reason: blockers.length ? blockers.join('; ') : c.label, evidence: r.evidence };
}

const summary = { generatedAt: new Date().toISOString(), products: {} };
for (const [code, product] of Object.entries(PRODUCTS)) {
  const checks = {};
  for (const [id, label] of Object.entries(CHECKS)) {
    const spec = product.checks[id];
    if (!spec) {
      checks[id] = { label, status: 'NOT_EVIDENCED' };
    } else if (spec.na) {
      checks[id] = { label, status: 'N/A', reason: spec.na };
    } else {
      checks[id] = { label, ...evaluate(spec.steps), note: spec.note };
    }
  }
  const ev = readJson(join(out, 'd14', `d14-${code}.json`));
  const criteria = Object.fromEntries(Object.entries(product.criteria).map(([id, c]) => {
    if (c.d14) return [id, evaluateD14(code, c, ev)];
    if (!c.steps) return [id, c];
    const r = evaluate(c.steps);
    return [id, { met: r.status === 'PASS', reason: c.reason ?? `pasos: ${r.status}`, evidence: r.evidence }];
  }));
  const testsOk = Object.values(checks).every((c) => c.status === 'PASS' || c.status === 'N/A');
  const criteriaOk = Object.values(criteria).every((c) => c.met === true);
  const result = {
    product: code,
    legacyAuthority: product.legacyAuthority,
    d14: ev && {
      entitlements: { scope: ev.entitlements.scope, saasFinalMode: ev.entitlements.finalMode, productScopeMode: ev.entitlements.productScopeMode,
        masteradminAxis: maAxes?.products?.[code]?.after?.entitlements ?? null, getVerified: ev.entitlements.getVerified,
        legacyWrite: ev.entitlements.legacyWrite },
      billing: ev.billing && { ...ev.billing, masteradminAxis: maAxes?.products?.[code]?.after?.billing ?? null },
      appActiveFalse: ev.appActiveFalse,
      legacyTenants: ev.legacyTenants,
    },
    checks,
    criteria,
    gaps: product.gaps,
    synchronized: testsOk && criteriaOk,
    blockers: [
      ...Object.entries(checks).filter(([, c]) => !['PASS', 'N/A'].includes(c.status)).map(([id, c]) => `check ${id} ${c.status}`),
      ...Object.entries(criteria).filter(([, c]) => c.met !== true).map(([id, c]) => `§19.1(${id}) ${c.reason}`),
    ],
  };
  writeFileSync(join(out, `${code}.json`), JSON.stringify(result, null, 2) + '\n');
  summary.products[code] = {
    synchronized: result.synchronized,
    d14: result.d14 && { entitlements: `${result.d14.entitlements.saasFinalMode} (${result.d14.entitlements.scope}) / MA ${result.d14.entitlements.masteradminAxis}`,
      billing: result.d14.billing ? `${result.d14.billing.authority} / MA ${result.d14.billing.masteradminAxis}, mismatches ${result.d14.billing.comparison.mismatches}` : null,
      unresolvedLegacyTenants: result.d14.legacyTenants.filter((t) => t.resolution === 'UNRESOLVED').length },
    checks: Object.fromEntries(Object.entries(checks).map(([id, c]) => [id, c.status])),
    blockers: result.blockers,
  };
}
summary.allSynchronized = Object.values(summary.products).every((p) => p.synchronized);
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

for (const [code, p] of Object.entries(summary.products)) {
  const counts = Object.values(p.checks).reduce((a, s) => ((a[s] = (a[s] ?? 0) + 1), a), {});
  console.log(`${code.padEnd(10)} ${p.synchronized ? 'SYNCHRONIZED' : 'NOT_SYNCHRONIZED'}  ${JSON.stringify(counts)}`);
}
console.log(summary.allSynchronized ? 'DEV_ALL_8_SYNCHRONIZED=YES' : 'DEV_ALL_8_SYNCHRONIZED=NO');
