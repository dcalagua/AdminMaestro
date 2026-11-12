/**
 * Export comercial del hub GMAO — contrato `gmao-hub-commercial-export.v1`
 * (spec §15.3, fase 16).
 *
 * El hub (schema `platform` del proyecto GMAO) guarda una verdad comercial
 * LEGACY de otros SaaS: catálogo, apps por organización, add-ons por compañía
 * y suscripciones. MasterAdmin es la autoridad canónica; del hub solo se
 * importa REFERENCIA (alias GMAO_HUB y un reporte de diferencias). Por eso:
 *
 *   · nunca se lee el hub por DB_DIRECT: el operador entrega este export, que
 *     GMAO genera de solo lectura;
 *   · lista de claves CERRADA en cada nivel. Una clave fuera de la lista —un
 *     precio (D-01), un secreto, un campo que nadie acordó— invalida TODO el
 *     export (`HUB_EXPORT_FORBIDDEN_KEY`): lo que no se entiende no se importa
 *     a medias. Esta comprobación va PRIMERO, antes que el checksum, para que
 *     un export con precio no se procese ni siquiera para decir que está mal
 *     firmado;
 *   · checksum `sha256:` del JCS del documento sin `checksum` (el mismo
 *     esquema que ebim.entitlements/v1, `jcs.ts`), recalculado aquí;
 *   · el entorno declarado debe ser el esperado por el operador;
 *   · el exportador ordena los arreglos, pero el importador no confía en ese
 *     orden: devuelve todo ordenado por su clave natural.
 *
 * Los mensajes de error nombran la RUTA de la clave, nunca su valor.
 */
import { canonicalize, entitlementChecksum } from '../jcs.ts';
import { sha256Hex } from '../../provisioning/fingerprint.ts';

export const HUB_EXPORT_FORMAT = 'gmao-hub-commercial-export.v1';
export const HUB_EXPORT_SOURCE = 'GMAO_HUB';

export type HubEnvironment = 'DEV' | 'QAS' | 'DEMO' | 'PRD' | 'LOCAL';
export type HubItemKind = 'module' | 'addon' | 'connector' | 'ai';
export type HubWorkspaceAppStatus = 'requested' | 'active' | 'suspended';

export interface HubApp {
  code: string;
  name: string;
  available: boolean;
}

export interface HubCatalogItem {
  appCode: string;
  code: string;
  name: string;
  kind: HubItemKind;
  available: boolean;
}

export interface HubWorkspaceApp {
  organizationId: string;
  appCode: string;
  status: HubWorkspaceAppStatus;
}

export interface HubCompanyAddon {
  organizationId: string;
  companyId: string;
  addonCode: string;
  active: boolean;
}

export interface HubSubscription {
  organizationId: string;
  itemCode: string;
  /** Texto libre del hub (`active`, `canceled`, …): se valida solo la forma. */
  status: string;
  activatedAt: string | null;
  canceledAt: string | null;
}

export interface HubExport {
  format: typeof HUB_EXPORT_FORMAT;
  source: typeof HUB_EXPORT_SOURCE;
  environment: HubEnvironment;
  generatedAt: string;
  apps: HubApp[];
  catalogItems: HubCatalogItem[];
  workspaceApps: HubWorkspaceApp[];
  companyAddons: HubCompanyAddon[];
  subscriptions: HubSubscription[];
  checksum: string;
}

export type HubExportErrorCode =
  | 'HUB_EXPORT_INVALID'
  | 'HUB_EXPORT_FORMAT'
  | 'HUB_EXPORT_FORBIDDEN_KEY'
  | 'HUB_EXPORT_CHECKSUM_MISMATCH'
  | 'HUB_EXPORT_ENVIRONMENT_MISMATCH'
  | 'HUB_EXPORT_DUPLICATE';

export class HubExportError extends Error {
  constructor(
    readonly code: HubExportErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'HubExportError';
  }
}

export interface ParseHubExportOptions {
  expectedEnvironment: HubEnvironment;
}

