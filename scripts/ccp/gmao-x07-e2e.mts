/**
 * E2E LOCAL de la fase 16 (X-07): MasterAdmin REAL → GMAO REAL (+ hub GMAO).
 *
 *   GMAO_WT=<worktree del programa en GMAO> \
 *     node --experimental-transform-types scripts/ccp/gmao-x07-e2e.mts
 *
 * MasterAdmin corre su código de producción: el emisor `buildSnapshot`, el cliente M2M
 * `EntitlementSyncClient` (JWT ES256 con clave generada EN MEMORIA) y los módulos del hub
 * (`parseHubExport` → `mapHubExport` → `compareHubWithMasterAdmin` → `buildParityAttestation`).
 *
 * GMAO corre su receptor de producción (`handleEntitlementsRequest`, lo que despacha
 * `platform-provisioning/index.ts`; la petición HTTP firmada se le entrega en proceso vía `fetchImpl`
 * porque el sandbox no permite abrir puertos locales), el núcleo de `charge` con pasarela FALSA que cuenta, y el núcleo
 * de `hub-commercial-export`, todos contra Postgres REAL en proceso (PGlite, mismo harness que
 * `supabase/tests/run_ccp16_tests.mjs`: GMAO no puede `db reset`) con la cadena de migraciones del
 * repo y el rol service_role de verdad. El tenant se da de alta con la RPC de provisioning REAL.
 * Sin red, sin proyectos remotos, sin pasarelas reales. No imprime claves ni tokens.
 *
 * Fase 18 · D-14 (DEV/LOCAL): el cobro usa el dataset SINTÉTICO `fixtures/d14-billing-cert.json`
 * (ítems de catálogo propios en PGlite + suscripción SANDBOX en MasterAdmin LOCAL (regla §2.2: DEMO no admite contrato recurrente activo; SANDBOX es no productivo y no facturable por uso, INV-7), SUPABASE_DB_URL).
 * La comparación BILLING_SHADOW la calcula MasterAdmin (`platform.record_billing_shadow_comparison`)
 * y su resultado (id, mismatches, checksum) se registra en GMAO — nunca un literal. La facturación
 * termina en SHADOW y nunca pasa por MASTERADMIN_AUTHORITY en esta corrida (regla 5);
 * entitlements terminan en MASTERADMIN_AUTHORITY (producto + tenant), sin rollback.
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { EntitlementSyncClient, type EntitlementDeliveryContext } from '../../supabase/functions/_shared/entitlements/sync-client.ts';
import { buildSnapshot } from '../../supabase/functions/_shared/entitlements/snapshot.ts';
import type { EntitlementSnapshot, GrantedCapability, RegistryCapability } from '../../supabase/functions/_shared/entitlements/types.ts';
import { parseHubExport } from '../../supabase/functions/_shared/entitlements/hub/hub-export.ts';
import { mapHubExport } from '../../supabase/functions/_shared/entitlements/hub/hub-mapping.ts';
import {
  buildParityAttestation, compareHubWithMasterAdmin, renderHubParityReport,
} from '../../supabase/functions/_shared/entitlements/hub/hub-parity.ts';
import { advanceAxis, axisState, ensureCcpIntegration, FINANCE, maDbUrl, maSql } from './d14-masteradmin.mts';
import { countChecks, D14_REASON, writeD14Evidence, type D14Evidence, type LegacyTenant } from './d14-evidence.mts';

const WT = process.env.GMAO_WT ?? '';
if (!WT.endsWith('/GMAO/.worktrees/ebim-commercial-control-plane-v1')) {
  console.error('HARD STOP: GMAO_WT debe apuntar al worktree del programa en GMAO');
  process.exit(2);
}
try { maDbUrl(); } catch (e) {
  console.error(String((e as Error).message), '(la fase D14 compara contra MasterAdmin LOCAL: SUPABASE_DB_URL = DB_URL de `supabase status -o env` en MasterAdmin; certify-local.sh la fija)');
  process.exit(2);
}
const PGLITE = join(WT, 'supabase/tests/node_modules/@electric-sql/pglite/dist/index.js');
if (!existsSync(PGLITE)) {
  console.error('HARD STOP: falta PGlite en el harness de GMAO (cd supabase/tests && npm install)');
  process.exit(2);
}

type Row = Record<string, unknown>;
const { PGlite } = (await import(PGLITE)) as { PGlite: { create(): Promise<Pg> } };
interface Pg {
  exec(sql: string): Promise<unknown>;
  query<T = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
const gmHandler = (await import(`${WT}/supabase/functions/_shared/entitlements/handler.ts`)) as {
  handleEntitlementsRequest(req: Request, deps: Row): Promise<Response>;
};
const gmConfig = (await import(`${WT}/supabase/functions/_shared/entitlements/config.ts`)) as {
  resolveEntitlementsConfig(env: (k: string) => string | undefined, prov: Row | null): { ok: boolean };
};
const gmStore = (await import(`${WT}/supabase/functions/_shared/entitlements/store.ts`)) as {
  createEntitlementsStore(client: unknown): unknown;
};
const gmM2m = (await import(`${WT}/supabase/functions/platform-provisioning/m2m_auth.ts`)) as {
  loadM2MConfig(env: (k: string) => string | undefined): Promise<Row & { issuer: string; createScope: string; readScope: string }>;
};
const gmCharge = (await import(`${WT}/supabase/functions/charge/core.ts`)) as {
  createChargeHandler(deps: Row): (req: Request) => Promise<Response>;
};
const gmHubExport = (await import(`${WT}/supabase/functions/hub-commercial-export/core.ts`)) as {
  createHubExportHandler(deps: Row): (req: Request) => Promise<Response>;
};

const results: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} · ${label}${detail ? ` · ${detail}` : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) process.exitCode = 1;
}

// ── GMAO: Postgres real en proceso con la cadena de migraciones del repo ─────
const mig = (f: string) => readFileSync(join(WT, 'supabase/migrations', f), 'utf8');
const harness = (f: string) => readFileSync(join(WT, 'supabase/tests', f), 'utf8');
const db = await PGlite.create();
await db.exec(harness('00_base_schema.sql'));
await db.exec(harness('20_provisioning_base.sql'));
await db.exec(mig('20260628_tenant_email_config.sql'));
await db.exec(harness('30_ccp_commercial_base.sql'));
await db.exec(mig('20260710200000_ai_entitlement_metering.sql'));
{
  const guards = mig('20260709150000_rpc_permission_guards.sql');
  const a = guards.indexOf('-- set_addon → ajustes.editar');
  await db.exec(guards.slice(a, guards.indexOf('-- set_reading_threshold', a)));
}
for (const f of ['20260928200000_ccp_ai_consume_validation.sql', '20260928200100_ccp_set_addon_technical_only.sql',
  '20260928200200_ccp_reset_ai_usage_service_only.sql', '20260928200300_ccp_secret_column_grants.sql',
  '20260925001118_platform_provisioning_m2m_capture_live.sql',
  '20260925001454_platform_provisioning_generic_v1_preprovisioned_admin.sql',
  '20260925002308_harden_tenant_provisioning_rpc_grants.sql']) await db.exec(mig(f));
await db.exec(harness('40_ccp_hub_capture.sql'));
for (const f of ['20261010100000_ccp_commercial_authority.sql', '20261010110000_ccp_gmao_entitlements_receiver.sql',
  '20261010120000_ccp_gmao_commercial_gate.sql', '20261010130000_ccp_billing_authority_guard.sql',
  '20261010140000_ccp_hub_commercial_freeze.sql', '20261017100000_ccp_gmao_usage_outbox.sql',
  '20261018100000_ccp_d14_app_active_commercial_only.sql', '20261018110000_ccp_d14_billing_comparison_masteradmin.sql']) await db.exec(mig(f));

let lock: Promise<unknown> = Promise.resolve();
/** Serializa: PGlite es una sola conexión y el rol se fija por sentencia. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}
const asRole = <T = Row>(role: string, sql: string, params: unknown[] = [], sub = '') => serial(async () => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
});
const svc = <T = Row>(sql: string, params: unknown[] = []) => asRole<T>('service_role', sql, params);
const failsWith = async (fn: () => Promise<unknown>, re: RegExp) => {
  try { await fn(); return false; } catch (e) { return re.test(String((e as Error).message)); }
};

/** Cliente `{ rpc }` del store de GMAO sobre PGlite, como service_role (lo que hace PostgREST). */
const rpc = {
  async rpc(fn: string, args: Row = {}) {
    const names = Object.keys(args);
    const casts = names.map((k, i) => {
      const v = args[k];
      return `${k} => $${i + 1}${v !== null && typeof v === 'object' ? '::jsonb' : typeof v === 'boolean' ? '::boolean' : ''}`;
    });
    const params = names.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    try {
      const rows = await svc<{ r: unknown }>(`select platform.${fn}(${casts.join(', ')}) as r`, params);
      return { data: rows[0]?.r ?? null, error: null };
    } catch (e) {
      return { data: null, error: { message: String((e as Error).message).split('\n')[0], code: null } };
    }
  },
};

