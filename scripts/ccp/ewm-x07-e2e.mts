/**
 * E2E LOCAL CCP fase 10 (X-07): MasterAdmin REAL → EWM REAL, sin sockets.
 *
 *   EWM_WT=<worktree del programa en WMS-by-EBIM> JAVA_HOME=<JDK 21> \
 *     node --experimental-transform-types scripts/ccp/ewm-x07-e2e.mts
 *
 * Del lado MasterAdmin corre el código de producción: el emisor `buildSnapshot`
 * y el cliente M2M `EntitlementSyncClient` (JWT ES256 firmado con una clave
 * generada EN MEMORIA, scopes de entitlements, url-guard, jti nuevo por intento,
 * clasificación de respuestas).
 *
 * Del lado EWM corre, dentro de su JVM, la cadena M2M de producción
 * (`PlatformM2mSecurityConfig` + decodificador ES256 con la clave pública que
 * deja este script), `PlatformEntitlementsController` y el receptor real sobre
 * almacenes en memoria (`MasterAdminMailboxBridgeTest`).
 *
 * El transporte es un BUZÓN DE ARCHIVOS en $TMPDIR en vez de HTTP porque el
 * sandbox no permite abrir puertos locales (EPERM): el `fetch` inyectado al
 * cliente escribe la petición exacta (método, ruta, headers, cuerpo) y espera la
 * respuesta de EWM. Sin red, sin Docker, sin ningún proyecto remoto. No imprime
 * claves ni tokens.
 *
 * Fase 18 (D-14, DEV/LOCAL): al final corre la fase "D14" — la cohorte del
 * contrato queda en PRIMARY (PRODUCT sigue en SHADOW), se verifica por GET el
 * último snapshot deseado y se ejecuta la prueba SQL de la guardia de EWM
 * (`scripts/ccp/pglite-legacy-write-guard.mjs`, PGLITE_MODULE opcional). No hay
 * rollback después. Con CCP_EVIDENCE_DIR escribe `d14-ewm.json`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { EntitlementSyncClient, type EntitlementDeliveryContext } from '../../supabase/functions/_shared/entitlements/sync-client.ts';
import { buildSnapshot } from '../../supabase/functions/_shared/entitlements/snapshot.ts';
import type { EntitlementSnapshot, GrantedCapability, RegistryCapability } from '../../supabase/functions/_shared/entitlements/types.ts';
import { countChecks, D14_REASON, writeD14Evidence, type D14Evidence } from './d14-evidence.mts';

const WT = process.env.EWM_WT ?? '';
if (!WT.endsWith('/WMS-by-EBIM/.worktrees/ebim-commercial-control-plane-v1') || !process.env.JAVA_HOME) {
  console.error('HARD STOP: EWM_WT debe ser el worktree del programa en EWM y JAVA_HOME un JDK 21');
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

// ── Buzón y puente EWM ───────────────────────────────────────────────────────
const CPT = '9e000000-0000-4000-8000-000000000001';
const ORG = '9e000000-0000-4000-8000-0000000000a0';
const COMPANY = '9e000000-0000-4000-8000-0000000000c0';
const box = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'ewm-x07-'));
writeFileSync(path.join(box, 'public.pem'), publicPem);
writeFileSync(path.join(box, 'setup.json'), JSON.stringify({ controlPlaneTenantId: CPT, organizationId: ORG, companyId: COMPANY }));

const mockito = path.join(homedir(), '.m2/repository/org/mockito/mockito-core/5.17.0/mockito-core-5.17.0.jar');
const bridge = spawn('./mvnw', ['-B', '-o', 'test', '-Dtest=MasterAdminMailboxBridgeTest', '-Dsurefire.failIfNoSpecifiedTests=false',
  `-DargLine=-javaagent:${mockito} -Djava.io.tmpdir=${process.env.TMPDIR ?? tmpdir()} -Xshare:off`], {
  cwd: path.join(WT, 'backend/wms-api'),
  env: { ...process.env, CCP_X07_MAILBOX: box },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bridgeLog = '';
bridge.stdout.on('data', (d) => { bridgeLog += d; });
bridge.stderr.on('data', (d) => { bridgeLog += d; });
const bridgeDone = new Promise<number>((resolve) => bridge.on('exit', (code) => resolve(code ?? -1)));

for (let i = 0; i < 1200 && !existsSync(path.join(box, 'ready')); i++) await sleep(150);
check('0. puente EWM arriba (cadena M2M real + receptor real)', existsSync(path.join(box, 'ready')));

let seq = 0;
async function ewm(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = String(++seq).padStart(5, '0');
  writeFileSync(path.join(box, `${id}.req.tmp`), JSON.stringify(payload));
  renameSync(path.join(box, `${id}.req.tmp`), path.join(box, `${id}.req.json`));
  const res = path.join(box, `${id}.res.json`);
  for (let i = 0; i < 2000; i++) {
    if (existsSync(res)) return JSON.parse(readFileSync(res, 'utf8'));
    await sleep(10);
  }
  throw new Error(`sin respuesta de EWM para ${id}`);
}

const jtis: string[] = [];
let saasUp = true;
const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
  if (!saasUp) {
    return new Response(JSON.stringify({ error: 'UNAVAILABLE', message: 'EWM en mantenimiento' }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
  const url = new URL(String(input));
  const headers = { ...(init?.headers as Record<string, string>) };
  const auth = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1] ?? '';
  const payload = auth.split('.')[1];
  if (payload) jtis.push(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).jti);
  const r = await ewm({ kind: 'http', method: init?.method ?? 'GET', path: url.pathname, headers, body: typeof init?.body === 'string' ? init.body : null });
  return new Response(r.body as string, { status: r.status as number, headers: { 'content-type': (r.contentType as string) ?? 'application/json' } });
}) as typeof fetch;

// ── MasterAdmin: contexto de entrega (lo que leería de product_integrations) ─
const SECRET_REF = 'LOCAL_X07_EWM_M2M_PRIVATE_KEY';
const ctx = (writeScope = 'ewm:entitlements:write', readScope = 'ewm:entitlements:read'): EntitlementDeliveryContext => ({
  tenant: { controlPlaneTenantId: CPT, productCode: 'ewm' },
  push_enabled: true,
  enrollment: 'ENROLLED',
  deployment: { id: 'x07', environment: 'DEV', base_url: 'http://127.0.0.1:18080/internal/platform/v1', timeout_ms: 20000, retry_count: 0 },
  integration: {
    id: 'x07-int',
    type: 'HTTP_M2M', // adapter_key EWM_V1: el canal entitlements.v1 no usa el codec de provisioning (pgTAP 37)
    issuer: 'masteradmin.ebim',
    audience: 'ewm.ebim',
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

// Registro de MasterAdmin = manifiesto de EWM importado (sólo ACTIVE, sin baseline).
const manifestFile = JSON.parse(readFileSync(`${WT}/docs/platform-provisioning/ENTITLEMENTS_MANIFEST.json`, 'utf8')) as {
  capabilities: { code: string; kind: RegistryCapability['kind']; scopeLevel: 'TENANT' | 'COMPANY'; isBaseline: boolean; status: string }[];
};
const registry: RegistryCapability[] = manifestFile.capabilities
  .filter((c) => c.status === 'ACTIVE' && !c.isBaseline)
  .map((c) => ({ code: c.code, kind: c.kind, isBaseline: false, scopeLevel: c.scopeLevel, unit: null, meterCode: null, status: 'ACTIVE' }));

let clock = Date.parse('2026-10-01T00:00:00Z');
async function emit(version: number, grants: Record<string, string[] | null>, appActive = true): Promise<EntitlementSnapshot> {
  const granted: GrantedCapability[] = Object.entries(grants).map(([code, companyIds]) => ({
    code, value: null, enforcement: null, included: null, sources: ['ADDON'], companyIds,
  }));
  clock += 60_000;
  return buildSnapshot({
    environment: 'DEV',
    controlPlaneTenantId: CPT,
    productCode: 'ewm',
    external: { tenantId: COMPANY, organizationId: ORG, companyIds: [COMPANY] },
    snapshotVersion: version,
    previousVersion: version > 1 ? version - 1 : null,
    effectiveAt: new Date(clock - 1000).toISOString(),
    issuedAt: new Date(clock).toISOString(),
    appActive,
    planCode: null,
    registry,
    granted,
    allowancePeriod: { start: '2026-10-01', end: '2026-10-31' },
    aiCredits: { weights: [], weightsVersion: 0 },
    correlationId: crypto.randomUUID(),
  });
}
const gate = async (agent: string) => (await ewm({ kind: 'gate', companyId: COMPANY, agent })).value === true;
const legacy = async () => (await ewm({ kind: 'legacy', companyId: COMPANY })).value as Record<string, boolean>;

// ── Fase 18 (D-14) ───────────────────────────────────────────────────────────
// La guardia SQL de EWM (supabase/migrations/20260929084334_ccp_bloqueo_escritura_legada_primary.sql)
// no puede correr dentro del puente en memoria: se certifica ejecutando su prueba
// SQL real (PGlite) como un paso de este X-07. PGLITE_MODULE es opcional; por
// defecto se usa la instalación existente de PGlite en EBIM/eCommerce.
const LOCAL_CODES = ['wms_copilot', 'ai_cycle_count', 'ai_slotting', 'ai_anomaly', 'ai_erp_reconcile', 'ai_replenishment', 'ai_wave_optimizer'];
const GUARD_RUNNER = 'scripts/ccp/pglite-legacy-write-guard.mjs';
const GUARD_TESTS = [
  'PRIMARY: admin_set_agent → LEGACY_WRITE_BLOCKED y no cambia nada',
  'PRIMARY: INSERT/UPDATE/DELETE directos por PostgREST (operador) → LEGACY_WRITE_BLOCKED',
  'PRIMARY: service_role por PostgREST también se bloquea',
  'PRIMARY: el materializador Java (JDBC sin claims) SÍ escribe: SQL_MATERIALIZAR y SQL_BORRAR',
  'sociedad sin mapping (CEYESA / V900) con PRODUCT=SHADOW: escritura legada permitida',
  'sin tablas de Flyway: admin_set_agent y la escritura directa del operador siguen permitidas',
];
const PGLITE_MODULE = process.env.PGLITE_MODULE
  ?? path.resolve(WT, '../../../../eCommerce/node_modules/@electric-sql/pglite/dist/index.js');
let appActiveFalse: D14Evidence['appActiveFalse'] = { commercialDenied: false, operationalContinues: false, evidence: 'paso 14 no alcanzado' };
let d14: Omit<D14Evidence, 'checks'> | null = null;

try {
  // ── Escenario ──────────────────────────────────────────────────────────────
  const manifest = await client.getManifest(ctx(), actor);
  check('1. MasterAdmin lee el manifiesto de EWM (7 agentes ACTIVE)', manifest.ok && manifest.activeCodes.length === 7,
    manifest.ok ? manifest.manifestVersion : manifest.errorCode);

  const m1 = await ewm({ kind: 'mode', scope: CPT, mode: 'DUAL_READ', tenant: CPT });
  const m2 = await ewm({ kind: 'mode', scope: CPT, mode: 'PRIMARY', tenant: CPT });
  check('   cohorte del contrato: SHADOW → DUAL_READ → PRIMARY (un paso por vez)', m1.value === 'DUAL_READ' && m2.value === 'PRIMARY');

  const v1 = await emit(1, { 'ewm.ai.copilot': null, 'ewm.ai.slotting': [COMPANY] });
  const p1 = await client.pushSnapshot(ctx(), v1, actor);
  check('2. emisor real → PUT M2M real → APPLIED', p1.result === 'APPLIED' && p1.appliedVersion === 1, `${p1.result} ${p1.httpStatus}`);

  const g1 = await client.getApplied(ctx(), actor);
  check('3. GET: misma versión y checksum, PRIMARY', g1.result === 'OBSERVED' && g1.appliedVersion === 1 && g1.appliedChecksum === v1.checksum && g1.enforcementMode === 'PRIMARY',
    `${g1.appliedVersion} ${g1.enforcementMode}`);

  const l1 = await legacy();
  check('4. gate de servidor EWM: copilot y slotting sí, anomaly no; company_ai_agents materializada',
    (await gate('wms_copilot')) && (await gate('ai_slotting')) && !(await gate('ai_anomaly')) && l1.ai_slotting === true && l1.ai_anomaly === false,
    JSON.stringify(l1));

  const p1r = await client.pushSnapshot(ctx(), v1, actor);
  check('5. replay idempotente → REPLAYED', p1r.result === 'REPLAYED' && p1r.appliedVersion === 1, p1r.result);

  const v2 = await emit(2, { 'ewm.ai.copilot': null });
  const p2 = await client.pushSnapshot(ctx(), v2, actor);
  check('6. v2 revoca slotting → APPLIED y gate cerrado', p2.result === 'APPLIED' && !(await gate('ai_slotting')), p2.result);

  const stale = await client.pushSnapshot(ctx(), v1, actor);
  check('7. v1 tras v2 → STALE (409)', stale.result === 'STALE' && stale.httpStatus === 409 && stale.appliedVersion === 2, `${stale.result} ${stale.errorCode}`);
  const v2b = await emit(2, { 'ewm.ai.copilot': null, 'ewm.ai.anomaly': null });
  const conflict = await client.pushSnapshot(ctx(), v2b, actor);
  check('8. misma versión, otro contenido → CONFLICT (409)', conflict.result === 'CONFLICT' && conflict.httpStatus === 409, `${conflict.result} ${conflict.errorCode}`);

  const wrong = await client.pushSnapshot(ctx('ewm:tenant:create'), v2, actor);
  check('9. credencial con scope de provisioning → 403 REJECTED', wrong.result === 'REJECTED' && wrong.httpStatus === 403, `${wrong.httpStatus} ${wrong.errorCode}`);

  saasUp = false;
  const v3 = await emit(3, { 'ewm.ai.copilot': null, 'ewm.ai.replenishment': null });
  const down = await client.pushSnapshot(ctx(), v3, actor);
  check('10. EWM no disponible → RETRYABLE, nada aplicado', down.result === 'RETRYABLE', `${down.result} ${down.httpStatus}`);
  saasUp = true;
  const drift = await client.getApplied(ctx(), actor);
  check('11. reconciliación: el GET delata deriva (aplicado v2 ≠ deseado v3)', drift.appliedVersion === 2 && drift.appliedChecksum !== v3.checksum);
  check('    mientras tanto el gate sigue con el last-good v2 (sin llamar a MasterAdmin)', (await gate('wms_copilot')) && !(await gate('ai_replenishment')));
  const p3 = await client.pushSnapshot(ctx(), v3, actor);
  const g3 = await client.getApplied(ctx(), actor);
  check('12. push de v3 → GET en sincronía (versión y checksum)', p3.result === 'APPLIED' && g3.appliedVersion === 3 && g3.appliedChecksum === v3.checksum && (await gate('ai_replenishment')));

  await ewm({ kind: 'legacyWrite', companyId: COMPANY, agent: 'ai_anomaly', active: true });
  const rec = await ewm({ kind: 'reconcile', tenant: CPT });
  const l2 = await legacy();
  check('13. escritura legada (admin_set_agent) en PRIMARY: detectada y revertida; el gate nunca la concedió',
    rec.value === 1 && l2.ai_anomaly === false && !(await gate('ai_anomaly')), `diferencias=${rec.value}`);

  const v4 = await emit(4, { 'ewm.ai.copilot': null }, false);
  const p4 = await client.pushSnapshot(ctx(), v4, actor);
  const denied14 = p4.result === 'APPLIED' && !(await gate('wms_copilot'));
  check('14. appActive=false → APPLIED y ningún agente concedido', denied14, p4.result);
  const l4 = await legacy();
  const g4 = await client.getApplied(ctx(), actor);
  const keeps14 = Object.keys(l4).length === LOCAL_CODES.length && g4.result === 'OBSERVED' && g4.appliedVersion === 4;
  check('    appActive=false no borra datos ni corta el canal: filas conservadas y GET OBSERVED v4', keeps14,
    `${Object.keys(l4).length} filas, GET ${g4.result} v${g4.appliedVersion}`);
  appActiveFalse = {
    commercialDenied: denied14,
    operationalContinues: keeps14,
    evidence: 'X-07 paso 14: v4 appActive=false APPLIED, gate wms_copilot=false, company_ai_agents conservada '
      + `(${Object.keys(l4).length} filas) y GET OBSERVED v4. appActive sólo entra en AgentDecision.java:41 (agentes), `
      + 'que consume únicamente AgentEntitlementService (hallazgos de la Flota); ninguna ruta operativa del WMS lo lee. '
      + 'EwmEntitlementsReceiverTest "appActive=false: ningún agente, sin borrar datos".',
  };

  check('15. un jti distinto por petición M2M', jtis.length > 0 && new Set(jtis).size === jtis.length, `${jtis.length} peticiones`);

  // ── D14 · corte gobernado a PRIMARY por COHORTE (este contrato), SIN rollback ──
  // PRODUCT queda en SHADOW: avanzarlo cambiaría las sociedades sin mapping
  // (CEYESA, V900), que en PRIMARY perderían todos sus agentes.
  const LADDER = ['LEGACY', 'SHADOW', 'DUAL_READ', 'PRIMARY'];
  const productMode = (await ewm({ kind: 'modeOf', scope: 'PRODUCT' })).value as string;
  const explicitBefore = (await ewm({ kind: 'modeOf', scope: CPT })).value as string;
  let current = explicitBefore === 'NONE' ? productMode : explicitBefore;
  const d14Steps: string[] = [];
  while (current !== 'PRIMARY' && LADDER.includes(current)) {
    const next = LADDER[LADDER.indexOf(current) + 1];
    const r = await ewm({ kind: 'mode', scope: CPT, mode: next, tenant: CPT, reason: D14_REASON });
    d14Steps.push(`${current}→${next}`);
    if (r.value !== next) break;
    current = next;
  }
  // Re-afirmación gobernada: no-op si ya es PRIMARY (EntitlementModeService no registra evento).
  const still = await ewm({ kind: 'mode', scope: CPT, mode: 'PRIMARY', tenant: CPT, reason: D14_REASON });
  const events = ((await ewm({ kind: 'modeEvents' })).value as string[])
    .filter((e) => e.startsWith(`${CPT}:`)).map((e) => e.slice(CPT.length + 1).replace('->', '→'));
  const oneStep = events.length > 0
    && events.every((e) => { const [a, b] = e.split('→'); return Math.abs(LADDER.indexOf(a) - LADDER.indexOf(b)) === 1; });
  check('D14.1 cohorte del contrato en PRIMARY, un paso por vez; PRODUCT sigue en SHADOW',
    still.value === 'PRIMARY' && productMode === 'SHADOW' && oneStep && events.at(-1) === 'DUAL_READ→PRIMARY',
    `eventos=[${events.join(', ')}] fase D14=[${d14Steps.join(', ') || 'ya PRIMARY'}] PRODUCT=${productMode}`);

  const v5 = await emit(5, { 'ewm.ai.copilot': null, 'ewm.ai.slotting': [COMPANY] }, true);
  const p5 = await client.pushSnapshot(ctx(), v5, actor);
  const g5 = await client.getApplied(ctx(), actor);
  const getOk = p5.result === 'APPLIED' && g5.result === 'OBSERVED' && g5.enforcementMode === 'PRIMARY'
    && g5.appliedVersion === 5 && g5.appliedChecksum === v5.checksum;
  check('D14.2 último deseado (v5, appActive=true) → GET: PRIMARY, versión y checksum iguales', getOk,
    `${p5.result} · GET ${g5.enforcementMode} v${g5.appliedVersion}`);

  const l5 = await legacy();
  let parityBlocking = 0;
  for (const code of LOCAL_CODES) if ((l5[code] === true) !== (await gate(code))) parityBlocking++;
  check('D14.3 paridad: company_ai_agents materializada = gate del snapshot (0 diferencias)',
    parityBlocking === 0 && l5.wms_copilot === true && l5.ai_slotting === true && l5.ai_anomaly === false, `diferencias=${parityBlocking}`);

  const guard = existsSync(PGLITE_MODULE)
    ? spawnSync(process.execPath, [GUARD_RUNNER], { cwd: WT, env: { ...process.env, PGLITE_MODULE }, encoding: 'utf8', timeout: 180_000 })
    : null;
  const guardOut = guard?.stdout ?? '';
  const guardLast = guardOut.trim().split('\n').at(-1) ?? 'sin salida';
  const guardOk = guard?.status === 0 && /# \d+ ok, 0 fail/.test(guardOut) && GUARD_TESTS.every((t) => guardOut.includes(`ok - ${t}`));
  check('D14.4 escritura legada BLOQUEADA en PRIMARY: prueba SQL de la guardia de EWM', guardOk,
    guard ? `rc=${guard.status} ${guardLast}` : `PGLITE_MODULE no encontrado: ${PGLITE_MODULE}`);
  check('D14.5 defensa en profundidad: el paso 13 (la reconciliación revierte la escritura legada) pasó',
    results.some((r) => r.startsWith('PASS · 13.')));

  d14 = {
    product: 'ewm',
    entitlements: {
      scope: 'COHORT',
      productScopeMode: productMode,
      finalMode: g5.enforcementMode ?? String(still.value),
      transitions: events,
      mappedTenants: 1,
      mappedTenantsPrimary: still.value === 'PRIMARY' && g5.enforcementMode === 'PRIMARY' ? 1 : 0,
      getVerified: {
        appliedVersion: g5.appliedVersion ?? 0,
        appliedChecksum: g5.appliedChecksum ?? '',
        enforcementMode: g5.enforcementMode ?? '',
        desiredChecksum: v5.checksum,
      },
      legacyWrite: {
        // Sólo BLOCKED si la prueba SQL real pasó; si no, el X-07 ya sale con 1.
        status: (guardOk ? 'BLOCKED' : 'NOT_VERIFIED') as D14Evidence['entitlements']['legacyWrite']['status'],
        evidence: `EWM ${GUARD_RUNNER} (PGlite; supabase/migrations/20260929084334_ccp_bloqueo_escritura_legada_primary.sql `
          + `+ V48/V49): ${GUARD_TESTS.map((t) => `"${t}"`).join('; ')} → ${guardLast}. `
          + 'Defensa en profundidad: X-07 paso 13 (la reconciliación detecta y revierte una escritura legada).',
      },
      parityBlocking,
    },
    appActiveFalse,
    legacyTenants: [
      {
        id: 'ce7e5a00-0000-4000-8000-000000000002',
        label: 'CEYESA (sociedad demo, supabase/migrations/20260804201000_seed_ceyesa_core.sql)',
        resolution: 'UNRESOLVED',
        reason: 'Sin mapping determinista en MasterAdmin: ningún platform_provisioning_request ACTIVE ni tenant_product_mappings '
          + '(los tenants EWM del seed de MasterAdmin alpha-ewm…titan-ewm tampoco tienen tenant_product_mappings). '
          + 'Sigue en PRODUCT=SHADOW: company_ai_agents manda. No se inventan plan, precio, cuotas ni add-ons.',
      },
      {
        id: '11111111-1111-4111-8111-111111111111',
        label: 'Tenant del perfil local (backend/wms-api/src/main/resources/db/seed/V900__local_seed_data.sql)',
        resolution: 'UNRESOLVED',
        reason: 'Sin mapping determinista en MasterAdmin (sin provisioning ACTIVE ni tenant_product_mappings). '
          + 'Sigue en PRODUCT=SHADOW. No se inventan plan, precio, cuotas ni add-ons.',
      },
    ],
    billing: null,
  };
} catch (e) {
  check('escenario sin excepciones', false, (e as Error).message);
} finally {
  writeFileSync(path.join(box, 'stop'), 'stop');
  const code = await bridgeDone;
  const ok = /Tests run: 1, Failures: 0, Errors: 0, Skipped: 0/.test(bridgeLog);
  check('16. puente EWM terminó limpio', ok && code === 0, `exit=${code}`);
  if (!ok) console.log(bridgeLog.split('\n').filter((l) => /ERROR|Caused|FAIL/.test(l)).slice(0, 20).join('\n'));
  const left = readdirSync(box).filter((f) => f.endsWith('.req.json'));
  if (left.length) console.log(`peticiones sin atender: ${left.length}`);
  check('D14 fase completa (evidencia armada)', d14 !== null);
  if (d14) {
    const file = writeD14Evidence({ ...d14, checks: countChecks(results) });
    console.log(file ? `evidencia D-14: ${file}` : 'evidencia D-14: sin CCP_EVIDENCE_DIR, no se escribe');
  }
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
}
