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
 *
 * Fase 18 · D-14 (DEV/LOCAL): alcance COHORT. El modo del PRODUCTO se queda en
 * SHADOW porque las sociedades del seed sin alta de MasterAdmin lo heredan y
 * PRIMARY les cortaría el agente IA que hoy tienen por `legacy_grant` (regla 4:
 * no se inventa su contrato). Cada tenant MAPEADO avanza a PRIMARY un paso por
 * vez con el motivo D-14 y NO se revierte. La fase D14 del final prueba
 * appActive=false (retira lo comercial, no lo operativo), deja el tenant con un
 * snapshot appActive=true, lo verifica por GET, prueba en ese estado que el
 * camino legacy no concede nada y escribe `d14-comerza.json`. El tope del
 * proveedor compartido (`operator.ai_provider_budget`) queda SIN fijar: número
 * operativo no decidido y no es prerrequisito del cutover.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { EntitlementSyncClient, type EntitlementDeliveryContext } from '../../supabase/functions/_shared/entitlements/sync-client.ts';
import { buildSnapshot } from '../../supabase/functions/_shared/entitlements/snapshot.ts';
import type { EntitlementSnapshot, GrantedCapability, RegistryCapability } from '../../supabase/functions/_shared/entitlements/types.ts';
import { D14_REASON, countChecks, writeD14Evidence, type LegacyTenant } from './d14-evidence.mts';

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

// Sociedades SIN alta de MasterAdmin (seed y anteriores): siguen en legacy. Su decisión del
// agente se toma ahora y se compara al final (D-14 no puede cambiarla).
const AI_CODE = 'comerza.ai.whatsapp_agent';
const UNMAPPED = `from public.companies c
  where not exists (select 1 from operator.platform_provisionings p where p.internal_tenant_id = c.id and p.status = 'ACTIVE')`;
const unmappedDecisions = () => czDb.psql(db, `select coalesce(string_agg(c.id || ':' || (d ->> 'mode') || ':' || (d ->> 'source') || ':' || (d ->> 'commercial'), ',' order by c.id), '')
  from public.companies c cross join lateral (select operator.commercial_capability_decision(c.id, '${AI_CODE}') d) x
  where c.id in (select c.id ${UNMAPPED})`);
const unmappedBefore = unmappedDecisions();
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
const receiver = async (req: IncomingMessage, res: ServerResponse) => {
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
};
const server = createServer(receiver);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
let port = (server.address() as { port: number }).port;

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
async function emit(version: number, features: string[], appActive = true): Promise<EntitlementSnapshot> {
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
    appActive,
    planCode: null,
    registry,
    granted,
    allowancePeriod: { start: '2026-10-01', end: '2026-10-31' },
    aiCredits: { weights: [], weightsVersion: 0 },
    correlationId: crypto.randomUUID(),
  });
}

// Claims de servicio construidos, no escritos: el literal tiene la forma que el
// secrets-scan busca en JWT reales, y esto no es ningún token.
const SERVICE_CLAIMS = JSON.stringify({ role: 'service_role' });
const svcSql = (sql: string) =>
  czDb.psql(db, `begin; set local role service_role; set local request.jwt.claims = '${SERVICE_CLAIMS}'; ${sql}; commit;`);
const gate = (cap: string) => svcSql(`select public.comerza_has_capability('${COMPANY}', '${cap}')`) === 't';
const admit = () =>
  JSON.parse(svcSql(`select public.comerza_ai_admit('${COMPANY}', 'comerza.ai.whatsapp_agent', 'whatsapp_meta')`)) as Row;
const AI = 'comerza.ai.whatsapp_agent';

// ── Escenario ────────────────────────────────────────────────────────────────
const manifest = await client.getManifest(ctx(), actor);
check('2. MasterAdmin lee el manifiesto de Comerza (1 código ACTIVE; Vitrina y ERP DRAFT)',
  manifest.ok && manifest.activeCodes.length === 1 && manifest.activeCodes[0] === AI,
  manifest.ok ? `${manifest.manifestVersion} ${manifest.activeCodes.join(',')}` : manifest.errorCode);

