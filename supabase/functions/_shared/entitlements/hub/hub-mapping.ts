/**
 * Mapeo del export del hub GMAO a referencia legacy (spec §15.3, fase 16).
 *
 * Función PURA y determinista: no lee la base, no escribe estado comercial
 * (ni `tenant_addons` ni suscripciones: el hub no crea clientes en
 * MasterAdmin) y no importa precios (D-01; el export ya no los trae).
 *
 * Reglas de mapeo de cada código del catálogo del hub, en este orden y SIN
 * inventar códigos (spec §4.2):
 *   (a) existe el alias (producto, 'GMAO_HUB', código) → su capacidad
 *       (si esa capacidad no está en el registro: UNMAPPED
 *       `ALIAS_TARGET_NOT_IN_REGISTRY`, el alias está roto);
 *   (b) el código del hub YA es un código canónico del registro del producto
 *       (caso eCommerce) → esa capacidad, y una PROPUESTA de alias para que el
 *       operador la registre con `platform.upsert_capability_alias`;
 *   si no, UNMAPPED `NO_ALIAS_NO_CANONICAL`.
 *
 * Decisión sobre propuestas y estado de la capacidad: el alias es solo una
 * traducción (no concede nada), así que se propone para capacidades ACTIVE y
 * DRAFT (`REGISTER`; el estado va en la propuesta y la paridad avisa de la
 * DRAFT). Para DEPRECATED la acción es `REVIEW`: registrar un alias nuevo
 * hacia algo en retirada es una decisión del operador, no un paso automático.
 *
 * Atribución a producto: un código pertenece a un producto por el `appCode`
 * de su ítem de catálogo (`products[].hubAppCode`). Un add-on o una
 * suscripción cuyo código no está en el catálogo no se atribuye por prefijo
 * (sería inventar): va a `unattributedCodes`. Una suscripción cuyo código es
 * el de la app (p. ej. `ecommerce`) es la suscripción a la app, no una
 * capacidad, y se ignora aquí (la actividad de la app sale de workspaceApps).
 *
 * Compañías: el export solo ve las compañías que tienen alguna fila en
 * `companyAddons` (de cualquier app), así que `totalCompanies` es ese
 * conjunto. Una compañía sin ninguna fila no es visible para el hub.
 *
 * Salida byte-estable: todo ordenado, sin marcas de tiempo propias, y
 * `mappingChecksum` = `sha256:` del JCS del resultado sin ese campo.
 */
import { canonicalize } from '../jcs.ts';
import { sha256Hex } from '../../provisioning/fingerprint.ts';
import type { CapabilityStatus, RegistryCapability } from '../types.ts';
import {
  hubExportContentChecksum,
  type HubEnvironment,
  type HubExport,
  type HubItemKind,
  type HubWorkspaceAppStatus,
} from './hub-export.ts';

export const HUB_MAPPING_FORMAT = 'gmao-hub-mapping.v1';
export const HUB_ALIAS_SOURCE = 'GMAO_HUB';
/** Estados de `workspace_subscriptions` que siguen concediendo el ítem. */
export const HUB_ACTIVE_SUBSCRIPTION_STATUSES: readonly string[] = ['active', 'trialing', 'past_due'];

export interface HubMappingProduct {
  /** `saas_products.code` en MasterAdmin. */
  code: string;
  /** `apps.code` / `catalog_items.app_code` en el hub. */
  hubAppCode: string;
}

export interface HubCapabilityAlias {
  productCode: string;
  aliasSource: string;
  aliasCode: string;
  capabilityCode: string;
}

export interface HubTenantLink {
  productCode: string;
  /** uuid de la organización en el hub. */
  organizationId: string;
  /** uuid del tenant en MasterAdmin. */
  tenantId: string;
}

export interface HubMappingContext {
  products: HubMappingProduct[];
  /** Registro de capacidades por código de producto. */
  registry: Record<string, RegistryCapability[]>;
  aliases: HubCapabilityAlias[];
  tenantLinks: HubTenantLink[];
}

export type HubMappingRule = 'ALIAS' | 'CANONICAL' | 'UNMAPPED';
export type HubUnmappedReason = 'NO_ALIAS_NO_CANONICAL' | 'ALIAS_TARGET_NOT_IN_REGISTRY';

export interface HubCodeMapping {
  productCode: string;
  hubCode: string;
  rule: HubMappingRule;
  capabilityCode: string | null;
  capabilityStatus: CapabilityStatus | null;
  isBaseline: boolean;
  reason: HubUnmappedReason | null;
}

