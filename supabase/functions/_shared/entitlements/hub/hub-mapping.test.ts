import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalize, entitlementChecksum } from '../jcs';
import { assertSnapshotSafe } from '../snapshot';
import { sha256Hex } from '../../provisioning/fingerprint';
import { hubExportContentChecksum, parseHubExport, type HubExport } from './hub-export';
import { HubMappingError, mapHubExport, type HubMappingContext } from './hub-mapping';

/*
 * Mapeo del export del hub a referencia legacy (spec §15.3): alias GMAO_HUB
 * existentes, propuestas de alias para códigos que YA son canónicos, códigos
 * sin mapeo y el estado legacy por tenant×producto. Nunca inventa códigos ni
 * escribe estado comercial: es una función pura y byte-estable.
 */

const MQ = 'd0000000-0000-4000-8000-000000000001';
const MQC = 'd0000000-0000-4000-8000-0000000000c1';
const SU = 'e0000000-0000-4000-8000-000000000001';
const SU2 = 'e0000000-0000-4000-8000-000000000002';
const TENANT_MQ = 'a0000000-0000-4000-8000-000000000001';
const TENANT_SU = 'a0000000-0000-4000-8000-000000000002';

const rawExport = () =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub-export.synthetic.json'), 'utf8')) as Record<string, unknown[]>;
const context = (): HubMappingContext =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub-context.synthetic.json'), 'utf8')) as HubMappingContext;

async function hubExport(mutate?: (doc: Record<string, unknown[]>) => void): Promise<HubExport> {
  const doc = rawExport();
  if (mutate) {
    mutate(doc);
    (doc as Record<string, unknown>).checksum = await entitlementChecksum(doc);
  }
  return parseHubExport(doc, { expectedEnvironment: 'LOCAL' });
}

