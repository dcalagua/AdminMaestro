import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { isValidSnapshotShape, ReferenceReceiver, type ReceiverConfig } from './reference-receiver';
import { assertSnapshotSafe } from '../../../supabase/functions/_shared/entitlements/snapshot';
import { classifyPutResponse } from '../../../supabase/functions/_shared/entitlements/sync-client';
import { pushTransition } from '../../../supabase/functions/_shared/entitlements/states';
import type { EntitlementSnapshot } from '../../../supabase/functions/_shared/entitlements/types';

/*
 * FIX-ENT-v1 (plan MA-38). El receptor de referencia ejecuta TODOS los fixtures
 * y tiene que producir exactamente expected/*.json. Las mismas aserciones las
 * repite cada SaaS con su receptor real (fases 09–16).
 */

/** sha256 de CHECKSUMS.sha256 publicado en la evidencia de la fase 08. */
const FIX_ENT_V1_SHA256 = '7aab413a145b0e9a165c5f02be4bfda17f886a4b46bc2a557eec3eeaed1f65d5';

const DIR = resolve(process.cwd(), 'contracts/entitlements/v1');
const read = (rel: string) => readFileSync(resolve(DIR, rel), 'utf8');

interface Fixture {
  id: string;
  receiver: ReceiverConfig;
  emitterNegative?: { error: string };
  steps: { step: number; tenantPath: string; snapshot: EntitlementSnapshot }[];
}
const FIXTURES: Fixture[] = readdirSync(resolve(DIR, 'fixtures'))
  .sort()
  .map((f) => JSON.parse(read(`fixtures/${f}`)) as Fixture);
const PUTS = (JSON.parse(read('expected/put-responses.json')) as { responses: Record<string, { step: number; status: number; body: Record<string, unknown> }[]> }).responses;
const GETS = (JSON.parse(read('expected/get-applied.json')) as { responses: Record<string, { status: number; body: Record<string, unknown> }> }).responses;

const CLOCK = () => new Date('2026-10-01T00:01:00Z');
let jti = 0;
const write = (cfg: ReceiverConfig) => ({ scopes: [cfg.writeScope], jti: `jti-${++jti}` });
const readTok = (cfg: ReceiverConfig) => ({ scopes: [cfg.readScope], jti: `jti-${++jti}` });