// ── Claves en memoria ────────────────────────────────────────────────────────
const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const privatePem = [`-----BEGIN ${'PRIVATE'} KEY-----`, pkcs8, `-----END ${'PRIVATE'} KEY-----`].join('\n');
const spki = Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
const publicKeyB64 = Buffer.from(`-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----\n`).toString('base64');

// ── GMAO: alta REAL, estado legacy ───────────────────────────────────────────
const CPT = '9f160000-0000-4000-8000-000000000001';
await db.query(
  `select platform.m2m_provision_tenant($1::jsonb, $2, 'ma-prov-v1-x07-gmao', '9f160000-0000-4000-8000-0000000000c0'::uuid,
     'masteradmin-provisioning', 'x07-alta', 'actor-1', 'TECH_LEAD')`,
  [JSON.stringify({
    controlPlaneTenantId: CPT,
    organization: { id: null, slug: 'x07-gmao', name: 'X07 GMAO', code: 'x07-gmao', legalName: null, taxId: null, countryCode: 'PE', currency: null, timezone: 'America/Lima' },
    company: { id: null, code: 'X07-01', name: 'X07 Planta', legalName: null, taxId: null, countryCode: 'PE', currency: 'PEN' },
    admin: { email: 'x07@gmao.ebim.test' }, deploymentMode: 'SHARED',
    context: { tenantName: 'X07 · GMAO', tenantType: 'DEMO', environment: 'DEV', planCode: 'gmao-standard', planName: null, contractVersion: 'v1' },
  }), 'c'.repeat(64)],
);
const TEN = (await db.query<{ t: string }>(`select internal_tenant_id as t from platform.provisioning_requests where control_plane_tenant_id = $1`, [CPT])).rows[0]?.t;
const OWNER = 'aaaaaaa9-0000-4000-8000-00000000009a';
await db.exec(`
  update platform.tenants set plan_code = 'gmao-standard' where id = '${TEN}';
  insert into platform.tenant_users (tenant_id, auth_user_id, email, role) values ('${TEN}', '${OWNER}', 'owner@x07.ebim.test', 'owner');`);
await svc(`select platform.ccp_set_ai_entitlement($1, true, 'active', null, 50, 'x07', 'legacy inicial')`, [TEN]);
const ai = async () => (await asRole<{ r: Row }>('test_user', `select public.ai_consume('report', 1) as r`, [], OWNER))[0].r;
const a0 = await ai();
check('0. alta real de GMAO + IA legacy 50/mes; autoridad DUAL_READ decide legacy', Boolean(TEN) && a0.allowed === true && a0.quota === 50,
  JSON.stringify(a0));

const envMap: Record<string, string> = {
  EBIM_MASTERADMIN_M2M_ENABLED: 'true',
  EBIM_MASTERADMIN_M2M_ISSUER: 'masteradmin.ebim',
  EBIM_MASTERADMIN_M2M_AUDIENCE: 'gmao.ebim',
  EBIM_MASTERADMIN_M2M_SUBJECT: 'masteradmin-provisioning',
  EBIM_MASTERADMIN_M2M_ALGORITHM: 'ES256',
  EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME: '300',
  EBIM_MASTERADMIN_M2M_CREATE_SCOPE: 'gmao:tenant:create',
  EBIM_MASTERADMIN_M2M_READ_SCOPE: 'gmao:tenant:read',
  EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64: publicKeyB64,
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_WRITE_SCOPE: 'gmao:entitlements:write',
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_READ_SCOPE: 'gmao:entitlements:read',
  EBIM_ENTITLEMENTS_ENVIRONMENT: 'DEV',
};
const env = (k: string) => envMap[k];
const m2m = await gmM2m.loadM2MConfig(env);
const receiverConfig = gmConfig.resolveEntitlementsConfig(env, m2m);
check('1. receptor GMAO configurado (mismo M2M de provisioning, scopes propios)', receiverConfig.ok);

// Transporte EN PROCESO (el sandbox no permite abrir puertos locales): el cliente real de MasterAdmin
// arma y firma la petición HTTP completa; aquí se entrega tal cual al handler real de GMAO.
const saasFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  return gmHandler.handleEntitlementsRequest(req,
    { m2m, config: receiverConfig, openStore: () => gmStore.createEntitlementsStore(rpc), log: () => {} });
}) as typeof fetch;

