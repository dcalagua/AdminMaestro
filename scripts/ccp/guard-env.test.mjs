/**
 * Pruebas de la guarda de entorno del programa CCP (Task MA-00).
 * Se ejecutan con `node --test scripts/ccp/` (no dependen de vitest ni de jsdom).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./guard-env.sh', import.meta.url));

function run(env) {
  return spawnSync('bash', [GUARD], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
}

test('acepta el stack local por 127.0.0.1 y localhost', () => {
  const r = run({
    VITE_SUPABASE_URL: 'http://127.0.0.1:54421',
    SUPABASE_DB_URL: 'postgresql://localhost:54422/postgres',
  });
  assert.equal(r.status, 0, r.stderr);
});

test('aborta con exit 2 si no hay destino declarado', () => {
  assert.equal(run({}).status, 2);
});

test('aborta con exit 2 ante una URL remota de Supabase', () => {
  const r = run({ VITE_SUPABASE_URL: 'https://example.supabase.co' });
  assert.equal(r.status, 2);
});

for (const ref of ['jivgwrczgdpsuvqcwqku', 'uvjmdphlnpyhtohobvzx', 'xikbhkfeaosasdltartg']) {
  test(`aborta con exit 2 ante el ref remoto conocido ${ref}`, () => {
    const r = run({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54421',
      SUPABASE_DB_URL: `postgresql://db.${ref}.supabase.co:5432/postgres`,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /HARD STOP/);
  });
}

test('aborta si el ref aparece aunque el host sea local (p. ej. en la ruta)', () => {
  const r = run({ VITE_SUPABASE_URL: 'http://127.0.0.1:54421/?ref=jivgwrczgdpsuvqcwqku' });
  assert.equal(r.status, 2);
});

test('no imprime el valor completo de las variables', () => {
  const r = run({ VITE_SUPABASE_URL: 'https://user:hunter2@db.jivgwrczgdpsuvqcwqku.supabase.co' });
  assert.doesNotMatch(r.stderr + r.stdout, /hunter2/);
});
