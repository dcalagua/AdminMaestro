/**
 * Pruebas del dry-run de importación del hub GMAO (fase 16, MA16-04).
 * Se ejecutan con `node --test scripts/ccp/gmao-hub-import-dryrun.test.mjs`.
 *
 * El script solo lee archivos: nunca escribe en ninguna base, se niega a
 * correr sin `--dry-run` y aborta si el entorno declara un Supabase remoto.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./gmao-hub-import-dryrun.mts', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../supabase/functions/_shared/entitlements/hub/fixtures/', import.meta.url));
const EXPORT = join(FIXTURES, 'hub-export.synthetic.json');
const CONTEXT = join(FIXTURES, 'hub-context.synthetic.json');
const RAN_AT = '2026-09-28T12:30:00Z';

function run(args, env = {}) {
  return spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', SCRIPT, ...args], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
}

const baseArgs = ['--dry-run', '--export', EXPORT, '--context', CONTEXT, '--environment', 'LOCAL', '--ran-at', RAN_AT];

test('sin --dry-run se niega a correr (exit 2)', () => {
  const r = run(baseArgs.filter((a) => a !== '--dry-run'));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--dry-run/);
});

test('aborta si el entorno declara un Supabase no local (exit 2) sin imprimir la URL', () => {
  const r = run(baseArgs, { SUPABASE_DB_URL: `postgresql://db.${'example'}.supabase.co:5432/postgres` });
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stdout + r.stderr, /example\.supabase\.co/);
});

test('acepta un entorno local declarado', () => {
  const r = run(baseArgs, { VITE_SUPABASE_URL: 'http://127.0.0.1:54421' });
  assert.equal(r.status, 0, r.stderr);
});

test('sobre los fixtures: resumen, reporte, SQL de operador y atestaciones, sin precios', () => {
  const r = run(baseArgs);
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout;
  assert.match(out, /DRY-RUN/);
  assert.match(out, /# Hub GMAO · paridad dual-read hub vs MasterAdmin/);
  assert.match(
    out,
    /select platform\.upsert_capability_alias\('ecommerce', 'GMAO_HUB', 'ecommerce\.pricing\.lists', 'ecommerce\.pricing\.lists'\);/,
  );
  // El alias ya registrado no se vuelve a proponer.
  assert.doesNotMatch(out, /upsert_capability_alias\('ecommerce', 'GMAO_HUB', 'ecommerce\.promotions'/);
  assert.match(out, /esupplier_legacy_portal/);
  const attestations = JSON.parse(out.slice(out.indexOf('<<<ATTESTATIONS') + '<<<ATTESTATIONS'.length, out.indexOf('ATTESTATIONS>>>')));
  assert.deepEqual(
    attestations.map((a) => [a.productCode, a.blocking, a.warnings, a.tenants, a.ranAt]),
    [
      ['ecommerce', 0, 23, 1, RAN_AT],
      ['esupplier', 3, 1, 2, RAN_AT],
    ],
  );
  const exportChecksum = JSON.parse(readFileSync(EXPORT, 'utf8')).checksum;
  assert.ok(attestations.every((a) => a.exportChecksum === exportChecksum));
  assert.doesNotMatch(out, /price|currency|USD|secret|password|token/i);
});

test('dos corridas con la misma fecha dan la misma salida', () => {
  assert.equal(run(baseArgs).stdout, run(baseArgs).stdout);
});

test('un export con precio se rechaza entero (exit 1, HUB_EXPORT_FORBIDDEN_KEY)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-dryrun-'));
  const doc = JSON.parse(readFileSync(EXPORT, 'utf8'));
  doc.catalogItems[0].price_month = 0;
  const path = join(dir, 'export.json');
  writeFileSync(path, JSON.stringify(doc));
  const r = run(['--dry-run', '--export', path, '--context', CONTEXT, '--environment', 'LOCAL']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /HUB_EXPORT_FORBIDDEN_KEY/);
  assert.equal(r.stdout.includes('upsert_capability_alias'), false);
});

test('un export de otro entorno se rechaza (exit 1)', () => {
  const r = run(['--dry-run', '--export', EXPORT, '--context', CONTEXT, '--environment', 'QAS']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /HUB_EXPORT_ENVIRONMENT_MISMATCH/);
});
