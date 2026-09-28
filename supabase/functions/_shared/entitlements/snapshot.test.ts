import { describe, it, expect } from 'vitest';
import { assertSnapshotSafe, buildSnapshot, idempotencyKeyFor, verifySnapshot } from './snapshot';
import { canonicalize, entitlementChecksum } from './jcs';
import { sha256Hex } from '../provisioning/fingerprint';
import { SnapshotError, type SnapshotInput } from './types';

/*
 * Constructor del snapshot ebim.entitlements/v1 (plan MA-31, spec §7).
 *
 * El snapshot de MasterAdmin lo emite la base (issue_entitlement_snapshot) en
 * la misma transacción que asigna la versión; este constructor es su espejo en
 * TS: genera los fixtures dorados y es la verificación que el cliente de sync
 * hace ANTES de enviar. Los dos tienen que producir los mismos bytes.
 */

const TENANT = '00000000-0000-4ccc-8000-000000000001';

function input(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    environment: 'DEV',
    controlPlaneTenantId: TENANT,
    productCode: 'fixture',
    external: { tenantId: 'ext-tenant-1', organizationId: 'ext-org-1', companyIds: ['ext-company-1'] },
    snapshotVersion: 3,
    previousVersion: 2,
    effectiveAt: '2026-10-01T00:00:00Z',
    issuedAt: '2026-10-01T00:00:03Z',
    appActive: true,
    planCode: 'fixture-standard',
    registry: [
      { code: 'fixture.core', kind: 'FEATURE', isBaseline: true, scopeLevel: 'TENANT', unit: null, meterCode: null, status: 'ACTIVE' },
      { code: 'fixture.reports', kind: 'FEATURE', isBaseline: false, scopeLevel: 'TENANT', unit: null, meterCode: null, status: 'ACTIVE' },
      { code: 'fixture.promotions', kind: 'FEATURE', isBaseline: false, scopeLevel: 'COMPANY', unit: null, meterCode: null, status: 'ACTIVE' },
      { code: 'fixture.ai.insights', kind: 'AI_FEATURE', isBaseline: false, scopeLevel: 'TENANT', unit: null, meterCode: 'ai.credits', status: 'ACTIVE' },
      { code: 'fixture.beta', kind: 'FEATURE', isBaseline: false, scopeLevel: 'TENANT', unit: null, meterCode: null, status: 'DRAFT' },
      { code: 'fixture.legacy_export', kind: 'FEATURE', isBaseline: false, scopeLevel: 'TENANT', unit: null, meterCode: null, status: 'DEPRECATED' },
      { code: 'fixture.old_widget', kind: 'FEATURE', isBaseline: false, scopeLevel: 'TENANT', unit: null, meterCode: null, status: 'DEPRECATED' },
      { code: 'fixture.users.max', kind: 'LIMIT', isBaseline: false, scopeLevel: 'TENANT', unit: 'user', meterCode: null, status: 'ACTIVE' },
      { code: 'fixture.docs.monthly', kind: 'ALLOWANCE', isBaseline: false, scopeLevel: 'TENANT', unit: 'document', meterCode: 'docs', status: 'ACTIVE' },
    ],
    granted: [
      { code: 'fixture.core', value: null, enforcement: null, included: null, sources: ['BASELINE'], companyIds: null },
      { code: 'fixture.reports', value: null, enforcement: null, included: null, sources: ['PLAN'], companyIds: null },
      { code: 'fixture.promotions', value: null, enforcement: null, included: null, sources: ['ADDON'], companyIds: ['c-2', 'c-1'] },
      { code: 'fixture.legacy_export', value: null, enforcement: null, included: null, sources: ['PLAN'], companyIds: null },
      { code: 'fixture.users.max', value: 25, enforcement: 'HARD', included: null, sources: ['PLAN', 'ADDON'], companyIds: null },
      { code: 'fixture.docs.monthly', value: null, enforcement: null, included: 150, sources: ['PLAN', 'ADDON'], companyIds: null },
    ],
    allowancePeriod: { start: '2026-10-01', end: '2026-10-31' },
    aiCredits: { weights: [], weightsVersion: 0 },
    correlationId: '00000000-0000-4ccc-8000-0000000000c1',
    ...overrides,
  };
}