// ── MasterAdmin: contexto de entrega ─────────────────────────────────────────
const SECRET_REF = 'LOCAL_X07_GMAO_M2M_PRIVATE_KEY';
const ctx = (writeScope = 'gmao:entitlements:write'): EntitlementDeliveryContext => ({
  tenant: { controlPlaneTenantId: CPT, productCode: 'gmao' },
  push_enabled: true,
  enrollment: 'ENROLLED',
  deployment: { id: 'x07', environment: 'DEV', base_url: 'http://127.0.0.1/functions/v1/platform-provisioning', timeout_ms: 30_000, retry_count: 0 },
  integration: {
    id: 'x07-int', type: 'HTTP_M2M', issuer: 'masteradmin.ebim', audience: 'gmao.ebim', subject: 'masteradmin-provisioning',
    algorithm: 'ES256', token_ttl_seconds: 120,
    entitlements_path: '/tenants/{controlPlaneTenantId}/entitlements', entitlements_manifest_path: '/entitlements/manifest',
    entitlements_write_scope: writeScope, entitlements_read_scope: 'gmao:entitlements:read', allowed_hosts: [],
  },
  credential: { id: 'x07-cred', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: SECRET_REF },
});
const client = new EntitlementSyncClient({ secretResolver: (ref) => (ref === SECRET_REF ? privatePem : undefined), sleep: async () => {}, fetchImpl: saasFetch });
const actor = { id: '10000000-0000-4000-a000-000000000002', role: 'EBIM_FINANCE' };

const manifestFile = JSON.parse(readFileSync(join(WT, 'supabase/functions/_shared/entitlements/ENTITLEMENTS_MANIFEST.json'), 'utf8')) as {
  capabilities: { code: string; kind: RegistryCapability['kind']; isBaseline: boolean; scopeLevel: 'TENANT' | 'COMPANY'; unit?: string; meterCode?: string; status: RegistryCapability['status'] }[];
};
const registry: RegistryCapability[] = manifestFile.capabilities.map((c) => ({
  code: c.code, kind: c.kind, isBaseline: c.isBaseline, scopeLevel: c.scopeLevel, unit: c.unit ?? null, meterCode: c.meterCode ?? null, status: c.status,
}));
let clock = Date.parse('2026-10-10T00:00:00Z');
async function emit(version: number, features: string[], opts: { appActive?: boolean; planCode?: string | null } = {}): Promise<EntitlementSnapshot> {
  const granted: GrantedCapability[] = features.map((code) => ({ code, value: null, enforcement: null, included: null, sources: ['PLAN'], companyIds: null }));
  clock += 60_000;
  return buildSnapshot({
    environment: 'DEV', controlPlaneTenantId: CPT, productCode: 'gmao',
    external: { tenantId: TEN, organizationId: null, companyIds: [] },
    snapshotVersion: version, previousVersion: version > 1 ? version - 1 : null,
    effectiveAt: new Date(clock - 1000).toISOString(), issuedAt: new Date(clock).toISOString(),
    appActive: opts.appActive ?? true, planCode: opts.planCode === undefined ? 'gmao-standard' : opts.planCode,
    registry, granted, allowancePeriod: { start: '2026-10-01', end: '2026-10-31' },
    aiCredits: { weights: [], weightsVersion: 0 }, correlationId: crypto.randomUUID(),
  });
}
const auth = (product: string, axis: string, tenant: string | null, state: string, approval: string | null = null, reason = 'e2e fase 16') =>
  svc(`select platform.ccp_set_commercial_authority($1, $2, $3::uuid, $4, 'x07', $6, $5) as r`, [product, axis, tenant, state, approval, reason]);
const parity = async () => svc<{ kind: string; severity: string }>(`select kind, severity from platform.ccp_gmao_commercial_parity($1)`, [TEN]);

// ── Escenario: entitlements ──────────────────────────────────────────────────
const manifest = await client.getManifest(ctx(), actor);
check('2. MasterAdmin lee el manifiesto GMAO (gmao.core + gmao.ai.assist ACTIVE; créditos IA, límites y addons técnicos DRAFT)',
  manifest.ok && manifest.activeCodes.slice().sort().join() === 'gmao.ai.assist,gmao.core',
  manifest.ok ? `${manifest.manifestVersion} · ${manifest.activeCodes.join(',')}` : manifest.errorCode);

const v1 = await emit(1, []);
check('3. snapshot sin DRAFT ni precios (gmao.ai.requests no se emite: D-03 sin decidir)',
  !JSON.stringify(v1).includes('gmao.ai.requests') && !/price|amount|currency/i.test(JSON.stringify(v1)));
const p1 = await client.pushSnapshot(ctx(), v1, actor);
check('4. emisor real → PUT M2M real → APPLIED', p1.result === 'APPLIED' && p1.appliedVersion === 1, `${p1.result} ${p1.httpStatus}`);
const a1 = await ai();
check('5. DUAL_READ: la IA sigue decidiéndose por legacy (50) aunque el snapshot no la conceda', a1.allowed === true && a1.quota === 50);
// Lectura de evidencia como el operador (las tablas de private no tienen grants para la API).
const diffs = (await db.query<{ kind: string }>(`select kind from private.gmao_entitlement_shadow_diffs where tenant_id = $1`, [TEN])).rows;
check('6. DUAL_READ registra la diferencia legacy ↔ snapshot', diffs.some((d) => d.kind === 'CAPABILITY_MISMATCH'), diffs.map((d) => d.kind).join());

const g1 = await client.getApplied(ctx(), actor);
check('7. GET: misma versión y checksum; modo de contrato DUAL_READ', g1.result === 'OBSERVED' && g1.appliedVersion === 1
  && g1.appliedChecksum === v1.checksum && g1.enforcementMode === 'DUAL_READ', `${g1.result} ${g1.enforcementMode ?? ''}`);
const replay = await client.pushSnapshot(ctx(), v1, actor);
const v2 = await emit(2, ['gmao.ai.assist']);
const p2 = await client.pushSnapshot(ctx(), v2, actor);
const stale = await client.pushSnapshot(ctx(), v1, actor);
const wrong = await client.pushSnapshot(ctx('gmao:tenant:create'), v2, actor);
check('8. replay idempotente, versión vieja STALE, scope de provisioning rechazado',
  replay.result === 'REPLAYED' && p2.result === 'APPLIED' && stale.result === 'STALE' && wrong.result === 'REJECTED',
  `${replay.result}/${p2.result}/${stale.result}/${wrong.result}`);

await auth('gmao', 'ENTITLEMENTS', TEN, 'SHADOW');
const par2 = await parity();
check('9. con IA concedida pero sin asignación (D-03) la paridad queda BLOCKING ALLOWANCE_NOT_DEFINED',
  par2.some((p) => p.kind === 'ALLOWANCE_NOT_DEFINED' && p.severity === 'BLOCKING'), par2.map((p) => p.kind).join());
check('10. la base impide MASTERADMIN_AUTHORITY sin paridad verde',
  await failsWith(() => auth('gmao', 'ENTITLEMENTS', TEN, 'MASTERADMIN_AUTHORITY'), /PARITY_NOT_GREEN/));

