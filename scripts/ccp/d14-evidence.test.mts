/**
 * Pruebas de la puerta de evidencia D-14 (Fase 18): el eje de MasterAdmin solo
 * avanza con evidencia SaaS en verde. Se ejecutan con
 * `node --experimental-transform-types --test scripts/ccp/`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceBlockers, type D14Evidence } from './d14-evidence.mts';

const SHA = `sha256:${'a'.repeat(64)}`;

function green(product: D14Evidence['product'] = 'tms'): D14Evidence {
  return {
    product,
    entitlements: {
      scope: 'PRODUCT', productScopeMode: 'PRIMARY', finalMode: 'PRIMARY', transitions: ['SHADOW->DUAL_READ', 'DUAL_READ->PRIMARY'],
      mappedTenants: 1, mappedTenantsPrimary: 1,
      getVerified: { appliedVersion: 4, appliedChecksum: SHA, enforcementMode: 'PRIMARY', desiredChecksum: SHA },
      legacyWrite: { status: 'BLOCKED', evidence: 'x07 D14.3' }, parityBlocking: 0,
    },
    appActiveFalse: { commercialDenied: true, operationalContinues: true, evidence: 'x07 D14.4' },
    legacyTenants: [{ id: 'demo', label: 'demo', resolution: 'UNRESOLVED', reason: 'sin evidencia' }],
    billing: null,
    checks: { passed: 20, failed: 0 },
  };
}

function billed(product: 'eexpense' | 'gmao'): D14Evidence {
  return {
    ...green(product),
    billing: {
      authority: 'BILLING_SHADOW',
      comparison: { computedBy: 'masteradmin', mismatches: 0, reportChecksum: SHA, negativeDetected: true, period: '2026-09-01' },
      gatewayCalls: 0, duplicateCharge: false, masteradminAuthorityReached: false,
    },
  };
}

test('evidencia verde → sin bloqueos (también con biller local en BILLING_SHADOW)', () => {
  assert.deepEqual(evidenceBlockers(green()), []);
  assert.deepEqual(evidenceBlockers(billed('eexpense')), []);
  assert.deepEqual(evidenceBlockers({ ...green('gmao'), ...billed('gmao'),
    entitlements: { ...billed('gmao').entitlements, finalMode: 'MASTERADMIN_AUTHORITY' } }), []);
});

test('sin evidencia no avanza', () => {
  assert.deepEqual(evidenceBlockers(null), ['sin evidencia D-14 del X-07']);
});

test('cada desajuste de entitlements bloquea', () => {
  const e = green();
  const cases: [string, D14Evidence][] = [
    ['checks en rojo', { ...e, checks: { passed: 19, failed: 1 } }],
    ['modo SaaS final', { ...e, entitlements: { ...e.entitlements, finalMode: 'DUAL_READ' } }],
    ['GET informa', { ...e, entitlements: { ...e.entitlements, getVerified: { ...e.entitlements.getVerified, enforcementMode: 'SHADOW' } } }],
    ['checksum aplicado', { ...e, entitlements: { ...e.entitlements, getVerified: { ...e.entitlements.getVerified, appliedChecksum: `sha256:${'b'.repeat(64)}` } } }],
    ['cohorte', { ...e, entitlements: { ...e.entitlements, mappedTenantsPrimary: 0 } }],
    ['cohorte', { ...e, entitlements: { ...e.entitlements, mappedTenants: 0, mappedTenantsPrimary: 0 } }],
    ['escritura legacy', { ...e, entitlements: { ...e.entitlements, legacyWrite: { status: 'BLOCKED', evidence: '' } } }],
    ['paridad', { ...e, entitlements: { ...e.entitlements, parityBlocking: 2 } }],
    ['appActive', { ...e, appActiveFalse: { ...e.appActiveFalse, operationalContinues: false } }],
  ];
  for (const [needle, ev] of cases) {
    const b = evidenceBlockers(ev);
    assert.ok(b.some((x) => x.includes(needle)), `${needle}: ${JSON.stringify(b)}`);
  }
});

test('biller local: nada salvo BILLING_SHADOW con diff 0 calculado por MasterAdmin y sin doble cobro', () => {
  const e = billed('gmao');
  const bi = e.billing!;
  const cases: [string, D14Evidence][] = [
    ['sin evidencia de facturación', { ...e, billing: null }],
    ['facturación SaaS en', { ...e, billing: { ...bi, authority: 'MASTERADMIN_AUTHORITY' } }],
    ['no calculada por MasterAdmin', { ...e, billing: { ...bi, comparison: { ...bi.comparison, reportChecksum: 'sha256:ddd' } } }],
    ['diferencias materiales', { ...e, billing: { ...bi, comparison: { ...bi.comparison, mismatches: 1 } } }],
    ['divergencia inyectada', { ...e, billing: { ...bi, comparison: { ...bi.comparison, negativeDetected: false } } }],
    ['doble cobro', { ...e, billing: { ...bi, duplicateCharge: true } }],
  ];
  for (const [needle, ev] of cases) {
    const b = evidenceBlockers(ev);
    assert.ok(b.some((x) => x.includes(needle)), `${needle}: ${JSON.stringify(b)}`);
  }
});

test('un producto sin biller local no exige evidencia de facturación', () => {
  assert.deepEqual(evidenceBlockers({ ...green('ewm'), billing: null }), []);
});