function shuffled<T>(values: T[], seed: number): T[] {
  const out = [...values];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('mapHubExport · reglas de mapeo', () => {
  it('eCommerce: 1 alias existente y 23 códigos ya canónicos', async () => {
    const result = await mapHubExport(await hubExport(), context());
    const eco = result.mappings.filter((m) => m.productCode === 'ecommerce');
    expect(eco).toHaveLength(24);
    expect(eco.filter((m) => m.rule === 'ALIAS').map((m) => m.hubCode)).toEqual(['ecommerce.promotions']);
    expect(eco.filter((m) => m.rule === 'CANONICAL')).toHaveLength(23);
    expect(eco.every((m) => m.capabilityCode === m.hubCode)).toBe(true);
  });

  it('propone alias solo para coincidencias canónicas que aún no son alias, con el estado de la capacidad', async () => {
    const result = await mapHubExport(await hubExport(), context());
    const eco = result.aliasProposals.filter((p) => p.productCode === 'ecommerce');
    expect(eco).toHaveLength(23);
    expect(eco.map((p) => p.aliasCode)).not.toContain('ecommerce.promotions');
    expect(eco.every((p) => p.aliasSource === 'GMAO_HUB' && p.aliasCode === p.capabilityCode)).toBe(true);
    const draft = eco.find((p) => p.capabilityCode === 'ecommerce.planning.demand');
    expect(draft).toMatchObject({ capabilityStatus: 'DRAFT', action: 'REGISTER' });
    expect(result.aliasProposals.filter((p) => p.productCode === 'esupplier')).toEqual([]);
  });

  it('una capacidad DEPRECATED se propone como REVIEW, no como REGISTER', async () => {
    const ctx = context();
    const cms = ctx.registry.ecommerce.find((c) => c.code === 'ecommerce.content.cms');
    cms!.status = 'DEPRECATED';
    const result = await mapHubExport(await hubExport(), ctx);
    expect(result.aliasProposals.find((p) => p.aliasCode === 'ecommerce.content.cms')).toMatchObject({
      capabilityStatus: 'DEPRECATED',
      action: 'REVIEW',
    });
  });

  it('eSupplier: alias GMAO_HUB; un alias de otra fuente NO mapea el código del hub', async () => {
    const result = await mapHubExport(await hubExport(), context());
    const byCode = Object.fromEntries(result.mappings.filter((m) => m.productCode === 'esupplier').map((m) => [m.hubCode, m]));
    expect(byCode.esupplier_dorothy_copilot).toMatchObject({ rule: 'ALIAS', capabilityCode: 'esupplier.ai.dorothy_copilot' });
    expect(byCode.esupplier_legacy_portal).toMatchObject({ rule: 'UNMAPPED', capabilityCode: null, reason: 'NO_ALIAS_NO_CANONICAL' });
    expect(result.unmapped).toEqual([
      {
        productCode: 'esupplier',
        hubCode: 'esupplier_legacy_portal',
        reason: 'NO_ALIAS_NO_CANONICAL',
        activeAnywhere: true,
        activeOrganizations: 1,
      },
    ]);
  });

  it('un alias cuyo destino no está en el registro queda UNMAPPED (no se inventa la capacidad)', async () => {
    const ctx = context();
    ctx.aliases.push({
      productCode: 'esupplier',
      aliasSource: 'GMAO_HUB',
      aliasCode: 'esupplier_legacy_portal',
      capabilityCode: 'esupplier.portal.legacy',
    });
    const result = await mapHubExport(await hubExport(), ctx);
    expect(result.mappings.find((m) => m.hubCode === 'esupplier_legacy_portal')).toMatchObject({
      rule: 'UNMAPPED',
      reason: 'ALIAS_TARGET_NOT_IN_REGISTRY',
      capabilityCode: null,
    });
  });

  it('un código que no es de ningún producto del contexto se informa, no se mapea', async () => {
    const result = await mapHubExport(await hubExport(), context());
    expect(result.unmanagedApps).toEqual(['echange']);
    expect(result.mappings.some((m) => m.hubCode === 'echange_voice')).toBe(false);
    expect(result.catalogReference.find((c) => c.code === 'echange_voice')).toMatchObject({ productCode: null });
  });

  it('add-ons o suscripciones con códigos fuera del catálogo quedan como no atribuidos', async () => {
    const exp = await hubExport((d) => {
      d.companyAddons.push({ organizationId: MQ, companyId: MQC, addonCode: 'ecommerce.ghost', active: true });
      d.subscriptions.push({ organizationId: SU, itemCode: 'mystery_item', status: 'active', activatedAt: null, canceledAt: null });
    });
    const result = await mapHubExport(exp, context());
    expect(result.unattributedCodes).toEqual([
      { organizationId: MQ, code: 'ecommerce.ghost', source: 'COMPANY_ADDON', active: true },
      { organizationId: SU, code: 'mystery_item', source: 'SUBSCRIPTION', active: true },
    ]);
  });
});

describe('mapHubExport · estado legacy por tenant×producto', () => {
  it('MiQuímica (eCommerce): app activa, 22 capacidades en su única compañía', async () => {
    const result = await mapHubExport(await hubExport(), context());
    const mq = result.legacyTenantState.find((s) => s.productCode === 'ecommerce' && s.organizationId === MQ)!;
    expect(mq).toMatchObject({ tenantId: TENANT_MQ, linked: true, appStatus: 'active', appActive: true, totalCompanies: 1 });
    expect(Object.keys(mq.capabilities)).toHaveLength(22);
    expect(mq.capabilities['ecommerce.promotions']).toEqual({
      activeCompanies: 1,
      totalCompanies: 1,
      viaSubscription: false,
      hubCodes: ['ecommerce.promotions'],
    });
    expect(mq.capabilities['ecommerce.ai.catalog.copy']).toBeUndefined();
    // Los 24 ítems están available=false en el hub: los 22 activos se señalan.
    expect(mq.unavailableActiveCodes).toHaveLength(22);
    expect(mq.unmappedActiveCodes).toEqual([]);
  });

  it('eSupplier: alcance parcial por compañía, suscripción de tenant y código sin mapeo', async () => {
    const result = await mapHubExport(await hubExport(), context());
    const su = result.legacyTenantState.find((s) => s.productCode === 'esupplier' && s.organizationId === SU)!;
    expect(su).toMatchObject({ tenantId: TENANT_SU, linked: true, appActive: true, totalCompanies: 2 });
    expect(su.capabilities['esupplier.ai.dorothy_copilot']).toMatchObject({ activeCompanies: 2, totalCompanies: 2 });
    expect(su.capabilities['esupplier.sourcing.events']).toMatchObject({ activeCompanies: 1, totalCompanies: 2 });
    expect(su.capabilities['esupplier.companies.extra']).toMatchObject({ activeCompanies: 0, viaSubscription: true });
    expect(su.unmappedActiveCodes).toEqual(['esupplier_legacy_portal']);
  });

  it('organización sin vínculo: tenantId null, linked=false; app requested no cuenta como activa', async () => {
    const result = await mapHubExport(await hubExport(), context());
    const su2 = result.legacyTenantState.find((s) => s.organizationId === SU2)!;
    expect(su2).toMatchObject({ productCode: 'esupplier', tenantId: null, linked: false, appStatus: 'requested', appActive: false });
  });

  it('un tenant vinculado sin datos en el hub aparece con la app inactiva', async () => {
    const ctx = context();
    ctx.tenantLinks.push({
      productCode: 'ecommerce',
      organizationId: 'f0000000-0000-4000-8000-000000000001',
      tenantId: 'a0000000-0000-4000-8000-000000000009',
    });
    const result = await mapHubExport(await hubExport(), ctx);
    const empty = result.legacyTenantState.find((s) => s.tenantId === 'a0000000-0000-4000-8000-000000000009')!;
    expect(empty).toMatchObject({ linked: true, appStatus: null, appActive: false, totalCompanies: 0, capabilities: {} });
  });

  it('una suscripción cancelada no concede; la del código de la app no es una capacidad', async () => {
    const exp = await hubExport((d) => {
      (d.subscriptions[1] as Record<string, unknown>).status = 'canceled';
    });
    const result = await mapHubExport(exp, context());
    const su = result.legacyTenantState.find((s) => s.organizationId === SU)!;
    expect(su.capabilities['esupplier.companies.extra']).toBeUndefined();
    const mq = result.legacyTenantState.find((s) => s.organizationId === MQ)!;
    expect(result.unattributedCodes.some((u) => u.code === 'ecommerce')).toBe(false);
    expect(Object.keys(mq.capabilities)).not.toContain('ecommerce');
  });
});

describe('mapHubExport · determinismo y seguridad', () => {
  it('mismo contenido en cualquier orden → mismo JCS y mismo mappingChecksum', async () => {
    const a = await mapHubExport(await hubExport(), context());
    for (const seed of [1, 7, 42]) {
      const exp = await hubExport((d) => {
        for (const name of ['apps', 'catalogItems', 'workspaceApps', 'companyAddons', 'subscriptions']) {
          d[name] = shuffled(d[name], seed);
        }
      });
      const ctx = context();
      ctx.products = shuffled(ctx.products, seed);
      ctx.aliases = shuffled(ctx.aliases, seed);
      ctx.tenantLinks = shuffled(ctx.tenantLinks, seed);
      ctx.registry.ecommerce = shuffled(ctx.registry.ecommerce, seed);
      const b = await mapHubExport(exp, ctx);
      expect(canonicalize(b)).toBe(canonicalize(a));
    }
    const { mappingChecksum, ...rest } = a;
    expect(mappingChecksum).toBe(`sha256:${await sha256Hex(canonicalize(rest))}`);
  });

  it('lleva el checksum del contenido del export y nunca claves de precio, secreto o correo', async () => {
    const exp = await hubExport();
    const result = await mapHubExport(exp, context());
    expect(result.exportContentChecksum).toBe(await hubExportContentChecksum(exp));
    expect(result.exportContentChecksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(() => assertSnapshotSafe(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toMatch(/price|currency|amount/i);
  });

  it('no muta el export ni el contexto', async () => {
    const exp = await hubExport();
    const ctx = context();
    const before = canonicalize({ exp, ctx });
    await mapHubExport(exp, ctx);
    expect(canonicalize({ exp, ctx })).toBe(before);
  });
});

describe('mapHubExport · contexto inválido', () => {
  it.each([
    [
      'alias GMAO_HUB repetido con destinos distintos',
      (c: HubMappingContext) =>
        c.aliases.push({
          productCode: 'esupplier',
          aliasSource: 'GMAO_HUB',
          aliasCode: 'esupplier_dorothy_copilot',
          capabilityCode: 'esupplier.sourcing.events',
        }),
    ],
    ['producto repetido', (c: HubMappingContext) => c.products.push({ code: 'ecommerce', hubAppCode: 'ecommerce2' })],
    ['dos productos con la misma app del hub', (c: HubMappingContext) => c.products.push({ code: 'ecommerce2', hubAppCode: 'ecommerce' })],
    ['producto sin registro', (c: HubMappingContext) => delete (c.registry as Record<string, unknown>).esupplier],
    [
      'organización vinculada a dos tenants del mismo producto',
      (c: HubMappingContext) =>
        c.tenantLinks.push({ productCode: 'ecommerce', organizationId: MQ, tenantId: 'a0000000-0000-4000-8000-000000000009' }),
    ],
    [
      'tenant vinculado a dos organizaciones del mismo producto',
      (c: HubMappingContext) =>
        c.tenantLinks.push({ productCode: 'ecommerce', organizationId: SU, tenantId: TENANT_MQ }),
    ],
    ['vínculo con uuid inválido', (c: HubMappingContext) => (c.tenantLinks[0].tenantId = 'x')],
    ['vínculo de un producto desconocido', (c: HubMappingContext) => (c.tenantLinks[0].productCode = 'gmao')],
  ])('HUB_MAPPING_CONTEXT_INVALID: %s', async (_name, mutate) => {
    const ctx = context();
    mutate(ctx);
    await expect(mapHubExport(await hubExport(), ctx)).rejects.toBeInstanceOf(HubMappingError);
  });
});