describe('buildSnapshot — determinismo', () => {
  it('mismo estado → mismo JSON canónico byte a byte', async () => {
    const a = await buildSnapshot(input());
    const b = await buildSnapshot(input());
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('el orden de llegada del registro y de los grants no cambia el resultado', async () => {
    const base = input();
    const shuffled = input({ registry: [...base.registry].reverse(), granted: [...base.granted].reverse() });
    expect(canonicalize(await buildSnapshot(shuffled))).toBe(canonicalize(await buildSnapshot(base)));
  });

  it('listas ordenadas por código; fuentes y compañías ordenadas', async () => {
    const s = await buildSnapshot(input());
    const codes = s.capabilities.map((c) => c.code);
    expect(codes).toEqual([...codes].sort());
    expect(s.limits[0].sources).toEqual(['ADDON', 'PLAN']);
    expect(s.capabilities.find((c) => c.code === 'fixture.promotions')?.scope).toEqual({
      level: 'COMPANY',
      companyIds: ['c-1', 'c-2'],
    });
  });
});

describe('buildSnapshot — snapshot completo (spec §7.2 regla 1)', () => {
  it('lista TODAS las sellables ACTIVE con enabled explícito; sin baseline ni DRAFT', async () => {
    const s = await buildSnapshot(input());
    expect(s.capabilities).toEqual([
      { code: 'fixture.ai.insights', enabled: false, scope: { level: 'TENANT' }, sources: [] },
      { code: 'fixture.legacy_export', enabled: true, scope: { level: 'TENANT' }, sources: ['PLAN'] },
      { code: 'fixture.promotions', enabled: true, scope: { level: 'COMPANY', companyIds: ['c-1', 'c-2'] }, sources: ['ADDON'] },
      { code: 'fixture.reports', enabled: true, scope: { level: 'TENANT' }, sources: ['PLAN'] },
    ]);
  });

  it('una DEPRECATED sin grant no aparece (el receptor la deniega por omisión)', async () => {
    const s = await buildSnapshot(input());
    expect(s.capabilities.map((c) => c.code)).not.toContain('fixture.old_widget');
  });

  it('COMPANY concedida a nivel tenant va sin lista (= todas); no concedida, sin lista', async () => {
    const granted = input().granted.map((g) => (g.code === 'fixture.promotions' ? { ...g, companyIds: null } : g));
    const s = await buildSnapshot(input({ granted }));
    expect(s.capabilities.find((c) => c.code === 'fixture.promotions')?.scope).toEqual({ level: 'COMPANY' });
    const none = await buildSnapshot(input({ granted: granted.filter((g) => g.code !== 'fixture.promotions') }));
    expect(none.capabilities.find((c) => c.code === 'fixture.promotions')).toEqual({
      code: 'fixture.promotions',
      enabled: false,
      scope: { level: 'COMPANY' },
      sources: [],
    });
  });

  it('límites y asignaciones concedidos, con su unidad; período y BLOCK por defecto', async () => {
    const s = await buildSnapshot(input());
    expect(s.limits).toEqual([
      { code: 'fixture.users.max', value: 25, unit: 'user', enforcement: 'HARD', scope: { level: 'TENANT' }, sources: ['ADDON', 'PLAN'] },
    ]);
    expect(s.allowances).toEqual([
      {
        code: 'fixture.docs.monthly',
        meterCode: 'docs',
        included: 150,
        unit: 'document',
        period: { start: '2026-10-01', end: '2026-10-31' },
        overageMode: 'BLOCK',
        sources: ['ADDON', 'PLAN'],
      },
    ]);
  });

  it('un grant de un código fuera del registro no se cuela en el snapshot', async () => {
    const granted = [...input().granted, { code: 'fixture.ghost', value: null, enforcement: null, included: null, sources: ['PLAN' as const], companyIds: null }];
    const s = await buildSnapshot(input({ granted }));
    expect(JSON.stringify(s)).not.toContain('fixture.ghost');
  });
});

describe('buildSnapshot — identidad, checksum y vigencia', () => {
  it('idempotencyKey = ma-ent-v1-sha256(tenant:producto:versión)', async () => {
    const s = await buildSnapshot(input());
    expect(s.idempotencyKey).toBe(`ma-ent-v1-${await sha256Hex(`${TENANT}:fixture:3`)}`);
    expect(await idempotencyKeyFor(TENANT, 'fixture', 3)).toBe(s.idempotencyKey);
  });

  it('checksum = JCS sin el propio campo, y verifySnapshot lo acepta', async () => {
    const s = await buildSnapshot(input());
    expect(s.checksum).toBe(await entitlementChecksum(s as unknown as Record<string, unknown>));
    expect(await verifySnapshot(s)).toEqual([]);
  });

  it('verifySnapshot detecta un documento alterado después de firmar el checksum', async () => {
    const s = await buildSnapshot(input());
    const tampered = { ...s, appActive: false };
    expect(await verifySnapshot(tampered)).toContain('CHECKSUM_MISMATCH');
  });

  it('verifySnapshot rechaza otro esquema', async () => {
    const s = await buildSnapshot(input());
    expect(await verifySnapshot({ ...s, schema: 'ebim.entitlements/v2' } as never)).toContain('SNAPSHOT_INVALID');
  });

  it('effectiveAt posterior a issuedAt no se emite (spec §7.2 regla 4)', async () => {
    await expect(buildSnapshot(input({ effectiveAt: '2026-10-02T00:00:00Z' }))).rejects.toThrow(SnapshotError);
  });

  it('versión no positiva o previousVersion incoherente no se emite', async () => {
    await expect(buildSnapshot(input({ snapshotVersion: 0, previousVersion: null }))).rejects.toThrow(SnapshotError);
    await expect(buildSnapshot(input({ snapshotVersion: 3, previousVersion: 3 }))).rejects.toThrow(SnapshotError);
  });
});

describe('assertSnapshotSafe — nada comercial ni secreto (spec §7.2 reglas 6 y 7)', () => {
  it.each(['price', 'amount', 'currency', 'cost', 'secret', 'token', 'email', 'key', 'priceMonth', 'unitAmount', 'secret_ref', 'apiKey', 'tokens', 'password'])(
    'clave prohibida "%s" → FORBIDDEN_KEY (también anidada)',
    (key) => {
      expect(() => assertSnapshotSafe({ [key]: 1 })).toThrow(SnapshotError);
      expect(() => assertSnapshotSafe({ limits: [{ code: 'x.y', extra: { [key]: 'v' } }] })).toThrow(/FORBIDDEN_KEY|prohibida/);
    },
  );

  it('idempotencyKey es la única excepción', () => {
    expect(() => assertSnapshotSafe({ idempotencyKey: 'ma-ent-v1-abc' })).not.toThrow();
  });

  it.each([
    ['correo', 'admin@cliente.pe'],
    // secrets-scan:allow encabezado PEM sin clave: el test exige que el emisor lo RECHACE
    ['PEM', '-----BEGIN PRIVATE KEY-----'],
    ['JWT', 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln'],
  ])('valor con forma de %s → FORBIDDEN_VALUE', (_label, value) => {
    expect(() => assertSnapshotSafe({ external: { tenantId: value } })).toThrow(SnapshotError);
  });

  it('el constructor también lo aplica: un id externo con correo no se emite', async () => {
    await expect(
      buildSnapshot(input({ external: { tenantId: 'admin@cliente.pe', organizationId: null, companyIds: [] } })),
    ).rejects.toThrow(SnapshotError);
  });

  it('> 64 KB → SNAPSHOT_TOO_LARGE', async () => {
    const registry = Array.from({ length: 2000 }, (_, i) => ({
      code: `fixture.module_${String(i).padStart(4, '0')}.feature_with_a_long_name`,
      kind: 'FEATURE' as const,
      isBaseline: false,
      scopeLevel: 'TENANT' as const,
      unit: null,
      meterCode: null,
      status: 'ACTIVE' as const,
    }));
    await expect(buildSnapshot(input({ registry }))).rejects.toMatchObject({ code: 'SNAPSHOT_TOO_LARGE' });
  });
});
