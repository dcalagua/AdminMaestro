/**
 * E2E LOCAL de la fase 11 (X-07): MasterAdmin REAL → Comerza REAL.
 *
 *   COMERZA_WT=<worktree del programa en Comerza> \
 *   COMERZA_DB_CONTAINER=<contenedor Postgres local> COMERZA_SCRATCH_DB=<base de trabajo> \
 *     node --experimental-transform-types scripts/ccp/comerza-x07-e2e.mts
 *
 * Del lado MasterAdmin corre el código de producción: el emisor `buildSnapshot`
 * y el cliente M2M `EntitlementSyncClient` (JWT ES256 firmado con una clave
 * generada EN MEMORIA, scopes de entitlements, jti nuevo por intento,
 * clasificación de respuestas).
 *
 * Del lado Comerza corre su receptor de producción: `handleEntitlementsRequest`
 * (la misma función que despacha `platform-provisioning`) servido por node:http,
 * con su almacén real sobre las RPC reales de una base de trabajo reconstruida
 * con TODAS las migraciones de Comerza (`db-rebuild-check.sh`), llamadas con el
 * rol service_role de verdad. El gate comercial (`comerza_has_capability`,
 * `comerza_ai_admit`) se consulta en esa misma base.
 *
 * Sin stack Supabase, sin red externa, sin tocar ningún proyecto remoto. No
 * imprime claves ni tokens. El estado de MasterAdmin (sync_state) no se ejercita
 * aquí: lo cubrió el E2E de la fase 08 contra la base local real.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { EntitlementSyncClient, type EntitlementDeliveryContext } from '../../supabase/functions/_shared/entitlements/sync-client.ts';
import { buildSnapshot } from '../../supabase/functions/_shared/entitlements/snapshot.ts';
import type { EntitlementSnapshot, GrantedCapability, RegistryCapability } from '../../supabase/functions/_shared/entitlements/types.ts';

const WT = process.env.COMERZA_WT ?? '';
if (!WT.endsWith('/comerza/.worktrees/ebim-commercial-control-plane-v1')) {
  console.error('HARD STOP: COMERZA_WT debe apuntar al worktree del programa en Comerza');
  process.exit(2);
}
const container = process.env.COMERZA_DB_CONTAINER ?? '';
const database = process.env.COMERZA_SCRATCH_DB ?? '';
if (!container || !database || /prd|prod|qas/i.test(`${container}${database}`)) {
  console.error('HARD STOP: COMERZA_DB_CONTAINER y COMERZA_SCRATCH_DB deben nombrar una base de trabajo LOCAL');
  process.exit(2);
}

type Row = Record<string, unknown>;

const czHandler = (await import(`${WT}/supabase/functions/_shared/entitlements/handler.ts`)) as {
  handleEntitlementsRequest(req: Request, deps: Row): Promise<Response>;
};
const czConfig = (await import(`${WT}/supabase/functions/_shared/entitlements/config.ts`)) as {
  resolveEntitlementsConfig(env: Row, provisioning: Row | null): { ok: boolean };
};
const czStore = (await import(`${WT}/supabase/functions/_shared/entitlements/store.ts`)) as {
  createEntitlementsStore(client: unknown): unknown;
};
const czM2m = (await import(`${WT}/supabase/functions/_shared/provisioning/m2m.ts`)) as {
  resolveM2MConfig(env: Row): { ok: boolean; config?: Row };
};
const czDb = (await import(`${WT}/tests/support/scratch-db.ts`)) as {
  psql(db: { container: string; database: string }, sql: string): string;
  literal(value: unknown): string;
  serviceRoleRpc(db: { container: string; database: string }): {
    rpc(fn: string, args: Row): Promise<{ data: unknown; error: { message: string } | null }>;
  };
};

const results: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} · ${label}${detail ? ` · ${detail}` : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) process.exitCode = 1;
}

// ── Claves en memoria ────────────────────────────────────────────────────────
const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const privatePem = [`-----BEGIN ${'PRIVATE'} KEY-----`, pkcs8, `-----END ${'PRIVATE'} KEY-----`].join('\n');
const spki = Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
const publicKeyB64 = Buffer.from(`-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----\n`).toString('base64');

// ── Comerza: base de trabajo, tenant aprovisionado por su puerta, receptor HTTP ─
const db = { container, database };
const rpc = czDb.serviceRoleRpc(db);
const CPT = '9f110000-0000-4000-8000-000000000001';
const ORG = '9f110000-0000-4000-8000-0000000000a0';
const COMPANY = '9f110000-0000-4000-8000-0000000000c0';

const alta = await rpc.rpc('platform_provision_tenant', {
  p_request: {
    controlPlaneTenantId: CPT,
    organization: { id: ORG, slug: 'x07-comerza', name: 'X07 Comerza', legalName: 'X07 Comerza SAC', taxId: null,
                    countryCode: 'PE', currency: 'PEN', timezone: 'America/Lima' },
    company: { id: COMPANY, name: 'X07 Comerza', legalName: 'X07 Comerza SAC', taxId: '20911100001',
               countryCode: 'PE', currency: 'PEN' },
    admin: { email: 'admin@x07-comerza.test', fullName: 'Admin X07' },
    deploymentMode: 'SHARED',
  },
  p_hash: 'e'.repeat(64),
  p_key: 'x07-comerza-alta',
  p_context: { correlationId: 'x07', m2mSubject: 'masteradmin-provisioning', m2mJti: 'x07-alta' },
});
const outcome = (alta.data as { outcome?: string } | null)?.outcome;
check('0. tenant aprovisionado por platform_provision_tenant', outcome === 'CREATED' || outcome === 'REPLAYED', outcome ?? alta.error?.message);
// Receptor vacío para este tenant (reejecutable sobre la misma base de trabajo).
czDb.psql(db, `delete from operator.entitlement_snapshot_applied where control_plane_tenant_id = '${CPT}';
               delete from operator.entitlement_enforcement_mode where scope_key = '${CPT}';`);

const env: Row = {
  EBIM_MASTERADMIN_M2M_ENABLED: 'true',
  EBIM_MASTERADMIN_M2M_ISSUER: 'masteradmin.ebim',
  EBIM_MASTERADMIN_M2M_AUDIENCE: 'comerza.ebim',
  EBIM_MASTERADMIN_M2M_SUBJECT: 'masteradmin-provisioning',
  EBIM_MASTERADMIN_M2M_ALGORITHM: 'ES256',
  EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME: '300',
  EBIM_MASTERADMIN_M2M_CREATE_SCOPE: 'comerza:tenant:create',
  EBIM_MASTERADMIN_M2M_READ_SCOPE: 'comerza:tenant:read',
  EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64: publicKeyB64,
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_WRITE_SCOPE: 'comerza:entitlements:write',
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_READ_SCOPE: 'comerza:entitlements:read',
  EBIM_ENTITLEMENTS_ENVIRONMENT: 'DEV',
};
const m2m = czM2m.resolveM2MConfig(env);
const receiverConfig = czConfig.resolveEntitlementsConfig(env, m2m.ok ? (m2m.config as Row) : null);
check('1. receptor Comerza configurado (fail-closed si faltara algo)', m2m.ok && receiverConfig.ok);

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
  const response = await czHandler.handleEntitlementsRequest(request, {
    m2m,
    config: receiverConfig,
    openStore: () => ({ ok: true, store: czStore.createEntitlementsStore(rpc) }),
    log: () => {},
  });
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(await response.text());
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;

// ── MasterAdmin: contexto de entrega (lo que leería de product_integrations) ─
const SECRET_REF = 'LOCAL_X07_COMERZA_M2M_PRIVATE_KEY';
// Cada RPC del receptor va por `docker exec … psql` a la base de trabajo: con el
// Docker local cargado una petición tarda decenas de segundos. El timeout del
// cliente se sube aquí para medir el contrato, no la latencia de ese puente.
const TIMEOUT_MS = 180_000;
const ctx = (writeScope = 'comerza:entitlements:write'): EntitlementDeliveryContext => ({
  tenant: { controlPlaneTenantId: CPT, productCode: 'comerza' },
  push_enabled: true,
  enrollment: 'ENROLLED',
  deployment: { id: 'x07', environment: 'DEV', base_url: `http://127.0.0.1:${port}/functions/v1/platform-provisioning`, timeout_ms: TIMEOUT_MS, retry_count: 0 },
  integration: {
    id: 'x07-int',
    type: 'HTTP_M2M',
    issuer: 'masteradmin.ebim',
    audience: 'comerza.ebim',
    subject: 'masteradmin-provisioning',
    algorithm: 'ES256',
    token_ttl_seconds: 120,
    entitlements_path: '/tenants/{controlPlaneTenantId}/entitlements',
    entitlements_manifest_path: '/entitlements/manifest',
    entitlements_write_scope: writeScope,
    entitlements_read_scope: 'comerza:entitlements:read',
    allowed_hosts: [],
  },
  credential: { id: 'x07-cred', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: SECRET_REF },
});
const client = new EntitlementSyncClient({
  secretResolver: (ref) => (ref === SECRET_REF ? privatePem : undefined),
  sleep: async () => {},
});
const actor = { id: '10000000-0000-4000-a000-000000000002', role: 'EBIM_FINANCE' };

// Registro de MasterAdmin = manifiesto importado de Comerza (import_capability_manifest).
const manifestFile = JSON.parse(readFileSync(`${WT}/docs/platform-provisioning/ENTITLEMENTS_MANIFEST.json`, 'utf8')) as {
  capabilities: { code: string; kind: RegistryCapability['kind']; scopeLevel: 'TENANT' | 'COMPANY'; status: RegistryCapability['status'] }[];
};
const registry: RegistryCapability[] = manifestFile.capabilities.map((c) => ({
  code: c.code,
  kind: c.kind,
  isBaseline: false,
  scopeLevel: c.scopeLevel,
  unit: null,
  meterCode: null,
  status: c.status,
}));

let clock = Date.parse('2026-10-03T00:00:00Z');
async function emit(version: number, features: string[]): Promise<EntitlementSnapshot> {
  const granted: GrantedCapability[] = features.map((code) => ({ code, value: null, enforcement: null, included: null, sources: ['ADDON'], companyIds: null }));
  clock += 60_000;
  return buildSnapshot({
    environment: 'DEV',
    controlPlaneTenantId: CPT,
    productCode: 'comerza',
    external: { tenantId: COMPANY, organizationId: ORG, companyIds: [COMPANY] },
    snapshotVersion: version,
    previousVersion: version > 1 ? version - 1 : null,
    effectiveAt: new Date(clock - 1000).toISOString(),
    issuedAt: new Date(clock).toISOString(),
    appActive: true,
    planCode: null,
    registry,
    granted,
    allowancePeriod: { start: '2026-10-01', end: '2026-10-31' },
    aiCredits: { weights: [], weightsVersion: 0 },
    correlationId: crypto.randomUUID(),
  });
}

const svcSql = (sql: string) =>
  czDb.psql(db, `begin; set local role service_role; set local request.jwt.claims = '{"role":"service_role"}'; ${sql}; commit;`);
const gate = (cap: string) => svcSql(`select public.comerza_has_capability('${COMPANY}', '${cap}')`) === 't';
const admit = () =>
  JSON.parse(svcSql(`select public.comerza_ai_admit('${COMPANY}', 'comerza.ai.whatsapp_agent', 'whatsapp_meta')`)) as Row;
const AI = 'comerza.ai.whatsapp_agent';

// ── Escenario ────────────────────────────────────────────────────────────────
const manifest = await client.getManifest(ctx(), actor);
check('2. MasterAdmin lee el manifiesto de Comerza (1 código ACTIVE; Vitrina y ERP DRAFT)',
  manifest.ok && manifest.activeCodes.length === 1 && manifest.activeCodes[0] === AI,
  manifest.ok ? `${manifest.manifestVersion} ${manifest.activeCodes.join(',')}` : manifest.errorCode);

svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'DUAL_READ', 'x07')`);
svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'PRIMARY', 'x07')`);

const v1 = await emit(1, []);
check('3. el snapshot no lleva DRAFT: solo el agente, con enabled explícito',
  v1.capabilities.length === 1 && v1.capabilities[0]!.code === AI && v1.capabilities[0]!.enabled === false);
const p1 = await client.pushSnapshot(ctx(), v1, actor);
check('4. emisor real → PUT M2M real → APPLIED', p1.result === 'APPLIED' && p1.appliedVersion === 1, `${p1.result} ${p1.httpStatus}`);
const g1 = await client.getApplied(ctx(), actor);
check('5. GET: misma versión y checksum, PRIMARY', g1.result === 'OBSERVED' && g1.appliedVersion === 1 && g1.appliedChecksum === v1.checksum && g1.enforcementMode === 'PRIMARY',
  `${g1.appliedVersion} ${g1.enforcementMode}`);

const a1 = admit();
check('6. gate de servidor: sin contrato, el agente NO se admite (Gemini no se llama)', a1.allowed === false && a1.reason === 'SIN_ENTITLEMENT', String(a1.reason));
check('   cero comisión ≠ add-ons gratis: Vitrina y ERP apagados', !gate('comerza.storefront') && !gate('comerza.erp_connector'));

const v2 = await emit(2, [AI]);
const p2 = await client.pushSnapshot(ctx(), v2, actor);
check('7. v2 concede el agente → APPLIED y admitido', p2.result === 'APPLIED' && gate(AI) && admit().allowed === true, p2.result);

const p2r = await client.pushSnapshot(ctx(), v2, actor);
check('8. replay idempotente → REPLAYED', p2r.result === 'REPLAYED' && p2r.appliedVersion === 2, p2r.result);
const stale = await client.pushSnapshot(ctx(), v1, actor);
check('9. v1 tras v2 → STALE (409)', stale.result === 'STALE' && stale.httpStatus === 409 && stale.appliedVersion === 2, `${stale.result} ${stale.errorCode}`);
clock -= 60_000;
const v2b = await emit(2, []);
const conflict = await client.pushSnapshot(ctx(), v2b, actor);
check('10. misma versión, otro contenido → CONFLICT (409)', conflict.result === 'CONFLICT' && conflict.httpStatus === 409, `${conflict.result} ${conflict.errorCode}`);
const wrong = await client.pushSnapshot(ctx('comerza:tenant:create'), v2, actor);
check('11. credencial con scope de provisioning → 403 REJECTED', wrong.result === 'REJECTED' && wrong.httpStatus === 403 && wrong.errorCode === 'INSUFFICIENT_SCOPE', `${wrong.httpStatus} ${wrong.errorCode}`);

// SaaS caído: MasterAdmin reintenta después; Comerza sigue con su last-good.
saasUp = false;
const v3 = await emit(3, []);
const down = await client.pushSnapshot(ctx(), v3, actor);
check('12. SaaS no disponible → RETRYABLE, nada aplicado', down.result === 'RETRYABLE', `${down.result} ${down.httpStatus}`);
saasUp = true;
const drift = await client.getApplied(ctx(), actor);
check('13. reconciliación: el GET delata deriva (aplicado v2 ≠ deseado v3)', drift.appliedVersion === 2 && drift.appliedChecksum !== v3.checksum);

// MasterAdmin inalcanzable: el gate NO depende de él. Se cierra el receptor y
// el gate sigue decidiendo con lo aplicado.
server.close();
check('14. offline: sin MasterAdmin ni receptor, el gate sigue con el last-good v2', gate(AI) && admit().allowed === true);

// Un flag del tenant en true no concede: se prueba contra v3 aplicado a mano por
// la misma RPC (el receptor HTTP ya está cerrado).
const p3 = await rpc.rpc('platform_apply_entitlements', {
  p_control_plane_tenant_id: CPT,
  p_snapshot: v3,
  p_meta: { correlationId: 'x07-v3', m2mSubject: 'masteradmin-provisioning', m2mJti: 'x07-v3' },
});
czDb.psql(db, `update public.config_layers set config = jsonb_set(config, '{features}',
  coalesce(config -> 'features', '{}') || '{"ai_whatsapp_agent": true, "vitrina": true, "erp_connector": true}')
  where organization_id = '${ORG}' and company_id is null;`);
check('15. v3 revoca el agente; los flags del tenant en true no lo reviven',
  (p3.data as { httpStatus?: number } | null)?.httpStatus === 200 && !gate(AI) && admit().reason === 'SIN_ENTITLEMENT' && !gate('comerza.storefront'));

console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
