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
 * El tenant se da de alta con la RPC de provisioning REAL de eExpense y se borra al final. Sin red
 * externa, sin pasarelas reales, sin proyectos remotos. No imprime claves ni tokens.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
const cleanup = () => psql(`
  delete from private.platform_entitlement_enforcement_mode where scope_key = '${CPT}';
  delete from private.platform_provisioning_requests where control_plane_tenant_id = '${CPT}';
  delete from public.tenants where id = '${TEN}';`);
cleanup();
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
const port = (server.address() as { port: number }).port;

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
    tenants: [{ id: TEN, name: 'X07', plan: 'pro', billing_mode: 'live' }], tenantAddons,
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
const toMa = JSON.parse(svcSql(`select public.eexpense_set_billing_authority('${TEN}', 'MASTERADMIN_AUTHORITY', 'x07 paridad DEV verde')`)) as Row;
const run3 = await billingRun('2026-10');
check('21. MASTERADMIN_AUTHORITY con paridad DEV verde: el biller local ya no factura ni cobra (nunca dos cobradores)',
  toMa.to === 'MASTERADMIN_AUTHORITY' && run3.external === 1 && run3.generated === 0 && gateway.calls === 0
    && failsWith(() => psql(`insert into public.invoices (tenant_id, period, amount) values ('${TEN}', '2026-11', 1)`),
      /BILLING_NOT_LOCAL_AUTHORITY/), JSON.stringify(run3));
svcSql(`select public.eexpense_set_billing_authority('${TEN}', 'SHADOW', 'x07 rollback')`);
svcSql(`select public.eexpense_set_billing_authority('${TEN}', 'LEGACY_AUTHORITY', 'x07 rollback')`);
check('22. rollback del eje de facturación a LEGACY_AUTHORITY (un paso por vez)',
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
check('26. v3 appActive=false: conciliación, fraude y hasta los incluidos quedan retirados',
  (p3.data as { httpStatus?: number } | null)?.httpStatus === 200 && !has(CONCILIA) && !has(FRAUDE) && !has('eexpense.ai_capture'));

// Volver a SHADOW: decide legacy otra vez (sin nada que restaurar: el snapshot no se materializa).
svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'DUAL_READ', 'x07 rollback')`);
svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'SHADOW', 'x07 rollback')`);
check('27. rollback PRIMARY → DUAL_READ → SHADOW: legacy intacto (fraude sí por tenant_addons)', has(FRAUDE) && has(CONCILIA));

cleanup();
check('28. limpieza: el tenant X-07 no queda en la base desechable (el outbox es historia inmutable y se conserva)',
  psql(`select count(*) from public.tenants where id = '${TEN}'`) === '0');

console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
