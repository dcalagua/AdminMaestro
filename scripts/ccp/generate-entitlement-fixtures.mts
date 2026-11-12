/**
 * Genera FIX-ENT-v1 (contracts/entitlements/v1): fixtures, respuestas esperadas
 * y CHECKSUMS.sha256. Determinista: dos ejecuciones producen los mismos bytes.
 *
 *   node --experimental-strip-types scripts/ccp/generate-entitlement-fixtures.mts
 *
 * Los snapshots los construye buildSnapshot (el emisor probado). Las respuestas
 * esperadas NO salen del receptor de referencia: la semántica de cada paso
 * (código HTTP, error, replayed, warnings) está escrita aquí a mano, y el test
 * reference-receiver.test.ts comprueba que el receptor la reproduce.
 *
 * FIX-ENT-v1 es inmutable una vez publicado: este script solo se vuelve a
 * ejecutar para comprobar que el resultado es idéntico. Una corrección es v1.1.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot } from '../../supabase/functions/_shared/entitlements/snapshot.ts';
import { entitlementChecksum } from '../../supabase/functions/_shared/entitlements/jcs.ts';
import type {
  EntitlementSnapshot,
  GrantedCapability,
  RegistryCapability,
  SnapshotInput,
} from '../../supabase/functions/_shared/entitlements/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../contracts/entitlements/v1');
const ISO = '$iso8601';

const tenant = (n: number) => `00000000-0000-4ccc-8000-${n.toString(16).padStart(12, '0')}`;
const corr = (n: number, v: number) => `00000000-0000-4ccc-8000-${(0xc0000 + n * 16 + v).toString(16).padStart(12, '0')}`;
const COMPANY_1 = '00000000-0000-4ccc-8000-00000000c001';
const COMPANY_2 = '00000000-0000-4ccc-8000-00000000c002';

const REGISTRY: RegistryCapability[] = [
  { code: 'fixture.core', kind: 'FEATURE', isBaseline: true, scopeLevel: 'TENANT', unit: null, meterCode: null, status: 'ACTIVE' },
  { code: 'fixture.reports', kind: 'FEATURE', isBaseline: false, scopeLevel: 'TENANT', unit: null, meterCode: null, status: 'ACTIVE' },
  { code: 'fixture.promotions', kind: 'FEATURE', isBaseline: false, scopeLevel: 'COMPANY', unit: null, meterCode: null, status: 'ACTIVE' },
  { code: 'fixture.ai.insights', kind: 'AI_FEATURE', isBaseline: false, scopeLevel: 'TENANT', unit: null, meterCode: 'ai.credits', status: 'ACTIVE' },
  { code: 'fixture.users.max', kind: 'LIMIT', isBaseline: false, scopeLevel: 'TENANT', unit: 'user', meterCode: null, status: 'ACTIVE' },
  { code: 'fixture.docs.monthly', kind: 'ALLOWANCE', isBaseline: false, scopeLevel: 'TENANT', unit: 'document', meterCode: 'docs', status: 'ACTIVE' },
];
const GHOST: RegistryCapability = { code: 'fixture.ghost', kind: 'FEATURE', isBaseline: false, scopeLevel: 'TENANT', unit: null, meterCode: null, status: 'ACTIVE' };

const g = {
  baseline: { code: 'fixture.core', value: null, enforcement: null, included: null, sources: ['BASELINE'], companyIds: null } as GrantedCapability,
  reports: { code: 'fixture.reports', value: null, enforcement: null, included: null, sources: ['PLAN'], companyIds: null } as GrantedCapability,
  promotions: { code: 'fixture.promotions', value: null, enforcement: null, included: null, sources: ['ADDON'], companyIds: [COMPANY_2, COMPANY_1] } as GrantedCapability,
  users: (value: number, sources: GrantedCapability['sources'] = ['PLAN']) =>
    ({ code: 'fixture.users.max', value, enforcement: 'HARD', included: null, sources, companyIds: null }) as GrantedCapability,
  docs: (included: number, sources: GrantedCapability['sources'] = ['PLAN']) =>
    ({ code: 'fixture.docs.monthly', value: null, enforcement: null, included, sources, companyIds: null }) as GrantedCapability,
  ghost: { code: 'fixture.ghost', value: null, enforcement: null, included: null, sources: ['PLAN'], companyIds: null } as GrantedCapability,
};

function input(n: number, v: number, over: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    environment: 'DEV',
    controlPlaneTenantId: tenant(n),
    productCode: 'fixture',
    external: { tenantId: `fixture-ext-${String(n).padStart(2, '0')}`, organizationId: `fixture-org-${String(n).padStart(2, '0')}`, companyIds: [] },
    snapshotVersion: v,
    previousVersion: v > 1 ? v - 1 : null,
    effectiveAt: `2026-10-01T00:00:0${v}Z`,
    issuedAt: `2026-10-01T00:00:1${v}Z`,
    appActive: true,
    planCode: 'fixture-standard',
    registry: REGISTRY,
    granted: [g.baseline],
    allowancePeriod: { start: '2026-10-01', end: '2026-10-31' },
    aiCredits: { weights: [], weightsVersion: 0 },
    correlationId: corr(n, v),
    ...over,
  };
}

type Expect =
  | { status: 200; applied: 'APPLIED' | 'APPLIED_WITH_WARNINGS'; replayed: boolean; unknown?: string[]; appliedFromStep?: number }
  | { status: 409 | 422 | 404; error: string; appliedVersion?: number };

interface Step {
  snapshot: EntitlementSnapshot | Record<string, unknown>;
  expect: Expect;
  tenantPath?: string;
}

interface Scenario {
  id: string;
  description: string;
  tenantNumber: number;
  provisioned?: boolean;
  steps: Step[];
  /** Estado del GET tras el último paso: paso cuyo snapshot quedó aplicado, o NONE. */
  get: { fromStep: number; status: 'APPLIED' | 'APPLIED_WITH_WARNINGS'; unknown?: string[] } | { status: 'NONE' };
  emitterNegative?: { error: 'FORBIDDEN_KEY' };
}

