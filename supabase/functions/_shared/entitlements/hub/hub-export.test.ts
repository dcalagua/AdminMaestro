import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { entitlementChecksum } from '../jcs';
import { HUB_EXPORT_FORMAT, HubExportError, hubExportContentChecksum, parseHubExport } from './hub-export';

/*
 * Export comercial del hub GMAO (contrato gmao-hub-commercial-export.v1,
 * spec §15.3). El importador es estricto: una sola clave fuera de la lista
 * permitida (un precio, un secreto, un campo nuevo que nadie acordó) invalida
 * TODO el export, porque lo que no se entiende no se importa a medias.
 */

const FIXTURE = resolve(__dirname, 'fixtures/hub-export.synthetic.json');
type Doc = Record<string, unknown> & {
  catalogItems: Record<string, unknown>[];
  companyAddons: Record<string, unknown>[];
  workspaceApps: Record<string, unknown>[];
  subscriptions: Record<string, unknown>[];
  apps: Record<string, unknown>[];
};

function fixture(): Doc {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')) as Doc;
}

/** Aplica un cambio y vuelve a firmar: así el test aísla la regla, no el checksum. */
async function resigned(mutate: (doc: Doc) => void): Promise<Doc> {
  const doc = fixture();
  mutate(doc);
  doc.checksum = await entitlementChecksum(doc);
  return doc;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HubExportError);
    return (error as HubExportError).code;
  }
  throw new Error('se esperaba un rechazo');
}

const LOCAL = { expectedEnvironment: 'LOCAL' as const };

describe('parseHubExport · export válido', () => {
  it('acepta el fixture sintético y conserva su checksum', async () => {
    const raw = fixture();
    const parsed = await parseHubExport(raw, LOCAL);
    expect(parsed.format).toBe(HUB_EXPORT_FORMAT);
    expect(parsed.source).toBe('GMAO_HUB');
    expect(parsed.checksum).toBe(raw.checksum);
    expect(parsed.catalogItems.filter((i) => i.appCode === 'ecommerce')).toHaveLength(24);
    expect(parsed.companyAddons.filter((a) => a.organizationId === 'd0000000-0000-4000-8000-000000000001' && a.active)).toHaveLength(22);
  });

  it('acepta el export como texto JSON', async () => {
    const parsed = await parseHubExport(readFileSync(FIXTURE, 'utf8'), LOCAL);
    expect(parsed.apps.map((a) => a.code)).toEqual(['echange', 'ecommerce', 'esupplier']);
  });

  it('no depende del orden de los arreglos: devuelve todo ordenado', async () => {
    const doc = await resigned((d) => {
      d.catalogItems.reverse();
      d.companyAddons.reverse();
      d.apps.reverse();
    });
    const a = await parseHubExport(fixture(), LOCAL);
    const b = await parseHubExport(doc, LOCAL);
    expect(b.catalogItems).toEqual(a.catalogItems);
    expect(b.companyAddons).toEqual(a.companyAddons);
    expect(b.apps).toEqual(a.apps);
    // El checksum del exportador cambia con el orden; el del contenido, no.
    expect(b.checksum).not.toBe(a.checksum);
    expect(await hubExportContentChecksum(b)).toBe(await hubExportContentChecksum(a));
  });
});