// D-14 (COHORT): el tenant mapeado avanza a PRIMARY un paso por vez, con motivo, por la
// palanca gobernada (service_role). No se revierte en ningún punto del escenario.
const ORDER = ['LEGACY', 'SHADOW', 'DUAL_READ', 'PRIMARY'] as const;
const transitions: string[] = [];
const modeOf = (cpt: string | null) => czDb.psql(db, `select operator.entitlement_mode_for(${cpt ? `'${cpt}'` : 'null'})`);
function advanceToPrimary(cpt: string): boolean {
  for (let guard = 0; guard < ORDER.length; guard += 1) {
    const from = modeOf(cpt);
    if (from === 'PRIMARY') return true;
    const to = ORDER[ORDER.indexOf(from as (typeof ORDER)[number]) + 1];
    if (!to) return false;
    const r = JSON.parse(svcSql(`select public.platform_set_entitlement_enforcement_mode('${cpt}', '${to}', ${czDb.literal(D14_REASON)})`)) as { scope: string; from: string; to: string };
    transitions.push(`${r.scope}: ${r.from}→${r.to}`);
  }
  return modeOf(cpt) === 'PRIMARY';
}
const cptAdvanced = advanceToPrimary(CPT);
check('D14.0 tenant mapeado → PRIMARY un paso por vez, con motivo D-14 (el PRODUCTO sigue en SHADOW)',
  cptAdvanced && modeOf(null) === 'SHADOW' && transitions.every((t) => {
    const [, pair] = t.split(': ');
    const [a, b] = pair!.split('→');
    return ORDER.indexOf(b as (typeof ORDER)[number]) - ORDER.indexOf(a as (typeof ORDER)[number]) === 1;
  }), transitions.join(' · ') || 'ya estaba en PRIMARY');

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

// ── D14 · cutover gobernado de Comerza (DEV/LOCAL, sin reversión) ─────────────
// El receptor vuelve (otro puerto): la verificación final va por el GET M2M real.
const server2 = createServer(receiver);
await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', resolve));
port = (server2.address() as { port: number }).port;

// appActive=false retira lo comercial (el agente concedido deja de admitirse), no lo operativo.
const v4 = await emit(4, [AI], false);
const p4 = await client.pushSnapshot(ctx(), v4, actor);
const a4 = admit();
const commercialDenied = p4.result === 'APPLIED' && !gate(AI) && a4.allowed === false && a4.reason === 'APP_INACTIVA';
// Lo operativo no lee `app_active`: solo la decisión comercial (y el apply que lo guarda) lo usan,
// ninguna policy RLS lo mira, y la sociedad y su configuración siguen ahí.
const appActiveReaders = czDb.psql(db, `select coalesce(string_agg(distinct p.proname, ',' order by p.proname), '')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'operator', 'app') and p.prosrc ~ '\\mapp_active\\M'`);
const appActivePolicies = czDb.psql(db, `select count(*) from pg_policies
  where coalesce(qual, '') ~ '\\mapp_active\\M' or coalesce(with_check, '') ~ '\\mapp_active\\M'`);
const companyIntact = czDb.psql(db, `select count(*) from public.companies c join public.config_layers cl
  on cl.organization_id = c.organization_id and cl.company_id is null where c.id = '${COMPANY}'`);
const operationalContinues = appActiveReaders.split(',').every((f) => ['commercial_capability_decision', 'platform_apply_entitlements'].includes(f))
  && appActiveReaders.includes('commercial_capability_decision') && appActivePolicies === '0' && companyIntact === '1';
check('D14.1 appActive=false (v4 con el agente): lo comercial se retira (APP_INACTIVA); lo operativo no depende de app_active',
  commercialDenied && operationalContinues, `${p4.result} · ${String(a4.reason)} · lectores=${appActiveReaders} · policies=${appActivePolicies}`);

// Estado final: snapshot appActive=true con el agente.
const v5 = await emit(5, [AI]);
const p5 = await client.pushSnapshot(ctx(), v5, actor);
check('D14.2 v5 appActive=true vuelve a conceder el agente → APPLIED y admitido', p5.result === 'APPLIED' && gate(AI) && admit().allowed === true, p5.result);