export interface HubAliasProposal {
  productCode: string;
  aliasSource: typeof HUB_ALIAS_SOURCE;
  aliasCode: string;
  capabilityCode: string;
  capabilityStatus: CapabilityStatus;
  action: 'REGISTER' | 'REVIEW';
}

export interface HubUnmappedCode {
  productCode: string;
  hubCode: string;
  reason: HubUnmappedReason;
  /** Alguna compañía (o suscripción de organización) lo tiene activo. */
  activeAnywhere: boolean;
  activeOrganizations: number;
}

export interface LegacyCapabilityState {
  activeCompanies: number;
  totalCompanies: number;
  /** Concedida a la organización entera por una suscripción activa. */
  viaSubscription: boolean;
  hubCodes: string[];
}

export interface LegacyTenantState {
  productCode: string;
  organizationId: string;
  /** Tenant de MasterAdmin; null si la organización no está vinculada. */
  tenantId: string | null;
  linked: boolean;
  appStatus: HubWorkspaceAppStatus | null;
  appActive: boolean;
  totalCompanies: number;
  /** Código canónico → estado en el hub. Solo capacidades con alguna concesión activa. */
  capabilities: Record<string, LegacyCapabilityState>;
  unmappedActiveCodes: string[];
  /** Códigos activos cuyo ítem de catálogo está `available=false`. */
  unavailableActiveCodes: string[];
}

export interface HubCatalogReference {
  productCode: string | null;
  hubAppCode: string;
  code: string;
  name: string;
  kind: HubItemKind;
  available: boolean;
  capabilityCode: string | null;
}

export interface HubUnattributedCode {
  organizationId: string;
  code: string;
  source: 'COMPANY_ADDON' | 'SUBSCRIPTION';
  active: boolean;
}

export interface HubMappingResult {
  format: typeof HUB_MAPPING_FORMAT;
  environment: HubEnvironment;
  /**
   * Checksum del CONTENIDO normalizado del export (independiente del orden de
   * sus arreglos). El checksum del exportador depende de ese orden y por eso
   * no entra aquí; va en la atestación (`buildParityAttestation`).
   */
  exportContentChecksum: string;
  exportGeneratedAt: string;
  mappings: HubCodeMapping[];
  aliasProposals: HubAliasProposal[];
  unmapped: HubUnmappedCode[];
  legacyTenantState: LegacyTenantState[];
  catalogReference: HubCatalogReference[];
  unmanagedApps: string[];
  unattributedCodes: HubUnattributedCode[];
  mappingChecksum: string;
}

export class HubMappingError extends Error {
  readonly code = 'HUB_MAPPING_CONTEXT_INVALID';
  constructor(message: string) {
    super(`HUB_MAPPING_CONTEXT_INVALID: ${message}`);
    this.name = 'HubMappingError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(cmp);
}

function sortRecord<T>(record: Map<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of [...record.keys()].sort(cmp)) out[key] = record.get(key) as T;
  return out;
}

interface IndexedContext {
  productByApp: Map<string, HubMappingProduct>;
  registry: Map<string, Map<string, RegistryCapability>>;
  /** `${product}\u0000${aliasCode}` → capabilityCode (solo GMAO_HUB). */
  hubAliases: Map<string, string>;
  /** `${product}\u0000${organizationId}` → tenantId. */
  links: Map<string, string>;
  linksByProduct: Map<string, HubTenantLink[]>;
}

const pair = (a: string, b: string) => `${a}\u0000${b}`;

