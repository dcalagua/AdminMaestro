import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalize, entitlementChecksum, JcsError } from './jcs';
import { sha256Hex } from '../provisioning/fingerprint';

/*
 * JCS (RFC 8785) y checksum de ebim.entitlements/v1 (spec §7.2 regla 3).
 *
 * Los canónicos de `jcs-vectors.json` están escritos a mano según la RFC: si
 * esta implementación y los vectores coinciden es porque la implementación es
 * correcta, no porque se generaron el uno del otro. Cada SaaS pasa los MISMOS
 * vectores con su propio runtime (plan §3.2).
 */

interface Vector {
  id: string;
  input: string;
  canonical: string;
  sha256: string;
  sqlDomain: boolean;
}

const VECTORS = (
  JSON.parse(
    readFileSync(resolve(process.cwd(), 'contracts/entitlements/v1/jcs-vectors.json'), 'utf8'),
  ) as { vectors: Vector[] }
).vectors;

describe('canonicalize — vectores RFC 8785', () => {
  it('hay vectores para todas las categorías del plan', () => {
    const ids = VECTORS.map((v) => v.id);
    for (const required of ['unicode-values', 'escapes', 'key-order', 'integers', 'decimals', 'negative-zero', 'exponents', 'empty-containers']) {
      expect(ids).toContain(required);
    }
  });

  it.each(VECTORS.map((v) => [v.id, v] as const))('%s', async (_id, vector) => {
    const canonical = canonicalize(JSON.parse(vector.input));
    expect(canonical).toBe(vector.canonical);
    expect(await sha256Hex(canonical)).toBe(vector.sha256);
  });
});

describe('canonicalize — entradas que no son JSON', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['undefined', undefined],
    ['bigint', BigInt(1)],
    ['función', () => 1],
  ])('%s → JcsError', (_label, value) => {
    expect(() => canonicalize(value)).toThrow(JcsError);
    expect(() => canonicalize({ a: value })).toThrow(JcsError);
    expect(() => canonicalize([value])).toThrow(JcsError);
  });

  it('una fecha no se serializa implícitamente (toJSON no participa)', () => {
    expect(() => canonicalize({ at: new Date(0) })).toThrow(JcsError);
  });

  it('un surrogate solitario es un error, no un escape silencioso', () => {
    expect(() => canonicalize({ s: '\ud800' })).toThrow(JcsError);
  });
});

describe('entitlementChecksum', () => {
  it('es sha256:<hex> del canónico SIN el campo checksum', async () => {
    const doc = { b: 1, a: 'x' };
    const expected = `sha256:${await sha256Hex('{"a":"x","b":1}')}`;
    expect(await entitlementChecksum(doc)).toBe(expected);
    expect(await entitlementChecksum({ ...doc, checksum: 'sha256:cualquiera' })).toBe(expected);
  });

  it('no depende del orden de inserción de las claves', async () => {
    expect(await entitlementChecksum({ a: 1, b: [1, 2] })).toBe(await entitlementChecksum({ b: [1, 2], a: 1 }));
  });

  it('sí depende del orden de los arreglos', async () => {
    expect(await entitlementChecksum({ a: [1, 2] })).not.toBe(await entitlementChecksum({ a: [2, 1] }));
  });
});

describe('espejo SQL (platform.jcs_canonical)', () => {
  it('el pgTAP 35 prueba exactamente los vectores sqlDomain de jcs-vectors.json', () => {
    const pgtap = readFileSync(resolve(process.cwd(), 'supabase/tests/35_ccp_entitlement_snapshots.test.sql'), 'utf8');
    const sqlVectors = VECTORS.filter((v) => v.sqlDomain);
    expect(sqlVectors.length).toBeGreaterThanOrEqual(8);
    for (const v of sqlVectors) {
      expect(pgtap, `falta el vector ${v.id} en el pgTAP 35`).toContain(`'${v.sha256}'`);
      expect(pgtap).toContain(`platform.jcs_canonical('${v.input}')`);
    }
  });
});