const KNOWN = ['fixture.ai.insights', 'fixture.docs.monthly', 'fixture.promotions', 'fixture.reports', 'fixture.users.max'];

async function scenarios(): Promise<Scenario[]> {
  const planGrants = [g.baseline, g.reports, g.users(25), g.docs(100)];
  const withAddon = [g.baseline, g.reports, g.promotions, g.users(25, ['ADDON', 'PLAN']), g.docs(150, ['ADDON', 'PLAN'])];

  const s08v3 = await buildSnapshot(input(8, 3, { granted: planGrants }));
  const s08v2 = await buildSnapshot(input(8, 2, { granted: planGrants }));
  const s09a = await buildSnapshot(input(9, 1, { granted: planGrants }));
  const s09b = await buildSnapshot(input(9, 1, { granted: [g.baseline] }));
  const s10 = await buildSnapshot(input(10, 1, { granted: planGrants }));
  const s10bad = { ...s10, checksum: `sha256:${'0'.repeat(64)}` };
  const s12base = await buildSnapshot(input(12, 1, { granted: planGrants }));
  const { checksum: _c, ...s12rest } = s12base;
  const s12doc: Record<string, unknown> = { ...s12rest, price: 10 };
  s12doc.checksum = await entitlementChecksum(s12doc);

  return [
    {
      id: '01-baseline-only', tenantNumber: 1,
      description: 'App activa sin nada vendido: todas las sellables ACTIVE con enabled=false; solo baseline.',
      steps: [{ snapshot: await buildSnapshot(input(1, 1, { planCode: null })), expect: { status: 200, applied: 'APPLIED', replayed: false } }],
      get: { fromStep: 1, status: 'APPLIED' },
    },
    {
      id: '02-plan-grants', tenantNumber: 2,
      description: 'Capacidades, límite y asignación concedidos por el plan.',
      steps: [{ snapshot: await buildSnapshot(input(2, 1, { granted: planGrants })), expect: { status: 200, applied: 'APPLIED', replayed: false } }],
      get: { fromStep: 1, status: 'APPLIED' },
    },
    {
      id: '03-plan-plus-addon', tenantNumber: 3,
      description: 'Unión plan + add-on (COMPANY con dos compañías; MAX en el límite, SUM en la asignación). El segundo PUT idéntico es un replay (200 replayed:true).',
      steps: (() => [])(),
      get: { fromStep: 1, status: 'APPLIED' },
    },
    {
      id: '04-addon-removed', tenantNumber: 4,
      description: 'v2 revoca el add-on (promotions enabled=false, límites y asignaciones solo del plan).',
      steps: [
        { snapshot: await buildSnapshot(input(4, 1, { granted: withAddon })), expect: { status: 200, applied: 'APPLIED', replayed: false } },
        { snapshot: await buildSnapshot(input(4, 2, { granted: planGrants })), expect: { status: 200, applied: 'APPLIED', replayed: false } },
      ],
      get: { fromStep: 2, status: 'APPLIED' },
    },
    {
      id: '05-limit-update', tenantNumber: 5,
      description: 'v2 baja el límite de usuarios de 25 a 10 (grandfather: el receptor bloquea altas nuevas, no desactiva recursos).',
      steps: [
        { snapshot: await buildSnapshot(input(5, 1, { granted: planGrants })), expect: { status: 200, applied: 'APPLIED', replayed: false } },
        { snapshot: await buildSnapshot(input(5, 2, { granted: [g.baseline, g.reports, g.users(10), g.docs(100)] })), expect: { status: 200, applied: 'APPLIED', replayed: false } },
      ],
      get: { fromStep: 2, status: 'APPLIED' },
    },
    {
      id: '06-app-inactive', tenantNumber: 6,
      description: 'appActive=false: se aplica y el receptor bloquea el acceso operativo (no borra datos).',
      steps: [{ snapshot: await buildSnapshot(input(6, 1, { appActive: false, granted: planGrants.filter((x) => x !== g.baseline) })), expect: { status: 200, applied: 'APPLIED', replayed: false } }],
      get: { fromStep: 1, status: 'APPLIED' },
    },
    {
      id: '07-unknown-capability', tenantNumber: 7,
      description: 'fixture.ghost no está en el manifiesto del receptor: se guarda, NO se concede y el estado queda APPLIED_WITH_WARNINGS.',
      steps: [{
        snapshot: await buildSnapshot(input(7, 1, { registry: [...REGISTRY, GHOST], granted: [...planGrants, g.ghost] })),
        expect: { status: 200, applied: 'APPLIED_WITH_WARNINGS', replayed: false, unknown: ['fixture.ghost'] },
      }],
      get: { fromStep: 1, status: 'APPLIED_WITH_WARNINGS', unknown: ['fixture.ghost'] },
    },
    {
      id: '08-stale', tenantNumber: 8,
      description: 'Aplicada v3, llega v2: 409 STALE_SNAPSHOT con appliedVersion=3 (un snapshot atrasado nunca revoca lo posterior).',
      steps: [
        { snapshot: s08v3, expect: { status: 200, applied: 'APPLIED', replayed: false } },
        { snapshot: s08v2, expect: { status: 409, error: 'STALE_SNAPSHOT', appliedVersion: 3 } },
      ],
      get: { fromStep: 1, status: 'APPLIED' },
    },
    {
      id: '09-conflict', tenantNumber: 9,
      description: 'Misma versión con otro contenido (checksum válido pero distinto): 409 VERSION_CONFLICT; lo aplicado no cambia.',
      steps: [
        { snapshot: s09a, expect: { status: 200, applied: 'APPLIED', replayed: false } },
        { snapshot: s09b, expect: { status: 409, error: 'VERSION_CONFLICT', appliedVersion: 1 } },
      ],
      get: { fromStep: 1, status: 'APPLIED' },
    },
    {
      id: '10-bad-checksum', tenantNumber: 10,
      description: 'checksum que no corresponde al contenido: 422 CHECKSUM_MISMATCH; nada aplicado.',
      steps: [{ snapshot: s10bad, expect: { status: 422, error: 'CHECKSUM_MISMATCH' } }],
      get: { status: 'NONE' },
    },
    {
      id: '11-wrong-environment', tenantNumber: 11,
      description: 'Snapshot de QAS en un receptor DEV: 422 ENVIRONMENT_MISMATCH.',
      steps: [{ snapshot: await buildSnapshot(input(11, 1, { environment: 'QAS', granted: planGrants })), expect: { status: 422, error: 'ENVIRONMENT_MISMATCH' } }],
      get: { status: 'NONE' },
    },
    {
      id: '12-forbidden-keys', tenantNumber: 12,
      description: 'Negativo del EMISOR: un documento con "price" no se emite (FORBIDDEN_KEY). Si aun así llegara, el receptor lo rechaza por forma: 422 SNAPSHOT_INVALID.',
      steps: [{ snapshot: s12doc, expect: { status: 422, error: 'SNAPSHOT_INVALID' } }],
      get: { status: 'NONE' },
      emitterNegative: { error: 'FORBIDDEN_KEY' },
    },
    {
      id: '13-tenant-not-provisioned', tenantNumber: 13, provisioned: false,
      description: 'Tenant sin provisioning local en el receptor: 404 TENANT_NOT_PROVISIONED (aditivo a la lista del plan §3.1).',
      steps: [{ snapshot: await buildSnapshot(input(13, 1, { granted: planGrants })), expect: { status: 404, error: 'TENANT_NOT_PROVISIONED' } }],
      get: { status: 'NONE' },
    },
  ].map((s) => s as Scenario);
}