function indexContext(ctx: HubMappingContext): IndexedContext {
  if (!ctx || !Array.isArray(ctx.products) || !Array.isArray(ctx.aliases) || !Array.isArray(ctx.tenantLinks)) {
    throw new HubMappingError('products, aliases y tenantLinks deben ser arreglos');
  }
  if (!ctx.registry || typeof ctx.registry !== 'object') throw new HubMappingError('registry debe ser un objeto');

  const productByApp = new Map<string, HubMappingProduct>();
  const productCodes = new Set<string>();
  const registry = new Map<string, Map<string, RegistryCapability>>();
  for (const product of ctx.products) {
    if (productCodes.has(product.code)) throw new HubMappingError(`producto repetido: ${product.code}`);
    if (productByApp.has(product.hubAppCode)) {
      throw new HubMappingError(`la app del hub ${product.hubAppCode} está asignada a dos productos`);
    }
    productCodes.add(product.code);
    productByApp.set(product.hubAppCode, product);
    const rows = ctx.registry[product.code];
    if (!Array.isArray(rows)) throw new HubMappingError(`falta el registro de capacidades de ${product.code}`);
    const byCode = new Map<string, RegistryCapability>();
    for (const row of rows) {
      if (byCode.has(row.code)) throw new HubMappingError(`capacidad repetida en el registro: ${row.code}`);
      byCode.set(row.code, row);
    }
    registry.set(product.code, byCode);
  }

  const hubAliases = new Map<string, string>();
  for (const alias of ctx.aliases) {
    if (alias.aliasSource !== HUB_ALIAS_SOURCE) continue;
    if (!productCodes.has(alias.productCode)) continue; // alias de un producto fuera de este mapeo
    const id = pair(alias.productCode, alias.aliasCode);
    const known = hubAliases.get(id);
    if (known !== undefined && known !== alias.capabilityCode) {
      throw new HubMappingError(`alias GMAO_HUB ${alias.productCode}/${alias.aliasCode} con dos destinos`);
    }
    hubAliases.set(id, alias.capabilityCode);
  }

  const links = new Map<string, string>();
  const tenantsSeen = new Map<string, string>();
  const linksByProduct = new Map<string, HubTenantLink[]>();
  for (const link of ctx.tenantLinks) {
    if (!productCodes.has(link.productCode)) throw new HubMappingError(`vínculo de un producto desconocido: ${link.productCode}`);
    if (!UUID_RE.test(link.organizationId) || !UUID_RE.test(link.tenantId)) {
      throw new HubMappingError('los vínculos tenant↔organización usan uuids en minúsculas');
    }
    const orgPair = pair(link.productCode, link.organizationId);
    const tenantPair = pair(link.productCode, link.tenantId);
    const knownTenant = links.get(orgPair);
    const knownOrg = tenantsSeen.get(tenantPair);
    if ((knownTenant !== undefined && knownTenant !== link.tenantId) || (knownOrg !== undefined && knownOrg !== link.organizationId)) {
      throw new HubMappingError(`vínculo tenant↔organización ambiguo en ${link.productCode}`);
    }
    if (knownTenant !== undefined) continue; // repetido idéntico
    links.set(orgPair, link.tenantId);
    tenantsSeen.set(tenantPair, link.organizationId);
    const list = linksByProduct.get(link.productCode) ?? [];
    list.push(link);
    linksByProduct.set(link.productCode, list);
  }

  return { productByApp, registry, hubAliases, links, linksByProduct };
}

function mapCode(ix: IndexedContext, productCode: string, hubCode: string): HubCodeMapping {
  const registry = ix.registry.get(productCode) as Map<string, RegistryCapability>;
  const aliasTarget = ix.hubAliases.get(pair(productCode, hubCode));
  if (aliasTarget !== undefined) {
    const capability = registry.get(aliasTarget);
    if (!capability) {
      return { productCode, hubCode, rule: 'UNMAPPED', capabilityCode: null, capabilityStatus: null, isBaseline: false, reason: 'ALIAS_TARGET_NOT_IN_REGISTRY' };
    }
    return { productCode, hubCode, rule: 'ALIAS', capabilityCode: capability.code, capabilityStatus: capability.status, isBaseline: capability.isBaseline, reason: null };
  }
  const canonical = registry.get(hubCode);
  if (canonical) {
    return { productCode, hubCode, rule: 'CANONICAL', capabilityCode: canonical.code, capabilityStatus: canonical.status, isBaseline: canonical.isBaseline, reason: null };
  }
  return { productCode, hubCode, rule: 'UNMAPPED', capabilityCode: null, capabilityStatus: null, isBaseline: false, reason: 'NO_ALIAS_NO_CANONICAL' };
}

interface TenantAccumulator {
  productCode: string;
  organizationId: string;
  appStatus: HubWorkspaceAppStatus | null;
  capabilityCompanies: Map<string, Set<string>>;
  capabilityViaSubscription: Set<string>;
  capabilityHubCodes: Map<string, Set<string>>;
  unmappedActive: Set<string>;
  unavailableActive: Set<string>;
}

/**
 * Traduce un export ya validado (`parseHubExport`) a referencia legacy.
 * No escribe nada; las propuestas de alias las ejecuta el operador.
 */