// Tenant sintético sin IA en ambos lados: corte completo demostrable sin inventar cuotas.
await svc(`select platform.ccp_set_ai_entitlement($1, false, 'active', null, 50, 'x07', 'sin IA para el corte sintético')`, [TEN]);
const alerts = (await db.query<{ n: number }>(`select count(*)::int as n from private.commercial_alerts where tenant_id = $1 and kind = 'LEGACY_WRITE'`, [TEN])).rows[0].n;
check('11. SHADOW: la escritura legacy del plan IA se permite y deja alerta', alerts >= 1, `${alerts} alertas`);
const v3 = await emit(3, []);
await client.pushSnapshot(ctx(), v3, actor);
const par3 = await parity();
check('12. paridad verde (0 BLOCKING) con legacy y MasterAdmin alineados', par3.every((p) => p.severity !== 'BLOCKING'), par3.map((p) => p.kind).join());
await auth('gmao', 'ENTITLEMENTS', TEN, 'MASTERADMIN_AUTHORITY');
const g3 = await client.getApplied(ctx(), actor);
check('13. MASTERADMIN_AUTHORITY: GET PRIMARY, versión 3', g3.result === 'OBSERVED' && g3.enforcementMode === 'PRIMARY' && g3.appliedVersion === 3,
  `${g3.enforcementMode ?? ''}`);
check('14. MASTERADMIN_AUTHORITY: re-habilitar la IA por la vía legacy queda BLOQUEADO en la base',
  await failsWith(() => svc(`select platform.ccp_set_ai_entitlement($1, true, 'active', null, 9999, 'x07', 'intento')`, [TEN]), /LEGACY_WRITE_BLOCKED/));
check('15. el plan del tenant ya no se cambia en GMAO',
  await failsWith(() => db.query(`update platform.tenants set plan_code = 'enterprise' where id = $1`, [TEN]), /LEGACY_WRITE_BLOCKED/));
const a3 = await ai();
check('16. el snapshot decide: sin gmao.ai.assist → IA apagada', a3.allowed === false && a3.reason === 'DISABLED', JSON.stringify(a3));

// ── Escenario: cobro (nunca dos cobradores) · dataset SINTÉTICO D-14 ─────────
const CERT = JSON.parse(readFileSync(new URL('./fixtures/d14-billing-cert.json', import.meta.url), 'utf8'));
const GC = CERT.products.gmao;
const PERIOD: string = CERT.period;
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
// Biller local de GMAO configurado con el dataset (catálogo propio de certificación; ningún ítem real).
await db.query(`insert into platform.apps (code, name, available) values ($1, 'GMAO', true) on conflict (code) do nothing`, [GC.local.appCode]);
for (const it of GC.local.catalogItems) {
  await db.query(`insert into platform.catalog_items (app_code, code, name, category, price_month, currency, available)
                  values ($1, $2, $3, $4, $5, $6, true)`, [GC.local.appCode, it.code, it.name, it.category, it.priceMonth, it.currency]);
}
await db.query(`insert into platform.payment_config (id, provider, secret_key, currency, enabled) values (1, $1, $2, $3, true)`,
  [GC.local.paymentConfig.provider, GC.local.paymentConfig.secretKey, GC.local.paymentConfig.currency]);
await db.query(`update platform.tenants set billing_mode = 'live' where id = $1`, [TEN]);

const gateway = { calls: 0 };
// Mismas lecturas que charge/index.ts (billing_mode, payment_config, catalog_items), contra PGlite.
const chargeHandler = gmCharge.createChargeHandler({
  authenticate: async () => ({ id: OWNER, email: 'owner@x07.ebim.test' }),
  tenantId: async () => TEN,
  role: async () => 'owner',
  load: async (tid: string, code: string) => ({
    mode: (await svc<{ m: string }>(`select billing_mode as m from platform.tenants where id = $1`, [tid]))[0]?.m,
    cfg: (await svc(`select provider, secret_key, currency, enabled from platform.payment_config where id = 1`))[0],
    item: (await svc(`select price_month, currency, name from platform.catalog_items where code = $1 limit 1`, [code]))[0],
  }),
  recordPayment: async (row: Row) => { await svc(`insert into platform.payments (tenant_id, item_code, amount, currency, status, mode) values ($1, $2, $3, $4, $5, $6)`,
    [row.tenant_id, row.item_code, row.amount, row.currency, row.status, row.mode]); },
  activateSubscription: async () => {},
  billingAuthority: async (tid: string) => (await svc<{ s: string }>(`select platform.ccp_billing_authority($1) as s`, [tid]))[0].s,
  recordChargeShadow: async (row: Row) => { await svc(`select platform.ccp_record_charge_shadow($1, $2, $3, $4, $5)`, [row.tenant_id, row.item_code, row.amount, row.currency, row.known_defect]); },
  fetchImpl: (async () => { gateway.calls++; return new Response(JSON.stringify({ source: { last_four: '1111' } }), { status: 201 }); }) as typeof fetch,
});
const charge = (code: string) => chargeHandler(new Request('https://gmao.test/functions/v1/charge', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code, token: 'tkn_fixture' }) }));
const [PLAN_ITEM, EXTRA_ITEM] = GC.local.catalogItems.map((i: { code: string }) => i.code);
const c0 = await charge(PLAN_ITEM);
check('17. BILLING LEGACY_AUTHORITY: cobra local el ítem sintético (pasarela falsa 1 vez)', c0.status === 200 && gateway.calls === 1);
await auth('gmao', 'BILLING', TEN, 'DUAL_READ');
await auth('gmao', 'BILLING', TEN, 'SHADOW');
const callsBeforeShadow = gateway.calls;
const c1 = await charge(PLAN_ITEM);
const c1b = await charge(EXTRA_ITEM);
const shadowGatewayCalls = gateway.calls - callsBeforeShadow;
const shadows = (await db.query<{ n: number }>(`select count(*)::int as n from private.billing_shadow_calculations where tenant_id = $1`, [TEN])).rows[0].n;
check('18. BILLING SHADOW: el cobro local sigue siendo el ÚNICO cobrador (2 cargos → 2 llamadas) y registra la sombra (sin tarjeta)',
  c1.status === 200 && c1b.status === 200 && shadowGatewayCalls === 2 && shadows === 2, `pasarela=${shadowGatewayCalls} sombras=${shadows}`);
check('19. BILLING → MASTERADMIN_AUTHORITY exige comparación SHADOW verde',
  await failsWith(() => auth('gmao', 'BILLING', TEN, 'MASTERADMIN_AUTHORITY'), /BILLING_SHADOW_NOT_GREEN/));
check('19b. GMAO ya no acepta un resultado fabricado (sha256:ddd… / sin id de MasterAdmin)',
  await failsWith(() => svc(`select platform.ccp_record_billing_shadow_comparison($1, $2, 0, $3, 'x07', $4::uuid)`,
    [TEN, PERIOD, `sha256:${'d'.repeat(64)}`, randomUUID()]), /CHECKSUM_INVALIDO/)
  && await failsWith(() => svc(`select platform.ccp_record_billing_shadow_comparison($1, $2, 0, $3, 'x07', null)`,
    [TEN, PERIOD, `sha256:${'0123456789abcdef'.repeat(4)}`]), /MASTERADMIN_COMPARISON_REQUIRED/));

