/**
 * Dry-run de la importación del hub GMAO como referencia legacy (fase 16,
 * spec §15.3). SOLO LEE ARCHIVOS: nunca abre una conexión a ninguna base,
 * nunca escribe estado comercial y nunca registra alias. Lo que produce es
 * texto para el operador:
 *
 *   1. resumen del mapeo (alias existentes, coincidencias canónicas, códigos
 *      sin mapeo, apps sin producto, códigos no atribuidos);
 *   2. las llamadas SQL `platform.upsert_capability_alias(...)` que el
 *      operador puede ejecutar él mismo en MasterAdmin (paso manual);
 *   3. el reporte de paridad dual-read (markdown);
 *   4. la atestación por producto, entre marcadores <<<ATTESTATIONS … ATTESTATIONS>>>,
 *      para la RPC service_role de GMAO `platform.ccp_record_hub_parity(...)`.
 *
 * Uso:
 *   node --experimental-transform-types scripts/ccp/gmao-hub-import-dryrun.mts --dry-run \
 *     --export <export.json> --context <context.json> --environment LOCAL|DEV|QAS|DEMO|PRD \
 *     [--ran-at <ISO-8601>]
 *
 * El export es el documento `gmao-hub-commercial-export.v1` que entrega GMAO.
 * El contexto es un JSON con `products`, `registry`, `aliases`, `tenantLinks`
 * y, opcionalmente, `snapshots` (vista de paridad o snapshots completos
 * ebim.entitlements/v1; los completos se verifican antes de usarse). Ver
 * supabase/functions/_shared/entitlements/hub/fixtures/.
 *
 * Guarda de entorno: si VITE_SUPABASE_URL / SUPABASE_DB_URL / SUPABASE_URL
 * están declaradas, deben apuntar al stack local (misma regla que
 * scripts/ccp/guard-env.sh, que es la que se ejecuta). Nunca se imprimen.
 *
 * Códigos de salida: 0 corrida completa (aunque la paridad sea BLOCKED: es un
 * resultado, no un fallo), 1 export/contexto rechazado, 2 uso o entorno
 * inválidos.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifySnapshot } from '../../supabase/functions/_shared/entitlements/snapshot.ts';
import type { EntitlementSnapshot } from '../../supabase/functions/_shared/entitlements/types.ts';
import {
  parseHubExport,
  type HubEnvironment,
} from '../../supabase/functions/_shared/entitlements/hub/hub-export.ts';
import {
  mapHubExport,
  type HubAliasProposal,
  type HubMappingContext,
  type HubMappingResult,
} from '../../supabase/functions/_shared/entitlements/hub/hub-mapping.ts';
import {
  buildParityAttestation,
  compareHubWithMasterAdmin,
  renderHubParityReport,
  summarizeHubParity,
  type HubParitySnapshotView,
} from '../../supabase/functions/_shared/entitlements/hub/hub-parity.ts';

const ENVIRONMENTS: HubEnvironment[] = ['DEV', 'QAS', 'DEMO', 'PRD', 'LOCAL'];
const GUARD = fileURLToPath(new URL('./guard-env.sh', import.meta.url));

function usage(message: string): never {
  process.stderr.write(`gmao-hub-import-dryrun: ${message}\n`);
  process.stderr.write(
    'uso: --dry-run --export <export.json> --context <context.json> --environment <LOCAL|DEV|QAS|DEMO|PRD> [--ran-at <ISO>]\n',
  );
  process.exit(2);
}

function reject(message: string): never {
  process.stderr.write(`gmao-hub-import-dryrun: RECHAZADO: ${message}\n`);
  process.exit(1);
}

/** Reusa guard-env.sh solo si hay destino declarado (este script no lo necesita). */
function guardEnvironment(): void {
  const { VITE_SUPABASE_URL, SUPABASE_DB_URL, SUPABASE_URL } = process.env;
  const PATH = process.env.PATH ?? '';
  const checks: Record<string, string>[] = [];
  if (VITE_SUPABASE_URL || SUPABASE_DB_URL) {
    checks.push({ PATH, ...(VITE_SUPABASE_URL ? { VITE_SUPABASE_URL } : {}), ...(SUPABASE_DB_URL ? { SUPABASE_DB_URL } : {}) });
  }
  // SUPABASE_URL se revisa con la misma regla, pasándola como VITE_SUPABASE_URL.
  if (SUPABASE_URL) checks.push({ PATH, VITE_SUPABASE_URL: SUPABASE_URL });
  for (const env of checks) {
    const r = spawnSync('bash', [GUARD], { env, encoding: 'utf8' });
    if (r.status !== 0) {
      process.stderr.write(r.stderr);
      usage('el entorno declara un Supabase que no es el stack local; este dry-run solo corre en local');
    }
  }
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function aliasSql(p: HubAliasProposal): string {
  const call = `select platform.upsert_capability_alias(${[p.productCode, p.aliasSource, p.aliasCode, p.capabilityCode]
    .map(sqlLiteral)
    .join(', ')});`;
  if (p.action === 'REVIEW') return `-- REVIEW (capacidad ${p.capabilityStatus}): decisión del operador\n-- ${call}`;
  return p.capabilityStatus === 'ACTIVE' ? call : `${call}  -- capacidad ${p.capabilityStatus}`;
}

function mappingSummary(mapping: HubMappingResult): string[] {
  const out: string[] = ['## Mapeo', ''];
  const products = [...new Set(mapping.mappings.map((m) => m.productCode))].sort();
  out.push('| Producto | Ítems hub | ALIAS | CANONICAL | UNMAPPED | Propuestas |', '| --- | --- | --- | --- | --- | --- |');
  for (const product of products) {
    const rows = mapping.mappings.filter((m) => m.productCode === product);
    const count = (rule: string) => rows.filter((m) => m.rule === rule).length;
    const proposals = mapping.aliasProposals.filter((p) => p.productCode === product).length;
    out.push(`| ${product} | ${rows.length} | ${count('ALIAS')} | ${count('CANONICAL')} | ${count('UNMAPPED')} | ${proposals} |`);
  }
  out.push('', '### Códigos sin mapeo', '');
  if (mapping.unmapped.length === 0) out.push('Ninguno.');
  for (const u of mapping.unmapped) {
    out.push(`- ${u.productCode} · \`${u.hubCode}\` · ${u.reason} · activo en ${u.activeOrganizations} organización(es)`);
  }
  out.push('', `Apps del hub sin producto en el contexto: ${mapping.unmanagedApps.join(', ') || 'ninguna'}`);
  out.push(`Códigos no atribuidos (fuera del catálogo): ${mapping.unattributedCodes.length}`);
  for (const u of mapping.unattributedCodes) out.push(`- ${u.source} · org ${u.organizationId} · \`${u.code}\` · activo=${String(u.active)}`);
  return out;
}

async function snapshotsOf(raw: unknown): Promise<HubParitySnapshotView[]> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) reject('context.snapshots debe ser un arreglo');
  for (const s of raw as Record<string, unknown>[]) {
    // Un snapshot completo se verifica (checksum y reglas) antes de usarse.
    if (s && typeof s === 'object' && 'schema' in s) {
      const problems = await verifySnapshot(s as unknown as EntitlementSnapshot);
      if (problems.length > 0) reject(`snapshot inválido (${String(s.productCode)}): ${problems.join('; ')}`);
    }
  }
  return raw as HubParitySnapshotView[];
}