export async function mapHubExport(hubExport: HubExport, ctx: HubMappingContext): Promise<HubMappingResult> {
  const ix = indexContext(ctx);

  // Catálogo → mapeo por (producto, código).
  const itemByCode = new Map<string, { productCode: string; available: boolean; mapping: HubCodeMapping }>();
  const mappings: HubCodeMapping[] = [];
  const catalogReference: HubCatalogReference[] = [];
  const unmanagedApps = new Set<string>();
  /** Códigos de apps sin producto en el contexto: se informan vía unmanagedApps, no uno a uno. */
  const unmanagedItemCodes = new Set<string>();

  for (const item of hubExport.catalogItems) {
    const product = ix.productByApp.get(item.appCode);
    if (!product) {
      unmanagedApps.add(item.appCode);
      unmanagedItemCodes.add(item.code);
      catalogReference.push({ productCode: null, hubAppCode: item.appCode, code: item.code, name: item.name, kind: item.kind, available: item.available, capabilityCode: null });
      continue;
    }
    const mapping = mapCode(ix, product.code, item.code);
    mappings.push(mapping);
    // El código de un add-on no lleva app: si dos apps gestionadas compartieran código, sería ambiguo.
    if (itemByCode.has(item.code)) {
      throw new HubMappingError(`el código ${item.code} aparece en dos apps gestionadas del catálogo`);
    }
    itemByCode.set(item.code, { productCode: product.code, available: item.available, mapping });
    catalogReference.push({ productCode: product.code, hubAppCode: item.appCode, code: item.code, name: item.name, kind: item.kind, available: item.available, capabilityCode: mapping.capabilityCode });
  }
  for (const app of hubExport.apps) if (!ix.productByApp.has(app.code)) unmanagedApps.add(app.code);
  for (const ws of hubExport.workspaceApps) if (!ix.productByApp.has(ws.appCode)) unmanagedApps.add(ws.appCode);

  // Propuestas de alias: solo regla (b).
  const aliasProposals: HubAliasProposal[] = mappings
    .filter((m) => m.rule === 'CANONICAL')
    .map((m) => ({
      productCode: m.productCode,
      aliasSource: HUB_ALIAS_SOURCE,
      aliasCode: m.hubCode,
      capabilityCode: m.capabilityCode as string,
      capabilityStatus: m.capabilityStatus as CapabilityStatus,
      action: m.capabilityStatus === 'DEPRECATED' ? ('REVIEW' as const) : ('REGISTER' as const),
    }));

  // Compañías visibles por organización.
  const companiesOfOrg = new Map<string, Set<string>>();
  for (const addon of hubExport.companyAddons) {
    const set = companiesOfOrg.get(addon.organizationId) ?? new Set<string>();
    set.add(addon.companyId);
    companiesOfOrg.set(addon.organizationId, set);
  }

  const tenants = new Map<string, TenantAccumulator>();
  const tenantFor = (productCode: string, organizationId: string): TenantAccumulator => {
    const id = pair(productCode, organizationId);
    let acc = tenants.get(id);
    if (!acc) {
      acc = {
        productCode,
        organizationId,
        appStatus: null,
        capabilityCompanies: new Map(),
        capabilityViaSubscription: new Set(),
        capabilityHubCodes: new Map(),
        unmappedActive: new Set(),
        unavailableActive: new Set(),
      };
      tenants.set(id, acc);
    }
    return acc;
  };
  const unattributed: HubUnattributedCode[] = [];
  const unmappedActiveOrgs = new Map<string, Set<string>>();

  const recordActive = (acc: TenantAccumulator, hubCode: string, companyId: string | null) => {
    const item = itemByCode.get(hubCode)!;
    if (!item.available) acc.unavailableActive.add(hubCode);
    const { mapping } = item;
    if (mapping.capabilityCode === null) {
      acc.unmappedActive.add(hubCode);
      const orgs = unmappedActiveOrgs.get(pair(mapping.productCode, hubCode)) ?? new Set<string>();
      orgs.add(acc.organizationId);
      unmappedActiveOrgs.set(pair(mapping.productCode, hubCode), orgs);
      return;
    }
    const code = mapping.capabilityCode;
    const hubCodes = acc.capabilityHubCodes.get(code) ?? new Set<string>();
    hubCodes.add(hubCode);
    acc.capabilityHubCodes.set(code, hubCodes);
    const companies = acc.capabilityCompanies.get(code) ?? new Set<string>();
    if (companyId === null) acc.capabilityViaSubscription.add(code);
    else companies.add(companyId);
    acc.capabilityCompanies.set(code, companies);
  };

  for (const ws of hubExport.workspaceApps) {
    const product = ix.productByApp.get(ws.appCode);
    if (product) tenantFor(product.code, ws.organizationId).appStatus = ws.status;
  }
  for (const addon of hubExport.companyAddons) {
    if (unmanagedItemCodes.has(addon.addonCode)) continue;
    const item = itemByCode.get(addon.addonCode);
    if (!item) {
      unattributed.push({ organizationId: addon.organizationId, code: addon.addonCode, source: 'COMPANY_ADDON', active: addon.active });
      continue;
    }
    const acc = tenantFor(item.productCode, addon.organizationId);
    if (addon.active) recordActive(acc, addon.addonCode, addon.companyId);
  }
  for (const sub of hubExport.subscriptions) {
    if (ix.productByApp.has(sub.itemCode) || unmanagedApps.has(sub.itemCode)) continue; // suscripción a la app
    if (unmanagedItemCodes.has(sub.itemCode)) continue;
    const item = itemByCode.get(sub.itemCode);
    const active = HUB_ACTIVE_SUBSCRIPTION_STATUSES.includes(sub.status);
    if (!item) {
      unattributed.push({ organizationId: sub.organizationId, code: sub.itemCode, source: 'SUBSCRIPTION', active });
      continue;
    }
    const acc = tenantFor(item.productCode, sub.organizationId);
    if (active) recordActive(acc, sub.itemCode, null);
  }
  for (const [productCode, list] of ix.linksByProduct) {
    for (const link of list) tenantFor(productCode, link.organizationId);
  }

  const legacyTenantState: LegacyTenantState[] = [...tenants.values()]
    .map((acc): LegacyTenantState => {
      const tenantId = ix.links.get(pair(acc.productCode, acc.organizationId)) ?? null;
      const totalCompanies = companiesOfOrg.get(acc.organizationId)?.size ?? 0;
      const capabilities = new Map<string, LegacyCapabilityState>();
      for (const [code, companies] of acc.capabilityCompanies) {
        capabilities.set(code, {
          activeCompanies: companies.size,
          totalCompanies,
          viaSubscription: acc.capabilityViaSubscription.has(code),
          hubCodes: sortedUnique(acc.capabilityHubCodes.get(code) ?? []),
        });
      }
      return {
        productCode: acc.productCode,
        organizationId: acc.organizationId,
        tenantId,
        linked: tenantId !== null,
        appStatus: acc.appStatus,
        appActive: acc.appStatus === 'active',
        totalCompanies,
        capabilities: sortRecord(capabilities),
        unmappedActiveCodes: sortedUnique(acc.unmappedActive),
        unavailableActiveCodes: sortedUnique(acc.unavailableActive),
      };
    })
    .sort((a, b) => cmp(a.productCode, b.productCode) || cmp(a.organizationId, b.organizationId));

  const unmapped: HubUnmappedCode[] = mappings
    .filter((m): m is HubCodeMapping & { reason: HubUnmappedReason } => m.rule === 'UNMAPPED')
    .map((m) => {
      const orgs = unmappedActiveOrgs.get(pair(m.productCode, m.hubCode));
      return {
        productCode: m.productCode,
        hubCode: m.hubCode,
        reason: m.reason,
        activeAnywhere: (orgs?.size ?? 0) > 0,
        activeOrganizations: orgs?.size ?? 0,
      };
    });

  const byProductCode = <T extends { productCode: string | null }>(key: (x: T) => string) => (a: T, b: T) =>
    cmp(a.productCode ?? '', b.productCode ?? '') || cmp(key(a), key(b));

  const result: Omit<HubMappingResult, 'mappingChecksum'> = {
    format: HUB_MAPPING_FORMAT,
    environment: hubExport.environment,
    exportContentChecksum: await hubExportContentChecksum(hubExport),
    exportGeneratedAt: hubExport.generatedAt,
    mappings: mappings.sort(byProductCode<HubCodeMapping>((m) => m.hubCode)),
    aliasProposals: aliasProposals.sort(byProductCode<HubAliasProposal>((p) => p.aliasCode)),
    unmapped: unmapped.sort(byProductCode<HubUnmappedCode>((u) => u.hubCode)),
    legacyTenantState,
    catalogReference: catalogReference.sort(
      (a, b) => cmp(a.hubAppCode, b.hubAppCode) || cmp(a.code, b.code),
    ),
    unmanagedApps: sortedUnique(unmanagedApps),
    unattributedCodes: unattributed.sort(
      (a, b) => cmp(a.organizationId, b.organizationId) || cmp(a.source, b.source) || cmp(a.code, b.code),
    ),
  };
  return { ...result, mappingChecksum: `sha256:${await sha256Hex(canonicalize(result))}` };
}
