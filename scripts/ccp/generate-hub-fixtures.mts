/**
 * Genera los fixtures SINTÉTICOS del hub GMAO (fase 16, MA16):
 *
 *   supabase/functions/_shared/entitlements/hub/fixtures/hub-export.synthetic.json
 *   supabase/functions/_shared/entitlements/hub/fixtures/hub-context.synthetic.json
 *
 *   node --experimental-strip-types scripts/ccp/generate-hub-fixtures.mts
 *
 * Determinista: dos ejecuciones producen los mismos bytes. Nada de aquí es un
 * dato real de cliente: MiQuímica es la organización DEMO del hub (sus uuids
 * son los de la migración GMAO 20260915120000, ya sintéticos) y el resto usa
 * uuids `e0000000-…`/`a0000000-…` inventados. Sin precios (D-01): el export
 * del hub NUNCA trae `price_month`/`currency` y el importador lo rechaza.
 *
 * Qué ejercita:
 *   · eCommerce: los 24 ítems del catálogo del hub (códigos ya canónicos, todos
 *     `available=false`, precio 0 en el hub) y los 22 add-ons activos de
 *     MiQuímica → paridad GREEN con avisos (ítem no disponible pero activo,
 *     capacidad DRAFT);
 *   · eSupplier: códigos snake_case con alias GMAO_HUB, un código sin mapeo
 *     activo (`esupplier_legacy_portal`), un add-on activo solo en una de las
 *     dos compañías y una organización sin vínculo a tenant → BLOCKED;
 *   · eChange: app del hub sin producto en el contexto (se informa, no se mapea).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entitlementChecksum } from '../../supabase/functions/_shared/entitlements/jcs.ts';
import type { RegistryCapability } from '../../supabase/functions/_shared/entitlements/types.ts';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../supabase/functions/_shared/entitlements/hub/fixtures');

const MQ = 'd0000000-0000-4000-8000-000000000001';
const MQC = 'd0000000-0000-4000-8000-0000000000c1';
const SU = 'e0000000-0000-4000-8000-000000000001';
const SUC1 = 'e0000000-0000-4000-8000-0000000000c1';
const SUC2 = 'e0000000-0000-4000-8000-0000000000c2';
const SU2 = 'e0000000-0000-4000-8000-000000000002';
const SU2C1 = 'e0000000-0000-4000-8000-0000000000d1';
const TENANT_MQ = 'a0000000-0000-4000-8000-000000000001';
const TENANT_SU = 'a0000000-0000-4000-8000-000000000002';

type Kind = 'module' | 'addon' | 'connector' | 'ai';

const ECOMMERCE: [string, string, Kind][] = [
  ['ecommerce.catalog.advanced', 'Catálogo avanzado', 'module'],
  ['ecommerce.pricing.lists', 'Listas de precios', 'module'],
  ['ecommerce.customers.b2b', 'Cuentas de empresa', 'module'],
  ['ecommerce.inventory.multiwarehouse', 'Inventario multialmacén', 'module'],
  ['ecommerce.payments', 'Cobros en línea', 'module'],
  ['ecommerce.promotions', 'Promociones', 'addon'],
  ['ecommerce.content.cms', 'Gestor de contenido', 'addon'],
  ['ecommerce.content.white_label', 'Marca blanca', 'addon'],
  ['ecommerce.fulfillment', 'Entregas y devoluciones', 'module'],
  ['ecommerce.fulfillment.routing', 'Enrutado de entregas', 'addon'],
  ['ecommerce.orders.advanced', 'Pedidos avanzados', 'addon'],
  ['ecommerce.analytics.advanced', 'Analítica avanzada', 'addon'],
  ['ecommerce.integrations.enterprise', 'Integraciones corporativas', 'connector'],
  ['ecommerce.sales.force', 'Fuerza de ventas', 'module'],
  ['ecommerce.sales.territory', 'Territorios de venta', 'addon'],
  ['ecommerce.sales.performance', 'Desempeño comercial', 'addon'],
  ['ecommerce.credit.management', 'Gestión de crédito', 'module'],
  ['ecommerce.invoicing', 'Facturación', 'module'],
  ['ecommerce.trade.quotes', 'Cotizaciones', 'addon'],
  ['ecommerce.trade.assortments', 'Surtidos por cliente', 'addon'],
  ['ecommerce.planning.demand', 'Planificación de demanda', 'addon'],
  ['ecommerce.ai.assist', 'Asistencia con IA', 'ai'],
  ['ecommerce.ai.catalog.copy', 'Redacción de fichas con IA', 'ai'],
  ['ecommerce.ai.insights', 'Análisis y alertas con IA', 'ai'],
];
/** Los 22 add-ons que MiQuímica tiene activos en el hub (migración GMAO 20260915120000). */
const ECOMMERCE_ACTIVE = ECOMMERCE.map(([code]) => code).filter(
  (code) => code !== 'ecommerce.ai.catalog.copy' && code !== 'ecommerce.ai.insights',
);
/** En el registro sintético esta capacidad sigue en DRAFT: ejercita DRAFT_CAPABILITY_IN_HUB. */
const ECOMMERCE_DRAFT = 'ecommerce.planning.demand';

