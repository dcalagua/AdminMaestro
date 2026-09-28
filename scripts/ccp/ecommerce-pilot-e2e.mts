/**
 * E2E LOCAL del piloto CCP fase 09 (X-07): MasterAdmin REAL → eCommerce REAL.
 *
 *   ECOMMERCE_WT=<ruta del worktree de eCommerce> \
 *     node --experimental-transform-types scripts/ccp/ecommerce-pilot-e2e.mts
 *
 * Del lado MasterAdmin corre el código de producción: el emisor `buildSnapshot`
 * (el mismo que la SQL reproduce, equivalencia probada en la fase 08) y el
 * cliente M2M `EntitlementSyncClient` (JWT ES256 firmado con una clave generada
 * EN MEMORIA, scopes de entitlements, url-guard, jti nuevo por intento,
 * clasificación de respuestas).
 *
 * Del lado eCommerce corre su receptor de producción: `handleEntitlementsRequest`
 * (la misma función que despacha `platform-provisioning`) servido por node:http,
 * con sus RPC reales sobre PGlite (todas las migraciones de eCommerce).
 *
 * Sin stack Supabase, sin red externa, sin tocar ningún proyecto remoto. No
 * imprime claves ni tokens. El estado de MasterAdmin (sync_state) no se
 * ejercita aquí: lo cubrió el E2E de la fase 08 contra la base local real.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { EntitlementSyncClient, type EntitlementDeliveryContext } from '../../supabase/functions/_shared/entitlements/sync-client.ts';
import { buildSnapshot } from '../../supabase/functions/_shared/entitlements/snapshot.ts';
import type { EntitlementSnapshot, GrantedCapability, RegistryCapability } from '../../supabase/functions/_shared/entitlements/types.ts';

const WT = process.env.ECOMMERCE_WT ?? '';
if (!WT || !WT.endsWith('/eCommerce/.worktrees/ebim-commercial-control-plane-v1')) {
  console.error('HARD STOP: ECOMMERCE_WT debe apuntar al worktree del programa en eCommerce');
  process.exit(2);
}

type Row = Record<string, unknown>;
interface PgLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

const harness = (await import(`${WT}/supabase/tests/harness.ts`)) as {
  createTestDatabase(): Promise<PgLike>;
  asRole<T>(db: PgLike, role: string, claims: unknown, fn: () => Promise<T>): Promise<T>;
};
const helpers = (await import(`${WT}/supabase/tests/entitlements-helpers.ts`)) as {
  provisionTenant(db: PgLike, ids: { cpt: string; org: string; company: string; slug: string }): Promise<void>;
};
const ecHandler = (await import(`${WT}/supabase/functions/_shared/platformEntitlements/handler.ts`)) as {
  handleEntitlementsRequest(req: Request, deps: Row): Promise<Response>;
};
const ecConfig = (await import(`${WT}/supabase/functions/_shared/platformEntitlements/config.ts`)) as {
  loadEntitlementsConfig(env: { get(k: string): string | undefined }): Row | null;
};
const ecRepo = (await import(`${WT}/supabase/functions/_shared/platformEntitlements/repository.ts`)) as {
  createEntitlementsRpcRepository(client: unknown): unknown;
};
const ecM2m = (await import(`${WT}/supabase/functions/_shared/platformProvisioning/m2m.ts`)) as {
  importMasterAdminPublicKey(b64: string): Promise<CryptoKey>;
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

// ── eCommerce: base, tenant aprovisionado, receptor HTTP ─────────────────────
const db = await harness.createTestDatabase();
const CPT = '9f000000-0000-4000-8000-000000000001';
const ORG = '9f000000-0000-4000-8000-0000000000a0';
const COMPANY = '9f000000-0000-4000-8000-0000000000c0';
await helpers.provisionTenant(db, { cpt: CPT, org: ORG, company: COMPANY, slug: 'x07-e2e' });

const svc = <T,>(sql: string, params: unknown[] = []) =>
  harness.asRole(db, 'service_role', null, async () => (await db.query<T>(sql, params)).rows);

const rpc = {
  async rpc(fn: string, args: Row) {
    try {
      const names = Object.keys(args);
      const casts: Record<string, string> = { p_snapshot: '::jsonb', p_meta: '::jsonb', p_control_plane_tenant_id: '::uuid', p_expires_at: '::timestamptz' };
      const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}${casts[n] ?? ''}`).join(', ')}) as v`;
      const params = names.map((n) => (typeof args[n] === 'object' && args[n] !== null ? JSON.stringify(args[n]) : args[n]));
      const rows = await svc<{ v: unknown }>(sql, params);
      return { data: rows[0]?.v ?? null, error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  },
};

const env: Record<string, string> = {
  EBIM_MASTERADMIN_M2M_ENABLED: 'true',
  EBIM_MASTERADMIN_M2M_ISSUER: 'masteradmin.ebim',
  EBIM_MASTERADMIN_M2M_AUDIENCE: 'ecommerce.ebim',
  EBIM_MASTERADMIN_M2M_SUBJECT: 'masteradmin-provisioning',
  EBIM_MASTERADMIN_M2M_ALGORITHM: 'ES256',
  EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME: '300',
  EBIM_MASTERADMIN_M2M_CREATE_SCOPE: 'ecommerce:tenant:create',
  EBIM_MASTERADMIN_M2M_READ_SCOPE: 'ecommerce:tenant:read',
  EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64: publicKeyB64,
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_WRITE_SCOPE: 'ecommerce:entitlements:write',
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_READ_SCOPE: 'ecommerce:entitlements:read',
  EBIM_ENTITLEMENTS_ENVIRONMENT: 'DEV',
};
const receiverConfig = ecConfig.loadEntitlementsConfig({ get: (k) => env[k] });
check('0. receptor eCommerce configurado (fail-closed si faltara algo)', receiverConfig !== null);

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
  const response = await ecHandler.handleEntitlementsRequest(request, {
    config: receiverConfig,
    publicKey: () => ecM2m.importMasterAdminPublicKey(publicKeyB64),
    repository: () => ecRepo.createEntitlementsRpcRepository(rpc),
  });
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(await response.text());
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;

// ── MasterAdmin: contexto de entrega (lo que leería de product_integrations) ─
const SECRET_REF = 'LOCAL_X07_ECOMMERCE_M2M_PRIVATE_KEY';
const ctx = (writeScope = 'ecommerce:entitlements:write'): EntitlementDeliveryContext => ({
  tenant: { controlPlaneTenantId: CPT, productCode: 'ecommerce' },
  push_enabled: true,
  enrollment: 'ENROLLED',
  deployment: { id: 'x07', environment: 'DEV', base_url: `http://127.0.0.1:${port}/functions/v1/platform-provisioning`, timeout_ms: 5000, retry_count: 0 },
  integration: {
    id: 'x07-int',
    type: 'HTTP_M2M',
    issuer: 'masteradmin.ebim',
    audience: 'ecommerce.ebim',
    subject: 'masteradmin-provisioning',
    algorithm: 'ES256',
    token_ttl_seconds: 120,
    entitlements_path: '/tenants/{controlPlaneTenantId}/entitlements',
    entitlements_manifest_path: '/entitlements/manifest',
    entitlements_write_scope: writeScope,
    entitlements_read_scope: 'ecommerce:entitlements:read',
    allowed_hosts: [],
  },
  credential: { id: 'x07-cred', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: SECRET_REF },
});
const client = new EntitlementSyncClient({
  secretResolver: (ref) => (ref === SECRET_REF ? privatePem : undefined),
  sleep: async () => {},
});
const actor = { id: '10000000-0000-4000-a000-000000000002', role: 'EBIM_FINANCE' };

// Registro de MasterAdmin = manifiesto importado de eCommerce (import_capability_manifest).
const manifestFile = JSON.parse(readFileSync(`${WT}/docs/platform-provisioning/ENTITLEMENTS_MANIFEST.json`, 'utf8')) as {
  capabilities: { code: string; kind: RegistryCapability['kind']; scopeLevel: 'TENANT' | 'COMPANY'; unit?: string; meterCode?: string; status: 'ACTIVE' }[];
};
const registry: RegistryCapability[] = manifestFile.capabilities.map((c) => ({
  code: c.code,
  kind: c.kind,
  isBaseline: false,
  scopeLevel: c.scopeLevel,
  unit: c.unit ?? null,
  meterCode: c.meterCode ?? null,
  status: c.status,
}));

let clock = Date.parse('2026-10-01T00:00:00Z');
async function emit(version: number, features: string[], aiCredits: number | null): Promise<EntitlementSnapshot> {
  const granted: GrantedCapability[] = features.map((code) => ({ code, value: null, enforcement: null, included: null, sources: ['PLAN'], companyIds: null }));
  if (aiCredits !== null) granted.push({ code: 'ecommerce.ai.credits', value: null, enforcement: null, included: aiCredits, sources: ['PLAN'], companyIds: null });
  clock += 60_000;
  return buildSnapshot({
    environment: 'DEV',
    controlPlaneTenantId: CPT,
    productCode: 'ecommerce',
    external: { tenantId: ORG, organizationId: ORG, companyIds: [COMPANY] },
    snapshotVersion: version,
    previousVersion: version > 1 ? version - 1 : null,
    effectiveAt: new Date(clock - 1000).toISOString(),
    issuedAt: new Date(clock).toISOString(),
    appActive: true,
    planCode: 'ecommerce-shared-standard',
    registry,
    granted,
    allowancePeriod: { start: '2026-10-01', end: '2026-10-31' },
    aiCredits: { weights: [], weightsVersion: 0 },
    correlationId: crypto.randomUUID(),
  });
}

const gate = async (cap: string) =>
  (await svc<{ ok: boolean }>('select ebim.company_is_entitled($1, $2, $3) as ok', [ORG, COMPANY, cap]))[0]!.ok;
const consume = async () =>
  (await svc<{ r: Row }>(`select ebim.ai_consume_for($1, $2, 'assistant', 1) as r`, [ORG, COMPANY]))[0]!.r;

// ── Escenario ────────────────────────────────────────────────────────────────
const manifest = await client.getManifest(ctx(), actor);
check('1. MasterAdmin lee el manifiesto de eCommerce (26 códigos ACTIVE)', manifest.ok && manifest.activeCodes.length === 26,
  manifest.ok ? manifest.manifestVersion : manifest.errorCode);

await svc(`select public.platform_set_entitlement_enforcement_mode($1, 'DUAL_READ', 'x07')`, [CPT]);
await svc(`select public.platform_set_entitlement_enforcement_mode($1, 'PRIMARY', 'x07')`, [CPT]);

const v1 = await emit(1, ['ecommerce.ai.assist', 'ecommerce.promotions'], 2);
const p1 = await client.pushSnapshot(ctx(), v1, actor);
check('2. emisor real → PUT M2M real → APPLIED', p1.result === 'APPLIED' && p1.appliedVersion === 1, `${p1.result} ${p1.httpStatus}`);

const g1 = await client.getApplied(ctx(), actor);
check('3. GET: misma versión y checksum, PRIMARY', g1.result === 'OBSERVED' && g1.appliedVersion === 1 && g1.appliedChecksum === v1.checksum && g1.enforcementMode === 'PRIMARY',
  `${g1.appliedVersion} ${g1.enforcementMode}`);

check('4. gate de servidor eCommerce: promotions sí, payments no', (await gate('promotions')) && !(await gate('payments')));
const a1 = await consume();
const a2 = await consume();
const a3 = await consume();
check('   IA: asignación 2 del snapshot, el hard gate corta la 3ª', a1.allowed === true && a2.allowed === true && a3.allowed === false && a3.reason === 'QUOTA_EXCEEDED');

const p1r = await client.pushSnapshot(ctx(), v1, actor);
check('5. replay idempotente → REPLAYED', p1r.result === 'REPLAYED' && p1r.appliedVersion === 1, p1r.result);

const v2 = await emit(2, ['ecommerce.ai.assist'], 2);
const p2 = await client.pushSnapshot(ctx(), v2, actor);
check('6. v2 revoca promotions → APPLIED y gate cerrado', p2.result === 'APPLIED' && !(await gate('promotions')), p2.result);

const stale = await client.pushSnapshot(ctx(), v1, actor);
check('7. v1 tras v2 → STALE (409)', stale.result === 'STALE' && stale.httpStatus === 409 && stale.appliedVersion === 2, `${stale.result} ${stale.errorCode}`);
const v2b = await emit(2, ['ecommerce.ai.assist', 'ecommerce.payments'], 2);
const conflict = await client.pushSnapshot(ctx(), v2b, actor);
check('8. misma versión, otro contenido → CONFLICT (409)', conflict.result === 'CONFLICT' && conflict.httpStatus === 409, `${conflict.result} ${conflict.errorCode}`);

const wrong = await client.pushSnapshot(ctx('ecommerce:tenant:create'), v2, actor);
check('9. credencial con scope de provisioning → 403 REJECTED', wrong.result === 'REJECTED' && wrong.httpStatus === 403 && wrong.errorCode === 'INSUFFICIENT_SCOPE', `${wrong.httpStatus} ${wrong.errorCode}`);

// SaaS caído: MasterAdmin reintenta después; el SaaS sigue con su last-good.
saasUp = false;
const v3 = await emit(3, ['ecommerce.ai.assist', 'ecommerce.pricing.lists'], 5);
const down = await client.pushSnapshot(ctx(), v3, actor);
check('10. SaaS no disponible → RETRYABLE, nada aplicado', down.result === 'RETRYABLE', `${down.result} ${down.httpStatus}`);
saasUp = true;
const drift = await client.getApplied(ctx(), actor);
check('11. reconciliación: el GET delata deriva (aplicado v2 ≠ deseado v3)', drift.appliedVersion === 2 && drift.appliedChecksum !== v3.checksum);
check('    mientras tanto el gate sigue con el last-good v2', !(await gate('pricing.lists')));
const p3 = await client.pushSnapshot(ctx(), v3, actor);
const g3 = await client.getApplied(ctx(), actor);
check('12. push de v3 → GET en sincronía (versión y checksum)', p3.result === 'APPLIED' && g3.appliedVersion === 3 && g3.appliedChecksum === v3.checksum && (await gate('pricing.lists')));

server.close();
await db.close();
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