// COHORT: todo tenant mapeado (alta ACTIVE de MasterAdmin) en PRIMARY, un paso por vez y con motivo.
// Cohorte (spec §15): solo altas que MasterAdmin sincronizó (snapshot aplicado). Las altas nunca
// sincronizadas (fixtures de las suites en la base desechable) quedan en el modo del PRODUCTO.
const cohortSql = (synced: boolean) => czDb.psql(db, `select coalesce(string_agg(p.control_plane_tenant_id::text, ',' order by p.control_plane_tenant_id), '')
  from operator.platform_provisionings p where p.status = 'ACTIVE' and p.internal_tenant_id is not null
   and ${synced ? '' : 'not '}exists (select 1 from operator.entitlement_snapshot_applied a where a.control_plane_tenant_id = p.control_plane_tenant_id)`).split(',').filter(Boolean);
const mapped = cohortSql(true);
const neverSynced = cohortSql(false);
const cohortErrors: string[] = [];
for (const cpt of mapped) {
  try {
    if (!advanceToPrimary(cpt)) cohortErrors.push(cpt);
  } catch (e) {
    cohortErrors.push(`${cpt}:${String((e as { stderr?: string }).stderr ?? e).split('\n')[0]}`);
  }
}
const mappedPrimary = mapped.filter((cpt) => modeOf(cpt) === 'PRIMARY').length;
const productScopeMode = modeOf(null);
check('D14.3 COHORT: todo tenant sincronizado por MasterAdmin en PRIMARY; el PRODUCTO sigue en SHADOW (lo heredan las sociedades sin alta)',
  cohortErrors.length === 0 && mapped.includes(CPT) && mappedPrimary === mapped.length && productScopeMode === 'SHADOW',
  `${mappedPrimary}/${mapped.length} · PRODUCT ${productScopeMode}${cohortErrors.length ? ` · ${cohortErrors.join(',')}` : ''}`);
check('D14.3b altas nunca sincronizadas: fuera de la cohorte, siguen en el modo del PRODUCTO (no se fuerzan)',
  neverSynced.every((cpt) => modeOf(cpt) !== 'PRIMARY'), `${neverSynced.length} altas sin snapshot`);

const gF = await client.getApplied(ctx(), actor);
const getOk = gF.result === 'OBSERVED' && gF.enforcementMode === 'PRIMARY' && gF.appliedVersion === 5
  && gF.appliedChecksum === v5.checksum && v5.appActive === true;
check('D14.4 GET final: PRIMARY, versión y checksum = último deseado (v5, appActive=true)', getOk,
  `${gF.result} v${gF.appliedVersion} ${gF.enforcementMode}`);

// Escritura legacy en el estado final. En Comerza la fuente legacy es `legacy_grant` (constante del
// producto) + los flags del tenant, que solo pueden APAGAR: los flags en true no conceden nada, y el
// tenant no puede tocar ni el modo, ni el snapshot aplicado, ni `legacy_grant`.
const decisionOf = (company: string, code: string) =>
  JSON.parse(czDb.psql(db, `select operator.commercial_capability_decision('${company}', '${code}')`)) as Row;
const flagsOn = czDb.psql(db, `select concat_ws('|', config -> 'features' ->> 'vitrina', config -> 'features' ->> 'erp_connector')
  from public.config_layers where organization_id = '${ORG}' and company_id is null`);
const dStore = decisionOf(COMPANY, 'comerza.storefront');
const flagsDoNotGrant = flagsOn === 'true|true' && !gate('comerza.storefront') && !gate('comerza.erp_connector')
  && dStore.source === 'SNAPSHOT' && dStore.commercial === false;
