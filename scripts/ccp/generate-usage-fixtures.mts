/**
 * Genera los fixtures de FIX-USG-v1 (contracts/usage/v1) y CHECKSUMS.sha256.
 * Determinista: dos ejecuciones producen los mismos bytes.
 *
 * Los archivos escritos a mano (README.md, *.schema.json, reference-sender.ts)
 * no se generan aquí; sí entran en CHECKSUMS.sha256.
 *
 * Uso: node --experimental-strip-types scripts/ccp/generate-usage-fixtures.mts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../contracts/usage/v1');

// Identificadores sintéticos (el E2E de MasterAdmin los traduce a su seed local).
const T_MAPPED = '00000000-0000-4ccc-8000-0000000000a1';
const T_UNMAPPED = '00000000-0000-4ccc-8000-0000000000a2';
const T_OTHER_PRODUCT = '00000000-0000-4ccc-8000-0000000000a3';
const BATCH_ID = '00000000-0000-4ccc-8000-00000000b001';
const id = (n: number) => `00000000-0000-4ccc-8000-${(0xe000 + n).toString(16).padStart(12, '0')}`;

const base = (n: number, over: Record<string, unknown> = {}) => ({
  eventId: id(n),
  meterCode: 'fixture.ai.calls',
  quantity: 1,
  unit: 'call',
  occurredAt: '2026-09-05T10:00:00Z',
  controlPlaneTenantId: T_MAPPED,
  externalCompanyId: 'fixture-co-01',
  capabilityCode: 'fixture.ai.copilot',
  ...over,
});

const internalFull = { provider: 'anthropic', model: 'fixture-model', inputTokens: 1200, outputTokens: 300, latencyMs: 850 };

const cases: Array<{ name: string; description: string; event: Record<string, unknown>; expect: { status: string; code?: string } }> = [
  { name: 'accepted-with-provider-tokens', description: 'Evento válido; tokens que el proveedor devolvió.', event: base(1, { internal: internalFull }), expect: { status: 'ACCEPTED' } },
  { name: 'duplicate-identical', description: 'Mismo eventId y mismo contenido: DUPLICATE (el outbox lo marca sent).', event: base(1, { internal: internalFull }), expect: { status: 'DUPLICATE' } },
  { name: 'conflict-same-id-different-content', description: 'Mismo eventId, contenido distinto: CONFLICT (alerta, dead-letter).', event: base(1, { quantity: 2 }), expect: { status: 'REJECTED', code: 'CONFLICT' } },
  { name: 'accepted-provider-returned-no-tokens', description: 'El proveedor no devolvió tokens: internal sin claves de tokens (nunca 0 inventado).', event: base(2, { internal: { provider: 'deepgram', model: 'fixture-stt' } }), expect: { status: 'ACCEPTED' } },
  { name: 'accepted-decimal-quantity', description: 'Cantidad decimal no negativa (≤ 6 decimales).', event: base(3, { meterCode: 'fixture.voice.seconds', unit: 'second', quantity: 12.5, capabilityCode: undefined }), expect: { status: 'ACCEPTED' } },
  { name: 'accepted-late-past-period', description: 'occurredAt de un período anterior: se acepta; MasterAdmin lo imputa (late) si ese período ya está FINALIZED.', event: base(4, { occurredAt: '2026-01-15T08:00:00Z' }), expect: { status: 'ACCEPTED' } },
  { name: 'accepted-negative-on-compensating-meter', description: 'Negativa solo en un medidor que declara allowsNegative.', event: base(5, { meterCode: 'fixture.adjust', quantity: -1, capabilityCode: undefined }), expect: { status: 'ACCEPTED' } },
  { name: 'rejected-negative-quantity', description: 'Cantidad negativa en medidor normal.', event: base(6, { quantity: -1 }), expect: { status: 'REJECTED', code: 'NEGATIVE_QUANTITY' } },
  { name: 'rejected-unknown-meter', description: 'Medidor no registrado.', event: base(7, { meterCode: 'fixture.nope' }), expect: { status: 'REJECTED', code: 'UNKNOWN_METER' } },
  { name: 'rejected-draft-meter', description: 'Medidor DRAFT (no aprobado): UNKNOWN_METER.', event: base(8, { meterCode: 'fixture.draft' }), expect: { status: 'REJECTED', code: 'UNKNOWN_METER' } },
  { name: 'rejected-unit-mismatch', description: 'Unidad distinta a la del medidor.', event: base(9, { unit: 'page' }), expect: { status: 'REJECTED', code: 'UNIT_MISMATCH' } },
  { name: 'rejected-tenant-not-mapped', description: 'Tenant sin mapping ACTIVE para este producto (D-12).', event: base(10, { controlPlaneTenantId: T_UNMAPPED }), expect: { status: 'REJECTED', code: 'TENANT_NOT_MAPPED_FOR_PRODUCT' } },
  { name: 'rejected-tenant-of-other-product', description: 'Tenant de otro producto: la credencial solo habla por el suyo.', event: base(11, { controlPlaneTenantId: T_OTHER_PRODUCT }), expect: { status: 'REJECTED', code: 'TENANT_NOT_MAPPED_FOR_PRODUCT' } },
  { name: 'rejected-occurred-in-future', description: 'occurredAt más de 5 min en el futuro.', event: base(12, { occurredAt: '2099-01-01T00:00:00Z' }), expect: { status: 'REJECTED', code: 'OCCURRED_AT_IN_FUTURE' } },
  { name: 'rejected-internal-with-content', description: 'internal con contenido del cliente: prohibido.', event: base(13, { internal: { provider: 'anthropic', prompt: 'fixture text' } }), expect: { status: 'REJECTED', code: 'INTERNAL_METADATA_INVALID' } },
  { name: 'rejected-internal-negative-tokens', description: 'Tokens negativos o no enteros.', event: base(14, { internal: { provider: 'anthropic', inputTokens: -5 } }), expect: { status: 'REJECTED', code: 'INTERNAL_METADATA_INVALID' } },
  { name: 'rejected-invalid-event', description: 'eventId no UUID / campos faltantes.', event: { eventId: 'not-a-uuid', meterCode: 'fixture.ai.calls', quantity: 1 }, expect: { status: 'REJECTED', code: 'INVALID_EVENT' } },
  { name: 'rejected-extra-field', description: 'Campo no previsto por el contrato.', event: base(15, { prompt: 'fixture text' }), expect: { status: 'REJECTED', code: 'INVALID_EVENT' } },
];

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const batch = {
  schema: 'ebim.usage/v1',
  environment: 'DEV',
  productCode: 'fixture',
  batchId: BATCH_ID,
  events: cases.map((c) => clean(c.event)),
};

const setup = {
  description:
    'Estado de MasterAdmin contra el que se evalúa fixtures/ingest-batch.json en orden. El E2E de MasterAdmin ' +
    '(scripts/ccp/usage-ingest-e2e.mts) lo crea en su stack local con identificadores de su seed.',
  productCode: 'fixture',
  environment: 'DEV',
  meters: [
    { code: 'fixture.ai.calls', unit: 'call', aggregation: 'SUM', measurement: 'EVENT', status: 'ACTIVE', allowsNegative: false, capabilityCode: 'fixture.ai.copilot' },
    { code: 'fixture.voice.seconds', unit: 'second', aggregation: 'SUM', measurement: 'EVENT', status: 'ACTIVE', allowsNegative: false },
    { code: 'fixture.adjust', unit: 'call', aggregation: 'SUM', measurement: 'EVENT', status: 'ACTIVE', allowsNegative: true },
    { code: 'fixture.draft', unit: 'call', aggregation: 'SUM', measurement: 'EVENT', status: 'DRAFT', allowsNegative: false },
  ],
  tenants: [
    { controlPlaneTenantId: T_MAPPED, mapping: 'ACTIVE', environment: 'DEV' },
    { controlPlaneTenantId: T_UNMAPPED, mapping: 'NONE' },
    { controlPlaneTenantId: T_OTHER_PRODUCT, mapping: 'ACTIVE_OTHER_PRODUCT' },
  ],
};

const results = {
  description: 'Resultado por evento de POST usage-ingest con fixtures/ingest-batch.json sobre setup.json, en orden.',
  httpStatus: 200,
  results: cases.map((c) => ({ name: c.name, eventId: (c.event.eventId as string) ?? null, ...c.expect })),
  accepted: cases.filter((c) => c.expect.status === 'ACCEPTED').length,
  duplicate: cases.filter((c) => c.expect.status === 'DUPLICATE').length,
  rejected: cases.filter((c) => c.expect.status === 'REJECTED').length,
};

const transport = {
  description:
    'Errores de LOTE (HTTP ≠ 200). Ninguno descarta eventos: el outbox reintenta con backoff y token nuevo. ' +
    '`when` describe la condición; `status`/`error` es la respuesta exacta.',
  cases: [
    { when: 'USAGE_INGEST_ENABLED != true (D-12) o kill-switch del producto apagado', status: 503, error: 'USAGE_INGEST_DISABLED' },
    { when: 'método distinto de POST', status: 405, error: 'METHOD_NOT_ALLOWED' },
    { when: 'content-type distinto de application/json', status: 415, error: 'UNSUPPORTED_MEDIA_TYPE' },
    { when: 'cuerpo > 262144 bytes', status: 413, error: 'PAYLOAD_TOO_LARGE' },
    { when: 'sin Authorization: Bearer', status: 401, error: 'TOKEN_MISSING' },
    { when: 'JWT mal formado, sin jti/iat/exp enteros', status: 401, error: 'TOKEN_INVALID' },
    { when: 'alg ≠ ES256', status: 401, error: 'ALGORITHM_NOT_ALLOWED' },
    { when: 'iss sin credencial registrada', status: 401, error: 'ISSUER_UNKNOWN' },
    { when: 'credencial deshabilitada', status: 403, error: 'CREDENTIAL_DISABLED' },
    { when: 'clave pública no configurada en el entorno de MasterAdmin', status: 503, error: 'CREDENTIAL_NOT_CONFIGURED' },
    { when: 'firma inválida', status: 401, error: 'SIGNATURE_INVALID' },
    { when: 'aud ≠ masteradmin.ebim', status: 401, error: 'AUDIENCE_INVALID' },
    { when: 'exp vencido (skew 60 s)', status: 401, error: 'TOKEN_EXPIRED' },
    { when: 'iat/nbf en el futuro (skew 60 s)', status: 401, error: 'TOKEN_NOT_YET_VALID' },
    { when: 'exp − iat > 300', status: 401, error: 'TOKEN_TTL_TOO_LONG' },
    { when: 'scope sin usage:ingest', status: 403, error: 'SCOPE_MISSING' },
    { when: 'jti ya usado por ese emisor', status: 401, error: 'JTI_REPLAYED' },
    { when: 'schema ≠ ebim.usage/v1', status: 400, error: 'SCHEMA_UNSUPPORTED' },
    { when: 'JSON inválido, batchId no UUID, events vacío o no arreglo', status: 400, error: 'INVALID_BATCH' },
    { when: 'más de 500 eventos', status: 400, error: 'BATCH_TOO_LARGE' },
    { when: 'environment ≠ ambiente de la credencial', status: 400, error: 'ENVIRONMENT_MISMATCH' },
    { when: 'productCode ≠ producto de la credencial', status: 400, error: 'PRODUCT_MISMATCH' },
    { when: 'error transitorio de la base', status: 503, error: 'RETRYABLE' },
  ],
};

const e = (n: number) => ({ eventId: id(100 + n) });
const classification = {
  description:
    'Vectores de clasificación del outbox: dada la respuesta, qué hace el SaaS con cada evento del lote. ' +
    'SENT = marcar enviado; DEAD = terminal con su código (dead-letter, no se reintenta); RETRY = backoff y token nuevo.',
  backoffSeconds: { formula: 'min(30 * 2^(attempt-1), 21600)', samples: [[1, 30], [2, 60], [3, 120], [10, 15360], [11, 21600], [50, 21600]] },
  vectors: [
    { name: 'mixed-results', batch: [e(1), e(2), e(3)], response: { status: 200, body: { results: [
      { eventId: id(101), status: 'ACCEPTED' }, { eventId: id(102), status: 'DUPLICATE' }, { eventId: id(103), status: 'REJECTED', code: 'UNKNOWN_METER' }] } },
      expect: [{ eventId: id(101), outcome: 'SENT' }, { eventId: id(102), outcome: 'SENT' }, { eventId: id(103), outcome: 'DEAD', code: 'UNKNOWN_METER' }] },
    { name: 'missing-result-retries', batch: [e(1), e(2)], response: { status: 200, body: { results: [{ eventId: id(101), status: 'ACCEPTED' }] } },
      expect: [{ eventId: id(101), outcome: 'SENT' }, { eventId: id(102), outcome: 'RETRY', code: 'MISSING_RESULT' }] },
    { name: 'results-matched-by-position', batch: [e(1), e(2)], response: { status: 200, body: { results: [
      { eventId: id(102), status: 'ACCEPTED' }, { eventId: id(101), status: 'ACCEPTED' }] } },
      expect: [{ eventId: id(101), outcome: 'RETRY', code: 'MISSING_RESULT' }, { eventId: id(102), outcome: 'RETRY', code: 'MISSING_RESULT' }] },
    { name: 'disabled-retries-all', batch: [e(1), e(2)], response: { status: 503, body: { error: 'USAGE_INGEST_DISABLED' } },
      expect: [{ eventId: id(101), outcome: 'RETRY', code: 'USAGE_INGEST_DISABLED' }, { eventId: id(102), outcome: 'RETRY', code: 'USAGE_INGEST_DISABLED' }] },
    { name: 'auth-error-retries-all', batch: [e(1)], response: { status: 401, body: { error: 'SIGNATURE_INVALID' } },
      expect: [{ eventId: id(101), outcome: 'RETRY', code: 'SIGNATURE_INVALID' }] },
    { name: 'transport-error', batch: [e(1)], response: { status: null, body: null },
      expect: [{ eventId: id(101), outcome: 'RETRY', code: 'TRANSPORT_ERROR' }] },
    { name: 'non-json-5xx', batch: [e(1)], response: { status: 502, body: null },
      expect: [{ eventId: id(101), outcome: 'RETRY', code: 'HTTP_502' }] },
    { name: 'conflict-is-terminal', batch: [e(1)], response: { status: 200, body: { results: [{ eventId: id(101), status: 'REJECTED', code: 'CONFLICT' }] } },
      expect: [{ eventId: id(101), outcome: 'DEAD', code: 'CONFLICT' }] },
  ],
};

const meters = {
  description:
    'Medidores que emiten los SaaS en v1. Se registran en MasterAdmin (upsert_usage_meter) por el product admin; ' +
    'nacen is_billable=false (D-06). Ningún DAILY_SNAPSHOT está aprobado: los SaaS NO emiten fotos diarias hasta que ' +
    'un humano apruebe la dimensión. Ningún peso de crédito está aprobado (D-03): mapear cuotas por acción a peso 1 ' +
    'requiere aprobación explícita.',
  eventMeters: [
    { productCode: 'ecommerce', code: 'ecommerce.ai.calls', unit: 'call', aggregation: 'SUM', measurement: 'EVENT', capabilityCodeFromEvent: true },
    { productCode: 'ewm', code: 'ewm.ai.calls', unit: 'call', aggregation: 'SUM', measurement: 'EVENT', capabilityCodeFromEvent: true },
    { productCode: 'comerza', code: 'comerza.ai.calls', unit: 'call', aggregation: 'SUM', measurement: 'EVENT', capabilityCodeFromEvent: true },
    { productCode: 'esupplier', code: 'esupplier.ai.calls', unit: 'call', aggregation: 'SUM', measurement: 'EVENT', capabilityCodeFromEvent: true },
    { productCode: 'echange', code: 'echange.ai.calls', unit: 'call', aggregation: 'SUM', measurement: 'EVENT', capabilityCodeFromEvent: true },
    { productCode: 'echange', code: 'echange.voice.seconds', unit: 'second', aggregation: 'SUM', measurement: 'EVENT', capabilityCodeFromEvent: true },
    { productCode: 'eexpense', code: 'eexpense.ai.calls', unit: 'call', aggregation: 'SUM', measurement: 'EVENT', capabilityCodeFromEvent: true },
    { productCode: 'gmao', code: 'gmao.ai.calls', unit: 'call', aggregation: 'SUM', measurement: 'EVENT', capabilityCodeFromEvent: true },
  ],
  dailySnapshotMeters: [],
  notEmitting: [{ productCode: 'tms', reason: 'Sin medidor aprobado (plan §12.2).' }],
};

function write(rel: string, value: unknown) {
  const path = join(ROOT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

write('fixtures/setup.json', setup);
write('fixtures/ingest-batch.json', batch);
write('expected/ingest-results.json', results);
write('expected/transport-errors.json', transport);
write('expected/classification-vectors.json', classification);
write('meters.json', meters);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(ROOT)
  .map((p) => relative(ROOT, p))
  .filter((r) => r !== 'CHECKSUMS.sha256' && !r.endsWith('.test.ts'))
  .sort();
const lines = files.map((f) => `${createHash('sha256').update(readFileSync(join(ROOT, f))).digest('hex')}  ${f}`);
writeFileSync(join(ROOT, 'CHECKSUMS.sha256'), lines.join('\n') + '\n');
const pin = createHash('sha256').update(readFileSync(join(ROOT, 'CHECKSUMS.sha256'))).digest('hex');
console.log(`FIX-USG-v1: ${files.length} archivos · sha256(CHECKSUMS.sha256) = ${pin}`);
