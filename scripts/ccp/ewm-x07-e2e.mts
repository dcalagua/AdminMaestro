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
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { EntitlementSyncClient, type EntitlementDeliveryContext } from '../../supabase/functions/_shared/entitlements/sync-client.ts';
import { buildSnapshot } from '../../supabase/functions/_shared/entitlements/snapshot.ts';
import type { EntitlementSnapshot, GrantedCapability, RegistryCapability } from '../../supabase/functions/_shared/entitlements/types.ts';

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
  check('14. appActive=false → APPLIED y ningún agente concedido', p4.result === 'APPLIED' && !(await gate('wms_copilot')), p4.result);

  check('15. un jti distinto por petición M2M', jtis.length > 0 && new Set(jtis).size === jtis.length, `${jtis.length} peticiones`);
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
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
}