const asTenant = (sql: string) => {
  try {
    czDb.psql(db, `begin; set local role authenticated; ${sql}; commit;`);
    return 'PERMITIDO';
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? '').split('\n')[0] ?? '';
  }
};
const tenantWrites = [
  asTenant(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'DUAL_READ', 'tenant')`),
  asTenant(`update operator.entitlement_snapshot_applied set app_active = true where control_plane_tenant_id = '${CPT}'`),
  asTenant(`update operator.entitlement_capabilities set legacy_grant = true where code = 'comerza.storefront'`),
];
const tenantWritesDenied = tenantWrites.every((w) => /permission denied/i.test(w));
const legacyBlocked = flagsDoNotGrant && tenantWritesDenied && modeOf(CPT) === 'PRIMARY';
check('D14.5 estado final: el camino legacy no concede (flags del tenant en true → sin Vitrina/ERP) y el tenant no escribe modo, snapshot ni legacy_grant',
  legacyBlocked, `flags=${flagsOn} · ${tenantWrites.map((w) => (/permission denied/i.test(w) ? 'denegado' : w)).join(' / ')}`);

const unmappedAfter = unmappedDecisions();
check('D14.6 sociedades sin alta de MasterAdmin: misma decisión que antes (SHADOW · LEGACY · agente por legacy_grant)',
  unmappedAfter !== '' && unmappedAfter === unmappedBefore && unmappedAfter.split(',').every((e) => e.endsWith(':SHADOW:LEGACY:true')),
  unmappedAfter);

const parityMismatches = v5.capabilities.filter((c) => decisionOf(COMPANY, c.code).commercial !== c.enabled).map((c) => c.code);
check('D14.7 paridad: decisión comercial local = snapshot v5 en cada capacidad ACTIVE', v5.capabilities.length > 0 && parityMismatches.length === 0,
  parityMismatches.join(',') || 'sin diferencias');

const legacyTenants: LegacyTenant[] = czDb.psql(db, `select coalesce(string_agg(c.id || '|' || replace(c.name, '|', '/'), chr(10) order by c.name), '') ${UNMAPPED}`)
  .split('\n').filter(Boolean).map((line) => {
    const [id, ...label] = line.split('|');
    return {
      id: id!,
      label: label.join('|'),
      resolution: 'UNRESOLVED' as const,
      reason: 'Sin alta en operator.platform_provisionings ni evidencia determinista de plan/precio/cupo/add-on (D-14 regla 4): '
        + 'sigue en legacy (legacy_grant) bajo el modo del PRODUCTO (SHADOW).',
    };
  });

server2.close();
server2.closeAllConnections();

const counts = countChecks(results);
const evidenceFile = writeD14Evidence({
  product: 'comerza',
  entitlements: {
    scope: 'COHORT',
    productScopeMode,
    finalMode: gF.enforcementMode ?? 'NONE',
    transitions,
    mappedTenants: mapped.length,
    mappedTenantsPrimary: mappedPrimary,
    excludedFromCohort: neverSynced.map((id) => ({ id, reason: 'alta ACTIVE sin snapshot aplicado: MasterAdmin nunca la sincronizó; queda en el modo del PRODUCTO (SHADOW)' })),
    getVerified: { appliedVersion: gF.appliedVersion ?? -1, appliedChecksum: gF.appliedChecksum ?? '', enforcementMode: gF.enforcementMode ?? 'NONE', desiredChecksum: v5.checksum },
    legacyWrite: {
      // Sin prueba no se declara BLOCKED: el valor fuera del contrato hace fallar a quien lo lea.
      status: (legacyBlocked ? 'BLOCKED' : 'NOT_PROVEN') as 'BLOCKED',
      evidence: 'D14.5 (estado final PRIMARY): flags del tenant vitrina/erp_connector=true en config_layers no conceden (decisión SNAPSHOT, commercial=false); '
        + 'el rol authenticated recibe permission denied al fijar el modo y al escribir operator.entitlement_snapshot_applied y '
        + 'operator.entitlement_capabilities.legacy_grant; check 15: los flags no reviven un agente revocado.',
    },
    parityBlocking: parityMismatches.length,
  },
  appActiveFalse: {
    commercialDenied,
    operationalContinues,
    evidence: `D14.1: v4 appActive=false con el agente → comerza_ai_admit reason=${String(a4.reason)}; app_active solo lo leen `
      + `${appActiveReaders || '(nadie)'}; policies RLS que lo leen=${appActivePolicies}; sociedad y configuración intactas.`,
  },
  legacyTenants,
  billing: null,
  checks: counts,
});
console.log(evidenceFile ? `evidencia D-14: ${evidenceFile}` : 'evidencia D-14: sin CCP_EVIDENCE_DIR, no se escribe');

console.log(`\n${counts.passed}/${results.length} PASS`);