const ENVIRONMENTS: readonly HubEnvironment[] = ['DEV', 'QAS', 'DEMO', 'PRD', 'LOCAL'];
const ITEM_KINDS: readonly HubItemKind[] = ['module', 'addon', 'connector', 'ai'];
const WORKSPACE_STATUSES: readonly HubWorkspaceAppStatus[] = ['requested', 'active', 'suspended'];

/** Claves permitidas por nivel. Cualquier otra → HUB_EXPORT_FORBIDDEN_KEY. */
const ROOT_KEYS = [
  'format',
  'source',
  'environment',
  'generatedAt',
  'apps',
  'catalogItems',
  'workspaceApps',
  'companyAddons',
  'subscriptions',
  'checksum',
] as const;
const ARRAY_KEYS = {
  apps: ['code', 'name', 'available'],
  catalogItems: ['appCode', 'code', 'name', 'kind', 'available'],
  workspaceApps: ['organizationId', 'appCode', 'status'],
  companyAddons: ['organizationId', 'companyId', 'addonCode', 'active'],
  subscriptions: ['organizationId', 'itemCode', 'status', 'activatedAt', 'canceledAt'],
} as const;
type ArrayName = keyof typeof ARRAY_KEYS;
const ARRAY_NAMES = Object.keys(ARRAY_KEYS) as ArrayName[];

// uuid canónico en minúsculas: es como lo emite PostgreSQL y como lo guarda MasterAdmin.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// ISO-8601 con zona explícita (Z u offset): una fecha sin zona es ambigua.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
// Códigos del hub: snake_case con prefijo o dot-notation (eCommerce); sin espacios.
const CODE_RE = /^[A-Za-z0-9]+([._-][A-Za-z0-9]+)*$/;
const STATUS_RE = /^[a-z][a-z_]{0,31}$/;
const CHECKSUM_RE = /^sha256:[0-9a-f]{64}$/;

const invalid = (message: string) => new HubExportError('HUB_EXPORT_INVALID', message);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Lista cerrada de claves. Recorre el documento entero ANTES de cualquier otra
 * validación; solo informa la ruta.
 */
function assertAllowedKeys(doc: Record<string, unknown>): void {
  const rootAllowed = new Set<string>(ROOT_KEYS);
  for (const key of Object.keys(doc)) {
    if (!rootAllowed.has(key)) {
      throw new HubExportError('HUB_EXPORT_FORBIDDEN_KEY', `clave no permitida en $.${key}`);
    }
  }
  for (const name of ARRAY_NAMES) {
    const rows = doc[name];
    if (!Array.isArray(rows)) continue; // la forma se valida después
    const allowed = new Set<string>(ARRAY_KEYS[name]);
    rows.forEach((row, i) => {
      if (!isPlainObject(row)) return;
      for (const key of Object.keys(row)) {
        if (!allowed.has(key)) {
          throw new HubExportError('HUB_EXPORT_FORBIDDEN_KEY', `clave no permitida en $.${name}[${i}].${key}`);
        }
      }
    });
  }
}

function field<T>(row: Record<string, unknown>, key: string, path: string, check: (v: unknown) => v is T, what: string): T {
  if (!(key in row)) throw invalid(`falta ${path}.${key}`);
  const value = row[key];
  if (!check(value)) throw invalid(`${path}.${key} no es ${what}`);
  return value;
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isUuid = (v: unknown): v is string => isString(v) && UUID_RE.test(v);
const isIso = (v: unknown): v is string => isString(v) && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
const isIsoOrNull = (v: unknown): v is string | null => v === null || isIso(v);
const isCode = (v: unknown): v is string => isString(v) && v.length <= 128 && CODE_RE.test(v);
const isName = (v: unknown): v is string => isString(v) && v.trim().length > 0 && v.length <= 256;
const oneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    isString(v) && (values as readonly string[]).includes(v);

function rowsOf(doc: Record<string, unknown>, name: ArrayName): Record<string, unknown>[] {
  const rows = doc[name];
  if (!Array.isArray(rows)) throw invalid(`$.${name} debe ser un arreglo`);
  return rows.map((row, i) => {
    if (!isPlainObject(row)) throw invalid(`$.${name}[${i}] debe ser un objeto`);
    return row;
  });
}

function compareBy<T>(...keys: (keyof T)[]) {
  return (a: T, b: T): number => {
    for (const key of keys) {
      const x = String(a[key]);
      const y = String(b[key]);
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  };
}

function assertUnique<T>(rows: T[], keyOf: (row: T) => string, what: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) throw new HubExportError('HUB_EXPORT_DUPLICATE', `${what} repetido: ${key}`);
    seen.add(key);
  }
}

