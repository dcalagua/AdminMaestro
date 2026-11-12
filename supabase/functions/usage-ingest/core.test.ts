import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildIngestDeps, isIngestEnabled } from './core';

/*
 * Cableado de usage-ingest con la base (plan MA-51).
 *   · el flag global solo se enciende con el literal 'true' (D-12);
 *   · los nombres de parámetro de cada RPC coinciden con la migración;
 *   · la referencia de clave se resuelve con el lector de entorno, nunca se
 *     lee de la base.
 */

const MIGRATION = readFileSync(
  resolve(__dirname, '../../migrations/20261005000100_ccp_usage_meters_events.sql'),
  'utf8',
);

function rpcMock(data: Record<string, unknown>) {
  return vi.fn(async (fn: string, _args: Record<string, unknown>) => ({ data: data[fn], error: null }));
}

describe('isIngestEnabled', () => {
  it.each([
    [undefined, false], ['', false], ['1', false], ['TRUE', false], ['yes', false], ['true', true],
  ])('%s → %s', (value, expected) => {
    expect(isIngestEnabled(value as string | undefined)).toBe(expected);
  });
});

describe('buildIngestDeps', () => {
  it('usage_ingest_credential(p_issuer) → credencial tipada; sin fila → null', async () => {
    const rpc = rpcMock({
      usage_ingest_credential: [{
        product_code: 'eexpense', environment: 'DEV', audience: 'masteradmin.ebim', algorithm: 'ES256', kid: null,
        public_key_ref: 'EEXPENSE_DEV_USAGE_PUBLIC_JWK', credential_enabled: true, product_ingest_enabled: false,
      }],
    });
    const deps = buildIngestDeps({ rpc }, (k) => (k === 'USAGE_INGEST_ENABLED' ? 'true' : undefined));
    expect(await deps.resolveCredential('eexpense.ebim')).toEqual({
      productCode: 'eexpense', environment: 'DEV', audience: 'masteradmin.ebim', algorithm: 'ES256', kid: null,
      publicKeyRef: 'EEXPENSE_DEV_USAGE_PUBLIC_JWK', credentialEnabled: true, productIngestEnabled: false,
    });
    expect(rpc).toHaveBeenCalledWith('usage_ingest_credential', { p_issuer: 'eexpense.ebim' });
    expect(deps.enabled).toBe(true);

    const empty = buildIngestDeps({ rpc: rpcMock({ usage_ingest_credential: [] }) }, () => undefined);
    expect(await empty.resolveCredential('x.ebim')).toBeNull();
    expect(empty.enabled).toBe(false);
  });

  it('consume_m2m_jti(p_issuer, p_jti, p_expires_at ISO) → booleano', async () => {
    const rpc = rpcMock({ consume_m2m_jti: true });
    const deps = buildIngestDeps({ rpc }, () => undefined);
    expect(await deps.consumeJti('eexpense.ebim', 'j1', 1_790_000_000)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('consume_m2m_jti', {
      p_issuer: 'eexpense.ebim', p_jti: 'j1', p_expires_at: new Date(1_790_000_000_000).toISOString(),
    });
  });

  it('ingest_usage_events(p_product_code, p_environment, p_events, p_batch_id)', async () => {
    const out = { results: [], accepted: 0, duplicate: 0, rejected: 0 };
    const rpc = rpcMock({ ingest_usage_events: out });
    const deps = buildIngestDeps({ rpc }, () => undefined);
    expect(await deps.ingest('eexpense', 'DEV', [{ a: 1 }], 'b')).toEqual(out);
    expect(rpc).toHaveBeenCalledWith('ingest_usage_events', {
      p_product_code: 'eexpense', p_environment: 'DEV', p_events: [{ a: 1 }], p_batch_id: 'b',
    });
  });

  it('un error de la RPC se propaga (el handler lo convierte en 503 RETRYABLE)', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'boom', code: 'XX000' } }));
    const deps = buildIngestDeps({ rpc }, () => undefined);
    await expect(deps.ingest('p', 'DEV', [], 'b')).rejects.toBeTruthy();
  });

  it('la clave pública se lee del entorno por referencia', () => {
    const deps = buildIngestDeps({ rpc: rpcMock({}) }, (k) => (k === 'EEXPENSE_DEV_USAGE_PUBLIC_JWK' ? '{"kty":"EC"}' : undefined));
    expect(deps.resolvePublicKey('EEXPENSE_DEV_USAGE_PUBLIC_JWK')).toBe('{"kty":"EC"}');
    // Una referencia con forma distinta a NOMBRE_EN_MAYUSCULAS no se resuelve.
    expect(deps.resolvePublicKey('SUPABASE_SERVICE_ROLE_KEY')).toBeUndefined();
  });

  it('los nombres de parámetro existen en la migración', () => {
    for (const sig of [
      'usage_ingest_credential(p_issuer text)',
      'consume_m2m_jti(p_issuer text, p_jti text, p_expires_at timestamptz)',
    ]) {
      expect(MIGRATION).toContain(`platform.${sig}`);
    }
    expect(MIGRATION).toMatch(/ingest_usage_events\(\s*p_product_code text,\s*p_environment\s+text,\s*p_events\s+jsonb,\s*p_batch_id\s+uuid/);
  });
});
