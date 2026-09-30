import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalize } from '../jcs';
import { sha256Hex } from '../../provisioning/fingerprint';
import { assertSnapshotSafe } from '../snapshot';
import { parseHubExport } from './hub-export';
import { mapHubExport, type HubMappingContext, type LegacyTenantState } from './hub-mapping';
import {
  buildParityAttestation,
  compareHubWithMasterAdmin,
  HubParityError,
  renderHubParityReport,
  summarizeHubParity,
  type HubParityResult,
  type HubParitySnapshotView,
} from './hub-parity';

/*
 * Paridad dual-read hub GMAO ↔ MasterAdmin (spec §15.1, §15.3). GREEN solo con
 * 0 diferencias bloqueantes; las baseline no cuentan; sin precios en ninguna
 * salida. La atestación es lo que el operador entrega a GMAO para que su guarda
 * de autoridad permita MASTERADMIN_AUTHORITY.
 */

const MQ = 'd0000000-0000-4000-8000-000000000001';
const SU = 'e0000000-0000-4000-8000-000000000001';
const SU2 = 'e0000000-0000-4000-8000-000000000002';
const TENANT_MQ = 'a0000000-0000-4000-8000-000000000001';
const TENANT_SU = 'a0000000-0000-4000-8000-000000000002';
const RAN_AT = '2026-09-28T12:30:00Z';

type Ctx = HubMappingContext & { snapshots: HubParitySnapshotView[] };
const ctx = (): Ctx =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub-context.synthetic.json'), 'utf8')) as Ctx;

async function mapped() {
  const exp = await parseHubExport(readFileSync(resolve(__dirname, 'fixtures/hub-export.synthetic.json'), 'utf8'), {
    expectedEnvironment: 'LOCAL',
  });
  const c = ctx();
  return { exp, ctx: c, mapping: await mapHubExport(exp, c) };
}

function stateOf(states: LegacyTenantState[], org: string): LegacyTenantState {
  return structuredClone(states.find((s) => s.organizationId === org)!);
}

function snapshotOf(c: Ctx, tenantId: string): HubParitySnapshotView {
  return structuredClone(c.snapshots.find((s) => s.controlPlaneTenantId === tenantId)!);
}

const types = (r: HubParityResult) => r.diffs.map((d) => `${d.severity}:${d.type}:${d.capabilityCode ?? '-'}`);

describe('compareHubWithMasterAdmin · fixture sintético', () => {
  it('eCommerce/MiQuímica: GREEN con avisos (ítems no disponibles pero activos, capacidad DRAFT)', async () => {
    const { ctx: c, mapping } = await mapped();
    const r = compareHubWithMasterAdmin(stateOf(mapping.legacyTenantState, MQ), snapshotOf(c, TENANT_MQ), c.registry.ecommerce);
    expect(r).toMatchObject({ productCode: 'ecommerce', tenantId: TENANT_MQ, verdict: 'GREEN', blocking: 0 });
    expect(r.diffs.filter((d) => d.type === 'HUB_ITEM_UNAVAILABLE_BUT_ACTIVE')).toHaveLength(22);
    expect(types(r)).toContain('WARNING:DRAFT_CAPABILITY_IN_HUB:ecommerce.planning.demand');
    expect(r.warnings).toBe(23);
  });

  it('eSupplier: BLOCKED por código sin mapeo y por capacidad solo en el hub; aviso por alcance parcial', async () => {
    const { ctx: c, mapping } = await mapped();
    const r = compareHubWithMasterAdmin(stateOf(mapping.legacyTenantState, SU), snapshotOf(c, TENANT_SU), c.registry.esupplier);
    expect(r.verdict).toBe('BLOCKED');
    expect(types(r)).toEqual([
      'BLOCKING:CAPABILITY_ONLY_IN_HUB:esupplier.companies.extra',
      'BLOCKING:UNMAPPED_ACTIVE_HUB_CODE:-',
      'WARNING:COMPANY_SCOPE_PARTIAL:esupplier.sourcing.events',
    ]);
    expect(r.diffs[1].hubCodes).toEqual(['esupplier_legacy_portal']);
    expect(r).toMatchObject({ blocking: 2, warnings: 1 });
  });

  it('organización sin vínculo: TENANT_NOT_LINKED, sin comparar snapshot', async () => {
    const { ctx: c, mapping } = await mapped();
    const r = compareHubWithMasterAdmin(stateOf(mapping.legacyTenantState, SU2), null, c.registry.esupplier);
    expect(r).toMatchObject({ tenantId: null, verdict: 'BLOCKED' });
    expect(types(r)).toEqual(['BLOCKING:TENANT_NOT_LINKED:-']);
  });
});