// ── D14 · MasterAdmin LOCAL: tenant SANDBOX + plan + suscripción ACTIVE del dataset (idempotente) ─
type MaCmp = { id: string; mismatches: number; green: boolean; reportChecksum: string; expectedTotal: number; localTotal: number; periodStart: string; diffs: unknown[] };
function maCertSetup(product: string): { subscriptionId: string; transitions: string[]; integrationId: string } {
  const f = CERT.products[product].masteradmin;
  const org = CERT.masteradmin.customerOrganizationId;
  const meta = `'{"certification":"D-14","synthetic":true,"nonBillable":true}'::jsonb`;
  maSql(`insert into platform.plans (id, code, name, saas_product_id, description, metadata)
         select ${lit(f.plan.id)}, ${lit(f.plan.code)}, ${lit(f.plan.name)}, p.id, 'Plan SINTÉTICO de certificación D-14 (DEV/LOCAL)', ${meta}
           from platform.saas_products p where p.code = ${lit(product)}
         on conflict do nothing`);
  maSql(`insert into platform.tenants (id, slug, name, saas_product_id, customer_organization_id, tenant_type, admin_email, metadata)
         select ${lit(f.tenant.id)}, ${lit(f.tenant.slug)}, ${lit(f.tenant.name)}, p.id, ${lit(org)}, 'SANDBOX', ${lit(f.tenant.adminEmail)}, ${meta}
           from platform.saas_products p where p.code = ${lit(product)}
         on conflict do nothing`);
  maSql(`insert into platform.subscriptions (id, code, billed_organization_id, saas_product_id, tenant_id, plan_id, market_id, status,
           billing_interval, currency, quantity, started_on, notes, metadata)
         select ${lit(f.subscription.id)}, ${lit(f.subscription.code)}, ${lit(org)}, p.id, ${lit(f.tenant.id)}, ${lit(f.plan.id)},
                (select id from platform.markets where code = ${lit(CERT.masteradmin.market)}), 'ACTIVE', 'MONTHLY',
                ${lit(CERT.products[product].currency)}, 1, ${lit(f.subscription.startedOn)}::date, 'Certificación D-14 (sintético, SANDBOX, no facturable)', ${meta}
           from platform.saas_products p where p.code = ${lit(product)}
         on conflict do nothing`);
  const ok = maSql(`select count(*) from platform.subscriptions s join platform.tenants t on t.id = s.tenant_id join platform.plans pl on pl.id = s.plan_id
                     where s.id = ${lit(f.subscription.id)} and s.status = 'ACTIVE' and t.id = ${lit(f.tenant.id)} and t.tenant_type = 'SANDBOX'
                       and pl.code = ${lit(f.plan.code)}`);
  if (ok !== '1') throw new Error(`dataset D-14 de ${product}: suscripción/tenant/plan de MasterAdmin no coinciden con el fixture`);
  const want = f.items.map((i: Row) => [i.chargeKind, Number(i.quantity).toFixed(2), Number(i.unitAmount).toFixed(2), CERT.products[product].currency,
    i.billingInterval, i.catalogItemCode ?? '', i.validFrom, ''].join('|')).sort().join(';');
  const have = maSql(`select coalesce(string_agg(concat_ws('|', charge_kind, quantity, unit_amount, currency, billing_interval,
                        coalesce(catalog_item_code, ''), valid_from, coalesce(valid_to::text, '')), ';' order by 1), '')
                        from (select charge_kind::text, quantity, unit_amount, currency, billing_interval::text, catalog_item_code, valid_from, valid_to
                                from platform.subscription_items where subscription_id = ${lit(f.subscription.id)}) x`);
  const haveSorted = have ? have.split(';').sort().join(';') : '';
  if (haveSorted !== want) {
    if (maSql(`select count(*) from platform.invoices where subscription_id = ${lit(f.subscription.id)}`) !== '0') {
      throw new Error(`dataset D-14 de ${product}: la suscripción SANDBOX tiene facturas; no se reescriben sus líneas`);
    }
    maSql(`delete from platform.subscription_items where subscription_id = ${lit(f.subscription.id)}`);
    for (const i of f.items) {
      maSql(`select platform.upsert_subscription_item(${lit(f.subscription.id)}, ${lit(i.chargeKind)}::platform.charge_kind, ${lit(i.description)},
               ${Number(i.quantity)}, ${Number(i.unitAmount)}, ${lit(i.billingInterval)}::platform.billing_interval, ${lit(CERT.products[product].currency)},
               null, ${i.catalogItemCode ? lit(i.catalogItemCode) : 'null'}, ${lit(i.validFrom)}::date)`, { user: FINANCE });
    }
  }
  const integrationId = ensureCcpIntegration(product);
  const transitions = advanceAxis(integrationId, 'BILLING', 'BILLING_SHADOW', D14_REASON);
  return { subscriptionId: f.subscription.id, transitions, integrationId };
}
function maCompare(product: string, tenantId: string, local: Row, actor: string): MaCmp {
  return JSON.parse(maSql(`select platform.record_billing_shadow_comparison(${lit(product)}, ${lit(tenantId)}::uuid, ${lit(`${PERIOD}-01`)}::date,
    ${lit(JSON.stringify(local))}::jsonb, ${lit(actor)})`, { service: true })) as MaCmp;
}
const maGm = maCertSetup('gmao');
check('D14.B1 MasterAdmin LOCAL: tenant SANDBOX + plan + suscripción ACTIVE sintéticos; eje de facturación en BILLING_SHADOW',
  axisState(maGm.integrationId).billing === 'BILLING_SHADOW', maGm.transitions.join(',') || 'ya en BILLING_SHADOW');
// Lado local: lo que calculó el cobro local de GMAO en SHADOW (tabla append-only), traducido con el mapeo del fixture.
const since = (await db.query<{ t: string }>(`select entered_at::text as t from private.commercial_authority where scope_key = $1`, [`gmao:BILLING:${TEN}`])).rows[0].t;
const calc = (await db.query<{ item_code: string; n: number; amount: string; currency: string }>(
  `select item_code, count(*)::int as n, sum(local_amount)::text as amount, min(local_currency) as currency
     from private.billing_shadow_calculations where tenant_id = $1 and calculated_at >= $2::timestamptz group by item_code order by item_code`, [TEN, since])).rows;
const localLines = calc.map((r) => ({ itemCode: GC.itemMap[r.item_code] ?? `local:${r.item_code}`, quantity: r.n, amount: Number(r.amount), currency: r.currency }));
const local = { source: 'gmao.charge.shadow', currency: GC.currency, lines: localLines };
const maTen = GC.masteradmin.tenant.id;
// Negativo primero: una línea local +0.01 → MasterAdmin la detecta; GMAO la registra y NO la toma por verde.
const perturbed = { ...local, lines: localLines.map((l, i) => (i === 0 ? { ...l, amount: Math.round((l.amount + 0.01) * 100) / 100 } : l)) };
const maRed = maCompare('gmao', maTen, perturbed, 'x07 GMAO D-14 (negativo)');
await svc(`select platform.ccp_record_billing_shadow_comparison($1, $2, $3, $4, 'x07 D-14', $5::uuid)`, [TEN, PERIOD, maRed.mismatches, maRed.reportChecksum, maRed.id]);
check('D14.B2 negativo: +0.01 en una línea local → MasterAdmin cuenta la diferencia y GMAO sigue sin paridad de cobro',
  maRed.mismatches > 0 && maRed.green === false && await failsWith(() => auth('gmao', 'BILLING', TEN, 'MASTERADMIN_AUTHORITY'), /BILLING_SHADOW_NOT_GREEN/),
  `${maRed.mismatches} · ${JSON.stringify(maRed.diffs)}`);