/** Compara con los comodines del contrato: "$iso8601" y solo error/appliedVersion en errores. */
function matches(actual: { status: number; body: Record<string, unknown> }, expected: { status: number; body: Record<string, unknown> }) {
  expect(actual.status).toBe(expected.status);
  if (expected.status >= 400) {
    expect(actual.body.error).toBe(expected.body.error);
    expect(typeof actual.body.message).toBe('string');
    if ('appliedVersion' in expected.body) expect(actual.body.appliedVersion).toBe(expected.body.appliedVersion);
    return;
  }
  for (const [k, v] of Object.entries(expected.body)) {
    if (v === '$iso8601') expect(actual.body[k]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    else expect(actual.body[k], k).toEqual(v);
  }
  expect(Object.keys(actual.body).sort()).toEqual(Object.keys(expected.body).sort());
}

describe('FIX-ENT-v1 — completitud', () => {
  it('13 fixtures (los 12 del plan §3.1 + tenant no aprovisionado), cada uno con respuestas esperadas', () => {
    expect(FIXTURES.map((f) => f.id)).toEqual([
      '01-baseline-only', '02-plan-grants', '03-plan-plus-addon', '04-addon-removed', '05-limit-update',
      '06-app-inactive', '07-unknown-capability', '08-stale', '09-conflict', '10-bad-checksum',
      '11-wrong-environment', '12-forbidden-keys', '13-tenant-not-provisioned',
    ]);
    for (const f of FIXTURES) {
      expect(PUTS[f.id]).toHaveLength(f.steps.length);
      expect(GETS[f.id]).toBeDefined();
    }
  });

  it('todo snapshot salvo el negativo del emisor cumple schema.json (forma y claves obligatorias)', () => {
    const schema = JSON.parse(read('schema.json')) as { required: string[] };
    for (const f of FIXTURES) {
      for (const s of f.steps) {
        if (f.id === '12-forbidden-keys') {
          expect(isValidSnapshotShape(s.snapshot)).toBe(false);
          continue;
        }
        expect(isValidSnapshotShape(s.snapshot), `${f.id}#${s.step}`).toBe(true);
        expect(Object.keys(s.snapshot).sort()).toEqual([...schema.required].sort());
      }
    }
  });

  it('ningún fixture lleva precios, montos, monedas ni secretos (salvo el negativo del emisor)', () => {
    for (const f of FIXTURES.filter((x) => !x.emitterNegative)) {
      for (const s of f.steps) expect(() => assertSnapshotSafe(s.snapshot)).not.toThrow();
    }
  });

  it('12-forbidden-keys: el EMISOR lo rechaza con FORBIDDEN_KEY', () => {
    const f = FIXTURES.find((x) => x.id === '12-forbidden-keys')!;
    expect(f.emitterNegative).toEqual({ error: 'FORBIDDEN_KEY' });
    expect(() => assertSnapshotSafe(f.steps[0].snapshot)).toThrow(/FORBIDDEN_KEY/);
  });
});

describe('FIX-ENT-v1 — el receptor de referencia reproduce las respuestas esperadas', () => {
  it.each(FIXTURES.map((f) => [f.id, f] as const))('%s', async (id, f) => {
    const receiver = new ReferenceReceiver(f.receiver, CLOCK);
    for (const s of f.steps) {
      matches(await receiver.put(s.tenantPath, s.snapshot, write(f.receiver)), PUTS[id][s.step - 1]);
    }
    matches(receiver.get(f.steps[0].tenantPath, readTok(f.receiver)), GETS[id]);
  });
});

describe('Transporte del contrato (cada SaaS lo prueba con su JWT real)', () => {
  const f = FIXTURES.find((x) => x.id === '02-plan-grants')!;
  const snap = f.steps[0].snapshot;

  it('scope de lectura o de provisioning en un PUT → 403 INSUFFICIENT_SCOPE', async () => {
    const r = new ReferenceReceiver(f.receiver, CLOCK);
    expect((await r.put(snap.controlPlaneTenantId, snap, { scopes: [f.receiver.readScope], jti: 'a' })).body.error).toBe('INSUFFICIENT_SCOPE');
    expect((await r.put(snap.controlPlaneTenantId, snap, { scopes: ['fixture:tenant:create'], jti: 'b' })).status).toBe(403);
    expect(r.get(snap.controlPlaneTenantId, { scopes: [f.receiver.writeScope], jti: 'c' }).status).toBe(403);
  });

  it('jti reutilizado → 401 JTI_REPLAYED, aunque el cuerpo sea un replay legítimo', async () => {
    const r = new ReferenceReceiver(f.receiver, CLOCK);
    expect((await r.put(snap.controlPlaneTenantId, snap, { scopes: [f.receiver.writeScope], jti: 'same' })).status).toBe(200);
    const again = await r.put(snap.controlPlaneTenantId, snap, { scopes: [f.receiver.writeScope], jti: 'same' });
    expect(again).toMatchObject({ status: 401, body: { error: 'JTI_REPLAYED' } });
  });

  it('tenant de la ruta distinto del cuerpo → 422 SNAPSHOT_INVALID', async () => {
    const r = new ReferenceReceiver({ ...f.receiver, provisionedTenants: [...f.receiver.provisionedTenants, '00000000-0000-4ccc-8000-0000000000ff'] }, CLOCK);
    expect((await r.put('00000000-0000-4ccc-8000-0000000000ff', snap, write(f.receiver))).body.error).toBe('SNAPSHOT_INVALID');
  });
});

describe('Enforcement last-good: MasterAdmin inalcanzable no detiene lo concedido', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function applied(id: string) {
    const f = FIXTURES.find((x) => x.id === id)!;
    const r = new ReferenceReceiver(f.receiver, CLOCK);
    for (const s of f.steps) await r.put(s.tenantPath, s.snapshot, write(f.receiver));
    return { r, tenant: f.steps[0].tenantPath };
  }

  it('sin red, decide con el snapshot aplicado (concede, deniega, límites, compañía)', async () => {
    const { r, tenant } = await applied('03-plan-plus-addon');
    const fetchSpy = vi.fn(() => { throw new Error('MasterAdmin caído'); });
    vi.stubGlobal('fetch', fetchSpy);
    expect(r.isEntitled(tenant, 'fixture.core')).toBe(true);
    expect(r.isEntitled(tenant, 'fixture.reports')).toBe(true);
    expect(r.isEntitled(tenant, 'fixture.ai.insights')).toBe(false);
    expect(r.isEntitled(tenant, 'fixture.promotions', '00000000-0000-4ccc-8000-00000000c001')).toBe(true);
    expect(r.isEntitled(tenant, 'fixture.promotions', '00000000-0000-4ccc-8000-00000000c999')).toBe(false);
    expect(r.limit(tenant, 'fixture.users.max')).toBe(25);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('una revocación solo llega con un snapshot nuevo (04: v2 retira el add-on)', async () => {
    const { r, tenant } = await applied('04-addon-removed');
    expect(r.isEntitled(tenant, 'fixture.promotions', '00000000-0000-4ccc-8000-00000000c001')).toBe(false);
    expect(r.isEntitled(tenant, 'fixture.reports')).toBe(true);
  });

  it('appActive=false bloquea todo, baseline incluida', async () => {
    const { r, tenant } = await applied('06-app-inactive');
    expect(r.isEntitled(tenant, 'fixture.core')).toBe(false);
    expect(r.isEntitled(tenant, 'fixture.reports')).toBe(false);
  });

  it('una capacidad desconocida nunca se concede', async () => {
    const { r, tenant } = await applied('07-unknown-capability');
    expect(r.isEntitled(tenant, 'fixture.ghost')).toBe(false);
    expect(r.isEntitled(tenant, 'fixture.reports')).toBe(true);
  });

  it('un snapshot atrasado (08) no cambia lo aplicado', async () => {
    const { r, tenant } = await applied('08-stale');
    expect(r.get(tenant, { scopes: ['fixture:entitlements:read'], jti: 'x' }).body.appliedVersion).toBe(3);
  });
});

describe('MasterAdmin interpreta cada respuesta esperada con el estado correcto (MA-35)', () => {
  const STATE_BY_ERROR: Record<string, string> = {
    STALE_SNAPSHOT: 'DRIFT_AHEAD',
    VERSION_CONFLICT: 'DRIFT_CHECKSUM',
    CHECKSUM_MISMATCH: 'REJECTED',
    ENVIRONMENT_MISMATCH: 'REJECTED',
    SNAPSHOT_INVALID: 'REJECTED',
    TENANT_NOT_PROVISIONED: 'REJECTED',
  };
  const all = Object.entries(PUTS).flatMap(([id, rs]) => rs.map((r) => [`${id}#${r.step}`, r] as const));

  it.each(all)('%s', (_id, r) => {
    const classified = classifyPutResponse(r.status, r.body);
    const next = pushTransition(classified.result, 0).state;
    if (r.status === 200) expect(next).toBe('AWAITING_VERIFY');
    else expect(next).toBe(STATE_BY_ERROR[r.body.error as string]);
  });
});

describe('Pin FIX-ENT-v1', () => {
  it('cada archivo coincide con CHECKSUMS.sha256 y CHECKSUMS.sha256 con FIX_ENT_V1_SHA256', () => {
    const lines = read('CHECKSUMS.sha256').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(20);
    for (const line of lines) {
      const [hash, file] = line.split(/\s{2}/);
      expect(createHash('sha256').update(readFileSync(resolve(DIR, file))).digest('hex'), file).toBe(hash);
    }
    expect(createHash('sha256').update(readFileSync(resolve(DIR, 'CHECKSUMS.sha256'))).digest('hex')).toBe(FIX_ENT_V1_SHA256);
  });
});

describe('Emisor SQL de MasterAdmin', () => {
  it('el pgTAP 35 recalcula en SQL el checksum del fixture 03 (mismo documento, mismo checksum)', () => {
    const pgtap = readFileSync(resolve(process.cwd(), 'supabase/tests/35_ccp_entitlement_snapshots.test.sql'), 'utf8');
    const snap = FIXTURES.find((x) => x.id === '03-plan-plus-addon')!.steps[0].snapshot;
    expect(pgtap).toContain(`platform.entitlement_checksum('${JSON.stringify(snap)}'::jsonb)`);
    expect(pgtap).toContain(`'${snap.checksum}'`);
  });
});
