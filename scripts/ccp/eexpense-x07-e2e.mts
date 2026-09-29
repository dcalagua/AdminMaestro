/**
 * E2E LOCAL de la fase 15 (X-07): MasterAdmin REAL → eExpense REAL.
 *
 *   EEXPENSE_WT=<worktree del programa en eExpenses> \
 *   EEXPENSE_DB_CONTAINER=<contenedor supabase_db_* del stack LOCAL desechable de eExpense> \
 *     node --experimental-transform-types scripts/ccp/eexpense-x07-e2e.mts
 *
 * Del lado MasterAdmin corre el código de producción: el emisor `buildSnapshot` y el cliente M2M
 * `EntitlementSyncClient` (JWT ES256 firmado con una clave generada EN MEMORIA, scopes de
 * entitlements, jti nuevo por intento, clasificación de respuestas).
 *
 * Del lado eExpense corre su receptor de producción: `handleEntitlementsRequest` (lo que despacha
 * `platform-provisioning/index.ts`) servido por node:http, con su store real sobre las RPC reales de
 * la base DESECHABLE (cadena completa de migraciones), llamadas con el rol service_role de verdad. La
 * puerta comercial (`eexpense_capacidad_activa` / `eexpense_admitir_ia`, y `runCommercialAi`, el
 * mismo núcleo de las 9 funciones IA), el outbox de uso, la paridad (`eexpense_paridad_comercial` +
 * `commercialParity.ts`) y el eje de facturación (`billing-run/core.ts` con pasarelas FALSAS que
 * cuentan) se ejercitan contra esa base.
 *
 * El tenant se da de alta con la RPC de provisioning REAL de eExpense. Sin red externa, sin pasarelas
 * reales, sin proyectos remotos. No imprime claves ni tokens.
 *
 * Fase 18 · D-14 (DEV/LOCAL): la fase final D14 NO se revierte y el tenant NO se borra al final (se
 * limpia al empezar, para poder repetir). Entitlements → PRIMARY (PRODUCT + tenant; los tenants sin
 * alta siguen LEGACY), facturación → SHADOW con el dataset SINTÉTICO `fixtures/d14-billing-cert.json`
 * (plan de certificación propio en la base desechable + suscripción SANDBOX en MasterAdmin LOCAL (regla §2.2: DEMO no admite contrato recurrente activo; SANDBOX es no productivo y no facturable por uso, INV-7),
 * SUPABASE_DB_URL). La comparación la calcula MasterAdmin (`platform.record_billing_shadow_comparison`)
 * y eExpense guarda ese resultado (`eexpense_record_masteradmin_billing_comparison`), nunca un literal.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { advanceAxis, axisState, ensureCcpIntegration, FINANCE, maDbUrl, maSql } from './d14-masteradmin.mts';
import { countChecks, D14_REASON, writeD14Evidence, type D14Evidence, type LegacyTenant } from './d14-evidence.mts';
import { EntitlementSyncClient, type EntitlementDeliveryContext } from '../../supabase/functions/_shared/entitlements/sync-client.ts';
import { buildSnapshot } from '../../supabase/functions/_shared/entitlements/snapshot.ts';
import type { EntitlementSnapshot, GrantedCapability, RegistryCapability } from '../../supabase/functions/_shared/entitlements/types.ts';

const WT = process.env.EEXPENSE_WT ?? '';
if (!WT.endsWith('/eExpenses/.worktrees/ebim-commercial-control-plane-v1')) {
  console.error('HARD STOP: EEXPENSE_WT debe apuntar al worktree del programa en eExpenses');
  process.exit(2);
}
const container = process.env.EEXPENSE_DB_CONTAINER ?? '';
if (!/^supabase_db_eexpense-ccp/.test(container)) {
  console.error('HARD STOP: EEXPENSE_DB_CONTAINER debe nombrar el contenedor LOCAL desechable (supabase_db_eexpense-ccp*)');
  process.exit(2);
}

try { maDbUrl(); } catch (e) {
  console.error(String((e as Error).message), '(la fase D14 compara contra MasterAdmin LOCAL: SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres)');
  process.exit(2);
}

type Row = Record<string, unknown>;
const exHandler = (await import(`${WT}/supabase/functions/_shared/entitlements/handler.ts`)) as {
  handleEntitlementsRequest(req: Request, deps: Row): Promise<Response>;
};
const exConfig = (await import(`${WT}/supabase/functions/_shared/entitlements/config.ts`)) as {
  resolveEntitlementsConfig(env: Row, provisioning: Row | null): { ok: boolean };
};
const exStore = (await import(`${WT}/supabase/functions/_shared/entitlements/store.ts`)) as {
  createEntitlementsStore(client: unknown): unknown;
};
const exM2m = (await import(`${WT}/supabase/functions/_shared/platformM2M.ts`)) as {
  loadM2MConfig(env: { get(k: string): string | undefined }): Row | null;
  importMasterAdminPublicKey(b64: string): Promise<CryptoKey>;
};
const exParidad = (await import(`${WT}/supabase/functions/_shared/commercialParity.ts`)) as {
  renderParityReport(rows: unknown[], meta: { generatedAt: string; environment: string }): string;
};
const exAi = (await import(`${WT}/supabase/functions/_shared/commercialAi.ts`)) as {
  AI_SPEC: Record<string, { capability: string; subject: string }>;
  runCommercialAi(req: Request, actor: Row, deps: Row, spec: Row, cors: Row,
    handler: (r: Request, a: Row, m: { attempt(p: string, m: string): void; result(u: unknown): void }) => Promise<Response>): Promise<Response>;
};
const exBilling = (await import(`${WT}/supabase/functions/billing-run/core.ts`)) as {
  runBilling(input: Row, ports: Row): Promise<Row>;
};

const results: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} · ${label}${detail ? ` · ${detail}` : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) process.exitCode = 1;
}

// ── La base desechable de eExpense, por docker exec (sin puertos, sin claves) ──
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
  async rpc(fn: string, args: Row = {}) {
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
const failsWith = (fn: () => unknown, re: RegExp) => {
  try { fn(); return false; } catch (e) { return re.test(String((e as { stderr?: string }).stderr)); }
};

// ── Claves en memoria ────────────────────────────────────────────────────────
const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const privatePem = [`-----BEGIN ${'PRIVATE'} KEY-----`, pkcs8, `-----END ${'PRIVATE'} KEY-----`].join('\n');
const spki = Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
const publicKeyB64 = Buffer.from(`-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----\n`).toString('base64');

// ── eExpense: alta REAL, estado legacy, receptor HTTP ─────────────────────────
const CPT = '9f150000-0000-4000-8000-000000000001';
const TEN = '9f150000-0000-4000-8000-0000000000aa';
const CO = '9f150000-0000-4000-8000-0000000000cc';
// Limpieza AL EMPEZAR (la fase D14 deja su estado final a propósito). Si una corrida anterior dejó el
// PRODUCT en PRIMARY, se rebobina con la misma RPC gobernada (un paso por vez, con motivo).
const productMode = () => psql(`select mode from private.platform_entitlement_enforcement_mode where scope_key = 'PRODUCT'`);
for (const back of ['DUAL_READ', 'SHADOW']) {
  const cur = productMode();
  if (cur === 'PRIMARY' || (cur === 'DUAL_READ' && back === 'SHADOW')) {
    svcSql(`select public.platform_set_entitlement_enforcement_mode('PRODUCT', '${back}', 'x07: preparar corrida repetida (D-14)')`);
  }
}
psql(`
  delete from private.platform_entitlement_enforcement_mode where scope_key = '${CPT}';
  delete from private.platform_provisioning_requests where control_plane_tenant_id = '${CPT}';
  delete from public.tenants where id = '${TEN}';`);
const alta = svcSql(`select public.platform_provision_tenant(${literal({
  controlPlaneTenantId: CPT,
  tenant: { id: TEN, slug: 'x07-eexpense', name: 'X07 eExpense', legalName: 'X07 eExpense S.A.C.', taxId: '20999999991',
    primaryCountry: 'PE', defaultCurrency: 'PEN' },
  company: { id: CO, code: 'X07-PE', name: 'X07 eExpense', legalName: 'X07 eExpense', countryCode: 'PE', currency: 'PEN',
    taxId: '20999999992' },
  admin: { email: 'x07@eexpense.ebim.test' }, deploymentMode: 'SHARED', context: { environment: 'DEV' } })}::jsonb, ${literal({
  idempotencyKey: 'ma-prov-v1-x07-eexpense', requestHash: 'a'.repeat(64), correlationId: crypto.randomUUID(),
  m2mSubject: 'masteradmin-provisioning', m2mJti: 'x07-alta' })}::jsonb) ->> 'outcome'`);
// Legacy: el operador EBIM activó conciliación y fraude por la consola (`tenant_addons`).
psql(`insert into public.tenant_addons (tenant_id, addon_id, enabled)
      select '${TEN}', id, true from public.addons where code in ('card_reconcile', 'fraud_vision');`);
const has = (code: string) =>
  (JSON.parse(svcSql(`select public.eexpense_capacidad_activa('${TEN}', '${code}')`)) as { allowed: boolean }).allowed;
check('0. alta real de eExpense (CREATED); en SHADOW decide legacy (fraude sí; IA sin puerta previa sí; marca blanca no)',
  alta === 'CREATED' && has('eexpense.fraud_vision') && has('eexpense.ai_copilot') && !has('eexpense.white_label'), alta);

const envMap: Record<string, string> = {
  EBIM_MASTERADMIN_M2M_ENABLED: 'true',
  EBIM_MASTERADMIN_M2M_ISSUER: 'masteradmin.ebim',
  EBIM_MASTERADMIN_M2M_AUDIENCE: 'eexpense.ebim',
  EBIM_MASTERADMIN_M2M_SUBJECT: 'masteradmin-provisioning',
  EBIM_MASTERADMIN_M2M_ALGORITHM: 'ES256',
  EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME: '300',
  EBIM_MASTERADMIN_M2M_CREATE_SCOPE: 'eexpense:tenant:create',
  EBIM_MASTERADMIN_M2M_READ_SCOPE: 'eexpense:tenant:read',
  EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64: publicKeyB64,
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_WRITE_SCOPE: 'eexpense:entitlements:write',
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_READ_SCOPE: 'eexpense:entitlements:read',
  EBIM_ENTITLEMENTS_ENVIRONMENT: 'DEV',
};
const m2m = exM2m.loadM2MConfig({ get: (k) => envMap[k] });
const receiverConfig = exConfig.resolveEntitlementsConfig(envMap, m2m);
check('1. receptor eExpense configurado (fail-closed si faltara algo; sujeto M2M exacto)', m2m !== null && receiverConfig.ok);
const receiverKey = await exM2m.importMasterAdminPublicKey(publicKeyB64);

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
  const response = await exHandler.handleEntitlementsRequest(request, {
    m2m,
    publicKey: async () => receiverKey,
    config: receiverConfig,
    openStore: () => exStore.createEntitlementsStore(rpc),
    log: () => {},
  });
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(await response.text());
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
let port = (server.address() as { port: number }).port;

// ── MasterAdmin: contexto de entrega (lo que leería de product_integrations) ─
const SECRET_REF = 'LOCAL_X07_EEXPENSE_M2M_PRIVATE_KEY';
const TIMEOUT_MS = 120_000; // cada RPC del receptor va por docker exec: se mide el contrato, no la latencia del puente.
const ctx = (writeScope = 'eexpense:entitlements:write'): EntitlementDeliveryContext => ({
  tenant: { controlPlaneTenantId: CPT, productCode: 'eexpense' },
  push_enabled: true,
  enrollment: 'ENROLLED',
  deployment: { id: 'x07', environment: 'DEV', base_url: `http://127.0.0.1:${port}/functions/v1/platform-provisioning`, timeout_ms: TIMEOUT_MS, retry_count: 0 },
  integration: {
    id: 'x07-int',
    type: 'HTTP_M2M',
    issuer: 'masteradmin.ebim',
    audience: 'eexpense.ebim',
    subject: 'masteradmin-provisioning',
    algorithm: 'ES256',
    token_ttl_seconds: 120,
    entitlements_path: '/tenants/{controlPlaneTenantId}/entitlements',
    entitlements_manifest_path: '/entitlements/manifest',
    entitlements_write_scope: writeScope,
    entitlements_read_scope: 'eexpense:entitlements:read',
    allowed_hosts: [],
  },
  credential: { id: 'x07-cred', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: SECRET_REF },
});
const client = new EntitlementSyncClient({
  secretResolver: (ref) => (ref === SECRET_REF ? privatePem : undefined),
  sleep: async () => {},
});
const actor = { id: '10000000-0000-4000-a000-000000000002', role: 'EBIM_FINANCE' };

// Registro de MasterAdmin = manifiesto importado de eExpense (import_capability_manifest).
const manifestFile = JSON.parse(readFileSync(`${WT}/docs/platform-provisioning/ENTITLEMENTS_MANIFEST.json`, 'utf8')) as {
  capabilities: { code: string; kind: RegistryCapability['kind']; isBaseline: boolean; scopeLevel: 'TENANT' | 'COMPANY';
    unit?: string; meterCode?: string; status: RegistryCapability['status'] }[];
};
const registry: RegistryCapability[] = manifestFile.capabilities.map((c) => ({
  code: c.code, kind: c.kind, isBaseline: c.isBaseline, scopeLevel: c.scopeLevel,
  unit: c.unit ?? null, meterCode: c.meterCode ?? null, status: c.status,
}));

let clock = Date.parse('2026-10-08T00:00:00Z');
async function emit(version: number, features: string[], appActive = true, planCode: string | null = 'pro'): Promise<EntitlementSnapshot> {
  const granted: GrantedCapability[] = features.map((code) => ({ code, value: null, enforcement: null, included: null, sources: ['ADDON'], companyIds: null }));
  clock += 60_000;
  return buildSnapshot({
    environment: 'DEV',
    controlPlaneTenantId: CPT,
    productCode: 'eexpense',
    external: { tenantId: TEN, organizationId: null, companyIds: [CO] },
    snapshotVersion: version,
    previousVersion: version > 1 ? version - 1 : null,
    effectiveAt: new Date(clock - 1000).toISOString(),
    issuedAt: new Date(clock).toISOString(),
    appActive,
    planCode,
    registry,
    granted,
    allowancePeriod: { start: '2026-10-01', end: '2026-10-31' },
    aiCredits: { weights: [], weightsVersion: 0 },
    correlationId: crypto.randomUUID(),
  });
}

const CONCILIA = 'eexpense.card_reconcile';
const FRAUDE = 'eexpense.fraud_vision';
const COPILOTO = 'eexpense.ai_copilot';

// Biller local con pasarelas FALSAS que cuentan: ninguna llamada real.
const gateway = { calls: 0 };
async function billingRun(period: string) {
  const authorities = JSON.parse(svcSql('select public.eexpense_billing_authorities()')) as Row;
  const plans = JSON.parse(psql(`select json_agg(p) from public.plans p`)) as Row[];
  const tenantAddons = JSON.parse(psql(`select coalesce(json_agg(json_build_object('tenant_id', ta.tenant_id,
      'addons', json_build_object('code', a.code, 'name', a.name, 'price', a.price, 'tier', a.tier))), '[]')
    from public.tenant_addons ta join public.addons a on a.id = ta.addon_id where ta.tenant_id = '${TEN}' and ta.enabled`)) as Row[];
  const existing = JSON.parse(psql(`select coalesce(json_agg(json_build_object('id', id, 'tenant_id', tenant_id, 'status', status)), '[]')
    from public.invoices where tenant_id = '${TEN}' and period = '${period}'`)) as Row[];
  return exBilling.runBilling({
    period, cfg: { enabled: true, mode: 'auto', provider: 'culqi', secret_key: 'x07-fake', currency: 'USD' }, plans,
    tenants: JSON.parse(psql(`select json_agg(json_build_object('id', id, 'name', name, 'plan', plan, 'billing_mode', 'live'))
                               from public.tenants where id = '${TEN}'`)) as Row[], tenantAddons,
    paymentMethods: [{ tenant_id: TEN, card_token: 'tok_x07_fake' }], existing, authorities,
  }, {
    insertInvoice: async (row: Row) => {
      const out = psql(`insert into public.invoices (tenant_id, period, amount, currency, status, line_items)
        values ('${TEN}', ${literal(row.period)}, ${Number(row.amount)}, ${literal(row.currency)}, 'pending', ${literal(row.line_items)}::jsonb)
        returning json_build_object('id', id, 'tenant_id', tenant_id, 'status', status)`);
      return JSON.parse(out);
    },
    markPaid: async () => {},
    markFailed: async () => {},
    chargeCulqi: async () => { gateway.calls++; return { ok: true, ref: 'chr_x07_fake' }; },
    chargeStripe: async () => { gateway.calls++; return { ok: true, ref: 'ch_x07_fake' }; },
    recordShadow: async (tenantId: string, p: string, local: Row) => {
      const r = await rpc.rpc('eexpense_record_billing_shadow', { p_tenant_id: tenantId, p_period: p, p_local: local });
      if (r.error) throw new Error('shadow');
    },
  });
}

// ── Escenario ────────────────────────────────────────────────────────────────
const manifest = await client.getManifest(ctx(), actor);
check('2. MasterAdmin lee el manifiesto (8 vendibles + 3 incluidos ACTIVE; módulos solo-UI, límite y créditos DRAFT)',
  manifest.ok && manifest.activeCodes.length === 11 && !manifest.activeCodes.includes('eexpense.caja')
    && !manifest.activeCodes.includes('eexpense.users.max') && !manifest.activeCodes.includes('eexpense.ai.credits'),
  manifest.ok ? `${manifest.manifestVersion} · ${manifest.activeCodes.length} ACTIVE` : manifest.errorCode);

const v1 = await emit(1, [CONCILIA]);
check('3. el snapshot lista las 8 vendibles ACTIVE con enabled explícito, sin DRAFT ni baseline, sin precios',
  v1.capabilities.length === 8 && v1.capabilities.filter((c) => c.enabled).map((c) => c.code).join() === CONCILIA
    && !/price|amount|currency|monthly/i.test(JSON.stringify(v1)));
const p1 = await client.pushSnapshot(ctx(), v1, actor);
check('4. emisor real → PUT M2M real → APPLIED (en SHADOW: guarda y compara)', p1.result === 'APPLIED' && p1.appliedVersion === 1, `${p1.result} ${p1.httpStatus}`);
check('5. SHADOW no cambia la decisión: fraude sigue permitido por legacy', has(FRAUDE));
const diffs = psql(`select string_agg(capability_code, ',' order by capability_code) from private.platform_entitlement_shadow_diffs
                     where control_plane_tenant_id = '${CPT}' and snapshot_version = 1`);
check('6. SHADOW registra la diferencia legacy vs snapshot (fraude)', diffs.split(',').includes(FRAUDE), diffs);

const par1 = JSON.parse(svcSql(`select public.eexpense_paridad_comercial('${TEN}')`)) as Row[];
check('7. paridad local vs MasterAdmin: ADDON_ONLY_LOCAL fraud_vision → sin paridad; reporte sin precios',
  par1[0].paridad === false && JSON.stringify(par1[0].diferencias).includes('ADDON_ONLY_LOCAL')
    && !/price|precio|amount|USD/i.test(exParidad.renderParityReport(par1, { generatedAt: 'x07', environment: 'LOCAL' })));

// Eje de facturación: SHADOW calcula y compara, nunca cobra; sin paridad no hay MASTERADMIN_AUTHORITY.
svcSql(`select public.eexpense_set_billing_authority('${TEN}', 'SHADOW', 'x07')`);
const run1 = await billingRun('2026-10');
check('8. billing SHADOW: calcula y guarda la corrida, sin factura ni pasarela',
  run1.shadow === 1 && run1.generated === 0 && gateway.calls === 0
    && psql(`select count(*) from public.invoices where tenant_id = '${TEN}'`) === '0', JSON.stringify(run1));
check('9. paridad en rojo: MASTERADMIN_AUTHORITY bloqueado por la base',
  failsWith(() => svcSql(`select public.eexpense_set_billing_authority('${TEN}', 'MASTERADMIN_AUTHORITY', 'x07')`),
    /BILLING_AUTHORITY_BLOCKED: ENTITLEMENT_PARITY_NOT_GREEN/));

svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'DUAL_READ', 'x07')`);
svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'PRIMARY', 'x07')`);
const g1 = await client.getApplied(ctx(), actor);
check('10. GET: misma versión y checksum, PRIMARY', g1.result === 'OBSERVED' && g1.appliedVersion === 1
  && g1.appliedChecksum === v1.checksum && g1.enforcementMode === 'PRIMARY', `${g1.appliedVersion} ${g1.enforcementMode}`);
check('11. PRIMARY: decide el snapshot — fraude negado aunque tenant_addons lo tenga; conciliación e incluidos sí',
  !has(FRAUDE) && has(CONCILIA) && has('eexpense.ai_capture') && has('eexpense.cfo_insights') && !has(COPILOTO));

// La misma puerta que usan las 9 funciones IA (runCommercialAi), con un "proveedor" falso.
let providerCalls = 0;
const aiCall = (spec: string) => exAi.runCommercialAi(
  new Request(`http://x07/${spec}`, { method: 'POST', body: '{}' }),
  { userId: 'x07-user', email: null, tenantId: TEN, isAdmin: false, isSuperAdmin: false },
  { rpc, newUuid: () => crypto.randomUUID() }, exAi.AI_SPEC[spec], {},
  async (_r, _a, meter) => {
    meter.attempt('anthropic', 'claude-sonnet-4-6');
    providerCalls++;
    meter.result({ input_tokens: 321, output_tokens: 45 });
    return new Response('{"ok":true}', { status: 200 });
  });
const denied = await aiCall('fraud-check');
check('12. función IA con capacidad negada → 403 y el proveedor NO se invoca; nada se mide',
  denied.status === 403 && providerCalls === 0
    && psql(`select count(*) from private.usage_outbox where tenant_id = '${TEN}'`) === '0', `${denied.status}`);

const v2 = await emit(2, [CONCILIA, FRAUDE]);
const p2 = await client.pushSnapshot(ctx(), v2, actor);
check('13. v2 concede conciliación + fraude → APPLIED; la puerta lo ve', p2.result === 'APPLIED' && has(FRAUDE), p2.result);
const allowed = await aiCall('fraud-check');
const uso = psql(`select control_plane_tenant_id || '|' || meter_code || '|' || billable || '|' || status || '|' ||
                          (internal ->> 'inputTokens') || '|' || (internal ? 'prompt')
                     from private.usage_outbox where tenant_id = '${TEN}'`);
check('14. función IA permitida → proveedor invocado una vez y UN evento en el outbox (tokens reales, no facturable, sin contenido)',
  allowed.status === 200 && providerCalls === 1 && uso === `${CPT}|eexpense.ai.calls|false|PENDING|321|false`, uso);
const p2r = await client.pushSnapshot(ctx(), v2, actor);
check('15. replay idempotente → REPLAYED', p2r.result === 'REPLAYED' && p2r.appliedVersion === 2, p2r.result);
const stale = await client.pushSnapshot(ctx(), v1, actor);
check('16. v1 tras v2 → STALE (409)', stale.result === 'STALE' && stale.httpStatus === 409 && stale.appliedVersion === 2, `${stale.result} ${stale.errorCode}`);
clock -= 60_000;
const v2b = await emit(2, []);
const conflict = await client.pushSnapshot(ctx(), v2b, actor);
check('17. misma versión, otro contenido → CONFLICT (409)', conflict.result === 'CONFLICT' && conflict.httpStatus === 409, `${conflict.result} ${conflict.errorCode}`);
const wrong = await client.pushSnapshot(ctx('eexpense:tenant:create'), v2, actor);
check('18. credencial con scope de provisioning → 403 REJECTED', wrong.result === 'REJECTED' && wrong.httpStatus === 403 && wrong.errorCode === 'INSUFFICIENT_SCOPE', `${wrong.httpStatus} ${wrong.errorCode}`);
check('19. PRIMARY: una escritura legacy de add-ons queda bloqueada en servidor',
  failsWith(() => psql(`insert into public.tenant_addons (tenant_id, addon_id, enabled)
                        select '${TEN}', id, true from public.addons where code = 'ai_close'`), /LEGACY_WRITE_BLOCKED/));

// Paridad verde → la corrida SHADOW nueva también → MasterAdmin puede pasar a ser el cobrador.
const par2 = JSON.parse(svcSql(`select public.eexpense_paridad_comercial('${TEN}')`)) as Row[];
const run2 = await billingRun('2026-10');
const shadowOk = psql(`select paridad from private.billing_shadow_runs where tenant_id = '${TEN}' order by id desc limit 1`);
check('20. modelo local = MasterAdmin (paridad) y la corrida SHADOW nueva cuadra ítem por ítem',
  par2[0].paridad === true && run2.shadow === 1 && shadowOk === 't' && gateway.calls === 0, JSON.stringify(par2[0].diferencias));
check('21. D-14: con la paridad local verde, MASTERADMIN_AUTHORITY sigue bloqueado sin la comparación calculada por MasterAdmin',
  failsWith(() => svcSql(`select public.eexpense_set_billing_authority('${TEN}', 'MASTERADMIN_AUTHORITY', 'x07')`),
    /BILLING_AUTHORITY_BLOCKED: MASTERADMIN_COMPARISON_MISSING/));
svcSql(`select public.eexpense_set_billing_authority('${TEN}', 'LEGACY_AUTHORITY', 'x07 rollback')`);
check('22. rollback del eje de facturación a LEGACY_AUTHORITY (un paso)',
  psql(`select state from private.billing_authority where tenant_id = '${TEN}'`) === 'LEGACY_AUTHORITY');

// SaaS caído: MasterAdmin reintenta después; eExpense sigue con su last-good.
saasUp = false;
const v3 = await emit(3, [CONCILIA], false);
const down = await client.pushSnapshot(ctx(), v3, actor);
check('23. SaaS no disponible → RETRYABLE, nada aplicado', down.result === 'RETRYABLE', `${down.result} ${down.httpStatus}`);
saasUp = true;
const drift = await client.getApplied(ctx(), actor);
check('24. reconciliación: el GET delata deriva (aplicado v2 ≠ deseado v3)', drift.appliedVersion === 2 && drift.appliedChecksum !== v3.checksum);

// MasterAdmin inalcanzable: la puerta NO depende de él.
server.close();
check('25. offline: sin MasterAdmin ni receptor HTTP, la puerta sigue con el last-good v2', has(FRAUDE) && has(CONCILIA) && !has(COPILOTO));

// v3 (appActive=false) por la misma RPC: se retira todo lo comercial.
const p3 = await rpc.rpc('platform_apply_entitlements', {
  p_control_plane_tenant_id: CPT, p_snapshot: v3,
  p_meta: { correlationId: 'x07-v3', m2mSubject: 'masteradmin-provisioning', m2mJti: 'x07-v3' },
});
check('26. v3 appActive=false (D-14 regla 2): conciliación y fraude retirados; el baseline (ai_capture) y el núcleo siguen',
  (p3.data as { httpStatus?: number } | null)?.httpStatus === 200 && !has(CONCILIA) && !has(FRAUDE) && has('eexpense.ai_capture')
    && has('eexpense.cfo_insights'));

// Volver a SHADOW: decide legacy otra vez (sin nada que restaurar: el snapshot no se materializa).
svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'DUAL_READ', 'x07 rollback')`);
svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'SHADOW', 'x07 rollback')`);
check('27. rollback PRIMARY → DUAL_READ → SHADOW: legacy intacto (fraude sí por tenant_addons)', has(FRAUDE) && has(CONCILIA));

// ── D14 · estado final gobernado (DEV/LOCAL), SIN rollback ───────────────────
const CERT = JSON.parse(readFileSync(new URL('./fixtures/d14-billing-cert.json', import.meta.url), 'utf8'));
const EC = CERT.products.eexpense;
const PERIOD: string = CERT.period;
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
const CERT_PLAN: string = EC.local.plan.code;
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
port = (server.address() as { port: number }).port;

// a. Biller local configurado con el dataset SINTÉTICO: plan propio de certificación (base desechable; los planes
//    reales no se tocan) y ningún add-on premium activo. En SHADOW de entitlements la escritura legacy se permite.
psql(`insert into public.plans (code, name, monthly_price, currency) values (${lit(CERT_PLAN)}, ${lit(EC.local.plan.name)},
        ${Number(EC.local.plan.monthlyPrice)}, ${lit(EC.local.plan.currency)}) on conflict (code) do nothing`);
const certPlanRow = psql(`select monthly_price || '|' || currency from public.plans where code = ${lit(CERT_PLAN)}`);
psql(`update public.tenants set plan = ${lit(CERT_PLAN)} where id = '${TEN}';
      update public.tenant_addons set enabled = false where tenant_id = '${TEN}' and enabled;`);
const v4 = await emit(4, [], true, CERT_PLAN);
const p4 = await client.pushSnapshot(ctx(), v4, actor);
const parD14 = JSON.parse(svcSql(`select public.eexpense_paridad_comercial('${TEN}')`)) as Row[];
check('D14.1 dataset sintético en la base desechable (plan de certificación) + v4 (plan de certificación, sin vendibles) → paridad verde',
  certPlanRow === `${Number(EC.local.plan.monthlyPrice).toFixed(2)}|${EC.local.plan.currency}` && p4.result === 'APPLIED' && parD14[0].paridad === true,
  JSON.stringify(parD14[0].diferencias));

// b. Legacy sin mapping (seed `demo` y cualquier otro): su decisión NO cambia con PRODUCT=PRIMARY.
const unmapped = JSON.parse(psql(`select coalesce(json_agg(json_build_object('id', t.id, 'slug', t.slug) order by t.slug), '[]')
  from public.tenants t where not exists (select 1 from private.platform_provisioning_requests r
                                           where r.external_tenant_id = t.id and r.status = 'ACTIVE')`)) as { id: string; slug: string }[];
const PROBE = [CONCILIA, FRAUDE, COPILOTO, 'eexpense.white_label', 'eexpense.ai_capture', 'eexpense.cfo_insights'];
const decisions = (tid: string) => PROBE.map((c) => {
  const d = JSON.parse(svcSql(`select public.eexpense_capacidad_activa('${tid}', '${c}')`)) as { allowed: boolean; mode: string };
  return `${c}=${d.allowed}/${d.mode}`;
}).join(',');
const legacyBefore = unmapped.map((t) => decisions(t.id));

// c. Transición gobernada: PRODUCT y el tenant, SHADOW → DUAL_READ → PRIMARY, un paso por vez con motivo D-14.
const d14Transitions: string[] = [];
for (const scope of ['PRODUCT', CPT]) {
  for (const to of ['DUAL_READ', 'PRIMARY']) {
    const r = JSON.parse(svcSql(`select public.platform_set_entitlement_enforcement_mode('${scope}', '${to}', ${lit(D14_REASON)})`)) as Row;
    d14Transitions.push(`${scope === 'PRODUCT' ? 'PRODUCT' : 'tenant'}:${r.from}->${r.to}`);
  }
}
const legacyAfter = unmapped.map((t) => decisions(t.id));
check('D14.2 PRODUCT y tenant → PRIMARY (un paso por vez); los tenants sin alta siguen LEGACY con la misma decisión',
  productMode() === 'PRIMARY' && unmapped.length >= 1 && legacyBefore.join(';') === legacyAfter.join(';')
    && legacyAfter.every((d) => d.split(',').every((x) => x.endsWith('/LEGACY'))),
  `${d14Transitions.join(',')} · sin alta: ${unmapped.map((t) => t.slug).join(',')}`);
const legacyBlocked = failsWith(() => psql(`insert into public.tenant_addons (tenant_id, addon_id, enabled)
                                            select '${TEN}', id, true from public.addons where code = 'ai_close'`), /LEGACY_WRITE_BLOCKED/);
check('D14.3 PRIMARY: la escritura legacy de add-ons (tenant_addons) queda bloqueada en servidor', legacyBlocked);

// d. Facturación → SHADOW y corrida REAL del biller local (pasarelas falsas): calcula, no factura ni cobra.
svcSql(`select public.eexpense_set_billing_authority('${TEN}', 'SHADOW', ${lit(D14_REASON)})`);
const callsBefore = gateway.calls;
const runD14 = await billingRun(PERIOD);
const lastRun = JSON.parse(psql(`select json_build_object('paridad', paridad, 'local', local_run) from private.billing_shadow_runs
                                 where tenant_id = '${TEN}' order by id desc limit 1`)) as { paridad: boolean; local: { planCode: string; addons: string[]; currency: string; lines: { concepto: string; monto: number }[] } };
check('D14.4 BILLING SHADOW: el biller local calcula el período sintético (paridad de ítems) sin factura ni pasarela',
  runD14.shadow === 1 && runD14.generated === 0 && gateway.calls === callsBefore && lastRun.paridad === true
    && psql(`select count(*) from public.invoices where tenant_id = '${TEN}' and period = ${lit(PERIOD)}`) === '0', JSON.stringify(runD14));

// e. MasterAdmin LOCAL: tenant SANDBOX + plan + suscripción ACTIVE del dataset; eje de facturación en BILLING_SHADOW.
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
function maCompare(product: string, tenantId: string, local: Row, actorName: string): MaCmp {
  return JSON.parse(maSql(`select platform.record_billing_shadow_comparison(${lit(product)}, ${lit(tenantId)}::uuid, ${lit(`${PERIOD}-01`)}::date,
    ${lit(JSON.stringify(local))}::jsonb, ${lit(actorName)})`, { service: true })) as MaCmp;
}
const maEx = maCertSetup('eexpense');
check('D14.5 MasterAdmin LOCAL: tenant SANDBOX + plan + suscripción ACTIVE sintéticos; eje de facturación en BILLING_SHADOW',
  axisState(maEx.integrationId).billing === 'BILLING_SHADOW', maEx.transitions.join(',') || 'ya en BILLING_SHADOW');

// f. Lo que calculó el biller local (su corrida SHADOW guardada), traducido con el mapeo del fixture.
const [planLine, ...addonLines] = lastRun.local.lines;
const localLines = [
  { itemCode: EC.itemMap[`plan:${lastRun.local.planCode}`] ?? `local:plan:${lastRun.local.planCode}`, quantity: 1, amount: Number(planLine.monto) },
  ...addonLines.map((l, i) => ({ itemCode: `local:addon-line-${i + 1}`, quantity: 1, amount: Number(l.monto) })),
];
const local = { source: 'eexpense.billing-run.shadow', currency: lastRun.local.currency, lines: localLines };
const maTen: string = EC.masteradmin.tenant.id;
const recordEx = (c: MaCmp) => svcSql(`select public.eexpense_record_masteradmin_billing_comparison('${TEN}', ${lit(PERIOD)},
  ${literal(c)}::jsonb, 'x07 eExpense D-14')`);
// Negativo: una línea local +0.01 → MasterAdmin la detecta; eExpense la guarda y NO la toma por verde.
const maRed = maCompare('eexpense', maTen, { ...local, lines: localLines.map((l, i) => (i === 0 ? { ...l, amount: Math.round((l.amount + 0.01) * 100) / 100 } : l)) },
  'x07 eExpense D-14 (negativo)');
recordEx(maRed);
check('D14.6 negativo: +0.01 en la línea del plan → MasterAdmin cuenta la diferencia y eExpense NO habilita MASTERADMIN_AUTHORITY',
  maRed.mismatches > 0 && maRed.green === false
    && failsWith(() => svcSql(`select public.eexpense_set_billing_authority('${TEN}', 'MASTERADMIN_AUTHORITY', 'x07')`), /MASTERADMIN_COMPARISON_NOT_GREEN/),
  `${maRed.mismatches} · ${JSON.stringify(maRed.diffs)}`);
const maGreen = maCompare('eexpense', maTen, local, 'x07 eExpense D-14');
recordEx(maGreen);
check('D14.7 MasterAdmin calcula la comparación del dataset: diff material 0 (al centavo) y eExpense la guarda con su id y checksum',
  maGreen.mismatches === 0 && maGreen.green === true && /^sha256:[0-9a-f]{64}$/.test(maGreen.reportChecksum)
    && psql(`select report_checksum from private.billing_masteradmin_comparisons where tenant_id = '${TEN}' order by id desc limit 1`) === maGreen.reportChecksum,
  `mismatches=${maGreen.mismatches} ${maGreen.reportChecksum} MA=${maGreen.expectedTotal} local=${maGreen.localTotal}`);
const maInvoices = () => Number(maSql(`select count(distinct i.id) from platform.invoices i left join platform.invoice_lines l on l.invoice_id = i.id where i.subscription_id = ${lit(maEx.subscriptionId)} or l.tenant_id = ${lit(maTen)}`));

// g. D-14 regla 5: la facturación NO avanza a MASTERADMIN_AUTHORITY en esta corrida (ni de forma transitoria).
//    La guarda "nunca dos cobradores" en MASTERADMIN_AUTHORITY la certifican las suites SQL de eExpense
//    (ccp_billing_authority_test, ccp_d14_masteradmin_billing_test) en su propia base desechable.
const billingEnd = psql(`select state from private.billing_authority where tenant_id = '${TEN}'`);
check('D14.9 D-14 regla 5: facturación final SHADOW; 0 facturas locales del período, 0 llamadas a pasarela y 0 facturas de MasterAdmin',
  billingEnd === 'SHADOW' && gateway.calls === callsBefore && maInvoices() === 0
    && psql(`select count(*) from public.invoices where tenant_id = '${TEN}' and period = ${lit(PERIOD)}`) === '0');

// h. appActive=false (regla 2) en PRIMARY: se retira lo comercial, la operación sigue; luego el deseado final.
const v5 = await emit(5, [CONCILIA], true, CERT_PLAN);
await client.pushSnapshot(ctx(), v5, actor);
const conciliaOn = has(CONCILIA);
const v6 = await emit(6, [CONCILIA], false, CERT_PLAN);
const p6 = await client.pushSnapshot(ctx(), v6, actor);
const par6 = JSON.parse(svcSql(`select public.eexpense_paridad_comercial('${TEN}')`)) as { diferencias: { tipo: string; severidad: string }[] }[];
const commercialDenied = conciliaOn && p6.result === 'APPLIED' && !has(CONCILIA) && !has(FRAUDE) && !has(COPILOTO);
const operationalContinues = has('eexpense.ai_capture') && has('eexpense.cfo_insights')
  && psql(`select coalesce(status, 'active') from public.tenants where id = '${TEN}'`) === 'active'
  && par6[0].diferencias.some((d) => d.tipo === 'APP_INACTIVE_LOCAL_ACTIVE' && d.severidad === 'WARNING');
check('D14.10 appActive=false: conciliación (vendible) negada; baseline ai_capture y núcleo cfo_insights siguen; tenant activo; paridad solo WARNING por eso',
  commercialDenied && operationalContinues, JSON.stringify(par6[0].diferencias));
const v7 = await emit(7, [], true, CERT_PLAN);
const p7 = await client.pushSnapshot(ctx(), v7, actor);
const g7 = await client.getApplied(ctx(), actor);
check('D14.11 GET final: PRIMARY con la versión y el checksum del último deseado (v7, appActive=true)',
  p7.result === 'APPLIED' && g7.result === 'OBSERVED' && g7.enforcementMode === 'PRIMARY' && g7.appliedVersion === 7 && g7.appliedChecksum === v7.checksum,
  `${g7.enforcementMode} v${g7.appliedVersion}`);
const parFinal = JSON.parse(svcSql(`select public.eexpense_paridad_comercial('${TEN}')`)) as { diferencias: { severidad: string; tipo: string }[] }[];
const parityBlocking = parFinal[0].diferencias.filter((d) => d.severidad === 'BLOCKING').length;
const cohort = psql(`select count(*) || '|' || count(*) filter (where private.platform_entitlement_mode_for(r.control_plane_tenant_id) = 'PRIMARY')
                       from private.platform_provisioning_requests r join public.tenants t on t.id = r.external_tenant_id where r.status = 'ACTIVE'`).split('|').map(Number);
check('D14.12 estado final sin rollback: PRODUCT y cohorte en PRIMARY, paridad sin BLOCKING, facturación SHADOW, el tenant se conserva',
  productMode() === 'PRIMARY' && cohort[0] >= 1 && cohort[1] === cohort[0] && parityBlocking === 0 && billingEnd === 'SHADOW'
    && psql(`select count(*) from public.tenants where id = '${TEN}'`) === '1', `cohorte ${cohort[1]}/${cohort[0]}`);
server.close();

const legacyTenants: LegacyTenant[] = unmapped.map((t) => ({ id: t.id, label: t.slug, resolution: 'UNRESOLVED',
  reason: t.slug === 'demo' ? 'seed `demo` de eExpense: sin evidencia de mapping con MasterAdmin (D-14 regla 4); sigue LEGACY'
    : 'tenant sin alta de MasterAdmin en la base desechable: sin mapping determinista; sigue LEGACY' }));
const d14: D14Evidence = {
  product: 'eexpense',
  entitlements: {
    scope: 'PRODUCT', productScopeMode: productMode(), finalMode: 'PRIMARY', transitions: d14Transitions,
    mappedTenants: cohort[0], mappedTenantsPrimary: cohort[1],
    getVerified: { appliedVersion: g7.appliedVersion ?? -1, appliedChecksum: g7.appliedChecksum ?? '', enforcementMode: g7.enforcementMode ?? '', desiredChecksum: v7.checksum },
    legacyWrite: { status: legacyBlocked ? 'BLOCKED' : 'NO_LEGACY_PATH', evidence: legacyBlocked ? 'tenant_addons INSERT → LEGACY_WRITE_BLOCKED (D14.3)' : '' },
    parityBlocking,
  },
  appActiveFalse: { commercialDenied, operationalContinues,
    evidence: 'v6 appActive=false: card_reconcile/fraud_vision/ai_copilot negados; ai_capture (baseline) y cfo_insights (núcleo) concedidos; tenants.status=active; APP_INACTIVE_LOCAL_ACTIVE WARNING (D14.10)' },
  legacyTenants,
  billing: {
    authority: billingEnd === 'SHADOW' ? 'BILLING_SHADOW' : billingEnd,
    comparison: { computedBy: 'masteradmin', mismatches: maGreen.mismatches, reportChecksum: maGreen.reportChecksum,
      negativeDetected: maRed.mismatches > 0, period: PERIOD },
    gatewayCalls: gateway.calls - callsBefore,
    duplicateCharge: !(gateway.calls === callsBefore && maInvoices() === 0 && runD14.generated === 0),
    masteradminAuthorityReached: false,
  },
  checks: countChecks(results),
};
const file = writeD14Evidence({ ...d14, checks: countChecks(results) });
console.log(file ? `evidencia D14: ${file}` : 'evidencia D14: sin CCP_EVIDENCE_DIR, no se escribe');
console.log(`D14 eExpense · comparación MasterAdmin: mismatches=${maGreen.mismatches} ${maGreen.reportChecksum} · negativo=${maRed.mismatches} ${maRed.reportChecksum}`);

console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