const maGreen = maCompare('gmao', maTen, local, 'x07 GMAO D-14');
await svc(`select platform.ccp_record_billing_shadow_comparison($1, $2, $3, $4, 'x07 D-14', $5::uuid)`, [TEN, PERIOD, maGreen.mismatches, maGreen.reportChecksum, maGreen.id]);
check('D14.B3 MasterAdmin calcula la comparación del dataset: diff material 0 (plan + soporte, al centavo) y GMAO la registra con su id y checksum',
  maGreen.mismatches === 0 && maGreen.green === true && /^sha256:[0-9a-f]{64}$/.test(maGreen.reportChecksum) && localLines.length === GC.masteradmin.items.length,
  `mismatches=${maGreen.mismatches} ${maGreen.reportChecksum} MA=${maGreen.expectedTotal} local=${maGreen.localTotal}`);
const maInvoices = () => Number(maSql(`select count(distinct i.id) from platform.invoices i left join platform.invoice_lines l on l.invoice_id = i.id where i.subscription_id = ${lit(maGm.subscriptionId)} or l.tenant_id = ${lit(maTen)}`));
check('D14.B4 BILLING_SHADOW: MasterAdmin no emitió ninguna factura para el tenant SANDBOX', maInvoices() === 0);
// D-14 regla 5: la facturación NO avanza a MASTERADMIN_AUTHORITY en esta corrida (ni de forma transitoria).
// La guarda "nunca dos cobradores" en MASTERADMIN_AUTHORITY (charge 409 sin pasarela, triggers de pagos/
// facturas) la certifican run_ccp16_tests / run_ccp18_tests y deno test de GMAO.
const billingFinal = (await svc<{ s: string }>(`select platform.ccp_billing_authority($1) as s`, [TEN]))[0].s;
check('21b. D-14 regla 5: el eje de cobro queda en SHADOW (nunca MASTERADMIN_AUTHORITY en esta corrida)', billingFinal === 'SHADOW');

// ── Escenario: hub GMAO → MasterAdmin (export, mapeo, paridad, atestación, congelamiento) ─
const hubCtx = JSON.parse(readFileSync('supabase/functions/_shared/entitlements/hub/fixtures/hub-context.synthetic.json', 'utf8')) as {
  registry: Record<string, RegistryCapability[]>;
};
const ecoRegistry = hubCtx.registry.ecommerce;
const sellable = ecoRegistry.filter((c) => c.status === 'ACTIVE' && !c.isBaseline && (c.kind === 'FEATURE' || c.kind === 'AI_FEATURE')).map((c) => c.code).sort();
const [EC1, EC2] = sellable;
const ORG = 'd0000000-0000-4000-8000-000000000001';
const CO = 'd0000000-0000-4000-8000-0000000000c1';
const MA_ECO_TENANT = '9f160000-0000-4000-8000-0000000000ec';
await db.exec(`
  insert into platform.apps (code, name, available) values ('ecommerce', 'eCommerce', true), ('esupplier', 'eSupplier', true);
  insert into platform.catalog_items (app_code, code, name, category, price_month, currency, available) values
    ('ecommerce', '${EC1}', 'Uno', 'addon', 0, 'USD', true), ('ecommerce', '${EC2}', 'Dos', 'addon', 0, 'USD', true),
    ('esupplier', 'esupplier_dorothy', 'Dorothy', 'ai', 49, 'USD', true);
  insert into platform.organizations (id, name) values ('${ORG}', 'MiQuímica');
  insert into platform.companies (id, organization_id, name) values ('${CO}', '${ORG}', 'MiQuímica');
  insert into platform.workspace_apps (tenant_id, app_code, status) values ('${ORG}', 'ecommerce', 'active');`);
await svc(`select platform.hub_set_addon($1, $2, true)`, [CO, EC1]);
await svc(`select platform.hub_set_addon($1, $2, true)`, [CO, EC2]);

const HUB_SCOPE = 'gmao:hub:export';
async function hubToken(): Promise<string> {
  const b64u = (b: Uint8Array | string) => Buffer.from(b).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT' }))}.${b64u(JSON.stringify({
    iss: 'masteradmin.ebim', aud: 'gmao.ebim', sub: 'masteradmin-provisioning', iat: now, exp: now + 60, jti: crypto.randomUUID(), scope: HUB_SCOPE,
  }))}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(input)));
  return `${input}.${b64u(sig)}`;
}
const exportHandler = gmHubExport.createHubExportHandler({ m2m, scope: HUB_SCOPE, environment: 'LOCAL', openRpc: () => rpc, log: () => {} });
async function fetchExport() {
  const r = await exportHandler(new Request('https://gmao.test/functions/v1/hub-commercial-export', { headers: { Authorization: `Bearer ${await hubToken()}` } }));
  return { status: r.status, body: await r.json() as Row };
}
const ex1 = await fetchExport();
check('22. GMAO sirve el export del hub por M2M (scope propio), sin precios ni secretos',
  ex1.status === 200 && !/price|currency|secret|token/i.test(JSON.stringify(ex1.body)), `${ex1.status}`);
const parsed = await parseHubExport(ex1.body, { expectedEnvironment: 'LOCAL' });
const mapping = await mapHubExport(parsed, {
  products: [{ code: 'ecommerce', hubAppCode: 'ecommerce' }],
  registry: { ecommerce: ecoRegistry },
  aliases: [],
  tenantLinks: [{ productCode: 'ecommerce', organizationId: ORG, tenantId: MA_ECO_TENANT }],
});
const state = mapping.legacyTenantState.find((s) => s.productCode === 'ecommerce' && s.organizationId === ORG);
check('23. MasterAdmin valida checksum/lista blanca y mapea de forma determinista (códigos canónicos, sin inventar)',
  Boolean(state) && Object.keys(state!.capabilities).sort().join() === [EC1, EC2].join() && mapping.unmapped.length === 0,
  state ? Object.keys(state.capabilities).join() : 'sin estado');