/**
 * Valida y normaliza un export del hub. `raw` puede ser el texto JSON o el
 * objeto ya parseado. Lanza `HubExportError`; nunca devuelve un export parcial.
 */
export async function parseHubExport(raw: unknown, options: ParseHubExportOptions): Promise<HubExport> {
  let doc: unknown = raw;
  if (typeof raw === 'string') {
    try {
      doc = JSON.parse(raw);
    } catch {
      throw invalid('el export no es JSON válido');
    }
  }
  if (!isPlainObject(doc)) throw invalid('el export debe ser un objeto JSON');

  assertAllowedKeys(doc);

  if (doc.format !== HUB_EXPORT_FORMAT || doc.source !== HUB_EXPORT_SOURCE) {
    throw new HubExportError('HUB_EXPORT_FORMAT', `se esperaba ${HUB_EXPORT_FORMAT} con source ${HUB_EXPORT_SOURCE}`);
  }

  const root = '$';
  const environment = field(doc, 'environment', root, oneOf(ENVIRONMENTS), `un entorno (${ENVIRONMENTS.join('|')})`);
  const generatedAt = field(doc, 'generatedAt', root, isIso, 'una fecha ISO-8601 con zona');
  const checksum = field(doc, 'checksum', root, isString, 'texto');

  const apps: HubApp[] = rowsOf(doc, 'apps').map((row, i) => {
    const path = `$.apps[${i}]`;
    return {
      code: field(row, 'code', path, isCode, 'un código'),
      name: field(row, 'name', path, isName, 'un nombre'),
      available: field(row, 'available', path, isBoolean, 'booleano'),
    };
  });
  const catalogItems: HubCatalogItem[] = rowsOf(doc, 'catalogItems').map((row, i) => {
    const path = `$.catalogItems[${i}]`;
    return {
      appCode: field(row, 'appCode', path, isCode, 'un código'),
      code: field(row, 'code', path, isCode, 'un código'),
      name: field(row, 'name', path, isName, 'un nombre'),
      kind: field(row, 'kind', path, oneOf(ITEM_KINDS), `un tipo (${ITEM_KINDS.join('|')})`),
      available: field(row, 'available', path, isBoolean, 'booleano'),
    };
  });
  const workspaceApps: HubWorkspaceApp[] = rowsOf(doc, 'workspaceApps').map((row, i) => {
    const path = `$.workspaceApps[${i}]`;
    return {
      organizationId: field(row, 'organizationId', path, isUuid, 'un uuid'),
      appCode: field(row, 'appCode', path, isCode, 'un código'),
      status: field(row, 'status', path, oneOf(WORKSPACE_STATUSES), `un estado (${WORKSPACE_STATUSES.join('|')})`),
    };
  });
  const companyAddons: HubCompanyAddon[] = rowsOf(doc, 'companyAddons').map((row, i) => {
    const path = `$.companyAddons[${i}]`;
    return {
      organizationId: field(row, 'organizationId', path, isUuid, 'un uuid'),
      companyId: field(row, 'companyId', path, isUuid, 'un uuid'),
      addonCode: field(row, 'addonCode', path, isCode, 'un código'),
      active: field(row, 'active', path, isBoolean, 'booleano'),
    };
  });
  const subscriptions: HubSubscription[] = rowsOf(doc, 'subscriptions').map((row, i) => {
    const path = `$.subscriptions[${i}]`;
    return {
      organizationId: field(row, 'organizationId', path, isUuid, 'un uuid'),
      itemCode: field(row, 'itemCode', path, isCode, 'un código'),
      status: field(row, 'status', path, (v): v is string => isString(v) && STATUS_RE.test(v), 'un estado'),
      activatedAt: field(row, 'activatedAt', path, isIsoOrNull, 'ISO-8601 o null'),
      canceledAt: field(row, 'canceledAt', path, isIsoOrNull, 'ISO-8601 o null'),
    };
  });

  if (environment !== options.expectedEnvironment) {
    throw new HubExportError(
      'HUB_EXPORT_ENVIRONMENT_MISMATCH',
      `el export es de ${environment} y se esperaba ${options.expectedEnvironment}`,
    );
  }

  if (!CHECKSUM_RE.test(checksum) || checksum !== (await entitlementChecksum(doc))) {
    throw new HubExportError('HUB_EXPORT_CHECKSUM_MISMATCH', 'el checksum no corresponde al contenido del export');
  }

  assertUnique(apps, (a) => a.code, 'app');
  assertUnique(catalogItems, (c) => `${c.appCode}/${c.code}`, 'ítem de catálogo');
  assertUnique(workspaceApps, (w) => `${w.organizationId}/${w.appCode}`, 'workspace app');
  assertUnique(companyAddons, (a) => `${a.companyId}/${a.addonCode}`, 'add-on de compañía');
  assertUnique(subscriptions, (s) => `${s.organizationId}/${s.itemCode}`, 'suscripción');
  // Una compañía pertenece a UNA organización: si aparece en dos, el export es incoherente.
  const orgOfCompany = new Map<string, string>();
  for (const addon of companyAddons) {
    const known = orgOfCompany.get(addon.companyId);
    if (known !== undefined && known !== addon.organizationId) {
      throw new HubExportError('HUB_EXPORT_DUPLICATE', `compañía ${addon.companyId} en dos organizaciones`);
    }
    orgOfCompany.set(addon.companyId, addon.organizationId);
  }

  return {
    format: HUB_EXPORT_FORMAT,
    source: HUB_EXPORT_SOURCE,
    environment,
    generatedAt,
    apps: apps.sort(compareBy<HubApp>('code')),
    catalogItems: catalogItems.sort(compareBy<HubCatalogItem>('appCode', 'code')),
    workspaceApps: workspaceApps.sort(compareBy<HubWorkspaceApp>('organizationId', 'appCode')),
    companyAddons: companyAddons.sort(compareBy<HubCompanyAddon>('organizationId', 'companyId', 'addonCode')),
    subscriptions: subscriptions.sort(compareBy<HubSubscription>('organizationId', 'itemCode')),
    checksum,
  };
}

/**
 * `sha256:` del JCS del export NORMALIZADO (arreglos ordenados, sin
 * `checksum`). A diferencia del checksum del exportador, no depende del orden
 * en que llegaron los arreglos: dos exports con el mismo contenido dan el
 * mismo valor.
 */
export async function hubExportContentChecksum(hubExport: HubExport): Promise<string> {
  const { checksum: _ignored, ...rest } = hubExport;
  const normalized = {
    ...rest,
    apps: [...rest.apps].sort(compareBy<HubApp>('code')),
    catalogItems: [...rest.catalogItems].sort(compareBy<HubCatalogItem>('appCode', 'code')),
    workspaceApps: [...rest.workspaceApps].sort(compareBy<HubWorkspaceApp>('organizationId', 'appCode')),
    companyAddons: [...rest.companyAddons].sort(compareBy<HubCompanyAddon>('organizationId', 'companyId', 'addonCode')),
    subscriptions: [...rest.subscriptions].sort(compareBy<HubSubscription>('organizationId', 'itemCode')),
  };
  return `sha256:${await sha256Hex(canonicalize(normalized))}`;
}
