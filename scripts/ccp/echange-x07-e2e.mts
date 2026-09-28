/**
 * E2E LOCAL de la fase 14 (X-07): MasterAdmin REAL → eChange REAL.
 *
 *   ECHANGE_WT=<worktree del programa en eChange> \
 *   ECHANGE_DB_CONTAINER=<contenedor supabase_db_* del stack LOCAL desechable de eChange> \
 *     node --experimental-transform-types scripts/ccp/echange-x07-e2e.mts
 *
 * Del lado MasterAdmin corre el código de producción: el emisor `buildSnapshot` y el cliente M2M
 * `EntitlementSyncClient` (JWT ES256 firmado con una clave generada EN MEMORIA, scopes de
 * entitlements, jti nuevo por intento, clasificación de respuestas).
 *
 * Del lado eChange corre su receptor de producción: `handleEntitlementsRequest` (lo que despacha
 * `platform-provisioning/index.ts`) servido por node:http, con su store real sobre las RPC reales de
 * la base DESECHABLE (cadena completa de migraciones), llamadas con el rol service_role de verdad. La
 * puerta (`echange_capacidad_activa`), la materialización en `ai_agents`/`channels`, el outbox de uso
 * y el dual-read (`echange_modelo_comercial_local` + `commercialParity.ts`) se consultan en esa base.
 *
 * El tenant se da de alta con la RPC de provisioning REAL de eChange y se borra al final (la base
 * es desechable, pero otras suites miran el estado global). Sin red externa, sin proyectos remotos.
 * No imprime claves ni tokens.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EntitlementSyncClient, type EntitlementDeliveryContext } from '../../supabase/functions/_shared/entitlements/sync-client.ts';
import { buildSnapshot } from '../../supabase/functions/_shared/entitlements/snapshot.ts';
import type { EntitlementSnapshot, GrantedCapability, RegistryCapability } from '../../supabase/functions/_shared/entitlements/types.ts';

const WT = process.env.ECHANGE_WT ?? '';
if (!WT.endsWith('/eChange/.worktrees/ebim-commercial-control-plane-v1')) {
  console.error('HARD STOP: ECHANGE_WT debe apuntar al worktree del programa en eChange');
  process.exit(2);
}
const container = process.env.ECHANGE_DB_CONTAINER ?? '';
if (!/^supabase_db_echange-ccp/.test(container)) {
  console.error('HARD STOP: ECHANGE_DB_CONTAINER debe nombrar el contenedor LOCAL desechable (supabase_db_echange-ccp*)');
  process.exit(2);
}

type Row = Record<string, unknown>;
const ecHandler = (await import(`${WT}/supabase/functions/_shared/entitlements/handler.ts`)) as {
  handleEntitlementsRequest(req: Request, deps: Row): Promise<Response>;
};
const ecConfig = (await import(`${WT}/supabase/functions/_shared/entitlements/config.ts`)) as {
  resolveEntitlementsConfig(env: Row, provisioning: Row | null): { ok: boolean };
};
const ecStore = (await import(`${WT}/supabase/functions/_shared/entitlements/store.ts`)) as {
  createEntitlementsStore(client: unknown): unknown;
};
const ecM2m = (await import(`${WT}/supabase/functions/_shared/platformM2M.ts`)) as {
  loadM2MConfig(env: { get(k: string): string | undefined }): Row | null;
  importMasterAdminPublicKey(b64: string): Promise<CryptoKey>;
};
const ecParidad = (await import(`${WT}/supabase/functions/_shared/commercialParity.ts`)) as {
  compararModeloComercial(m: unknown): { paridad: boolean; diferencias: { tipo: string; severidad: string; code: string }[] };
};

const results: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} · ${label}${detail ? ` · ${detail}` : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) process.exitCode = 1;
}

// ── La base desechable de eChange, por docker exec (sin puertos, sin claves) ──
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

// ── eChange: alta REAL, estado legacy, receptor HTTP ──────────────────────────
const CPT = '9f140000-0000-4000-8000-000000000001';
const ORG = '9f140000-0000-4000-8000-0000000000aa';
const CO = '9f140000-0000-4000-8000-0000000000cc';
const cleanup = () => psql(`
  delete from privado.platform_entitlement_enforcement_mode where scope_key = '${CPT}';
  delete from privado.platform_entitlement_legacy_backup where organization_id = '${ORG}';
  delete from privado.platform_entitlement_snapshot_applied where control_plane_tenant_id = '${CPT}';
  delete from privado.platform_provisioning_requests where control_plane_tenant_id = '${CPT}';
  delete from public.organizations where id = '${ORG}';`);
cleanup();
const alta = svcSql(`select public.platform_provision_tenant(${literal({
  controlPlaneTenantId: CPT, organization: { id: ORG, slug: 'x07-echange', name: 'X07 eChange' },
  company: { id: CO, name: 'X07 eChange' }, admin: { email: 'x07@echange.ebim.test' }, deploymentMode: 'SHARED',
  context: { environment: 'DEV' } })}::jsonb, ${literal({ idempotencyKey: 'ma-prov-v1-x07-echange', requestHash: 'a'.repeat(64),
  correlationId: crypto.randomUUID(), m2mSubject: 'masteradmin-provisioning', m2mJti: 'x07-alta' })}::jsonb) ->> 'outcome'`);
// Legacy: WhatsApp contratado y encendido por el operador; notas de voz apagadas por el tenant; el
// portal (incluido) lo enciende el tenant — el alta crea los canales apagados.
psql(`update public.channels set commercially_entitled = true, enabled = true where organization_id = '${ORG}' and type = 'whatsapp';
      update public.channels set enabled = true where organization_id = '${ORG}' and type = 'portal';
      update public.ai_agents set enabled = false where organization_id = '${ORG}' and agent_key = 'voice_transcriber';`);
const has = (code: string) => svcSql(`select public.echange_capacidad_activa('${ORG}', '${CO}', '${code}')`) === 't';
const fila = (tabla: 'ai_agents' | 'channels', col: string, key: string) =>
  psql(`select commercially_entitled || '|' || enabled from public.${tabla} where organization_id = '${ORG}' and ${col} = '${key}'`);
check('0. alta real de eChange (CREATED) y en SHADOW decide legacy (WhatsApp sí, notas de voz sí: sin gate previo)',
  alta === 'CREATED' && has('echange.channels.whatsapp') && has('echange.ai.voice_transcriber') && has('echange.ai.triage'), alta);

const envMap: Record<string, string> = {
  EBIM_MASTERADMIN_M2M_ENABLED: 'true',
  EBIM_MASTERADMIN_M2M_ISSUER: 'masteradmin.ebim',
  EBIM_MASTERADMIN_M2M_AUDIENCE: 'echange.ebim',
  EBIM_MASTERADMIN_M2M_SUBJECT: 'masteradmin-provisioning',
  EBIM_MASTERADMIN_M2M_ALGORITHM: 'ES256',
  EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME: '300',
  EBIM_MASTERADMIN_M2M_CREATE_SCOPE: 'echange:tenant:create',
  EBIM_MASTERADMIN_M2M_READ_SCOPE: 'echange:tenant:read',
  EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64: publicKeyB64,
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_WRITE_SCOPE: 'echange:entitlements:write',
  EBIM_MASTERADMIN_M2M_ENTITLEMENTS_READ_SCOPE: 'echange:entitlements:read',
  EBIM_ENTITLEMENTS_ENVIRONMENT: 'DEV',
};
const m2m = ecM2m.loadM2MConfig({ get: (k) => envMap[k] });
const receiverConfig = ecConfig.resolveEntitlementsConfig(envMap, m2m);
check('1. receptor eChange configurado (fail-closed si faltara algo; sujeto M2M exacto)', m2m !== null && receiverConfig.ok);
const receiverKey = await ecM2m.importMasterAdminPublicKey(publicKeyB64);

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
    m2m,
    publicKey: async () => receiverKey,
    config: receiverConfig,
    openStore: () => ecStore.createEntitlementsStore(rpc),
    log: () => {},
  });
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(await response.text());
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;

// ── MasterAdmin: contexto de entrega (lo que leería de product_integrations) ─
const SECRET_REF = 'LOCAL_X07_ECHANGE_M2M_PRIVATE_KEY';
const TIMEOUT_MS = 120_000; // cada RPC del receptor va por docker exec: se mide el contrato, no la latencia del puente.
const ctx = (writeScope = 'echange:entitlements:write'): EntitlementDeliveryContext => ({
  tenant: { controlPlaneTenantId: CPT, productCode: 'echange' },
  push_enabled: true,
  enrollment: 'ENROLLED',
  deployment: { id: 'x07', environment: 'DEV', base_url: `http://127.0.0.1:${port}/functions/v1/platform-provisioning`, timeout_ms: TIMEOUT_MS, retry_count: 0 },
  integration: {
    id: 'x07-int',
    type: 'HTTP_M2M',
    issuer: 'masteradmin.ebim',
    audience: 'echange.ebim',
    subject: 'masteradmin-provisioning',
    algorithm: 'ES256',
    token_ttl_seconds: 120,
    entitlements_path: '/tenants/{controlPlaneTenantId}/entitlements',
    entitlements_manifest_path: '/entitlements/manifest',
    entitlements_write_scope: writeScope,
    entitlements_read_scope: 'echange:entitlements:read',
    allowed_hosts: [],
  },
  credential: { id: 'x07-cred', type: 'M2M_ASYMMETRIC_JWT', enabled: true, algorithm: 'ES256', token_ttl_seconds: 120, secret_ref: SECRET_REF },
});
const client = new EntitlementSyncClient({
  secretResolver: (ref) => (ref === SECRET_REF ? privatePem : undefined),
  sleep: async () => {},
});
const actor = { id: '10000000-0000-4000-a000-000000000002', role: 'EBIM_FINANCE' };

// Registro de MasterAdmin = manifiesto importado de eChange (import_capability_manifest).
const manifestFile = JSON.parse(readFileSync(`${WT}/docs/platform-provisioning/ENTITLEMENTS_MANIFEST.json`, 'utf8')) as {
  capabilities: { code: string; kind: RegistryCapability['kind']; isBaseline: boolean; scopeLevel: 'TENANT' | 'COMPANY';
    unit?: string; meterCode?: string; status: RegistryCapability['status'] }[];
};
const registry: RegistryCapability[] = manifestFile.capabilities.map((c) => ({
  code: c.code, kind: c.kind, isBaseline: c.isBaseline, scopeLevel: c.scopeLevel,
  unit: c.unit ?? null, meterCode: c.meterCode ?? null, status: c.status,
}));

let clock = Date.parse('2026-10-07T00:00:00Z');
async function emit(version: number, features: string[], appActive = true): Promise<EntitlementSnapshot> {
  const granted: GrantedCapability[] = features.map((code) => ({ code, value: null, enforcement: null, included: null, sources: ['ADDON'], companyIds: null }));
  clock += 60_000;
  return buildSnapshot({
    environment: 'DEV',
    controlPlaneTenantId: CPT,
    productCode: 'echange',
    external: { tenantId: ORG, organizationId: ORG, companyIds: [CO] },
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

const WHATSAPP = 'echange.channels.whatsapp';
const REPORTES = 'echange.ai.report_writer';

// ── Escenario ────────────────────────────────────────────────────────────────
const manifest = await client.getManifest(ctx(), actor);
check('2. MasterAdmin lee el manifiesto (6 vendibles + 7 incluidos ACTIVE; asset_clerk, email_intake, línea y bolsa DRAFT)',
  manifest.ok && manifest.activeCodes.length === 13 && !manifest.activeCodes.includes('echange.ai.asset_clerk')
    && !manifest.activeCodes.includes('echange.cases.included') && !manifest.activeCodes.includes('echange.service_line'),
  manifest.ok ? `${manifest.manifestVersion} · ${manifest.activeCodes.length} ACTIVE` : manifest.errorCode);

const v1 = await emit(1, []);
check('3. el snapshot lista las 6 vendibles ACTIVE con enabled explícito, sin DRAFT ni baseline, sin precios',
  v1.capabilities.length === 6 && v1.capabilities.every((c) => c.enabled === false)
    && !/price|amount|currency|hourly|rate/i.test(JSON.stringify(v1)));
const p1 = await client.pushSnapshot(ctx(), v1, actor);
check('4. emisor real → PUT M2M real → APPLIED (en SHADOW: guarda y compara)', p1.result === 'APPLIED' && p1.appliedVersion === 1, `${p1.result} ${p1.httpStatus}`);
check('5. SHADOW no toca nada: WhatsApp sigue legacy (contratado y encendido)', fila('channels', 'type', 'whatsapp') === 'true|true' && has(WHATSAPP));
const diffs = Number(psql(`select count(*) from privado.platform_entitlement_shadow_diffs where control_plane_tenant_id = '${CPT}' and snapshot_version = 1`));
check('6. SHADOW registra la diferencia legacy vs snapshot (WhatsApp)', diffs >= 1, `${diffs} diferencias`);

svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'DUAL_READ', 'x07')`);
svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'PRIMARY', 'x07')`);
const g1 = await client.getApplied(ctx(), actor);
check('7. GET: misma versión y checksum, PRIMARY', g1.result === 'OBSERVED' && g1.appliedVersion === 1
  && g1.appliedChecksum === v1.checksum && g1.enforcementMode === 'PRIMARY', `${g1.appliedVersion} ${g1.enforcementMode}`);
check('8. PRIMARY: el snapshot sustituye al legacy (WhatsApp sin derecho y apagado) y lo incluido sigue',
  fila('channels', 'type', 'whatsapp') === 'false|false' && !has(WHATSAPP) && has('echange.ai.triage') && has('echange.channels.portal'));

const v2 = await emit(2, [WHATSAPP, REPORTES]);
const p2 = await client.pushSnapshot(ctx(), v2, actor);
psql(`update public.ai_agents set enabled = true where organization_id = '${ORG}' and agent_key = 'report_writer';
      update public.channels set enabled = true where organization_id = '${ORG}' and type = 'whatsapp';`);
check('9. v2 concede WhatsApp + reportería → APPLIED; el tenant los enciende y la puerta los ve',
  p2.result === 'APPLIED' && fila('ai_agents', 'agent_key', 'report_writer') === 'true|true' && has(REPORTES) && has(WHATSAPP), p2.result);
const p2r = await client.pushSnapshot(ctx(), v2, actor);
check('10. replay idempotente → REPLAYED', p2r.result === 'REPLAYED' && p2r.appliedVersion === 2, p2r.result);
const stale = await client.pushSnapshot(ctx(), v1, actor);
check('11. v1 tras v2 → STALE (409)', stale.result === 'STALE' && stale.httpStatus === 409 && stale.appliedVersion === 2, `${stale.result} ${stale.errorCode}`);
clock -= 60_000;
const v2b = await emit(2, []);
const conflict = await client.pushSnapshot(ctx(), v2b, actor);
check('12. misma versión, otro contenido → CONFLICT (409)', conflict.result === 'CONFLICT' && conflict.httpStatus === 409, `${conflict.result} ${conflict.errorCode}`);
const wrong = await client.pushSnapshot(ctx('echange:tenant:create'), v2, actor);
check('13. credencial con scope de provisioning → 403 REJECTED', wrong.result === 'REJECTED' && wrong.httpStatus === 403 && wrong.errorCode === 'INSUFFICIENT_SCOPE', `${wrong.httpStatus} ${wrong.errorCode}`);
check('14. PRIMARY: una escritura legacy del derecho queda bloqueada en servidor',
  /LEGACY_WRITE_BLOCKED/.test((() => {
    try { svcSql(`update public.channels set commercially_entitled = true where organization_id = '${ORG}' and type = 'phone'`); return ''; }
    catch (e) { return String((e as { stderr?: string }).stderr); }
  })()));

// Dual-read: tras materializar, el modelo comercial local coincide con MasterAdmin.
const modelo = JSON.parse(svcSql(`select public.echange_modelo_comercial_local('${CPT}')`)) as Row;
const paridad = ecParidad.compararModeloComercial(modelo);
check('15. dual-read: modelo comercial local = snapshot (paridad, sin precios en la lectura)',
  paridad.paridad && !/price|amount|currency/i.test(JSON.stringify(modelo)),
  paridad.diferencias.filter((d) => d.severidad === 'MISMATCH').map((d) => `${d.tipo}:${d.code}`).join(',') || 'sin diferencias');

// SaaS caído: MasterAdmin reintenta después; eChange sigue con su last-good.
saasUp = false;
const v3 = await emit(3, [REPORTES], false);
const down = await client.pushSnapshot(ctx(), v3, actor);
check('16. SaaS no disponible → RETRYABLE, nada aplicado', down.result === 'RETRYABLE', `${down.result} ${down.httpStatus}`);
saasUp = true;
const drift = await client.getApplied(ctx(), actor);
check('17. reconciliación: el GET delata deriva (aplicado v2 ≠ deseado v3)', drift.appliedVersion === 2 && drift.appliedChecksum !== v3.checksum);

// MasterAdmin inalcanzable: la puerta NO depende de él.
server.close();
check('18. offline: sin MasterAdmin ni receptor HTTP, la puerta sigue con el last-good v2', has(WHATSAPP) && has(REPORTES));

// Uso: un caso nuevo y una llamada IA quedan en el outbox, atribuidos, sin contenido y no facturables.
const ticket = psql(`insert into public.tickets (organization_id, company_id, raw_text) values ('${ORG}', '${CO}', 'x07 no imprime') returning id`);
const caso = psql(`select meter_code || '|' || control_plane_tenant_id || '|' || billable || '|' || status || '|' || (internal = '{}'::jsonb)
                     from privado.usage_outbox where subject_ref = '${ticket}'`);
check('19. caso nuevo → evento echange.cases con controlPlaneTenantId, billable=false, PENDING, sin contenido',
  caso === `echange.cases|${CPT}|false|PENDING|true`, caso);
const eventId = crypto.randomUUID();
const ia = svcSql(`select public.echange_registrar_uso_ia(${literal({ eventId, occurredAt: new Date(clock).toISOString(),
  organizationId: ORG, companyId: CO, functionName: 'ai-monthly-report', capabilityCode: REPORTES, outcome: 'SUCCEEDED',
  internal: { provider: 'anthropic', model: 'claude-sonnet-5', inputTokens: 1812, outputTokens: 640, httpStatus: 200 } })}::jsonb)`);
const iaRow = psql(`select control_plane_tenant_id || '|' || billable || '|' || coalesce(meter_code, 'null') from privado.usage_outbox where event_id = '${eventId}'`);
check('20. llamada IA → ACCEPTED, tokens reales, medidor NULL (D-06), billable=false', ia === 'ACCEPTED' && iaRow === `${CPT}|false|null`, iaRow);

// v3 (appActive=false) por la misma RPC: retira lo comercial, no lo operativo.
const p3 = await rpc.rpc('platform_apply_entitlements', {
  p_control_plane_tenant_id: CPT, p_snapshot: v3,
  p_meta: { correlationId: 'x07-v3', m2mSubject: 'masteradmin-provisioning', m2mJti: 'x07-v3' },
});
check('21. v3 appActive=false: reportería y WhatsApp retirados; clasificador y portal siguen (comercial ≠ operativo)',
  (p3.data as { httpStatus?: number } | null)?.httpStatus === 200 && !has(REPORTES) && !has(WHATSAPP)
    && has('echange.ai.triage') && has('echange.channels.portal'));

// Volver a SHADOW restaura lo legacy exacto.
svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'DUAL_READ', 'x07 rollback')`);
svcSql(`select public.platform_set_entitlement_enforcement_mode('${CPT}', 'SHADOW', 'x07 rollback')`);
check('22. rollback PRIMARY → DUAL_READ → SHADOW: WhatsApp vuelve a su legacy (contratado y encendido)',
  fila('channels', 'type', 'whatsapp') === 'true|true' && has(WHATSAPP));

cleanup();
check('23. limpieza: el tenant X-07 no queda en la base desechable',
  psql(`select count(*) from public.organizations where id = '${ORG}'`) === '0');

console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
