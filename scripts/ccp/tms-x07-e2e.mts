/**
 * E2E LOCAL CCP fase 12 (X-07): MasterAdmin REAL → TMS REAL, sin sockets.
 *
 *   TMS_WT=<worktree del programa en TMS> JAVA_HOME=<JDK 21> \
 *     node --experimental-transform-types scripts/ccp/tms-x07-e2e.mts
 *
 * Del lado MasterAdmin corre el código de producción: el emisor `buildSnapshot`
 * y el cliente M2M `EntitlementSyncClient` (JWT ES256 firmado con una clave
 * generada EN MEMORIA, scopes de entitlements, url-guard, jti nuevo por intento,
 * clasificación de respuestas).
 *
 * Del lado TMS corre, dentro de su JVM, la cadena MasterAdmin de producción
 * (`PlatformProvisioningSecurityConfig` + decodificador ES256 con la clave pública
 * que deja este script), `PlatformEntitlementsController`, los servicios reales y
 * `CommercialEntitlementService` sobre un almacén en memoria
 * (`MasterAdminMailboxBridgeTest`).
 *
 * El transporte es un BUZÓN DE ARCHIVOS en $TMPDIR en vez de HTTP porque el
 * sandbox no permite abrir puertos locales. Sin red, sin Docker, sin ningún
 * proyecto remoto. No imprime claves ni tokens.
 *
 * TMS no registra capacidades vendibles: el registro que importa MasterAdmin del
 * manifiesto queda vacío, así que los snapshots sólo llevan `appActive`.
 *
 * D-14 (2026-09-29, DEV/LOCAL): `appActive=false` retira lo comercial y la
 * operación continúa (regla 1). La fase final "D14" lleva el modo de TMS a
 * PRIMARY a nivel PRODUCT, un paso por vez y con motivo, verifica por GET y NO
 * revierte; con CCP_EVIDENCE_DIR escribe `d14-tms.json` (`d14-evidence.mts`).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { EntitlementSyncClient, type EntitlementDeliveryContext } from '../../supabase/functions/_shared/entitlements/sync-client.ts';
import { buildSnapshot } from '../../supabase/functions/_shared/entitlements/snapshot.ts';
import type { EntitlementSnapshot, RegistryCapability } from '../../supabase/functions/_shared/entitlements/types.ts';
import { countChecks, D14_REASON, writeD14Evidence, type D14Evidence } from './d14-evidence.mts';

const WT = process.env.TMS_WT ?? '';
if (!WT.endsWith('/TMS/.worktrees/ebim-commercial-control-plane-v1') || !process.env.JAVA_HOME) {
  console.error('HARD STOP: TMS_WT debe ser el worktree del programa en TMS y JAVA_HOME un JDK 21');
  process.exit(2);
}

const results: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} · ${label}${detail ? ` · ${detail}` : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) process.exitCode = 1;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Claves en memoria ────────────────────────────────────────────────────────
const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const privatePem = [`-----BEGIN ${'PRIVATE'} KEY-----`, pkcs8, `-----END ${'PRIVATE'} KEY-----`].join('\n');
const spki = Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
const publicPem = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----\n`;

// ── Buzón y puente TMS ───────────────────────────────────────────────────────
const CPT = '7a000000-0000-4000-8000-000000000001';
const ORG = '7a000000-0000-4000-8000-0000000000a0';
const COMPANY = '7a000000-0000-4000-8000-0000000000c0';
const box = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'tms-x07-'));
writeFileSync(path.join(box, 'public.pem'), publicPem);
writeFileSync(path.join(box, 'setup.json'), JSON.stringify({ controlPlaneTenantId: CPT, organizationId: ORG }));

const mockito = path.join(homedir(), '.m2/repository/org/mockito/mockito-core/5.20.0/mockito-core-5.20.0.jar');
const bridge = spawn('./mvnw', ['-B', '-o', 'test', '-Dtest=MasterAdminMailboxBridgeTest', '-Dsurefire.failIfNoSpecifiedTests=false',
  `-DargLine=-javaagent:${mockito} -Djava.io.tmpdir=${process.env.TMPDIR ?? tmpdir()} -Xshare:off`], {
  cwd: path.join(WT, 'backend/tms-api'),
  env: { ...process.env, CCP_X07_MAILBOX: box },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bridgeLog = '';
bridge.stdout.on('data', (d) => { bridgeLog += d; });
bridge.stderr.on('data', (d) => { bridgeLog += d; });
const bridgeDone = new Promise<number>((resolve) => bridge.on('exit', (code) => resolve(code ?? -1)));

for (let i = 0; i < 1200 && !existsSync(path.join(box, 'ready')); i++) await sleep(150);
check('0. puente TMS arriba (cadena MasterAdmin real + receptor real)', existsSync(path.join(box, 'ready')));

let seq = 0;
async function tms(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = String(++seq).padStart(5, '0');
  writeFileSync(path.join(box, `${id}.req.tmp`), JSON.stringify(payload));
  renameSync(path.join(box, `${id}.req.tmp`), path.join(box, `${id}.req.json`));
  const res = path.join(box, `${id}.res.json`);
  for (let i = 0; i < 2000; i++) {
    if (existsSync(res)) return JSON.parse(readFileSync(res, 'utf8'));
    await sleep(10);
  }
  throw new Error(`sin respuesta de TMS para ${id}`);
}

const jtis: string[] = [];
let saasUp = true;
const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
  if (!saasUp) {
    return new Response(JSON.stringify({ error: 'UNAVAILABLE', message: 'TMS en mantenimiento' }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
  const url = new URL(String(input));
  const headers = { ...(init?.headers as Record<string, string>) };
  const auth = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1] ?? '';
  const payload = auth.split('.')[1];
  if (payload) jtis.push(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).jti);
  const r = await tms({ kind: 'http', method: init?.method ?? 'GET', path: url.pathname, headers, body: typeof init?.body === 'string' ? init.body : null });
  return new Response(r.body as string, { status: r.status as number, headers: { 'content-type': (r.contentType as string) ?? 'application/json' } });
}) as typeof fetch;

// ── MasterAdmin: contexto de entrega (lo que leería de product_integrations) ─
const SECRET_REF = 'LOCAL_X07_TMS_M2M_PRIVATE_KEY';
const ctx = (writeScope = 'tms:entitlements:write', readScope = 'tms:entitlements:read'): EntitlementDeliveryContext => ({
  tenant: { controlPlaneTenantId: CPT, productCode: 'tms' },
  push_enabled: true,
  enrollment: 'ENROLLED',
  deployment: { id: 'x07', environment: 'DEV', base_url: 'http://127.0.0.1:18081/internal/platform-provisioning', timeout_ms: 20000, retry_count: 0 },
  integration: {
    id: 'x07-int',
    type: 'HTTP_M2M',
    issuer: 'masteradmin.ebim',
    audience: 'tms.ebim',
    subject: 'masteradmin-provisioning',
    algorithm: 'ES256',
    token_ttl_seconds: 120,
    entitlements_path: '/tenants/{controlPlaneTenantId}/entitlements',
    entitlements_manifest_path: '/entitlements/manifest',
    entitlements_write_scope: writeScope,
    entitlements_read_scope: readScope,
    allowed_hosts: [],
  },
  credential: { id: 'x07-cred', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: SECRET_REF },
});
const client = new EntitlementSyncClient({
  secretResolver: (ref) => (ref === SECRET_REF ? privatePem : undefined),
  sleep: async () => {},
  fetchImpl,
});
const actor = { id: '10000000-0000-4000-a000-000000000002', role: 'EBIM_FINANCE' };

// Registro de MasterAdmin = manifiesto de TMS importado (sólo ACTIVE, sin baseline) → vacío.
const manifestFile = JSON.parse(readFileSync(`${WT}/docs/platform-provisioning/ENTITLEMENTS_MANIFEST.json`, 'utf8')) as {
  capabilities: { code: string; kind: RegistryCapability['kind']; scopeLevel: 'TENANT' | 'COMPANY'; isBaseline: boolean; status: string }[];
};
const registry: RegistryCapability[] = manifestFile.capabilities
  .filter((c) => c.status === 'ACTIVE' && !c.isBaseline)
  .map((c) => ({ code: c.code, kind: c.kind, isBaseline: false, scopeLevel: c.scopeLevel, unit: null, meterCode: null, status: 'ACTIVE' }));

let clock = Date.parse('2026-10-01T00:00:00Z');
async function emit(version: number, appActive: boolean, planCode: string | null = 'tms-standard'): Promise<EntitlementSnapshot> {
  clock += 60_000;
  return buildSnapshot({
    environment: 'DEV',
    controlPlaneTenantId: CPT,
    productCode: 'tms',
    external: { tenantId: ORG, organizationId: ORG, companyIds: [COMPANY] },
    snapshotVersion: version,
    previousVersion: version > 1 ? version - 1 : null,
    effectiveAt: new Date(clock - 1000).toISOString(),
    issuedAt: new Date(clock).toISOString(),
    appActive,
    planCode,
    registry,
    granted: [],
    allowancePeriod: { start: '2026-10-01', end: '2026-10-31' },
    aiCredits: { weights: [], weightsVersion: 0 },
    correlationId: crypto.randomUUID(),
  });
}
type Access = { operational: boolean; commercial: boolean; reason: string; mode: string };
const access = async (organizationId = ORG) => (await tms({ kind: 'access', organizationId })) as Access;
type ModeStep = { from?: string; to?: string; value?: string; productMode?: string; reason?: string; error?: string };
const mode = async (scope: string, to: string, reason: string | null = D14_REASON) =>
  (await tms({ kind: 'mode', scope, mode: to, tenant: CPT, reason })) as ModeStep;
let d14: Omit<D14Evidence, 'checks'> | null = null;

try {
  // ── Escenario ──────────────────────────────────────────────────────────────
  const manifest = await client.getManifest(ctx(), actor);
  check('1. MasterAdmin lee el manifiesto de TMS: sólo el baseline tms.core, ninguna vendible',
    manifest.ok && manifest.activeCodes.join() === 'tms.core' && registry.length === 0,
    manifest.ok ? `${manifest.manifestVersion} ${manifest.activeCodes.join()}` : manifest.errorCode);

  const v1 = await emit(1, true);
  const p0 = await client.pushSnapshot(ctx(), v1, actor);
  const a0 = await access();
  check('2. SHADOW (sembrado): APPLIED, el snapshot no decide', p0.result === 'APPLIED' && a0.operational && a0.commercial && a0.reason === 'NOT_ENFORCED',
    `${p0.result} ${a0.reason}`);
  check('   el snapshot no lleva capacidades, límites ni asignaciones (registro vacío)',
    v1.capabilities.length === 0 && v1.limits.length === 0 && v1.allowances.length === 0);

  const m1 = await mode(CPT, 'DUAL_READ', 'X-07 cohorte del tenant (fase 12)');
  const m2 = await mode(CPT, 'PRIMARY', 'X-07 cohorte del tenant (fase 12)');
  check('   cohorte del tenant: SHADOW → DUAL_READ → PRIMARY', m1.value === 'DUAL_READ' && m2.value === 'PRIMARY');

  const g1 = await client.getApplied(ctx(), actor);
  check('3. GET: misma versión y checksum, PRIMARY', g1.result === 'OBSERVED' && g1.appliedVersion === 1 && g1.appliedChecksum === v1.checksum && g1.enforcementMode === 'PRIMARY',
    `${g1.appliedVersion} ${g1.enforcementMode}`);
  const a1 = await access();
  check('4. superficie comercial activa y operación permitida (APP_ACTIVE)', a1.commercial && a1.operational && a1.reason === 'APP_ACTIVE', a1.reason);

  const p1r = await client.pushSnapshot(ctx(), v1, actor);
  check('5. replay idempotente → REPLAYED', p1r.result === 'REPLAYED' && p1r.appliedVersion === 1, p1r.result);

  const v2 = await emit(2, false);
  const p2 = await client.pushSnapshot(ctx(), v2, actor);
  const a2 = await access();
  check('6. v2 appActive=false → APPLIED, lo comercial retirado (APP_INACTIVE) y la operación continúa (D-14 regla 1)',
    p2.result === 'APPLIED' && !a2.commercial && a2.reason === 'APP_INACTIVE' && a2.operational,
    `${p2.result} ${a2.reason} operational=${a2.operational}`);

  const stale = await client.pushSnapshot(ctx(), v1, actor);
  check('7. v1 tras v2 → STALE (409)', stale.result === 'STALE' && stale.httpStatus === 409 && stale.appliedVersion === 2, `${stale.result} ${stale.errorCode}`);
  const v2b = await emit(2, false, 'tms-other');
  const conflict = await client.pushSnapshot(ctx(), v2b, actor);
  check('8. misma versión, otro contenido → CONFLICT (409)', conflict.result === 'CONFLICT' && conflict.httpStatus === 409, `${conflict.result} ${conflict.errorCode}`);

  const wrong = await client.pushSnapshot(ctx('tms:tenant:create'), v2, actor);
  check('9. credencial con scope de provisioning → 403 INSUFFICIENT_SCOPE (REJECTED)',
    wrong.result === 'REJECTED' && wrong.httpStatus === 403 && wrong.errorCode === 'INSUFFICIENT_SCOPE', `${wrong.httpStatus} ${wrong.errorCode}`);

  saasUp = false;
  const v3 = await emit(3, true);
  const down = await client.pushSnapshot(ctx(), v3, actor);
  check('10. TMS no disponible → RETRYABLE, nada aplicado', down.result === 'RETRYABLE', `${down.result} ${down.httpStatus}`);
  saasUp = true;
  const drift = await client.getApplied(ctx(), actor);
  check('11. reconciliación: el GET delata deriva (aplicado v2 ≠ deseado v3)', drift.appliedVersion === 2 && drift.appliedChecksum !== v3.checksum);
  const a3 = await access();
  check('    mientras tanto decide el last-good v2 (lo comercial sigue retirado, la operación sigue; sin llamar a MasterAdmin)',
    !a3.commercial && a3.reason === 'APP_INACTIVE' && a3.operational);
  const p3 = await client.pushSnapshot(ctx(), v3, actor);
  const g3 = await client.getApplied(ctx(), actor);
  const a4 = await access();
  check('12. push de v3 → GET en sincronía y superficie comercial restablecida',
    p3.result === 'APPLIED' && g3.appliedVersion === 3 && g3.appliedChecksum === v3.checksum && a4.commercial && a4.operational && a4.reason === 'APP_ACTIVE',
    `${p3.result} v${g3.appliedVersion} ${a4.reason}`);

  check('13. un jti distinto por petición M2M', jtis.length > 0 && new Set(jtis).size === jtis.length, `${jtis.length} peticiones`);

  // ── D14: entitlements → PRIMARY a nivel PRODUCT (DEV/LOCAL), sin rollback ───
  const parityBlocking = countChecks(results).failed;
  const transitions: string[] = [];
  const noReason = await mode('PRODUCT', 'DUAL_READ', null);
  const jump = await mode('PRODUCT', 'PRIMARY');
  check('D14.1 el cambio de modo exige motivo y un paso por vez (SHADOW → PRIMARY rechazado)',
    !!noReason.error && !!jump.error && !noReason.to && !jump.to, `${noReason.error} | ${jump.error}`);
  for (const to of ['DUAL_READ', 'PRIMARY']) {
    const step = await mode('PRODUCT', to);
    if (step.to) transitions.push(`PRODUCT:${step.from}->${step.to}`);
    check(`D14.2 PRODUCT → ${to} con motivo D-14`, !step.error && step.to === to && step.productMode === to && step.reason === D14_REASON,
      step.error ?? `${step.from}→${step.to}`);
  }
  const d14Get = await client.getApplied(ctx(), actor);
  check('D14.3 GET: PRIMARY con la versión y el checksum del último deseado (v3, appActive=true)',
    d14Get.result === 'OBSERVED' && d14Get.enforcementMode === 'PRIMARY' && d14Get.appliedVersion === 3 && d14Get.appliedChecksum === v3.checksum && v3.appActive === true,
    `${d14Get.enforcementMode} v${d14Get.appliedVersion}`);
  const aFinal = await access();
  check('D14.4 organización mapeada en PRIMARY: superficie comercial activa, operación permitida',
    aFinal.mode === 'PRIMARY' && aFinal.reason === 'APP_ACTIVE' && aFinal.commercial && aFinal.operational, `${aFinal.mode} ${aFinal.reason}`);
  const unmapped = await access(crypto.randomUUID());
  check('D14.5 organización no mapeada: NOT_UNDER_CONTROL_PLANE, comportamiento legacy intacto con PRODUCT=PRIMARY',
    unmapped.reason === 'NOT_UNDER_CONTROL_PLANE' && unmapped.commercial && unmapped.operational, unmapped.reason);
  const mapped = [CPT];
  const modes = (await tms({ kind: 'modes', tenant: CPT })) as { productMode?: string; tenantMode?: string };
  const finalMode = modes.tenantMode ?? 'UNKNOWN';
  const productMode = modes.productMode ?? 'UNKNOWN';
  check('D14.6 estado final sin rollback: PRODUCT=PRIMARY y el tenant mapeado en PRIMARY', productMode === 'PRIMARY' && finalMode === 'PRIMARY',
    `PRODUCT=${productMode} tenant=${finalMode}`);
  d14 = {
    product: 'tms',
    entitlements: {
      scope: 'PRODUCT',
      productScopeMode: productMode,
      finalMode,
      transitions,
      mappedTenants: mapped.length,
      mappedTenantsPrimary: d14Get.enforcementMode === 'PRIMARY' ? mapped.length : 0,
      getVerified: {
        appliedVersion: d14Get.appliedVersion ?? -1,
        appliedChecksum: d14Get.appliedChecksum ?? '',
        enforcementMode: d14Get.enforcementMode ?? '',
        desiredChecksum: v3.checksum,
      },
      legacyWrite: {
        status: 'NO_LEGACY_PATH',
        evidence: 'TMS PlatformEntitlementsIntegrationTest.runtimeRoleIsLockedOut (PostgreSQL 17): tms_app gets 42501 on SELECT of the 6 V52 tables and on UPDATE/INSERT of tms.platform_entitlement_mode and UPDATE/DELETE of tms.platform_entitlement_applied; modes move only by operator SQL under the V52 guard trigger (modesMoveOneStep)',
      },
      parityBlocking,
    },
    appActiveFalse: {
      commercialDenied: !a2.commercial && a2.reason === 'APP_INACTIVE' && !a3.commercial,
      operationalContinues: a2.operational && a3.operational,
      evidence: 'X-07 pasos 6 y 11 (acceso de TMS: commercial=false, operational=true, APP_INACTIVE) y 12 (v3 restablece); TMS CommercialAccessSecurityTest.inactiveOrganizationStillOperates y CommercialAccessGateAdapterTest (el gate nunca rechaza por hechos comerciales)',
    },
    legacyTenants: [{
      id: 'tms.organization code=DEMO',
      label: 'DEMO - Demo Organization (TMS supabase/seeds/local_dev_seed.sql)',
      resolution: 'UNRESOLVED',
      reason: 'no deterministic MasterAdmin mapping evidence; NOT_UNDER_CONTROL_PLANE keeps legacy behavior',
    }],
    billing: null,
  };
} catch (e) {
  check('escenario sin excepciones', false, (e as Error).message);
} finally {
  writeFileSync(path.join(box, 'stop'), 'stop');
  const code = await bridgeDone;
  const ok = /Tests run: 1, Failures: 0, Errors: 0, Skipped: 0/.test(bridgeLog);
  check('14. puente TMS terminó limpio', ok && code === 0, `exit=${code}`);
  if (!ok) console.log(bridgeLog.split('\n').filter((l) => /ERROR|Caused|FAIL/.test(l)).slice(0, 20).join('\n'));
  const left = readdirSync(box).filter((f) => f.endsWith('.req.json'));
  if (left.length) console.log(`peticiones sin atender: ${left.length}`);
  if (d14) {
    const file = writeD14Evidence({ ...d14, checks: countChecks(results) });
    console.log(file ? `evidencia D14: ${file}` : 'evidencia D14: sin CCP_EVIDENCE_DIR, no se escribe');
  } else {
    check('D14. fase D14 completa', false, 'la fase D14 no llegó a ejecutarse');
  }
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
}