function by<T>(...keys: (keyof T)[]) {
  return (a: T, b: T): number => {
    for (const key of keys) {
      if (a[key] < b[key]) return -1;
      if (a[key] > b[key]) return 1;
    }
    return 0;
  };
}

function cap(code: string, over: Partial<RegistryCapability> = {}): RegistryCapability {
  return {
    code,
    kind: code.includes('.ai.') ? 'AI_FEATURE' : 'FEATURE',
    isBaseline: false,
    scopeLevel: 'COMPANY',
    unit: null,
    meterCode: code.includes('.ai.') ? 'ai.credits' : null,
    status: 'ACTIVE',
    ...over,
  };
}

async function buildExport(): Promise<Record<string, unknown>> {
  type Item = { appCode: string; code: string; name: string; kind: Kind; available: boolean };
  type Addon = { organizationId: string; companyId: string; addonCode: string; active: boolean };
  type WsApp = { organizationId: string; appCode: string; status: string };
  type Sub = { organizationId: string; itemCode: string; status: string; activatedAt: string | null; canceledAt: string | null };

  const catalogItems: Item[] = [
    ...ECOMMERCE.map(([code, name, kind]): Item => ({ appCode: 'ecommerce', code, name, kind, available: false })),
    { appCode: 'esupplier', code: 'esupplier_dorothy_copilot', name: 'Dorothy Copilot', kind: 'ai', available: true },
    { appCode: 'esupplier', code: 'esupplier_sourcing_events', name: 'Eventos de abastecimiento', kind: 'addon', available: true },
    { appCode: 'esupplier', code: 'esupplier_extra_company', name: 'Empresa adicional', kind: 'addon', available: true },
    { appCode: 'esupplier', code: 'esupplier_legacy_portal', name: 'Portal legado', kind: 'addon', available: true },
    { appCode: 'echange', code: 'echange_voice', name: 'Voz', kind: 'addon', available: false },
  ];
  const companyAddons: Addon[] = [
    ...ECOMMERCE_ACTIVE.map((addonCode): Addon => ({ organizationId: MQ, companyId: MQC, addonCode, active: true })),
    { organizationId: MQ, companyId: MQC, addonCode: 'ecommerce.ai.catalog.copy', active: false },
    { organizationId: SU, companyId: SUC1, addonCode: 'esupplier_dorothy_copilot', active: true },
    { organizationId: SU, companyId: SUC2, addonCode: 'esupplier_dorothy_copilot', active: true },
    { organizationId: SU, companyId: SUC1, addonCode: 'esupplier_sourcing_events', active: true },
    { organizationId: SU, companyId: SUC2, addonCode: 'esupplier_sourcing_events', active: false },
    { organizationId: SU, companyId: SUC1, addonCode: 'esupplier_legacy_portal', active: true },
    { organizationId: SU2, companyId: SU2C1, addonCode: 'esupplier_dorothy_copilot', active: true },
  ];
  const workspaceApps: WsApp[] = [
    { organizationId: MQ, appCode: 'ecommerce', status: 'active' },
    { organizationId: SU, appCode: 'esupplier', status: 'active' },
    { organizationId: SU2, appCode: 'esupplier', status: 'requested' },
  ];
  const subscriptions: Sub[] = [
    { organizationId: MQ, itemCode: 'ecommerce', status: 'active', activatedAt: '2026-09-15T12:00:00Z', canceledAt: null },
    { organizationId: SU, itemCode: 'esupplier_extra_company', status: 'active', activatedAt: '2026-08-01T00:00:00Z', canceledAt: null },
  ];

  const doc: Record<string, unknown> = {
    format: 'gmao-hub-commercial-export.v1',
    source: 'GMAO_HUB',
    environment: 'LOCAL',
    generatedAt: '2026-09-28T12:00:00Z',
    apps: [
      { code: 'echange', name: 'eChange', available: true },
      { code: 'ecommerce', name: 'eCommerce', available: true },
      { code: 'esupplier', name: 'eSupplier', available: true },
    ],
    catalogItems: catalogItems.sort(by<Item>('appCode', 'code')),
    workspaceApps: workspaceApps.sort(by<WsApp>('organizationId', 'appCode')),
    companyAddons: companyAddons.sort(by<Addon>('organizationId', 'companyId', 'addonCode')),
    subscriptions: subscriptions.sort(by<Sub>('organizationId', 'itemCode')),
  };
  doc.checksum = await entitlementChecksum(doc);
  return doc;
}

