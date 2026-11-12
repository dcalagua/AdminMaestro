/**
 * E2E local del ingest de uso (fase 17, MA-51/MA-54): emisor de referencia
 * FIX-USG-v1 → handler real de usage-ingest → RPCs reales de MasterAdmin
 * (supabase-js con service_role) → usage_events.
 *
 * Verifica que expected/ingest-results.json es lo que devuelve la base REAL
 * para fixtures/ingest-batch.json (con los ids traducidos al seed local y
 * eventIds frescos por ejecución, porque usage_events es append-only).
 *
 * Requiere SUPABASE_URL (http://127.0.0.1:54421), SUPABASE_DB_URL y
 * SUPABASE_SERVICE_ROLE_KEY del stack local. La guarda aborta si no es local.
 * Deja datos sintéticos en el stack local (append-only); `db reset` los borra.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { handleUsageIngest } from '../../supabase/functions/_shared/usage/ingest.ts';
import { buildIngestDeps } from '../../supabase/functions/usage-ingest/core.ts';
import {
  chunkUsageEvents,
  importSenderPrivateKey,
  sendUsageBatch,
  signUsageToken,
  type UsageBatch,
  type UsageEvent,
} from '../../contracts/usage/v1/reference-sender.ts';

const URL_ = process.env.SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB = process.env.SUPABASE_DB_URL ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(URL_) || !KEY || !/@(127\.0\.0\.1|localhost):/.test(DB)) {
  console.error('HARD STOP: SUPABASE_URL/SUPABASE_DB_URL deben ser el stack local y SUPABASE_SERVICE_ROLE_KEY debe existir');
  process.exit(2);
}

const CONTRACT = join(import.meta.dirname, '../../contracts/usage/v1');
const read = (rel: string) => JSON.parse(readFileSync(join(CONTRACT, rel), 'utf8'));
const setup = read('fixtures/setup.json');
const golden = read('fixtures/ingest-batch.json') as UsageBatch;
const expected = read('expected/ingest-results.json');

const ESUP = '20000000-0000-4000-a000-000000000001';
const TENANTS: Record<string, string> = {
  '00000000-0000-4ccc-8000-0000000000a1': '50000000-0000-4000-a000-000000000001', // alpha-esupplier (mapping DEV)
  '00000000-0000-4ccc-8000-0000000000a2': '50000000-0000-4000-a000-000000000002', // p1 sin mapping
  '00000000-0000-4ccc-8000-0000000000a3': '50000000-0000-4000-a000-000000000008', // tenant de EWM
};
const ISSUER = 'esupplier.ebim';
const PUBLIC_REF = 'LOCAL_E2E_ESUPPLIER_USAGE_PUBLIC_JWK';

const sql = (q: string) => execFileSync('psql', [DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
const results: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} · ${label}${detail ? ` · ${detail}` : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Estado de MasterAdmin = fixtures/setup.json sobre el seed local
// ---------------------------------------------------------------------------
for (const m of setup.meters) {
  sql(`insert into platform.usage_meters (saas_product_id, code, name, unit, aggregation, measurement, allows_negative, status)
       values ('${ESUP}', '${m.code}', 'E2E ${m.code}', '${m.unit}', '${m.aggregation}', '${m.measurement}', ${m.allowsNegative}, '${m.status}')
       on conflict (saas_product_id, code) do nothing`);
}
sql(`insert into platform.tenant_product_mappings (tenant_id, saas_product_id, deployment_target_id, external_tenant_id,
       external_organization_id, external_company_id, status, provisioned_at, registered_manually)
     select '${TENANTS['00000000-0000-4ccc-8000-0000000000a1']}', '${ESUP}', '40000000-0000-4000-a000-00000000000a',
            'ext-alpha', 'ext-org-alpha', 'fixture-co-01', 'ACTIVE', now(), true
      where not exists (select 1 from platform.tenant_product_mappings
                         where tenant_id = '${TENANTS['00000000-0000-4ccc-8000-0000000000a1']}' and saas_product_id = '${ESUP}')`);
sql(`insert into platform.usage_ingest_credentials (saas_product_id, environment, issuer, public_key_ref, enabled)
     values ('${ESUP}', 'DEV', '${ISSUER}', '${PUBLIC_REF}', true)
     on conflict (issuer, environment) do update set public_key_ref = excluded.public_key_ref, enabled = true`);
const setProductSwitch = (on: boolean) => sql(`update platform.product_integrations set usage_ingest_enabled = ${on} where saas_product_id = '${ESUP}'`);
check('setup: integración de eSupplier existente para el kill-switch',
  Number(sql(`select count(*) from platform.product_integrations where saas_product_id = '${ESUP}'`)) > 0);

// ---------------------------------------------------------------------------
// Claves del SaaS en memoria (la privada nunca sale de este proceso)
// ---------------------------------------------------------------------------
const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const privateKey = await importSenderPrivateKey([`-----BEGIN ${'PRIVATE'} KEY-----`, pkcs8, `-----END ${'PRIVATE'} KEY-----`].join('\n'));
const publicJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey));

const admin = createClient(URL_, KEY, { db: { schema: 'platform' }, auth: { persistSession: false } });
function fetchFor(globalFlag: boolean): typeof fetch {
  const env = (name: string) => (name === 'USAGE_INGEST_ENABLED' ? String(globalFlag) : name === PUBLIC_REF ? publicJwk : undefined);
  const deps = buildIngestDeps(admin, env);
  return (async (_url: string, init: RequestInit) => {
    const res = await handleUsageIngest({ method: init.method ?? 'GET', headers: new Headers(init.headers), bodyText: String(init.body) }, deps);
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}
const now = () => Math.floor(Date.now() / 1000);
const token = () => signUsageToken({ issuer: ISSUER, privateKey, nowSeconds: now() });

// eventIds frescos por ejecución (append-only), preservando las repeticiones.
const fresh = new Map<string, string>();
const remap = (id: string) => (/^[0-9a-f-]{36}$/.test(id) ? (fresh.get(id) ?? (fresh.set(id, crypto.randomUUID()), fresh.get(id)!)) : id);
const batch: UsageBatch = {
  ...golden,
  productCode: 'esupplier',
  batchId: crypto.randomUUID(),
  events: golden.events.map((e) => ({
    ...e,
    eventId: remap(e.eventId),
    ...(e.controlPlaneTenantId ? { controlPlaneTenantId: TENANTS[e.controlPlaneTenantId] ?? e.controlPlaneTenantId } : {}),
  })) as UsageEvent[],
};
const expectedStatus = expected.results.map((r: { status: string; code?: string }) => (r.code ? `${r.status}:${r.code}` : r.status));

// ---------------------------------------------------------------------------
// 1. Apagado por defecto (D-12)
// ---------------------------------------------------------------------------
setProductSwitch(false);
{
  const out = await sendUsageBatch({ endpoint: 'local', batch, token: await token(), fetchImpl: fetchFor(false) });
  check('flag global apagado → todo RETRY USAGE_INGEST_DISABLED', out.every((d) => d.outcome === 'RETRY' && d.code === 'USAGE_INGEST_DISABLED'));
  const out2 = await sendUsageBatch({ endpoint: 'local', batch, token: await token(), fetchImpl: fetchFor(true) });
  check('flag global on + kill-switch del producto off → RETRY USAGE_INGEST_DISABLED', out2.every((d) => d.code === 'USAGE_INGEST_DISABLED'));
  const n = Number(sql(`select count(*) from platform.usage_events where event_id::text = any(array[${[...fresh.values()].map((v) => `'${v}'`).join(',')}])`));
  check('nada persistido mientras está apagado', n === 0, `${n} filas`);
}

// ---------------------------------------------------------------------------
// 2. Lote dorado contra la base real
// ---------------------------------------------------------------------------
setProductSwitch(true);
const f = fetchFor(true);
const raw = await f('local', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}` },
  body: JSON.stringify(batch),
});
const body = (await raw.json()) as { results: Array<{ status: string; code?: string }>; accepted: number; duplicate: number; rejected: number };
const got = body.results.map((r) => (r.code ? `${r.status}:${r.code}` : r.status));
check('HTTP 200', raw.status === 200, String(raw.status));
expected.results.forEach((r: { name: string }, i: number) => check(`fixture ${r.name}`, got[i] === expectedStatus[i], `${got[i]} (esperado ${expectedStatus[i]})`));
check('conteos = expected', body.accepted === expected.accepted && body.duplicate === expected.duplicate && body.rejected === expected.rejected,
  `${body.accepted}/${body.duplicate}/${body.rejected}`);

// ---------------------------------------------------------------------------
// 3. Reintento del outbox: lo aceptado vuelve DUPLICATE; jti único
// ---------------------------------------------------------------------------
{
  const accepted = batch.events.filter((_, i) => expectedStatus[i] === 'ACCEPTED');
  const [again] = chunkUsageEvents(accepted, { environment: 'DEV', productCode: 'esupplier' }, () => crypto.randomUUID());
  const t = await token();
  const out = await sendUsageBatch({ endpoint: 'local', batch: again, token: t, fetchImpl: f });
  check('reenvío de lo aceptado → SENT (DUPLICATE), sin filas nuevas', out.every((d) => d.outcome === 'SENT'));
  const replay = await sendUsageBatch({ endpoint: 'local', batch: again, token: t, fetchImpl: f });
  check('mismo token otra vez → RETRY JTI_REPLAYED', replay.every((d) => d.code === 'JTI_REPLAYED'));
  const n = Number(sql(`select count(*) from platform.usage_events where event_id::text = any(array[${accepted.map((e) => `'${e.eventId}'`).join(',')}])`));
  check('exactamente una fila por evento aceptado', n === accepted.length, `${n}/${accepted.length}`);
}

// ---------------------------------------------------------------------------
// 4. Persistencia: atribución, COGS y bitácora de rechazos
// ---------------------------------------------------------------------------
{
  const first = batch.events[0];
  const row = sql(`select tenant_id || '|' || meter_code || '|' || quantity || '|' || coalesce(internal->>'inputTokens','') || '|' || period_start
                     from platform.usage_events where event_id = '${first.eventId}'`);
  check('evento persistido con tenant, medidor, cantidad y tokens reales', row === `${first.controlPlaneTenantId}|fixture.ai.calls|1.000000|1200|2026-09-01`, row);
  const noTokens = sql(`select internal::text from platform.usage_events where event_id = '${batch.events[3].eventId}'`);
  check('sin tokens del proveedor → internal sin claves de tokens', !/Tokens/.test(noTokens), noTokens);
  const rej = Number(sql(`select count(*) from platform.usage_ingest_rejections where ingest_batch_id = '${batch.batchId}'`));
  check('cada rechazo del lote queda en la bitácora', rej === expected.rejected, `${rej}`);
  const leak = Number(sql(`select count(*) from platform.usage_ingest_rejections where ingest_batch_id = '${batch.batchId}' and detail::text ~* 'fixture text'`));
  check('la bitácora no guarda contenido', leak === 0);
}

setProductSwitch(false);
check('estado final: kill-switch del producto apagado de nuevo', sql(`select bool_or(usage_ingest_enabled) from platform.product_integrations where saas_product_id = '${ESUP}'`) === 'f');

console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
