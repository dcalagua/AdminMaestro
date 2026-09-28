/**
 * E2E LOCAL de la fase 13 (X-07): MasterAdmin REAL → eSupplier REAL.
 *
 *   ESUPPLIER_WT=<worktree del programa en eSupplier> \
 *   ESUPPLIER_DB_CONTAINER=<contenedor de supabase/tests/ccp/run_ccp_sql_tests.sh con CCP_KEEP_CONTAINER=1> \
 *     node --experimental-transform-types scripts/ccp/esupplier-x07-e2e.mts
 *
 * Del lado MasterAdmin corre el código de producción: el emisor `buildSnapshot` y el cliente
 * M2M `EntitlementSyncClient` (JWT ES256 firmado con una clave generada EN MEMORIA, scopes de
 * entitlements, jti nuevo por intento, clasificación de respuestas).
 *
 * Del lado eSupplier corre su receptor de producción: `handleEntitlementsRequest` (lo que
 * despacha `platform-provisioning/index.ts`) servido por node:http, con su store real sobre las
 * RPC reales de la base DESECHABLE del harness CCP (captura + migraciones CCP 06/13), llamadas
 * con el rol service_role de verdad. El gate comercial (`esup_tenant_has_addon`,
 * `esup_tenants_with_addon`) y el outbox de uso IA se consultan en esa misma base.
 *
 * Sin stack Supabase, sin red externa, sin tocar ningún proyecto remoto. No imprime claves ni
 * tokens. El estado de MasterAdmin (sync_state) no se ejercita aquí: lo cubrió el E2E de la
 * fase 08 contra la base local real.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EntitlementSyncClient, type EntitlementDeliveryContext } from '../../supabase/functions/_shared/entitlements/sync-client.ts';
import { buildSnapshot } from '../../supabase/functions/_shared/entitlements/snapshot.ts';
import type { EntitlementSnapshot, GrantedCapability, RegistryCapability } from '../../supabase/functions/_shared/entitlements/types.ts';

const WT = process.env.ESUPPLIER_WT ?? '';
if (!WT.endsWith('/eSupplier/.worktrees/ebim-commercial-control-plane-v1')) {
  console.error('HARD STOP: ESUPPLIER_WT debe apuntar al worktree del programa en eSupplier');
  process.exit(2);
}
const container = process.env.ESUPPLIER_DB_CONTAINER ?? '';
if (!container || /prd|prod|qas/i.test(container)) {
  console.error('HARD STOP: ESUPPLIER_DB_CONTAINER debe nombrar el contenedor LOCAL desechable del harness CCP');
  process.exit(2);
}

type Row = Record<string, unknown>;
const esHandler = (await import(`${WT}/supabase/functions/_shared/entitlements/handler.ts`)) as {
  handleEntitlementsRequest(req: Request, deps: Row): Promise<Response>;
};
const esConfig = (await import(`${WT}/supabase/functions/_shared/entitlements/config.ts`)) as {
  resolveEntitlementsConfig(env: Row, provisioning: Row | null): { ok: boolean };
};
const esStore = (await import(`${WT}/supabase/functions/_shared/entitlements/store.ts`)) as {
  createEntitlementsStore(client: unknown): unknown;
};
const esM2m = (await import(`${WT}/supabase/functions/_shared/platformM2M.ts`)) as {
  loadM2MConfig(env: { get(k: string): string | undefined }): Row | null;
  importMasterAdminPublicKey(b64: string): Promise<CryptoKey>;
};

const results: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} · ${label}${detail ? ` · ${detail}` : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) process.exitCode = 1;
}

// ── La base desechable de eSupplier, por docker exec (sin puertos, sin claves) ─
function psql(sql: string): string {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function literal(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const tag = `q${randomBytes(6).toString('hex')}`;
  return `$${tag}$${text}$${tag}$`;
}
const svcSql = (sql: string) => psql(`begin; set local role service_role; ${sql}; commit;`);
const rpc = {
  async rpc(fn: string, args: Row) {
    const params = Object.entries(args).map(([k, v]) => `${k} => ${literal(v)}`).join(', ');
    try {
      const out = svcSql(`select public.${fn}(${params})`);
      if (out === '') return { data: null, error: null };
      if (out === 't' || out === 'f') return { data: out === 't', error: null };
      return { data: JSON.parse(out) as unknown, error: null };
    } catch (e) {
      return { data: null, error: { message: String((e as { stderr?: string }).stderr ?? 'psql').split('\n')[0], code: null } };
    }
  },
};

// ── Claves en memoria ────────────────────────────────────────────────────────
const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const privatePem = [`-----BEGIN ${'PRIVATE'} KEY-----`, pkcs8, `-----END ${'PRIVATE'} KEY-----`].join('\n');
const spki = Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
const publicKeyB64 = Buffer.from(`-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----\n`).toString('base64');

// ── eSupplier: tenant con mapping ACTIVE, grant legacy, receptor HTTP ─────────
// La captura de tests de eSupplier no tiene `companies`/`users` (la cadena de migraciones no
// se reproduce desde cero, fase 06): el mapping de provisioning se inserta como lo dejaría
// `platform_provision_tenant` (fila ACTIVE), sin pasar por el alta.
const CPT = '9f130000-0000-4000-8000-000000000001';
const TENANT = 91301;
psql(`
  insert into public.tenants (id, slug, name) values (${TENANT}, 'x07-esupplier', 'X07 eSupplier') on conflict (id) do nothing;
  insert into public.platform_provisioning_requests (control_plane_tenant_id, idempotency_key, request_hash,
    internal_tenant_id, deployment_mode, status, correlation_id, m2m_subject, m2m_jti, request_payload, completed_at)
  values ('${CPT}', 'x07-esupplier-alta', repeat('e', 64), ${TENANT}, 'SHARED', 'ACTIVE', gen_random_uuid(),
          'masteradmin-provisioning', 'x07-alta', '{}'::jsonb, now())
  on conflict (control_plane_tenant_id) do nothing;
  delete from public.platform_entitlement_snapshot_applied where control_plane_tenant_id = '${CPT}';`);
// Concesión LEGACY previa (hub/operador): en SHADOW decide, en PRIMARY el snapshot la sustituye.
svcSql(`select public.esup_grant_commercial_addon(${TENANT}, 'supplier_risk', 'OPERATOR')`);
const has = (addon: string) => svcSql(`select public.esup_tenant_has_addon(${TENANT}, '${addon}')`) === 't';
check('0. tenant con mapping ACTIVE; en SHADOW decide legacy (supplier_risk sí, dorothy no)',
  has('supplier_risk') && !has('dorothy_copilot'));

const envMap: Record<string, string> = {
  EBIM_MASTERADMIN_M2M_ENABLED: 'true',
  EBIM_MASTERADMIN_M2M_ISSUER: 'masteradmin.ebim',
  EBIM_MASTERADMIN_M2M_AUDIENCE: 'esupplier.ebim',
  EBIM_MASTERADMIN_M2M_ALGORITHM: 'ES256',
  EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME: '300',
  EBIM_MASTERADMIN_M2M_CREATE_SCOPE: 'esupplier:tenant:create',
  EBIM_MASTERADMIN_M2M_READ_SCOPE: 'esupplier:tenant:read',
  EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64: publicKeyB64,
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_WRITE_SCOPE: 'esupplier:entitlements:write',
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_READ_SCOPE: 'esupplier:entitlements:read',
  EBIM_ENTITLEMENTS_ENVIRONMENT: 'DEV',
};
const m2m = esM2m.loadM2MConfig({ get: (k) => envMap[k] });
const receiverConfig = esConfig.resolveEntitlementsConfig(envMap, m2m);
check('1. receptor eSupplier configurado (fail-closed si faltara algo)', m2m !== null && receiverConfig.ok);
const receiverKey = await esM2m.importMasterAdminPublicKey(publicKeyB64);

let saasUp = true;
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!saasUp) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'UNAVAILABLE', message: 'SaaS en mantenimiento' }));
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const request = new Request(`http://127.0.0.1${req.url}`, {
    method: req.method,
    headers,
    ...(raw && req.method !== 'GET' ? { body: raw } : {}),
  });
  const response = await esHandler.handleEntitlementsRequest(request, {
    m2m,
    publicKey: async () => receiverKey,
    config: receiverConfig,
    openStore: () => esStore.createEntitlementsStore(rpc),
    log: () => {},
  });
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(await response.text());
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;

// ── MasterAdmin: contexto de entrega (lo que leería de product_integrations) ─
const SECRET_REF = 'LOCAL_X07_ESUPPLIER_M2M_PRIVATE_KEY';
const TIMEOUT_MS = 120_000; // cada RPC del receptor va por docker exec: se mide el contrato, no la latencia del puente.
const ctx = (writeScope = 'esupplier:entitlements:write'): EntitlementDeliveryContext => ({
  tenant: { controlPlaneTenantId: CPT, productCode: 'esupplier' },
  push_enabled: true,
  enrollment: 'ENROLLED',
  deployment: { id: 'x07', environment: 'DEV', base_url: `http://127.0.0.1:${port}/functions/v1/platform-provisioning`, timeout_ms: TIMEOUT_MS, retry_count: 0 },
  integration: {
    id: 'x07-int',
    type: 'HTTP_M2M',
    issuer: 'masteradmin.ebim',
    audience: 'esupplier.ebim',
    subject: 'masteradmin-provisioning',
    algorithm: 'ES256',
    token_ttl_seconds: 120,
    entitlements_path: '/tenants/{controlPlaneTenantId}/entitlements',
    entitlements_manifest_path: '/entitlements/manifest',
    entitlements_write_scope: writeScope,
    entitlements_read_scope: 'esupplier:entitlements:read',
    allowed_hosts: [],
  },
  credential: { id: 'x07-cred', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: SECRET_REF },
});
const client = new EntitlementSyncClient({
  secretResolver: (ref) => (ref === SECRET_REF ? privatePem : undefined),
  sleep: async () => {},
});
const actor = { id: '10000000-0000-4000-a000-000000000002', role: 'EBIM_FINANCE' };

// Registro de MasterAdmin = manifiesto importado de eSupplier (import_capability_manifest).
const manifestFile = JSON.parse(readFileSync(`${WT}/docs/platform-provisioning/ENTITLEMENTS_MANIFEST.json`, 'utf8')) as {
  capabilities: { code: string; kind: RegistryCapability['kind']; isBaseline: boolean; scopeLevel: 'TENANT' | 'COMPANY';
    unit?: string; meterCode?: string; status: RegistryCapability['status'] }[];
};
const registry: RegistryCapability[] = manifestFile.capabilities.map((c) => ({
  code: c.code, kind: c.kind, isBaseline: c.isBaseline, scopeLevel: c.scopeLevel,
  unit: c.unit ?? null, meterCode: c.meterCode ?? null, status: c.status,
}));

let clock = Date.parse('2026-10-06T00:00:00Z');
async function emit(version: number, features: string[], appActive = true): Promise<EntitlementSnapshot> {
  const granted: GrantedCapability[] = features.map((code) => ({ code, value: null, enforcement: null, included: null, sources: ['ADDON'], companyIds: null }));
  clock += 60_000;
  return buildSnapshot({
    environment: 'DEV',
    controlPlaneTenantId: CPT,
    productCode: 'esupplier',
    external: { tenantId: String(TENANT), organizationId: null, companyIds: [] },
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

const DOROTHY = 'esupplier.ai.dorothy_copilot';
const TENDER = 'esupplier.ai.tender_copilot';

// ── Escenario ────────────────────────────────────────────────────────────────
const manifest = await client.getManifest(ctx(), actor);
check('2. MasterAdmin lee el manifiesto (9 IA de pago + 2 incluidos ACTIVE; mesa eChange, límites y créditos DRAFT)',
  manifest.ok && manifest.activeCodes.length === 11 && !manifest.activeCodes.includes('esupplier.echange_desk')
    && !manifest.activeCodes.includes('esupplier.users.max'),
  manifest.ok ? `${manifest.manifestVersion} · ${manifest.activeCodes.length} ACTIVE` : manifest.errorCode);

svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'DUAL_READ', 'x07')`);
svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'PRIMARY', 'x07')`);

const v1 = await emit(1, []);
check('3. el snapshot lista las 9 sellables ACTIVE con enabled explícito, sin DRAFT ni baseline',
  v1.capabilities.length === 9 && v1.capabilities.every((c) => c.enabled === false));
const p1 = await client.pushSnapshot(ctx(), v1, actor);
check('4. emisor real → PUT M2M real → APPLIED', p1.result === 'APPLIED' && p1.appliedVersion === 1, `${p1.result} ${p1.httpStatus}`);
const g1 = await client.getApplied(ctx(), actor);
check('5. GET: misma versión y checksum, PRIMARY', g1.result === 'OBSERVED' && g1.appliedVersion === 1
  && g1.appliedChecksum === v1.checksum && g1.enforcementMode === 'PRIMARY', `${g1.appliedVersion} ${g1.enforcementMode}`);
check('6. PRIMARY: el snapshot sustituye al legacy (supplier_risk revocado) y los incluidos siguen',
  !has('supplier_risk') && !has('dorothy_copilot') && has('ai_capture') && has('ai_auditor'));

const v2 = await emit(2, [DOROTHY, TENDER]);
const p2 = await client.pushSnapshot(ctx(), v2, actor);
check('7. v2 concede dorothy + tender → APPLIED; gate y barrido programado lo ven',
  p2.result === 'APPLIED' && has('dorothy_copilot') && has('tender_copilot')
    && svcSql(`select ${TENANT} = any (array(select public.esup_tenants_with_addon('dorothy_copilot')))`) === 't', p2.result);
const p2r = await client.pushSnapshot(ctx(), v2, actor);
check('8. replay idempotente → REPLAYED', p2r.result === 'REPLAYED' && p2r.appliedVersion === 2, p2r.result);
const stale = await client.pushSnapshot(ctx(), v1, actor);
check('9. v1 tras v2 → STALE (409)', stale.result === 'STALE' && stale.httpStatus === 409 && stale.appliedVersion === 2, `${stale.result} ${stale.errorCode}`);
clock -= 60_000;
const v2b = await emit(2, []);
const conflict = await client.pushSnapshot(ctx(), v2b, actor);
check('10. misma versión, otro contenido → CONFLICT (409)', conflict.result === 'CONFLICT' && conflict.httpStatus === 409, `${conflict.result} ${conflict.errorCode}`);
const wrong = await client.pushSnapshot(ctx('esupplier:tenant:create'), v2, actor);
check('11. credencial con scope de provisioning → 403 REJECTED', wrong.result === 'REJECTED' && wrong.httpStatus === 403 && wrong.errorCode === 'INSUFFICIENT_SCOPE', `${wrong.httpStatus} ${wrong.errorCode}`);
check('12. PRIMARY: una concesión legacy del operador queda bloqueada en servidor',
  /LEGACY_WRITE_BLOCKED/.test((() => { try { svcSql(`select public.esup_grant_commercial_addon(${TENANT}, 'invoice_3way', 'OPERATOR')`); return ''; } catch (e) { return String((e as { stderr?: string }).stderr); } })()));

// SaaS caído: MasterAdmin reintenta después; eSupplier sigue con su last-good.
saasUp = false;
const v3 = await emit(3, [DOROTHY], false);
const down = await client.pushSnapshot(ctx(), v3, actor);
check('13. SaaS no disponible → RETRYABLE, nada aplicado', down.result === 'RETRYABLE', `${down.result} ${down.httpStatus}`);
saasUp = true;
const drift = await client.getApplied(ctx(), actor);
check('14. reconciliación: el GET delata deriva (aplicado v2 ≠ deseado v3)', drift.appliedVersion === 2 && drift.appliedChecksum !== v3.checksum);

// MasterAdmin inalcanzable: el gate NO depende de él.
server.close();
check('15. offline: sin MasterAdmin ni receptor HTTP, el gate sigue con el last-good v2', has('dorothy_copilot') && has('tender_copilot'));

// Uso IA: el outbox atribuye tenant y controlPlaneTenantId, sin contenido y no facturable.
const eventId = crypto.randomUUID();
const recorded = svcSql(`select public.esup_record_ai_usage(${literal({ eventId, tenantId: TENANT, functionName: 'ai-chat',
  addonCode: 'dorothy_copilot', triggerSource: 'INTERACTIVE', outcome: 'SUCCEEDED',
  internal: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', inputTokens: 812, outputTokens: 164 } })}::jsonb)`);
const row = psql(`select control_plane_tenant_id || '|' || billable || '|' || status from public.ai_usage_outbox where event_id = '${eventId}'`);
check('16. uso IA en el outbox: tenant → controlPlaneTenantId, billable=false, PENDING', recorded === 't' && row === `${CPT}|false|PENDING`, row);

// v3 (appActive=false) aplicado por la misma RPC: retira lo comercial, no los incluidos.
const p3 = await rpc.rpc('platform_apply_entitlements', {
  p_control_plane_tenant_id: CPT, p_snapshot: v3,
  p_meta: { correlationId: 'x07-v3', m2mSubject: 'masteradmin-entitlements', m2mJti: 'x07-v3' },
});
check('17. v3 appActive=false: add-ons de pago retirados, incluidos intactos',
  (p3.data as { httpStatus?: number } | null)?.httpStatus === 200 && !has('dorothy_copilot') && has('ai_capture'));

// Limpieza del tenant X-07 (base desechable, reejecutable).
psql(`delete from public.platform_entitlement_enforcement_mode where scope_key = '${CPT}';`);

console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