const ecoSnapshot = (granted: string[]) => buildSnapshot({
  environment: 'DEV', controlPlaneTenantId: MA_ECO_TENANT, productCode: 'ecommerce',
  external: { tenantId: ORG, organizationId: ORG, companyIds: [CO] }, snapshotVersion: 1, previousVersion: null,
  effectiveAt: '2026-10-10T00:00:00.000Z', issuedAt: '2026-10-10T00:00:01.000Z', appActive: true, planCode: 'ecommerce-pro',
  registry: ecoRegistry, granted: granted.map((code) => ({ code, value: null, enforcement: null, included: null, sources: ['ADDON'], companyIds: null })),
  allowancePeriod: { start: '2026-10-01', end: '2026-10-31' }, aiCredits: { weights: [], weightsVersion: 0 }, correlationId: crypto.randomUUID(),
});
const red = compareHubWithMasterAdmin(state!, await ecoSnapshot([EC1]), ecoRegistry);
const redAtt = await buildParityAttestation('ecommerce', [red], String(ex1.body.checksum));
await auth('hub:ecommerce', 'ENTITLEMENTS', null, 'DUAL_READ');
await auth('hub:ecommerce', 'ENTITLEMENTS', null, 'SHADOW');
await svc(`select platform.ccp_record_hub_parity('ecommerce', $1, $2, $3, $4, $5, $6::timestamptz, 'x07')`,
  [redAtt.blocking, redAtt.warnings, redAtt.tenants, redAtt.exportChecksum, redAtt.reportChecksum, redAtt.ranAt]);
check('24. paridad dual-read en ROJO (MasterAdmin sin una capacidad del hub) → la base impide congelar el hub',
  red.verdict === 'BLOCKED' && await failsWith(() => auth('hub:ecommerce', 'ENTITLEMENTS', null, 'MASTERADMIN_AUTHORITY'), /HUB_PARITY_NOT_GREEN/),
  red.diffs.map((d) => d.type).join());
const green = compareHubWithMasterAdmin(state!, await ecoSnapshot([EC1, EC2]), ecoRegistry);
const att = await buildParityAttestation('ecommerce', [green], String(ex1.body.checksum));
await svc(`select platform.ccp_record_hub_parity('ecommerce', $1, $2, $3, $4, $5, $6::timestamptz, 'x07')`,
  [att.blocking, att.warnings, att.tenants, att.exportChecksum, att.reportChecksum, att.ranAt]);
await auth('hub:ecommerce', 'ENTITLEMENTS', null, 'MASTERADMIN_AUTHORITY');
const report = renderHubParityReport([green], { environment: 'LOCAL', generatedAt: 'x07' });
check('25. paridad VERDE + atestación → hub:ecommerce en MASTERADMIN_AUTHORITY; reporte sin precios',
  green.verdict === 'GREEN' && !/price|precio|USD|amount/i.test(report));
const allowed = (await svc<{ r: { allowed: boolean } }>(`select platform.ccp_hub_write_allowed('ecommerce', $1) as r`, [EC1]))[0].r;
check('26. el hub congela las escrituras comerciales de eCommerce (RPC y pre-chequeo de platform-register)',
  allowed.allowed === false && await failsWith(() => svc(`select platform.hub_set_addon($1, $2, false)`, [CO, EC1]), /HUB_COMMERCIAL_FROZEN/));
await svc(`insert into platform.companies (id, organization_id, name) values ('e0000000-0000-4000-8000-0000000000c1', $1, 'Otra')`, [ORG]);
check('27. el congelamiento es POR PRODUCTO: eSupplier (LEGACY) sigue escribiendo',
  !(await failsWith(() => svc(`select platform.hub_set_addon('e0000000-0000-4000-8000-0000000000c1', 'esupplier_dorothy', true)`), /./)));
const ex2 = await fetchExport();
check('28. el hub sigue sirviendo el export (lectura) con el producto congelado; identidad intacta', ex2.status === 200);
await auth('hub:ecommerce', 'ENTITLEMENTS', null, 'SHADOW');
check('29. rollback de un paso (MASTERADMIN_AUTHORITY → SHADOW) descongela al instante',
  !(await failsWith(() => svc(`select platform.hub_set_addon($1, $2, false)`, [CO, EC1]), /./)));

// ── D14 · entitlements → MASTERADMIN_AUTHORITY también a nivel PRODUCTO (DEV/LOCAL), sin rollback ─
// Los tenants sin alta de MasterAdmin resuelven SIEMPRE LEGACY_AUTHORITY (private.ccp_authority), así que
// el ámbito PRODUCT no cambia a ningún tenant legacy; la guarda exige paridad verde de TODOS los mapeados.
// Tenant legacy SIN alta de MasterAdmin (como los tenants previos a MasterAdmin): IA legacy activa.
const LEG = '9f160000-0000-4000-8000-0000000000f0';
const LEG_OWNER = 'aaaaaaa9-0000-4000-8000-0000000000f0';
await db.exec(`insert into platform.tenants (id, name) values ('${LEG}', 'X07 GMAO legacy (sin alta de MasterAdmin)');
  insert into platform.tenant_users (tenant_id, auth_user_id, email, role) values ('${LEG}', '${LEG_OWNER}', 'owner@legacy.x07.ebim.test', 'owner');`);
await svc(`select platform.ccp_set_ai_entitlement($1, true, 'active', null, 50, 'x07', 'tenant legacy del harness')`, [LEG]);
const aiLegacy = async () => (await asRole<{ r: Row }>('test_user', `select public.ai_consume('report', 1) as r`, [], LEG_OWNER))[0].r;
const legBefore = await aiLegacy();
const unmapped = (await db.query<{ id: string; name: string }>(`select t.id, t.name from platform.tenants t
   where not exists (select 1 from platform.provisioning_requests r where r.internal_tenant_id = t.id and r.status = 'ACTIVE') order by t.name`)).rows;
const unmappedBefore = await Promise.all(unmapped.map(async (t) => (await db.query<{ a: string }>(`select private.ccp_authority('gmao', 'ENTITLEMENTS', $1) as a`, [t.id])).rows[0].a));
const d14Transitions: string[] = [];
for (const to of ['SHADOW', 'MASTERADMIN_AUTHORITY']) {
  const r = (await auth('gmao', 'ENTITLEMENTS', null, to, null, D14_REASON))[0].r as Row;
  d14Transitions.push(`PRODUCT:${r.from}->${r.to}`);
}
const productState = (await db.query<{ s: string }>(`select state as s from private.commercial_authority where scope_key = 'gmao:ENTITLEMENTS:*'`)).rows[0].s;
check('D14.1 PRODUCT gmao/ENTITLEMENTS → MASTERADMIN_AUTHORITY un paso por vez con la guarda de paridad de toda la cohorte',
  productState === 'MASTERADMIN_AUTHORITY', d14Transitions.join(','));
const unmappedAfter = await Promise.all(unmapped.map(async (t) => (await db.query<{ a: string }>(`select private.ccp_authority('gmao', 'ENTITLEMENTS', $1) as a`, [t.id])).rows[0].a));
const legAfter = await aiLegacy();
check('D14.2 tenants sin alta de MasterAdmin: siguen LEGACY_AUTHORITY con PRODUCT en MASTERADMIN_AUTHORITY (su IA legacy 50/mes intacta)',
  unmapped.length >= 1 && unmappedAfter.every((a) => a === 'LEGACY_AUTHORITY') && unmappedBefore.join() === unmappedAfter.join()
    && legBefore.allowed === true && legAfter.allowed === true && legAfter.quota === 50, `${unmapped.length} sin alta`);

