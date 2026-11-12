/**
 * X-07 de uso (fase 17): emisor REAL de cada SaaS (su núcleo puro
 * `runUsageOutboxSender` + `buildUsageEvent`, importado desde su worktree del
 * programa) → handler REAL de usage-ingest → RPCs REALES de MasterAdmin
 * (supabase-js con service_role) → usage_events / agregados.
 *
 * El outbox del SaaS se sustituye por un almacén en memoria con la MISMA
 * interfaz que su store RPC (la semántica SQL del outbox — claim/lease/mark,
 * inmutabilidad — la prueban las suites SQL de cada repo). La entrega usa el
 * `fetchImpl` del emisor: el sandbox niega `listen` (EPERM), como en las X-07
 * de las fases 13–16.
 *
 * Por producto: tenant sintético DEMO + destino DEV + mapping ACTIVE en
 * MasterAdmin; medidor `<product>.ai.calls` ACTIVE; credencial ES256 con la
 * pública por referencia; ingest encendido SOLO durante la prueba y apagado al
 * final. Claves generadas en memoria.
 *
 * Requiere SUPABASE_URL, SUPABASE_DB_URL y SUPABASE_SERVICE_ROLE_KEY locales.
 * Uso: npx tsx scripts/ccp/usage-x07-e2e.mts [producto …]
 */
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { handleUsageIngest } from '../../supabase/functions/_shared/usage/ingest.ts';
import { buildIngestDeps } from '../../supabase/functions/usage-ingest/core.ts';

const URL_ = process.env.SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB = process.env.SUPABASE_DB_URL ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(URL_) || !KEY || !/@(127\.0\.0\.1|localhost):/.test(DB)) {
  console.error('HARD STOP: SUPABASE_URL/SUPABASE_DB_URL deben ser el stack local y SUPABASE_SERVICE_ROLE_KEY debe existir');
  process.exit(2);
}

const EBIM = '/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM';
const WT = (repo: string) => `${EBIM}/${repo}/.worktrees/ebim-commercial-control-plane-v1`;
const ENDPOINT = 'http://127.0.0.1:54421/functions/v1/usage-ingest';
const ORG = '30000000-0000-4000-a000-000000000002';

const sql = (q: string) => execFileSync('psql', [DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
const results: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} · ${label}${detail ? ` · ${detail}` : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Estado en MasterAdmin por producto
// ---------------------------------------------------------------------------
interface ProductCtx {
  code: string;
  productId: string;
  tenantId: string;
  meter: string;
  capability: string;
  publicRef: string;
}

function setupProduct(code: string, capability: string): ProductCtx {
  const productId = sql(`select id from platform.saas_products where code = '${code}'`);
  const tenantId = sql(`select md5('x07-usage-${code}')::uuid`);
  const targetId = sql(`select md5('x07-usage-target-${code}')::uuid`);
  sql(`insert into platform.tenants (id, slug, name, saas_product_id, customer_organization_id, tenant_type, admin_email)
       values ('${tenantId}', 'x07-usage-${code}', 'X-07 uso ${code}', '${productId}', '${ORG}', 'DEMO', 'x07-${code}@ebim.test')
       on conflict (id) do nothing`);
  sql(`insert into platform.deployment_targets (id, code, name, deployment_mode, saas_product_id, provisioning_environment)
       values ('${targetId}', 'x07-usage-${code}', 'X-07 uso ${code}', 'SHARED', '${productId}', 'DEV')
       on conflict (id) do nothing`);
  sql(`insert into platform.tenant_product_mappings (tenant_id, saas_product_id, deployment_target_id, external_tenant_id,
         status, provisioned_at, registered_manually)
       select '${tenantId}', '${productId}', '${targetId}', 'x07-ext-${code}', 'ACTIVE', now(), true
        where not exists (select 1 from platform.tenant_product_mappings where tenant_id = '${tenantId}' and saas_product_id = '${productId}')`);
  sql(`insert into platform.product_capabilities (saas_product_id, code, name, kind, status)
       values ('${productId}', '${capability}', 'X-07 ${capability}', 'AI_FEATURE', 'ACTIVE')
       on conflict (code) do nothing`);
  const meter = `${code}.ai.calls`;
  sql(`insert into platform.usage_meters (saas_product_id, code, name, unit, aggregation, status, capability_id)
       select '${productId}', '${meter}', 'X-07 ${meter}', 'call', 'SUM', 'ACTIVE', id from platform.product_capabilities where code = '${capability}'
       on conflict (saas_product_id, code) do update set status = 'ACTIVE'`);
  const publicRef = `${code.toUpperCase()}_DEV_USAGE_PUBLIC_JWK`;
  sql(`insert into platform.usage_ingest_credentials (saas_product_id, environment, issuer, public_key_ref, enabled)
       values ('${productId}', 'DEV', '${code}.ebim', '${publicRef}', true)
       on conflict (issuer, environment) do update set public_key_ref = excluded.public_key_ref, enabled = true`);
  if (Number(sql(`select count(*) from platform.product_integrations where saas_product_id = '${productId}'`)) === 0) {
    sql(`insert into platform.product_integrations (saas_product_id, code, name, integration_type)
         values ('${productId}', 'x07-usage-${code}', 'X-07 uso ${code}', 'MANUAL')`);
  }
  sql(`update platform.product_integrations set usage_ingest_enabled = true where saas_product_id = '${productId}'`);
  return { code, productId, tenantId, meter, capability, publicRef };
}
const switchOff = (p: ProductCtx) =>
  sql(`update platform.product_integrations set usage_ingest_enabled = false where saas_product_id = '${p.productId}'`);

// ---------------------------------------------------------------------------
// Claves y receptor real
// ---------------------------------------------------------------------------
async function keypair() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const pem = [`-----BEGIN ${'PRIVATE'} KEY-----`, pkcs8, `-----END ${'PRIVATE'} KEY-----`].join('\n');
  return { pair, pem, jwk: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey)) };
}

