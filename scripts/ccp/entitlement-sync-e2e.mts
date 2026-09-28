/**
 * E2E LOCAL de la fase 08 (MA-40): MasterAdmin local real → SaaS de prueba HTTP.
 *
 *   node --experimental-transform-types scripts/ccp/entitlement-sync-e2e.mts
 *
 * Requiere el stack LOCAL de MasterAdmin y, en el entorno del proceso,
 * SUPABASE_URL (http://127.0.0.1:54421), SUPABASE_DB_URL y
 * SUPABASE_SERVICE_ROLE_KEY del stack local (`supabase status -o env`). La guarda aborta si la URL no es local.
 *
 * Qué ejercita de verdad:
 *   · issue_entitlement_snapshot (SQL, JCS en SQL) → verifySnapshot (JCS en TS)
 *     antes de enviar: si los dos runtimes discrepan, el push sale REJECTED;
 *   · el job (core.ts) y el flujo del orquestador (sync-flow.ts) contra las
 *     RPCs reales vía supabase-js con service_role;
 *   · el cliente M2M real: JWT ES256 firmado con una clave generada EN MEMORIA
 *     (nunca se escribe), scopes de entitlements, jti nuevo por intento;
 *   · un SaaS de prueba (node:http) que verifica firma, iss/aud/exp, scope y
 *     jti de un solo uso, y delega en el receptor de referencia de FIX-ENT-v1.
 *
 * Deja datos en la base local (los snapshots son append-only): ejecutar sobre
 * un `db reset` desechable. No imprime claves ni tokens.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { EntitlementSyncClient } from '../../supabase/functions/_shared/entitlements/sync-client.ts';
import { createRpcSyncStore, type RpcClient } from '../../supabase/functions/_shared/entitlements/sync-store.ts';
import { syncTenantNow } from '../../supabase/functions/_shared/entitlements/sync-flow.ts';
import { runJob, parseJobRequest } from '../../supabase/functions/entitlement-sync/core.ts';
import { ReferenceReceiver } from '../../contracts/entitlements/v1/reference-receiver.ts';

const URL_ = process.env.SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB = process.env.SUPABASE_DB_URL ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(URL_) || !KEY || !/@(127\.0\.0\.1|localhost):/.test(DB)) {
  console.error('HARD STOP: SUPABASE_URL/SUPABASE_DB_URL deben ser el stack local y SUPABASE_SERVICE_ROLE_KEY debe existir');
  process.exit(2);
}

const ALPHA = '50000000-0000-4000-a000-000000000001';
const ESUP = '20000000-0000-4000-a000-000000000001';
const INTEGRATION = '70000000-0000-4000-a000-0000000000e2';
const SECRET_REF = 'LOCAL_E2E_ESUPPLIER_M2M_PRIVATE_KEY';
const CODES = ['esupplier.e2e.reports', 'esupplier.e2e.users.max'];

const sql = (q: string) => execFileSync('psql', [DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
const results: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} · ${label}${detail ? ` · ${detail}` : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Claves en memoria
// ---------------------------------------------------------------------------
const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const privatePem = [`-----BEGIN ${'PRIVATE'} KEY-----`, pkcs8, `-----END ${'PRIVATE'} KEY-----`].join('\n');

// ---------------------------------------------------------------------------
// SaaS de prueba
// ---------------------------------------------------------------------------
const receiver = new ReferenceReceiver({
  environment: 'DEV',
  productCode: 'esupplier',
  knownCapabilities: CODES,
  baselineCapabilities: [],
  provisionedTenants: [ALPHA],
  enforcementMode: 'SHADOW',
  writeScope: 'esupplier:entitlements:write',
  readScope: 'esupplier:entitlements:read',
});
const seenScopes: string[] = [];
const jtis: string[] = [];
let saasUp = true;

function b64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function verifyJwt(auth: string | undefined): Promise<{ scopes: string[]; jti: string } | null> {
  const token = (auth ?? '').replace(/^Bearer /, '');
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  const header = JSON.parse(b64url(h).toString()) as { alg: string };
  if (header.alg !== 'ES256') return null;
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const claims = JSON.parse(b64url(p).toString()) as { iss: string; aud: string; exp: number; scope: string; jti: string };
  if (claims.iss !== 'masteradmin.ebim' || claims.aud !== 'esupplier.ebim' || claims.exp * 1000 < Date.now()) return null;
  return { scopes: claims.scope.split(' '), jti: claims.jti };
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!saasUp) return send(503, { error: 'UNAVAILABLE', message: 'SaaS en mantenimiento' });
  const token = await verifyJwt(req.headers.authorization);
  if (!token) return send(401, { error: 'UNAUTHENTICATED', message: 'JWT inválido' });
  seenScopes.push(`${req.method} ${token.scopes.join(' ')}`);
  jtis.push(token.jti);
  if (req.headers['x-masteradmin-contract'] !== 'entitlements.v1') return send(422, { error: 'SNAPSHOT_INVALID', message: 'contrato' });

  const m = /^\/platform\/tenants\/([0-9a-f-]{36})\/entitlements$/.exec(req.url ?? '');
  if (req.method === 'GET' && req.url === '/platform/entitlements/manifest') {
    if (!token.scopes.includes('esupplier:entitlements:read')) return send(403, { error: 'INSUFFICIENT_SCOPE', message: 's' });
    return send(200, {
      schema: 'ebim.capabilities/v1', productCode: 'esupplier', manifestVersion: 'e2e-1',
      capabilities: CODES.map((code) => ({ code, name: code, kind: code.endsWith('.max') ? 'LIMIT' : 'FEATURE', status: 'ACTIVE' })),
    });
  }
  if (!m) return send(404, { error: 'NOT_FOUND', message: 'ruta' });
  if (req.method === 'GET') {
    const r = receiver.get(m[1], token);
    return send(r.status, r.body);
  }
  if (req.method === 'PUT') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const r = await receiver.put(m[1], JSON.parse(raw), token);
    return send(r.status, r.body);
  }
  return send(405, { error: 'METHOD', message: 'm' });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;

// ---------------------------------------------------------------------------
// Estado en MasterAdmin local
// ---------------------------------------------------------------------------
sql(`
  insert into platform.product_capabilities (saas_product_id, code, name, kind, unit, combine_rule, status)
  values ('${ESUP}', 'esupplier.e2e.reports', 'E2E reportes', 'FEATURE', null, null, 'ACTIVE'),
         ('${ESUP}', 'esupplier.e2e.users.max', 'E2E usuarios', 'LIMIT', 'user', 'MAX', 'ACTIVE');
  insert into platform.product_integrations
    (id, saas_product_id, code, name, integration_type, contract_version, issuer, audience, subject, algorithm,
     token_ttl_seconds, create_scope, read_scope, create_path_template, status_path_template, provisioning_policy,
     enabled, status, entitlements_path, entitlements_manifest_path, entitlements_write_scope, entitlements_read_scope,
     entitlements_push_enabled, cutover_state_entitlements)
  values ('${INTEGRATION}', '${ESUP}', 'esupplier-e2e-local', 'eSupplier · E2E local', 'HTTP_M2M', 'v1', 'masteradmin.ebim',
          'esupplier.ebim', 'masteradmin-provisioning', 'ES256', 120, 'esupplier:tenant:create', 'esupplier:tenant:read',
          '/tenants', '/tenants/{controlPlaneTenantId}', 'MANUAL', true, 'READY',
          '/tenants/{controlPlaneTenantId}/entitlements', '/entitlements/manifest',
          'esupplier:entitlements:write', 'esupplier:entitlements:read', true, 'SHADOW');
  insert into platform.credential_profiles
    (id, code, name, saas_product_id, type, environment, secret_ref, algorithm, issuer, audience, token_ttl_seconds, enabled)
  values ('71000000-0000-4000-a000-0000000000e2', 'esupplier-e2e-local', 'eSupplier E2E local', '${ESUP}',
          'M2M_ASYMMETRIC_JWT', 'DEV', '${SECRET_REF}', 'ES256', 'masteradmin.ebim', 'esupplier.ebim', 120, true);
  update platform.deployment_targets
     set product_integration_id = '${INTEGRATION}', credential_profile_id = '71000000-0000-4000-a000-0000000000e2',
         base_url = 'http://127.0.0.1:${port}/platform', retry_count = 1, timeout_ms = 3000
   where id = '40000000-0000-4000-a000-00000000000a';
  insert into platform.tenant_product_mappings
    (tenant_id, saas_product_id, deployment_target_id, external_tenant_id, status, provisioned_at, registered_manually)
  values ('${ALPHA}', '${ESUP}', '40000000-0000-4000-a000-00000000000a', 'ext-alpha-e2e', 'ACTIVE', now(), true);
`);
const grant = (code: string, value: string) =>
  sql(`select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-a000-000000000002","role":"authenticated"}', false);
       set role authenticated;
       select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', '${code}', '${value}', current_date - 1, 'E2E');`);
grant('esupplier.e2e.reports', '{"enabled": true}');
grant('esupplier.e2e.users.max', '{"value": 25, "enforcement": "HARD"}');

const state = () =>
  sql(`select state || '|' || coalesce(desired_version::text,'-') || '|' || coalesce(applied_version::text,'-') || '|' || consecutive_failures
         from platform.entitlement_sync_state where tenant_id = '${ALPHA}' and saas_product_id = '${ESUP}'`);

const admin = createClient(URL_, KEY, { db: { schema: 'platform' }, auth: { persistSession: false } });
const store = createRpcSyncStore(admin as unknown as RpcClient);
const client = new EntitlementSyncClient({
  secretResolver: (ref) => (ref === SECRET_REF ? privatePem : undefined),
  sleep: async () => {},
});
const deps = { store, client, worker: 'e2e-job' };
const job = (body: Record<string, unknown>) => runJob(deps, parseJobRequest(body));

// ---------------------------------------------------------------------------
// Escenario
// ---------------------------------------------------------------------------
const issue1 = (await job({ job: 'issue' })) as { issue: { issued: number } };
check('1. issue emite v1 para el tenant enrolado', issue1.issue.issued === 1, state());
check('   estado PENDING_PUSH v1', state().startsWith('PENDING_PUSH|1|-'), state());

const push1 = (await job({ job: 'push' })) as { push: { results: { result: string; errorCode: string | null }[] } };
check('2. push: PUT aceptado (el checksum SQL pasó la verificación TS previa al envío)', push1.push.results[0]?.result === 'APPLIED', JSON.stringify(push1.push.results));
check('   tras el PUT: AWAITING_VERIFY, applied sin tocar', state().startsWith('AWAITING_VERIFY|1|-'), state());

await job({ job: 'verify' });
check('3. verify: el GET confirma v1 → IN_SYNC', state().startsWith('IN_SYNC|1|1|0'), state());
check('   el SaaS decide con lo aplicado: reports concedida, límite 25', receiver.isEntitled(ALPHA, 'esupplier.e2e.reports') && receiver.limit(ALPHA, 'esupplier.e2e.users.max') === 25);

sql(`select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-a000-000000000003","role":"authenticated"}', false);
     set role authenticated;
     select platform.create_entitlement_override('${ALPHA}', 'esupplier.e2e.reports', 'DENY', '{}', now() + interval '1 day', 'E2E revocación');`);
const all2 = (await job({ job: 'all' })) as { issue: { issued: number } };
check('4. cambio comercial (DENY) → issue v2 → push → verify en un solo "all"', all2.issue.issued === 1 && state().startsWith('IN_SYNC|2|2|0'), state());
check('   revocación aplicada en el SaaS: reports denegada', !receiver.isEntitled(ALPHA, 'esupplier.e2e.reports'));

const orch = await syncTenantNow(store, client, ALPHA, ESUP, { id: null, role: 'E2E' }, 'e2e-orchestrator');
check('5. SYNC_ENTITLEMENTS sin cambios: no emite ni empuja, re-verifica IN_SYNC', orch.issued === false && orch.push === undefined && orch.state === 'IN_SYNC', JSON.stringify(orch));

sql(`update platform.entitlement_sync_state set state = 'PENDING_PUSH', next_attempt_at = now() where tenant_id = '${ALPHA}'`);
const replay = (await job({ job: 'push' })) as { push: { results: { result: string }[] } };
check('6. re-envío de la misma versión: el SaaS responde replayed (idempotente)', replay.push.results[0]?.result === 'REPLAYED', JSON.stringify(replay.push.results));
await job({ job: 'verify' });
check('   y el GET vuelve a IN_SYNC v2', state().startsWith('IN_SYNC|2|2'), state());

saasUp = false;
sql(`select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-a000-000000000003","role":"authenticated"}', false);
     set role authenticated;
     select platform.revoke_entitlement_override((select id from platform.tenant_entitlement_overrides where tenant_id = '${ALPHA}' and revoked_at is null), 'E2E fin');`);
await job({ job: 'issue' });
const down = (await job({ job: 'push' })) as { push: { results: { result: string; errorCode: string | null }[] } };
check('7. SaaS caído: 503 → RETRYABLE, PENDING_PUSH con 1 fallo y backoff', down.push.results[0]?.result === 'RETRYABLE' && state().startsWith('PENDING_PUSH|3|2|1'), state());
check('   el SaaS sigue decidiendo con su último snapshot (v2) mientras tanto', !receiver.isEntitled(ALPHA, 'esupplier.e2e.reports') && receiver.limit(ALPHA, 'esupplier.e2e.users.max') === 25);
saasUp = true;
sql(`update platform.entitlement_sync_state set next_attempt_at = now() where tenant_id = '${ALPHA}'`);
await job({ job: 'push' });
await job({ job: 'verify' });
check('   SaaS de vuelta: v3 aplicada y verificada', state().startsWith('IN_SYNC|3|3|0') && receiver.isEntitled(ALPHA, 'esupplier.e2e.reports'), state());

const reg = (await job({ job: 'registry-verify' })) as { registry: { results: { drift: boolean | null }[] } };
check('8. registry-verify: manifiesto = registro → sin drift', reg.registry.results[0]?.drift === false, JSON.stringify(reg.registry.results));

sql(`update platform.product_integrations set entitlements_push_enabled = false where id = '${INTEGRATION}'`);
sql(`select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-a000-000000000003","role":"authenticated"}', false);
     set role authenticated;
     select platform.create_entitlement_override('${ALPHA}', 'esupplier.e2e.users.max', 'GRANT', '{"value": 40, "enforcement": "HARD"}', now() + interval '1 day', 'E2E kill-switch');`);
const killed = (await job({ job: 'all' })) as { issue: { issued: number }; push: { claimed: number } };
check('9. kill-switch apagado: v4 se emite pero no se empuja', killed.issue.issued === 1 && killed.push.claimed === 0 && state().startsWith('PENDING_PUSH|4|3'), state());
check('   el SaaS conserva v3 (límite 25)', receiver.limit(ALPHA, 'esupplier.e2e.users.max') === 25);

check('10. cada petición llevó un jti distinto (un solo uso)', new Set(jtis).size === jtis.length, `${jtis.length} peticiones`);
check('    PUT solo con scope de escritura, GET solo con scope de lectura',
  seenScopes.every((s) => (s.startsWith('PUT ') ? s === 'PUT esupplier:entitlements:write' : s === 'GET esupplier:entitlements:read')),
  [...new Set(seenScopes)].join(', '));
const attempts = sql(`select count(*) || '|' || count(*) filter (where detail::text ~* '(BEGIN|eyJ)') from platform.entitlement_sync_attempts where tenant_id = '${ALPHA}'`);
check('    bitácora sin tokens ni claves', attempts.endsWith('|0'), attempts);

server.close();
console.log(`E2E: ${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