function stable(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

async function main() {
  const list = await scenarios();
  // 03 se construye aparte: dos pasos con el MISMO snapshot.
  const s03 = await buildSnapshot(
    input(3, 1, {
      external: { tenantId: 'fixture-ext-03', organizationId: 'fixture-org-03', companyIds: ['fixture-co-03a', 'fixture-co-03b'] },
      granted: [g.baseline, g.reports, g.promotions, g.users(25, ['ADDON', 'PLAN']), g.docs(150, ['ADDON', 'PLAN'])],
    }),
  );
  list[2].steps = [
    { snapshot: s03, expect: { status: 200, applied: 'APPLIED', replayed: false } },
    { snapshot: s03, expect: { status: 200, applied: 'APPLIED', replayed: true, appliedFromStep: 1 } },
  ];

  mkdirSync(join(ROOT, 'fixtures'), { recursive: true });
  mkdirSync(join(ROOT, 'expected'), { recursive: true });

  const puts: Record<string, unknown> = {};
  const gets: Record<string, unknown> = {};

  for (const s of list) {
    const t = tenant(s.tenantNumber);
    const fixture = {
      id: s.id,
      description: s.description,
      receiver: {
        environment: 'DEV',
        productCode: 'fixture',
        knownCapabilities: KNOWN,
        baselineCapabilities: ['fixture.core'],
        provisionedTenants: s.provisioned === false ? [] : [t],
        enforcementMode: 'SHADOW',
        writeScope: 'fixture:entitlements:write',
        readScope: 'fixture:entitlements:read',
      },
      ...(s.emitterNegative ? { emitterNegative: s.emitterNegative } : {}),
      steps: s.steps.map((st, i) => ({ step: i + 1, tenantPath: st.tenantPath ?? t, snapshot: st.snapshot })),
    };
    writeFileSync(join(ROOT, 'fixtures', `${s.id}.json`), stable(fixture));

    puts[s.id] = s.steps.map((st, i) => {
      const e = st.expect;
      if (e.status === 200) {
        const src = s.steps[(e.appliedFromStep ?? i + 1) - 1].snapshot as EntitlementSnapshot;
        return {
          step: i + 1,
          status: 200,
          body: {
            appliedVersion: src.snapshotVersion,
            appliedChecksum: src.checksum,
            appliedAt: ISO,
            status: e.applied,
            unknownCapabilities: e.unknown ?? [],
            replayed: e.replayed,
          },
        };
      }
      return {
        step: i + 1,
        status: e.status,
        body: { error: e.error, ...(e.appliedVersion !== undefined ? { appliedVersion: e.appliedVersion } : {}) },
      };
    });

    const gt = s.get;
    const applied = 'fromStep' in gt ? (s.steps[gt.fromStep - 1].snapshot as EntitlementSnapshot) : null;
    gets[s.id] =
      s.provisioned === false
        ? { status: 404, body: { error: 'TENANT_NOT_PROVISIONED' } }
        : {
            status: 200,
            body: {
              controlPlaneTenantId: t,
              productCode: 'fixture',
              appliedVersion: applied?.snapshotVersion ?? null,
              appliedChecksum: applied?.checksum ?? null,
              appliedAt: applied ? ISO : null,
              status: gt.status,
              unknownCapabilities: 'unknown' in gt ? (gt.unknown ?? []) : [],
              enforcementMode: 'SHADOW',
            },
          };
  }

  writeFileSync(
    join(ROOT, 'expected', 'put-responses.json'),
    stable({
      description:
        'Respuesta esperada de cada PUT, en orden, sobre un receptor vacío configurado con fixture.receiver. "$iso8601" = cualquier instante ISO-8601 UTC. En errores, además de "error" el receptor devuelve "message" (texto libre, no se compara).',
      responses: puts,
    }),
  );
  writeFileSync(
    join(ROOT, 'expected', 'get-applied.json'),
    stable({
      description: 'GET /tenants/{id}/entitlements tras ejecutar todos los pasos del fixture. Es la única prueba válida de sincronización (spec §8.3).',
      responses: gets,
    }),
  );

  // CHECKSUMS.sha256: todo el directorio salvo el propio archivo y los tests.
  const files: string[] = [];
  const walk = (dir: string, rel = '') => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${name.name}` : name.name;
      if (name.isDirectory()) walk(join(dir, name.name), r);
      else if (r !== 'CHECKSUMS.sha256' && !r.endsWith('.test.ts')) files.push(r);
    }
  };
  walk(ROOT);
  files.sort();
  const lines = files.map((f) => `${createHash('sha256').update(readFileSync(join(ROOT, f))).digest('hex')}  ${f}`);
  writeFileSync(join(ROOT, 'CHECKSUMS.sha256'), lines.join('\n') + '\n');
  const pin = createHash('sha256').update(readFileSync(join(ROOT, 'CHECKSUMS.sha256'))).digest('hex');
  console.log(`FIX-ENT-v1: ${files.length} archivos · sha256(CHECKSUMS.sha256) = ${pin}`);
}

await main();