const admin = createClient(URL_, KEY, { db: { schema: 'platform' }, auth: { persistSession: false } });
function receiverFetch(publicKeys: Record<string, string>): { fetchImpl: typeof fetch; calls: { count: number } } {
  const env = (n: string) => (n === 'USAGE_INGEST_ENABLED' ? 'true' : publicKeys[n]);
  const deps = buildIngestDeps(admin, env);
  const calls = { count: 0 };
  const fetchImpl = (async (url: string | URL, init: RequestInit) => {
    calls.count += 1;
    if (!String(url).endsWith('/functions/v1/usage-ingest')) return new Response('{}', { status: 404 });
    const res = await handleUsageIngest({ method: init.method ?? 'GET', headers: new Headers(init.headers), bodyText: String(init.body) }, deps);
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// Almacén en memoria genérico
// ---------------------------------------------------------------------------
interface Row { eventId: string; status: 'PENDING' | 'SENT' | 'DEAD'; attempts: number; lastError?: string }
function memoryOutbox<T>(rows: Array<{ meta: Row; row: T }>) {
  let lease = 0;
  const leased = new Map<string, string[]>();
  return {
    rows,
    claim(limit: number) {
      const token = `00000000-0000-4000-8000-${String(++lease).padStart(12, '0')}`;
      const picked = rows.filter((r) => r.meta.status === 'PENDING').slice(0, limit);
      leased.set(token, picked.map((r) => r.meta.eventId));
      return { token, rows: picked.map((r) => r.row) };
    },
    mark(token: string, dispositions: Array<{ eventId: string; outcome: string; code?: string }>) {
      const ids = new Set(leased.get(token) ?? []);
      for (const d of dispositions) {
        const r = rows.find((x) => x.meta.eventId === d.eventId && ids.has(x.meta.eventId));
        if (!r) continue;
        r.meta.attempts += 1;
        if (d.outcome === 'SENT') r.meta.status = 'SENT';
        else if (d.outcome === 'DEAD') { r.meta.status = 'DEAD'; r.meta.lastError = d.code; }
        else r.meta.lastError = d.code;
      }
      // El lease sigue vivo: un emisor puede marcar un claim en varias llamadas (una por lote).
    },
    reset() { for (const r of rows) r.meta.status = 'PENDING'; },
  };
}

// ---------------------------------------------------------------------------
// Adaptadores por producto (firma de cada emisor, tal como la publicó su repo)
// ---------------------------------------------------------------------------
interface Scenario { ids: { withTokens: string; noTokens: string; badMeter: string } }
interface Adapter {
  code: string;
  capability: string;
  run(p: ProductCtx, s: Scenario, key: Awaited<ReturnType<typeof keypair>>, fetchImpl: typeof fetch, enabled: boolean, freshRows: boolean): Promise<{ report: Record<string, unknown>; states: Record<string, Row> }>;
}

const occurred = new Date(Date.now() - 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
const stores = new Map<string, ReturnType<typeof memoryOutbox>>();

const adapters: Record<string, Adapter> = {
  gmao: {
    code: 'gmao',
    capability: 'gmao.ai.assist',
    async run(p, s, key, fetchImpl, enabled, freshRows) {
      const mod = await import(`${WT('GMAO')}/supabase/functions/_shared/usage/sender.ts`);
      const mk = (id: string, meter: string, internal: Record<string, unknown> | null) => ({
        meta: { eventId: id, status: 'PENDING' as const, attempts: 0 },
        row: { event_id: id, occurred_at: occurred, meter_code: meter, quantity: 1, unit: 'call', control_plane_tenant_id: p.tenantId,
               external_company_id: null, capability_code: p.capability, internal, attempts: 0 },
      });
      if (freshRows || !stores.has('gmao')) {
        stores.set('gmao', memoryOutbox([
          mk(s.ids.withTokens, p.meter, { provider: 'anthropic', model: 'x07-model', inputTokens: 900, outputTokens: 120 }),
          mk(s.ids.noTokens, p.meter, null),
          mk(s.ids.badMeter, 'gmao.ai.unregistered', null),
        ]));
      }
      const mem = stores.get('gmao')!;
      const report = await mod.runUsageOutboxSender({
        enabledFlag: enabled ? 'true' : undefined,
        endpoint: ENDPOINT,
        environment: 'DEV',
        loadPrivateKey: async () => key.pair.privateKey,
        store: {
          claim: async (limit: number) => { const c = mem.claim(limit); return { leaseId: c.token, rows: c.rows }; },
          mark: async (lease: string, res: never) => mem.mark(lease, res),
        },
        fetchImpl,
        meters: [{ code: p.meter, unit: 'call' }, { code: 'gmao.ai.unregistered', unit: 'call' }],
      });
      return { report, states: Object.fromEntries(mem.rows.map((r) => [r.meta.eventId, r.meta])) };
    },
  },
  eexpense: {
    code: 'eexpense',
    capability: 'eexpense.ai_copilot',
    async run(p, s, key, fetchImpl, enabled, freshRows) {
      const mod = await import(`${WT('eExpenses')}/supabase/functions/_shared/usageOutbox.ts`);
      const mk = (id: string, meter: string, internal: Record<string, unknown> | null) => ({
        meta: { eventId: id, status: 'PENDING' as const, attempts: 0 },
        row: { eventId: id, occurredAt: occurred, tenantId: 'x07-local-tenant', controlPlaneTenantId: p.tenantId, meterCode: meter,
               quantity: 1, unit: 'call', capabilityCode: p.capability, internal, attempts: 0 },
      });
      if (freshRows || !stores.has('eexpense')) {
        stores.set('eexpense', memoryOutbox([
          mk(s.ids.withTokens, p.meter, { provider: 'anthropic', model: 'x07-model', inputTokens: 700, outputTokens: 90 }),
          mk(s.ids.noTokens, p.meter, null),
          mk(s.ids.badMeter, 'eexpense.ai.unregistered', null),
        ]));
      }
      const mem = stores.get('eexpense')!;
      const report = await mod.runUsageOutboxSender({
        env: {
          USAGE_OUTBOX_SENDER_ENABLED: enabled ? 'true' : undefined,
          MASTERADMIN_USAGE_INGEST_URL: ENDPOINT,
          EEXPENSE_USAGE_PRIVATE_KEY: key.pem,
          EBIM_USAGE_ENVIRONMENT: 'DEV',
        },
        store: {
          claim: async (limit: number) => { const c = mem.claim(limit); return { claimToken: c.token, rows: c.rows }; },
          mark: async (token: string, res: never) => mem.mark(token, res),
        },
        fetch: fetchImpl,
      });
      return { report, states: Object.fromEntries(mem.rows.map((r) => [r.meta.eventId, r.meta])) };
    },
  },
  ecommerce: {
    code: 'ecommerce',
    capability: 'ecommerce.ai.content',
    async run(p, s, key, fetchImpl, enabled, freshRows) {
      const mod = await import(`${WT('eCommerce')}/supabase/functions/_shared/usageOutbox/sender.ts`);
      const mk = (id: string, meter: string, internal: Record<string, unknown> | null) => ({
        meta: { eventId: id, status: 'PENDING' as const, attempts: 0 },
        row: { event_id: id, occurred_at: occurred, meter_code: meter, quantity: 1, unit: 'call', control_plane_tenant_id: p.tenantId,
               external_company_id: null, capability_code: p.capability, internal, attempts: 0 },
      });
      if (freshRows || !stores.has('ecommerce')) {
        stores.set('ecommerce', memoryOutbox([
          mk(s.ids.withTokens, p.meter, { provider: 'anthropic', model: 'x07-model', inputTokens: 800, outputTokens: 100 }),
          mk(s.ids.noTokens, p.meter, null),
          mk(s.ids.badMeter, 'ecommerce.ai.unregistered', null),
        ]));
      }
      const mem = stores.get('ecommerce')!;
      let token = '';
      const env: Record<string, string | undefined> = {
        USAGE_OUTBOX_SENDER_ENABLED: enabled ? 'true' : undefined,
        MASTERADMIN_USAGE_INGEST_URL: ENDPOINT,
        ECOMMERCE_USAGE_PRIVATE_KEY: key.pem,
        EBIM_USAGE_ENVIRONMENT: 'DEV',
      };
      const report = await mod.runUsageOutboxSender({
        env: (n: string) => env[n],
        claim: async (limit: number) => { const c = mem.claim(limit); token = c.token; return c.rows; },
        mark: async (res: never) => mem.mark(token, res),
        fetchImpl,
      });
      return { report, states: Object.fromEntries(mem.rows.map((r) => [r.meta.eventId, r.meta])) };
    },
  },
  esupplier: {
    code: 'esupplier',
    capability: 'esupplier.ai.tender_copilot',
    async run(p, s, key, fetchImpl, enabled, freshRows) {
      const mod = await import(`${WT('eSupplier')}/supabase/functions/_shared/usage/outboxSender.ts`);
      const mk = (id: string, quantity: number, internal: Record<string, unknown> | null) => ({
        meta: { eventId: id, status: 'PENDING' as const, attempts: 0 },
        row: { event_id: id, occurred_at: occurred, tenant_id: 'x07', control_plane_tenant_id: p.tenantId, function_name: 'x07-fn',
               addon_code: null, capability_code: p.capability, quantity, internal, attempts: 0 },
      });
      if (freshRows || !stores.has('esupplier')) {
        stores.set('esupplier', memoryOutbox([
          mk(s.ids.withTokens, 1, { provider: 'anthropic', model: 'x07-model', inputTokens: 600, outputTokens: 80 }),
          mk(s.ids.noTokens, 1, null),
          // eSupplier tiene un único medidor fijo: la fila inválida es una cantidad negativa (DEAD en origen).
          mk(s.ids.badMeter, -1, null),
        ]));
      }
      const mem = stores.get('esupplier')!;
      const signer = await mod.createEs256Signer({ privateKeyPem: key.pem });
      const report = await mod.runUsageOutboxSender({
        enabled,
        endpoint: ENDPOINT,
        environment: 'DEV',
        store: {
          claim: async (limit: number) => { const c = mem.claim(limit); return { leaseId: c.rows.length ? c.token : null, rows: c.rows }; },
          mark: async (lease: string, res: never) => mem.mark(lease, res),
        },
        signer,
        fetchImpl,
        maxRounds: 1,
      });
      return { report, states: Object.fromEntries(mem.rows.map((r) => [r.meta.eventId, r.meta])) };
    },
  },
  echange: {
    code: 'echange',
    capability: 'echange.ai.triage',
    async run(p, s, key, fetchImpl, enabled, freshRows) {
      const mod = await import(`${WT('eChange')}/supabase/functions/_shared/usage/sender.ts`);
      const mk = (id: string, unit: string, internal: Record<string, unknown>) => ({
        meta: { eventId: id, status: 'PENDING' as const, attempts: 0 },
        row: { eventId: id, occurredAt: occurred, controlPlaneTenantId: p.tenantId, source: 'AI', outcome: 'SUCCEEDED',
               capabilityCode: p.capability, quantity: 1, unit, internal, attempts: 0 },
      });
      if (freshRows || !stores.has('echange')) {
        stores.set('echange', memoryOutbox([
          mk(s.ids.withTokens, 'call', { provider: 'anthropic', model: 'x07-model', inputTokens: 500, outputTokens: 70 }),
          mk(s.ids.noTokens, 'call', { provider: 'anthropic' }),
          // Deepgram con segundos del proveedor → echange.voice.seconds, que MasterAdmin NO tiene registrado aquí.
          mk(s.ids.badMeter, 'second', { provider: 'deepgram', audioSeconds: 12.5 }),
        ]));
      }
      const mem = stores.get('echange')!;
      const report = await mod.runUsageOutboxSender({
        env: {
          USAGE_OUTBOX_SENDER_ENABLED: enabled ? 'true' : undefined,
          MASTERADMIN_USAGE_INGEST_URL: ENDPOINT,
          ECHANGE_USAGE_PRIVATE_KEY: key.pem,
          EBIM_USAGE_ENVIRONMENT: 'DEV',
        },
        store: {
          claim: async (limit: number) => { const c = mem.claim(limit); return { leaseToken: c.rows.length ? c.token : null, events: c.rows }; },
          mark: async (token: string, res: never) => mem.mark(token, res),
        },
        fetchImpl,
        log: () => {},
      });
      return { report, states: Object.fromEntries(mem.rows.map((r) => [r.meta.eventId, r.meta])) };
    },
  },
  comerza: {
    code: 'comerza',
    capability: 'comerza.ai.whatsapp_agent',
    async run(p, s, key, fetchImpl, enabled, freshRows) {
      const mod = await import(`${WT('comerza')}/supabase/functions/_shared/usage/sender.ts`);
      const mk = (id: string, meter: string, internal: Record<string, unknown> | null) => ({
        meta: { eventId: id, status: 'PENDING' as const, attempts: 0 },
        row: { eventId: id, occurredAt: occurred, meterCode: meter, quantity: 1, unit: 'call', controlPlaneTenantId: p.tenantId,
               capabilityCode: p.capability, internal, attempts: 0 },
      });
      if (freshRows || !stores.has('comerza')) {
        stores.set('comerza', memoryOutbox([
          mk(s.ids.withTokens, p.meter, { provider: 'gemini', model: 'x07-model', inputTokens: 400, outputTokens: 60 }),
          mk(s.ids.noTokens, p.meter, { provider: 'gemini' }),
          mk(s.ids.badMeter, 'comerza.ai.unregistered', null),
        ]));
      }
      const mem = stores.get('comerza')!;
      const raw = await mod.runUsageOutboxSender({
        env: {
          USAGE_OUTBOX_SENDER_ENABLED: enabled ? 'true' : undefined,
          MASTERADMIN_USAGE_INGEST_URL: ENDPOINT,
          COMERZA_USAGE_PRIVATE_KEY: key.pem,
          EBIM_USAGE_ENVIRONMENT: 'DEV',
        },
        claim: async (limit: number) => { const c = mem.claim(limit); return { leaseToken: c.rows.length ? c.token : null, events: c.rows }; },
        mark: async (token: string, res: never) => { mem.mark(token, res); return { sent: 0, dead: 0, retry: 0, ignored: 0 }; },
        fetchImpl,
        log: () => {},
      });
      // Comerza informa {enabled, ok, …}: se normaliza al estado común del recorrido.
      const report = { ...raw, status: !raw.enabled ? 'DISABLED' : raw.ok ? 'OK' : 'NOT_OK' };
      return { report, states: Object.fromEntries(mem.rows.map((r) => [r.meta.eventId, r.meta])) };
    },
  },
};

// ---------------------------------------------------------------------------
// Recorrido por producto
// ---------------------------------------------------------------------------
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(adapters);
for (const code of wanted) {
  const a = adapters[code];
  if (!a) { check(`${code}: adaptador existente`, false); continue; }
  console.log(`\n=== ${code} ===`);
  const p = setupProduct(code, a.capability);
  const key = await keypair();
  const { fetchImpl, calls } = receiverFetch({ [p.publicRef]: key.jwk });
  const s: Scenario = { ids: { withTokens: crypto.randomUUID(), noTokens: crypto.randomUUID(), badMeter: crypto.randomUUID() } };

  // 1. Apagado por defecto en el SaaS: no reclama ni llama.
  const off = await a.run(p, s, key, fetchImpl, false, true);
  check(`${code}: emisor apagado por defecto (sin POST)`, off.report.status === 'DISABLED' && calls.count === 0, String(off.report.status));

  // 2. Encendido: entrega real.
  const on = await a.run(p, s, key, fetchImpl, true, false);
  check(`${code}: emisor encendido → OK`, ['OK', 'COMPLETED'].includes(String(on.report.status)), JSON.stringify(on.report));
  const st = on.states;
  check(`${code}: evento con tokens del proveedor → SENT`, st[s.ids.withTokens]?.status === 'SENT');
  check(`${code}: evento sin tokens → SENT`, st[s.ids.noTokens]?.status === 'SENT');
  const bad = st[s.ids.badMeter];
  check(`${code}: fila no aceptable (medidor no registrado o cantidad inválida) → DEAD con código, sin reintento`,
    bad?.status === 'DEAD' && typeof bad.lastError === 'string' && bad.lastError.length > 0, `${bad?.status}/${bad?.lastError}`);

  const row = sql(`select tenant_id || '|' || meter_code || '|' || quantity || '|' || coalesce(capability_code, '') || '|' ||
                          coalesce(internal->>'inputTokens', '-') || '|' || (select tenant_type from platform.tenants where id = tenant_id)
                     from platform.usage_events where event_id = '${s.ids.withTokens}'`);
  check(`${code}: MasterAdmin guarda tenant, medidor, cantidad, capacidad y tokens reales`,
    row.startsWith(`${p.tenantId}|${p.meter}|1.000000|${p.capability}|`) && !row.includes('|-|') && row.endsWith('|DEMO'), row);
  const noTok = sql(`select coalesce(internal::text, 'null') from platform.usage_events where event_id = '${s.ids.noTokens}'`);
  check(`${code}: sin tokens del proveedor → MasterAdmin no recibe tokens`, !/Tokens/.test(noTok), noTok);
  const agg = sql(`select status || ':' || (select count(*) from platform.usage_events e where e.tenant_id = a.tenant_id and e.meter_id = a.meter_id)
                     from platform.usage_period_aggregates a
                    where a.tenant_id = '${p.tenantId}' and a.meter_code = '${p.meter}'
                      and a.period_start = date_trunc('month', now() at time zone 'UTC')::date`);
  check(`${code}: el ingest abre el agregado OPEN del período`, agg.startsWith('OPEN:'), agg);

  // 3. Reintento del outbox (p. ej. tras perder la respuesta): DUPLICATE → SENT, sin filas nuevas.
  stores.get(code)!.reset();
  const before = Number(sql(`select count(*) from platform.usage_events where tenant_id = '${p.tenantId}'`));
  const again = await a.run(p, s, key, fetchImpl, true, false);
  const after = Number(sql(`select count(*) from platform.usage_events where tenant_id = '${p.tenantId}'`));
  check(`${code}: reenvío idempotente (DUPLICATE → SENT, sin filas nuevas)`,
    again.states[s.ids.withTokens]?.status === 'SENT' && after === before, `${before} → ${after}`);

  // 4. Kill-switch del producto en MasterAdmin: RETRY, nada se pierde.
  switchOff(p);
  const fresh: Scenario = { ids: { withTokens: crypto.randomUUID(), noTokens: crypto.randomUUID(), badMeter: crypto.randomUUID() } };
  const paused = await a.run(p, fresh, key, fetchImpl, true, true);
  const ps = paused.states;
  const validPending = [fresh.ids.withTokens, fresh.ids.noTokens]
    .filter((id) => ps[id]?.status === 'PENDING' && ps[id]?.lastError === 'USAGE_INGEST_DISABLED').length;
  const badOk = (ps[fresh.ids.badMeter]?.status === 'PENDING' && ps[fresh.ids.badMeter]?.lastError === 'USAGE_INGEST_DISABLED')
    || ps[fresh.ids.badMeter]?.status === 'DEAD';
  check(`${code}: ingest apagado en MasterAdmin → los eventos válidos quedan PENDING (RETRY USAGE_INGEST_DISABLED)`,
    validPending === 2 && badOk, `${validPending}/2 · medidor inválido ${ps[fresh.ids.badMeter]?.status}/${ps[fresh.ids.badMeter]?.lastError}`);
  check(`${code}: estado final: ingest del producto apagado`,
    sql(`select coalesce(bool_or(usage_ingest_enabled), false) from platform.product_integrations where saas_product_id = '${p.productId}'`) === 'f');
}

console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