async function main(): Promise<void> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      options: {
        'dry-run': { type: 'boolean' },
        export: { type: 'string' },
        context: { type: 'string' },
        environment: { type: 'string' },
        'ran-at': { type: 'string' },
      },
      strict: true,
    }));
  } catch (error) {
    usage((error as Error).message);
  }
  if (values['dry-run'] !== true) usage('--dry-run es obligatorio: es el único modo (no hay escrituras)');
  const exportPath = values.export as string | undefined;
  const contextPath = values.context as string | undefined;
  const environment = values.environment as HubEnvironment | undefined;
  if (!exportPath || !contextPath) usage('faltan --export y/o --context');
  if (!environment || !ENVIRONMENTS.includes(environment)) usage('--environment debe ser LOCAL, DEV, QAS, DEMO o PRD');
  guardEnvironment();

  let hubExport;
  let context: HubMappingContext & { snapshots?: unknown };
  try {
    hubExport = await parseHubExport(readFileSync(exportPath, 'utf8'), { expectedEnvironment: environment });
  } catch (error) {
    reject((error as Error).message);
  }
  try {
    context = JSON.parse(readFileSync(contextPath, 'utf8'));
  } catch {
    reject('el contexto no es JSON legible');
  }
  let mapping: HubMappingResult;
  try {
    mapping = await mapHubExport(hubExport, context);
  } catch (error) {
    reject((error as Error).message);
  }
  const snapshots = await snapshotsOf(context.snapshots);

  const results = mapping.legacyTenantState.map((state) =>
    compareHubWithMasterAdmin(
      state,
      snapshots.find((s) => s.productCode === state.productCode && s.controlPlaneTenantId === state.tenantId) ?? null,
      context.registry[state.productCode],
    ),
  );
  const ranAt = (values['ran-at'] as string | undefined) ?? new Date().toISOString();
  const attestations = [];
  for (const s of summarizeHubParity(results)) {
    attestations.push(await buildParityAttestation(s.productCode, results, hubExport.checksum, ranAt));
  }

  const out: string[] = [
    '# GMAO hub · importación legacy · DRY-RUN',
    '',
    'Modo: DRY-RUN (sin conexión a bases, sin escrituras, sin precios). El registro de alias es un paso del operador.',
    `Entorno del export: ${hubExport.environment} · generado: ${hubExport.generatedAt}`,
    `Checksum del export (GMAO): \`${hubExport.checksum}\``,
    `Checksum del contenido: \`${mapping.exportContentChecksum}\``,
    `Checksum del mapeo: \`${mapping.mappingChecksum}\``,
    '',
    ...mappingSummary(mapping),
    '',
    '## SQL para el operador (MasterAdmin, NO se ejecuta aquí)',
    '',
    '```sql',
    ...(mapping.aliasProposals.length === 0 ? ['-- sin propuestas'] : mapping.aliasProposals.map(aliasSql)),
    '```',
    '',
    renderHubParityReport(results, {
      environment: hubExport.environment,
      generatedAt: ranAt,
      exportContentChecksum: mapping.exportContentChecksum,
      mappingChecksum: mapping.mappingChecksum,
    }),
    '## Atestaciones (para platform.ccp_record_hub_parity en GMAO, paso del operador)',
    '',
    '<<<ATTESTATIONS',
    JSON.stringify(attestations, null, 2),
    'ATTESTATIONS>>>',
    '',
  ];
  process.stdout.write(out.join('\n'));
}

await main();