function buildContext(): Record<string, unknown> {
  const ecommerceRegistry: RegistryCapability[] = [
    // Incluidas (baseline): no se venden y la paridad las ignora.
    cap('ecommerce.catalog', { isBaseline: true, scopeLevel: 'TENANT' }),
    cap('ecommerce.storefront', { isBaseline: true, scopeLevel: 'TENANT' }),
    ...ECOMMERCE.map(([code]) => cap(code, code === ECOMMERCE_DRAFT ? { status: 'DRAFT' } : {})),
  ].sort(by<RegistryCapability>('code'));
  const esupplierRegistry: RegistryCapability[] = [
    cap('esupplier.core', { isBaseline: true, scopeLevel: 'TENANT' }),
    cap('esupplier.ai.dorothy_copilot'),
    cap('esupplier.sourcing.events'),
    cap('esupplier.companies.extra', { scopeLevel: 'TENANT' }),
  ].sort(by<RegistryCapability>('code'));

  const enabledEcommerce = new Set(ECOMMERCE_ACTIVE.filter((c) => c !== ECOMMERCE_DRAFT));
  const ecommerceSnapshot = {
    productCode: 'ecommerce',
    controlPlaneTenantId: TENANT_MQ,
    appActive: true,
    // Igual que buildSnapshot: toda FEATURE/AI_FEATURE no baseline ACTIVE, con enabled explícito.
    capabilities: ecommerceRegistry
      .filter((c) => !c.isBaseline && c.status === 'ACTIVE')
      .map((c) => ({
        code: c.code,
        enabled: enabledEcommerce.has(c.code),
        scope: { level: 'COMPANY', ...(enabledEcommerce.has(c.code) ? { companyIds: [MQC] } : {}) },
        sources: enabledEcommerce.has(c.code) ? ['ADDON'] : [],
      })),
    limits: [],
    allowances: [],
  };
  const esupplierSnapshot = {
    productCode: 'esupplier',
    controlPlaneTenantId: TENANT_SU,
    appActive: true,
    capabilities: [
      { code: 'esupplier.ai.dorothy_copilot', enabled: true, scope: { level: 'COMPANY' }, sources: ['ADDON'] },
      { code: 'esupplier.companies.extra', enabled: false, scope: { level: 'TENANT' }, sources: [] },
      { code: 'esupplier.sourcing.events', enabled: true, scope: { level: 'COMPANY', companyIds: [SUC1] }, sources: ['ADDON'] },
    ],
    limits: [],
    allowances: [],
  };

  return {
    format: 'gmao-hub-mapping-context.v1',
    products: [
      { code: 'ecommerce', hubAppCode: 'ecommerce' },
      { code: 'esupplier', hubAppCode: 'esupplier' },
    ],
    registry: { ecommerce: ecommerceRegistry, esupplier: esupplierRegistry },
    aliases: [
      { productCode: 'ecommerce', aliasSource: 'GMAO_HUB', aliasCode: 'ecommerce.promotions', capabilityCode: 'ecommerce.promotions' },
      { productCode: 'esupplier', aliasSource: 'GMAO_HUB', aliasCode: 'esupplier_dorothy_copilot', capabilityCode: 'esupplier.ai.dorothy_copilot' },
      { productCode: 'esupplier', aliasSource: 'GMAO_HUB', aliasCode: 'esupplier_extra_company', capabilityCode: 'esupplier.companies.extra' },
      { productCode: 'esupplier', aliasSource: 'GMAO_HUB', aliasCode: 'esupplier_sourcing_events', capabilityCode: 'esupplier.sourcing.events' },
      // Mismo código pero de OTRA fuente: no participa en el mapeo del hub.
      { productCode: 'esupplier', aliasSource: 'LOCAL_ADDON', aliasCode: 'esupplier_legacy_portal', capabilityCode: 'esupplier.sourcing.events' },
    ],
    tenantLinks: [
      { productCode: 'ecommerce', organizationId: MQ, tenantId: TENANT_MQ },
      { productCode: 'esupplier', organizationId: SU, tenantId: TENANT_SU },
    ],
    snapshots: [ecommerceSnapshot, esupplierSnapshot],
  };
}

const exportDoc = await buildExport();
writeFileSync(join(OUT, 'hub-export.synthetic.json'), `${JSON.stringify(exportDoc, null, 2)}\n`);
writeFileSync(join(OUT, 'hub-context.synthetic.json'), `${JSON.stringify(buildContext(), null, 2)}\n`);
console.log(`hub fixtures: ${String(exportDoc.checksum)}`);