describe('compareHubWithMasterAdmin · reglas', () => {
  async function base() {
    const { ctx: c, mapping } = await mapped();
    return { c, state: stateOf(mapping.legacyTenantState, MQ), snap: snapshotOf(c, TENANT_MQ), registry: c.registry.ecommerce };
  }

  it('SNAPSHOT_MISSING si el tenant vinculado no tiene snapshot', async () => {
    const { state, registry } = await base();
    const r = compareHubWithMasterAdmin(state, null, registry);
    expect(r.verdict).toBe('BLOCKED');
    expect(types(r)[0]).toBe('BLOCKING:SNAPSHOT_MISSING:-');
  });

  it('APP_ACTIVE_MISMATCH', async () => {
    const { state, snap, registry } = await base();
    snap.appActive = false;
    expect(types(compareHubWithMasterAdmin(state, snap, registry))).toContain('BLOCKING:APP_ACTIVE_MISMATCH:-');
  });

  it('CAPABILITY_ONLY_IN_MASTERADMIN (incluye límites y asignaciones concedidas)', async () => {
    const { state, snap, registry } = await base();
    snap.capabilities.find((x) => x.code === 'ecommerce.ai.insights')!.enabled = true;
    snap.limits = [{ code: 'ecommerce.users.max', value: 5, unit: 'user', enforcement: 'HARD', scope: { level: 'TENANT' }, sources: ['PLAN'] }];
    const r = compareHubWithMasterAdmin(state, snap, [
      ...registry,
      { code: 'ecommerce.users.max', kind: 'LIMIT', isBaseline: false, scopeLevel: 'TENANT', unit: 'user', meterCode: null, status: 'ACTIVE' },
    ]);
    expect(types(r)).toEqual(
      expect.arrayContaining([
        'BLOCKING:CAPABILITY_ONLY_IN_MASTERADMIN:ecommerce.ai.insights',
        'BLOCKING:CAPABILITY_ONLY_IN_MASTERADMIN:ecommerce.users.max',
      ]),
    );
  });

  it('CAPABILITY_ONLY_IN_HUB cuando MasterAdmin la tiene enabled=false', async () => {
    const { state, snap, registry } = await base();
    snap.capabilities.find((x) => x.code === 'ecommerce.promotions')!.enabled = false;
    const r = compareHubWithMasterAdmin(state, snap, registry);
    expect(types(r)).toContain('BLOCKING:CAPABILITY_ONLY_IN_HUB:ecommerce.promotions');
    expect(r.diffs.find((d) => d.capabilityCode === 'ecommerce.promotions')!.hubCodes).toEqual(['ecommerce.promotions']);
  });

  it('las capacidades baseline se ignoran en ambos lados', async () => {
    const { state, snap, registry } = await base();
    state.capabilities['ecommerce.catalog'] = { activeCompanies: 1, totalCompanies: 1, viaSubscription: false, hubCodes: ['x'] };
    snap.capabilities.push({ code: 'ecommerce.storefront', enabled: true, scope: { level: 'TENANT' }, sources: ['BASELINE'] });
    const r = compareHubWithMasterAdmin(state, snap, registry);
    expect(r.verdict).toBe('GREEN');
    expect(r.diffs.some((d) => d.capabilityCode === 'ecommerce.catalog' || d.capabilityCode === 'ecommerce.storefront')).toBe(false);
  });

  it('una DRAFT activa en el hub es aviso, no bloqueo', async () => {
    const { state, snap, registry } = await base();
    const r = compareHubWithMasterAdmin(state, snap, registry);
    expect(r.diffs.some((d) => d.type === 'CAPABILITY_ONLY_IN_HUB' && d.capabilityCode === 'ecommerce.planning.demand')).toBe(false);
  });

  it('suscripción de organización cubre todas las compañías: sin COMPANY_SCOPE_PARTIAL', async () => {
    const { state, snap, registry } = await base();
    state.totalCompanies = 2;
    state.capabilities['ecommerce.promotions'] = { activeCompanies: 1, totalCompanies: 2, viaSubscription: true, hubCodes: ['ecommerce.promotions'] };
    state.capabilities['ecommerce.payments'] = { ...state.capabilities['ecommerce.payments'], totalCompanies: 2 };
    const r = compareHubWithMasterAdmin(state, snap, registry);
    expect(r.diffs.filter((d) => d.type === 'COMPANY_SCOPE_PARTIAL').map((d) => d.capabilityCode)).toEqual(['ecommerce.payments']);
  });

  it('rechaza comparar contra el snapshot de otro tenant o de otro producto', async () => {
    const { state, snap, registry } = await base();
    expect(() => compareHubWithMasterAdmin(state, { ...snap, controlPlaneTenantId: TENANT_SU }, registry)).toThrow(HubParityError);
    expect(() => compareHubWithMasterAdmin(state, { ...snap, productCode: 'esupplier' }, registry)).toThrow(HubParityError);
  });

  it('es determinista: el orden de snapshot y registro no cambia el resultado', async () => {
    const { state, snap, registry } = await base();
    snap.capabilities.find((x) => x.code === 'ecommerce.promotions')!.enabled = false;
    const a = compareHubWithMasterAdmin(state, snap, registry);
    const b = compareHubWithMasterAdmin(state, { ...snap, capabilities: [...snap.capabilities].reverse() }, [...registry].reverse());
    expect(canonicalize(b)).toBe(canonicalize(a));
  });
});