describe('parseHubExport · rechazos', () => {
  it.each([
    ['price_month en un ítem', (d: Doc) => (d.catalogItems[0].price_month = 0)],
    ['priceMonth en un ítem', (d: Doc) => (d.catalogItems[0].priceMonth = 10)],
    ['currency en un ítem', (d: Doc) => (d.catalogItems[0].currency = 'USD')],
    ['secret en la raíz', (d: Doc) => (d.serviceRoleSecret = 'x')],
    ['token en una suscripción', (d: Doc) => (d.subscriptions[0].token = 'x')],
    ['password en una compañía', (d: Doc) => (d.companyAddons[0].password = 'x')],
    ['key en una app', (d: Doc) => (d.apps[0].key = 'x')],
    ['clave desconocida', (d: Doc) => (d.workspaceApps[0].plan = 'free')],
  ])('HUB_EXPORT_FORBIDDEN_KEY: %s', async (_name, mutate) => {
    expect(await codeOf(parseHubExport(await resigned(mutate), LOCAL))).toBe('HUB_EXPORT_FORBIDDEN_KEY');
  });

  it('la clave prohibida gana aunque el checksum no cuadre', async () => {
    const doc = fixture();
    doc.catalogItems[0].price_month = 0;
    expect(await codeOf(parseHubExport(doc, LOCAL))).toBe('HUB_EXPORT_FORBIDDEN_KEY');
  });

  it('el mensaje no repite el valor de la clave prohibida', async () => {
    const doc = await resigned((d) => (d.catalogItems[0].secretValue = 'SUPER-SECRETO-123'));
    await expect(parseHubExport(doc, LOCAL)).rejects.not.toThrow(/SUPER-SECRETO-123/);
  });

  it('HUB_EXPORT_FORMAT: formato o fuente distintos', async () => {
    expect(await codeOf(parseHubExport(await resigned((d) => (d.format = 'gmao-hub-commercial-export.v2')), LOCAL))).toBe(
      'HUB_EXPORT_FORMAT',
    );
    expect(await codeOf(parseHubExport(await resigned((d) => (d.source = 'GMAO')), LOCAL))).toBe('HUB_EXPORT_FORMAT');
  });

  it('HUB_EXPORT_CHECKSUM_MISMATCH: contenido alterado sin volver a firmar', async () => {
    const doc = fixture();
    doc.companyAddons[0].active = !doc.companyAddons[0].active;
    expect(await codeOf(parseHubExport(doc, LOCAL))).toBe('HUB_EXPORT_CHECKSUM_MISMATCH');
  });

  it('HUB_EXPORT_CHECKSUM_MISMATCH: checksum ausente o mal formado', async () => {
    const doc = fixture();
    delete doc.checksum;
    expect(await codeOf(parseHubExport(doc, LOCAL))).toBe('HUB_EXPORT_INVALID');
    const bad = fixture();
    bad.checksum = 'md5:abc';
    expect(await codeOf(parseHubExport(bad, LOCAL))).toBe('HUB_EXPORT_CHECKSUM_MISMATCH');
  });

  it('HUB_EXPORT_ENVIRONMENT_MISMATCH: export de otro entorno', async () => {
    expect(await codeOf(parseHubExport(fixture(), { expectedEnvironment: 'QAS' }))).toBe('HUB_EXPORT_ENVIRONMENT_MISMATCH');
  });

  it('HUB_EXPORT_DUPLICATE: (companyId, addonCode) repetido', async () => {
    const doc = await resigned((d) => d.companyAddons.push({ ...d.companyAddons[0], active: false }));
    expect(await codeOf(parseHubExport(doc, LOCAL))).toBe('HUB_EXPORT_DUPLICATE');
  });

  it.each([
    ['ítem de catálogo repetido', (d: Doc) => d.catalogItems.push({ ...d.catalogItems[0] })],
    ['app repetida', (d: Doc) => d.apps.push({ ...d.apps[0] })],
    ['workspace app repetida', (d: Doc) => d.workspaceApps.push({ ...d.workspaceApps[0] })],
    ['suscripción repetida', (d: Doc) => d.subscriptions.push({ ...d.subscriptions[0] })],
  ])('HUB_EXPORT_DUPLICATE: %s', async (_name, mutate) => {
    expect(await codeOf(parseHubExport(await resigned(mutate), LOCAL))).toBe('HUB_EXPORT_DUPLICATE');
  });

  it('HUB_EXPORT_DUPLICATE: la misma compañía en dos organizaciones', async () => {
    const doc = await resigned((d) =>
      d.companyAddons.push({
        organizationId: 'e0000000-0000-4000-8000-000000000001',
        companyId: 'd0000000-0000-4000-8000-0000000000c1',
        addonCode: 'esupplier_legacy_portal',
        active: true,
      }),
    );
    expect(await codeOf(parseHubExport(doc, LOCAL))).toBe('HUB_EXPORT_DUPLICATE');
  });

  it.each([
    ['uuid inválido', (d: Doc) => (d.companyAddons[0].companyId = 'not-a-uuid')],
    ['organización en mayúsculas', (d: Doc) => (d.workspaceApps[0].organizationId = 'D0000000-0000-4000-8000-000000000001')],
    ['kind fuera del enum', (d: Doc) => (d.catalogItems[0].kind = 'bundle')],
    ['estado de workspace fuera del enum', (d: Doc) => (d.workspaceApps[0].status = 'deleted')],
    ['available no booleano', (d: Doc) => (d.catalogItems[0].available = 'false')],
    ['active no booleano', (d: Doc) => (d.companyAddons[0].active = 1)],
    ['generatedAt no ISO', (d: Doc) => (d.generatedAt = '28/09/2026')],
    ['generatedAt sin zona', (d: Doc) => (d.generatedAt = '2026-09-28T12:00:00')],
    ['activatedAt no ISO', (d: Doc) => (d.subscriptions[0].activatedAt = 'ayer')],
    ['canceledAt ausente', (d: Doc) => delete d.subscriptions[0].canceledAt],
    ['environment fuera del enum', (d: Doc) => (d.environment = 'STAGING')],
    ['arreglo ausente', (d: Doc) => delete (d as Record<string, unknown>).subscriptions],
    ['arreglo que es objeto', (d: Doc) => (d.apps = {} as unknown as Doc['apps'])],
    ['código vacío', (d: Doc) => (d.catalogItems[0].code = '')],
    ['código con espacios', (d: Doc) => (d.companyAddons[0].addonCode = 'ecommerce promotions')],
    ['estado de suscripción vacío', (d: Doc) => (d.subscriptions[0].status = '')],
  ])('HUB_EXPORT_INVALID: %s', async (_name, mutate) => {
    expect(await codeOf(parseHubExport(await resigned(mutate), LOCAL))).toBe('HUB_EXPORT_INVALID');
  });

  it('HUB_EXPORT_INVALID: JSON ilegible o que no es un objeto', async () => {
    expect(await codeOf(parseHubExport('{no es json', LOCAL))).toBe('HUB_EXPORT_INVALID');
    expect(await codeOf(parseHubExport([], LOCAL))).toBe('HUB_EXPORT_INVALID');
    expect(await codeOf(parseHubExport(null, LOCAL))).toBe('HUB_EXPORT_INVALID');
  });
});