// appActive=false retira lo comercial, no la operación (regla 2). D-03 sigue sin decidir: sin asignación IA.
const v4 = await emit(4, ['gmao.ai.assist']);
await client.pushSnapshot(ctx(), v4, actor);
const grantsAi = async () => (await db.query<{ g: boolean }>(`select private.gmao_snapshot_grants(snapshot, 'gmao.ai.assist') as g from private.gmao_entitlement_snapshot_applied where tenant_id = $1`, [TEN])).rows[0].g;
const aiOn = await grantsAi();
const v5 = await emit(5, ['gmao.ai.assist'], { appActive: false });
const p5 = await client.pushSnapshot(ctx(), v5, actor);
const a5 = await ai();
const coreOn = (await db.query<{ g: boolean }>(`select private.gmao_snapshot_grants(snapshot, 'gmao.core') as g from private.gmao_entitlement_snapshot_applied where tenant_id = $1`, [TEN])).rows[0].g;
const wo = await asRole<{ t: string }>('test_user', `insert into public.work_orders (title) values ('OT X-07 con appActive=false') returning tenant_id as t`, [], OWNER);
const par5 = await parity();
const commercialDenied = aiOn === true && p5.result === 'APPLIED' && (await grantsAi()) === false && a5.allowed === false && a5.reason === 'DISABLED';
const operationalContinues = coreOn === true && wo[0]?.t === TEN
  && par5.some((p) => p.kind === 'APP_ACTIVE_MISMATCH' && p.severity === 'WARNING') && par5.every((p) => p.severity !== 'BLOCKING');
check('D14.3 appActive=false: gmao.ai.assist negado (IA DISABLED) y la operación sigue (gmao.core, OT creada; paridad solo WARNING)',
  commercialDenied && operationalContinues, `ai=${JSON.stringify(a5)} parity=${par5.map((p) => `${p.kind}:${p.severity}`).join(',')}`);
const v6 = await emit(6, []);
const p6 = await client.pushSnapshot(ctx(), v6, actor);
const g6 = await client.getApplied(ctx(), actor);
check('D14.4 GET final: PRIMARY con la versión y el checksum del último deseado (v6, appActive=true)',
  p6.result === 'APPLIED' && g6.result === 'OBSERVED' && g6.enforcementMode === 'PRIMARY' && g6.appliedVersion === 6 && g6.appliedChecksum === v6.checksum,
  `${g6.enforcementMode} v${g6.appliedVersion}`);
const legacyBlocked = await failsWith(() => svc(`select platform.ccp_set_ai_entitlement($1, true, 'active', null, 9999, 'x07', 'D-14 negativo')`, [TEN]), /LEGACY_WRITE_BLOCKED/);
check('D14.5 estado final: la escritura comercial legacy (plan IA) queda BLOQUEADA en la base', legacyBlocked);
const parFinal = await parity();
const parityBlocking = parFinal.filter((p) => p.severity === 'BLOCKING').length;
check('D14.6 paridad final sin BLOCKING', parityBlocking === 0, parFinal.map((p) => p.kind).join(',') || 'sin diferencias');
const mapped = (await db.query<{ t: string; a: string }>(`select r.internal_tenant_id as t, private.ccp_authority('gmao', 'ENTITLEMENTS', r.internal_tenant_id) as a
    from platform.provisioning_requests r where r.status = 'ACTIVE' and r.internal_tenant_id is not null`)).rows;
const billingEnd = (await svc<{ s: string }>(`select platform.ccp_billing_authority($1) as s`, [TEN]))[0].s;
check('D14.7 estado final sin rollback: ENTITLEMENTS MASTERADMIN_AUTHORITY (producto y cohorte), BILLING SHADOW; MasterAdmin sin facturas',
  mapped.length >= 1 && mapped.every((m) => m.a === 'MASTERADMIN_AUTHORITY') && billingEnd === 'SHADOW' && maInvoices() === 0
    && axisState(maGm.integrationId).billing === 'BILLING_SHADOW');

const legacyTenants: LegacyTenant[] = unmapped.map((t) => ({ id: t.id, label: t.name, resolution: 'UNRESOLVED',
  reason: 'tenant del harness GMAO sin provisioning de MasterAdmin (sin mapping determinista): sigue LEGACY_AUTHORITY' }));
const d14: D14Evidence = {
  product: 'gmao',
  entitlements: {
    scope: 'PRODUCT', productScopeMode: productState, finalMode: mapped.every((m) => m.a === 'MASTERADMIN_AUTHORITY') ? 'MASTERADMIN_AUTHORITY' : 'MIXED',
    transitions: ['tenant:SHADOW->MASTERADMIN_AUTHORITY (paso 13)', ...d14Transitions],
    mappedTenants: mapped.length, mappedTenantsPrimary: mapped.filter((m) => m.a === 'MASTERADMIN_AUTHORITY').length,
    getVerified: { appliedVersion: g6.appliedVersion ?? -1, appliedChecksum: g6.appliedChecksum ?? '', enforcementMode: g6.enforcementMode ?? '', desiredChecksum: v6.checksum },
    legacyWrite: { status: legacyBlocked ? 'BLOCKED' : 'NO_LEGACY_PATH', evidence: legacyBlocked ? 'platform.ccp_set_ai_entitlement → LEGACY_WRITE_BLOCKED (D14.5)' : '' },
    parityBlocking,
  },
  appActiveFalse: { commercialDenied, operationalContinues,
    evidence: 'v5 appActive=false: gmao.ai.assist no concedido, ai_consume DISABLED; gmao.core concedido, work_orders INSERT ok, APP_ACTIVE_MISMATCH WARNING (D14.3)' },
  legacyTenants,
  billing: {
    authority: billingEnd === 'SHADOW' ? 'BILLING_SHADOW' : billingEnd,
    comparison: { computedBy: 'masteradmin', mismatches: maGreen.mismatches, reportChecksum: maGreen.reportChecksum,
      negativeDetected: maRed.mismatches > 0, period: PERIOD },
    gatewayCalls: shadowGatewayCalls,
    duplicateCharge: !(maInvoices() === 0 && gateway.calls === callsBeforeShadow + shadowGatewayCalls),
    masteradminAuthorityReached: false,
  },
  checks: countChecks(results),
};
const file = writeD14Evidence({ ...d14, checks: countChecks(results) });
console.log(file ? `evidencia D14: ${file}` : 'evidencia D14: sin CCP_EVIDENCE_DIR, no se escribe');
console.log(`D14 GMAO · comparación MasterAdmin: mismatches=${maGreen.mismatches} ${maGreen.reportChecksum} · negativo=${maRed.mismatches} ${maRed.reportChecksum}`);

const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\nX-07 GMAO: ${results.length - failed}/${results.length} PASS`);