describe('resumen, reporte y atestación', () => {
  async function all(): Promise<HubParityResult[]> {
    const { ctx: c, mapping } = await mapped();
    return mapping.legacyTenantState.map((s) =>
      compareHubWithMasterAdmin(
        s,
        c.snapshots.find((x) => x.productCode === s.productCode && x.controlPlaneTenantId === s.tenantId) ?? null,
        c.registry[s.productCode],
      ),
    );
  }

  it('agrega por producto: eCommerce GREEN, eSupplier BLOCKED', async () => {
    const summary = summarizeHubParity(await all());
    expect(summary).toEqual([
      { productCode: 'ecommerce', tenants: 1, green: 1, blocked: 0, blocking: 0, warnings: 23, verdict: 'GREEN' },
      { productCode: 'esupplier', tenants: 2, green: 0, blocked: 2, blocking: 3, warnings: 1, verdict: 'BLOCKED' },
    ]);
  });

  it('un producto sin tenants no es GREEN', () => {
    expect(summarizeHubParity([])).toEqual([]);
  });

  it('el reporte markdown no lleva precios ni secretos y marca el veredicto', async () => {
    const md = renderHubParityReport(await all(), {
      environment: 'LOCAL',
      generatedAt: RAN_AT,
      exportContentChecksum: 'sha256:' + 'a'.repeat(64),
      mappingChecksum: 'sha256:' + 'b'.repeat(64),
    });
    expect(md).toContain('# Hub GMAO');
    expect(md).toMatch(/\| ecommerce \| 1 \| 1 \| 0 \| 0 \| 23 \| GREEN \|/);
    expect(md).toMatch(/\| esupplier \| 2 \| 0 \| 2 \| 3 \| 1 \| BLOCKED \|/);
    expect(md).toContain('UNMAPPED_ACTIVE_HUB_CODE');
    expect(md).toContain(`sin vínculo (org ${SU2})`);
    expect(md).not.toMatch(/price|precio_mes|currency|USD|secret|token|password/i);
  });

  it('el reporte escapa las barras de las celdas', () => {
    const md = renderHubParityReport(
      [
        {
          productCode: 'x|y',
          organizationId: MQ,
          tenantId: null,
          verdict: 'BLOCKED',
          blocking: 1,
          warnings: 0,
          diffs: [{ type: 'TENANT_NOT_LINKED', severity: 'BLOCKING', capabilityCode: null, hubCodes: [], detail: 'a|b' }],
        },
      ],
      { environment: 'LOCAL', generatedAt: RAN_AT },
    );
    expect(md).toContain('x\\|y');
    expect(md).toContain('a\\|b');
  });

  it('atestación por producto: conteos, checksums y fecha', async () => {
    const results = await all();
    const exportChecksum = 'sha256:' + 'c'.repeat(64);
    const att = await buildParityAttestation('ecommerce', results, exportChecksum, RAN_AT);
    expect(att).toMatchObject({ productCode: 'ecommerce', blocking: 0, warnings: 23, tenants: 1, exportChecksum, ranAt: RAN_AT });
    const product = results.filter((r) => r.productCode === 'ecommerce');
    expect(att.reportChecksum).toBe(`sha256:${await sha256Hex(canonicalize(product))}`);
    expect(() => assertSnapshotSafe(att)).not.toThrow();

    const blocked = await buildParityAttestation('esupplier', [...results].reverse(), exportChecksum, RAN_AT);
    expect(blocked).toMatchObject({ blocking: 3, warnings: 1, tenants: 2 });
    // El orden de entrada no cambia el checksum del reporte.
    expect(blocked.reportChecksum).toBe((await buildParityAttestation('esupplier', results, exportChecksum, RAN_AT)).reportChecksum);
  });

  it('atestación: exportChecksum mal formado o ranAt no ISO se rechazan', async () => {
    const results = await all();
    await expect(buildParityAttestation('ecommerce', results, 'md5:x', RAN_AT)).rejects.toBeInstanceOf(HubParityError);
    await expect(buildParityAttestation('ecommerce', results, 'sha256:' + 'c'.repeat(64), 'ayer')).rejects.toBeInstanceOf(HubParityError);
  });

  it('atestación sin fecha explícita usa la hora actual en ISO UTC', async () => {
    const att = await buildParityAttestation('ecommerce', await all(), 'sha256:' + 'c'.repeat(64));
    expect(att.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });
});
