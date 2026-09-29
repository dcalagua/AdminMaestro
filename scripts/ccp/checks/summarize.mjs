#!/usr/bin/env node
// ============================================================================
// EBIM Commercial Control Plane · Fase 18 · veredicto por producto (MA-62)
// ----------------------------------------------------------------------------
// Lee <out>/steps.tsv (pasos ejecutados por certify-local.sh) y escribe
// <out>/<producto>.json + <out>/summary.json con:
//   · los 15 checks del prompt 18: PASS si TODOS los pasos que lo evidencian
//     salieron 0; FAIL si alguno falló; NOT_RUN si falta un paso; N/A con
//     motivo cuando el producto no tiene esa superficie;
//   · los criterios de spec §19.1 que NO son tests (modo de cutover, D-14,
//     prerequisitos humanos) desde products.mjs;
//   · synchronized = todos los checks PASS/N/A ∧ criterios §19.1 cumplidos.
// No inventa: un criterio sin evidencia queda NOT_MET.
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKS, PRODUCTS } from './products.mjs';

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
  const criteria = Object.fromEntries(Object.entries(product.criteria).map(([id, c]) => {
    if (!c.steps) return [id, c];
    const r = evaluate(c.steps);
    return [id, { met: r.status === 'PASS', reason: c.reason ?? `pasos: ${r.status}`, evidence: r.evidence }];
  }));
  const testsOk = Object.values(checks).every((c) => c.status === 'PASS' || c.status === 'N/A');
  const criteriaOk = Object.values(criteria).every((c) => c.met === true);
  const result = {
    product: code,
    legacyAuthority: product.legacyAuthority,
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
