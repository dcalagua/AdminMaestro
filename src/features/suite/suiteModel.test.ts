import { describe, expect, it } from 'vitest';
import {
  appChannels,
  appHealth,
  buildMatrix,
  cellKind,
  isStale,
  moduleState,
  relativeAge,
  rowMatches,
  suiteApps,
  type IntegrationRow,
  type ProvisioningRow,
  type SuiteApp,
  type TargetRow,
  type TenantRow,
} from './suiteModel';

const NOW = new Date('2026-11-12T12:00:00Z');
const EWM: SuiteApp = { id: 'p-ewm', code: 'ewm', name: 'EWM', accent: null, sort: 2 };
const TMS: SuiteApp = { id: 'p-tms', code: 'tms', name: 'TMS', accent: null, sort: 3 };

const integration = (over: Partial<IntegrationRow> = {}) =>
  ({
    id: 'i-ewm',
    saas_product_id: 'p-ewm',
    enabled: true,
    status: 'READY',
    integration_type: 'HTTP_M2M',
    contract_version: 'v1',
    entitlements_push_enabled: false,
    usage_ingest_enabled: false,
    ...over,
  }) as IntegrationRow;

const target = (over: Partial<TargetRow> = {}) =>
  ({
    deployment_target_id: 't-ewm-qas',
    saas_product_id: 'p-ewm',
    product_integration_id: 'i-ewm',
    provisioning_environment: 'QAS',
    provisioning_enabled: true,
    provisioning_status: 'READY',
    health_status: 'HEALTHY',
    health_checked_at: '2026-09-24T12:00:00Z',
    contract_version: 'v1',
    ...over,
  }) as TargetRow;

const tenant = (over: Partial<TenantRow> = {}) =>
  ({
    tenant_id: 'tn-1',
    name: 'Acme EWM',
    slug: 'acme-ewm',
    status: 'PENDING',
    customer_organization_id: 'o-acme',
    customer_name: 'Acme',
    saas_product_id: 'p-ewm',
    subscription_id: 's-1',
    ...over,
  }) as TenantRow;

const request = (over: Partial<ProvisioningRow> = {}) =>
  ({
    id: 'r-1',
    tenant_id: 'tn-1',
    saas_product_id: 'p-ewm',
    status: 'ACTIVE',
    attempt_count: 1,
    max_attempts: 3,
    requested_at: '2026-10-01T00:00:00Z',
    ...over,
  }) as ProvisioningRow;

describe('estado combinado de una celda', () => {
  it('tenant PENDING con alta ACTIVE: activo en la app, pendiente de confirmar', () => {
    expect(cellKind('PENDING', 'ACTIVE')).toBe('PENDING_CONFIRM');
    expect(cellKind('ACTIVE', 'ACTIVE')).toBe('ACTIVE');
  });

  it('la suspensión y la baja mandan sobre el alta', () => {
    expect(cellKind('SUSPENDED', 'ACTIVE')).toBe('SUSPENDED');
    expect(cellKind('CHURNED', 'FAILED')).toBe('INACTIVE');
  });

  it('alta fallida, en curso o inexistente', () => {
    expect(cellKind('PENDING', 'FAILED')).toBe('FAILED');
    expect(cellKind('PENDING', 'PROVISIONING')).toBe('IN_PROGRESS');
    expect(cellKind('PENDING', null)).toBe('NOT_REQUESTED');
    expect(cellKind('ACTIVE', null)).toBe('ACTIVE_NO_APP');
  });
});

describe('matriz cuenta × app', () => {
  it('una fila por cuenta con tenants; la última solicitud de alta decide', () => {
    const rows = buildMatrix({
      apps: [EWM, TMS],
      tenants: [tenant(), tenant({ tenant_id: 'tn-2', name: 'Beta TMS', customer_organization_id: 'o-beta', customer_name: 'Beta', saas_product_id: 'p-tms', status: 'ACTIVE', subscription_id: null })],
      requests: [
        request({ id: 'r-old', status: 'FAILED', requested_at: '2026-09-01T00:00:00Z' }),
        request(),
        request({ id: 'r-2', tenant_id: 'tn-2', saas_product_id: 'p-tms', status: 'FAILED', attempt_count: 1 }),
      ],
      subscriptions: new Map([['s-1', 'ACTIVE']]),
    });
    expect(rows.map((r) => r.organizationName)).toEqual(['Acme', 'Beta']);
    const acme = rows[0]!.cells['p-ewm']!.primary!;
    expect(acme.kind).toBe('PENDING_CONFIRM');
    expect(acme.request?.id).toBe('r-1');
    expect(acme.subscriptionStatus).toBe('ACTIVE');
    expect(rows[0]!.cells['p-tms']).toBeUndefined();
    const beta = rows[1]!.cells['p-tms']!.primary!;
    expect(beta.kind).toBe('FAILED');
    expect(beta.canRetry).toBe(true);
  });

  it('sin vista financiera no hay estado de contrato', () => {
    const [row] = buildMatrix({ apps: [EWM], tenants: [tenant()], requests: [request()], subscriptions: null });
    expect(row!.cells['p-ewm']!.primary!.subscriptionStatus).toBeNull();
  });

  it('la celda la resume el tenant que más atención pide', () => {
    const [row] = buildMatrix({
      apps: [EWM],
      tenants: [tenant({ tenant_id: 'tn-a', status: 'ACTIVE' }), tenant({ tenant_id: 'tn-b', status: 'PENDING' })],
      requests: [request({ tenant_id: 'tn-a' }), request({ id: 'r-b', tenant_id: 'tn-b', status: 'FAILED' })],
    });
    const cell = row!.cells['p-ewm']!;
    expect(cell.tenants).toHaveLength(2);
    expect(cell.primary!.tenantId).toBe('tn-b');
  });

  it('filtra por estado, por app y por búsqueda', () => {
    const rows = buildMatrix({
      apps: [EWM, TMS],
      tenants: [tenant(), tenant({ tenant_id: 'tn-2', name: 'Beta TMS', customer_organization_id: 'o-beta', customer_name: 'Beta', saas_product_id: 'p-tms', status: 'ACTIVE' })],
      requests: [request(), request({ id: 'r-2', tenant_id: 'tn-2', saas_product_id: 'p-tms' })],
    });
    const [acme, beta] = rows;
    expect(rowMatches(acme!, 'PENDING_CONFIRM', null, '')).toBe(true);
    expect(rowMatches(beta!, 'PENDING_CONFIRM', null, '')).toBe(false);
    expect(rowMatches(acme!, 'ATTENTION', null, '')).toBe(true);
    expect(rowMatches(acme!, 'ALL', 'p-tms', '')).toBe(false);
    expect(rowMatches(beta!, 'ACTIVE', 'p-tms', 'bet')).toBe(true);
    expect(rowMatches(beta!, 'ALL', null, 'acme')).toBe(false);
  });
});

describe('canales de la app', () => {
  it('módulos y uso apagados se ven «No activo»; la suspensión, «No disponible»', () => {
    const [alta, modulos, uso, suspension] = appChannels(integration(), [target()]);
    expect(alta).toMatchObject({ active: true, status: 'Activo' });
    expect(modulos).toMatchObject({ active: false, status: 'No activo' });
    expect(uso).toMatchObject({ active: false, status: 'No activo' });
    expect(suspension).toMatchObject({ active: false, status: 'No disponible' });
  });

  it('sin entornos habilitados el alta no está activa, y sin integración no hay conexión', () => {
    expect(appChannels(integration(), [target({ provisioning_enabled: false })])[0]).toMatchObject({ active: false });
    expect(appChannels(null, [])[0]).toMatchObject({ active: false, status: 'Sin conexión' });
    expect(appChannels(integration({ entitlements_push_enabled: true }), [target()])[1]).toMatchObject({ active: true });
  });

  it('módulos de un tenant: «No activo» si el canal está apagado', () => {
    expect(moduleState(false, { state: 'IN_SYNC' }).label).toBe('No activo');
    expect(moduleState(true, { state: 'IN_SYNC' }).label).toBe('Al día');
    expect(moduleState(true, null).label).toBe('Sin sincronizar');
  });
});

describe('salud de una app', () => {
  it('toma el entorno más productivo habilitado y avisa si la observación es vieja', () => {
    const h = appHealth(EWM, [target({ deployment_target_id: 't-dev', provisioning_environment: 'DEV' }), target()], [integration()], NOW);
    expect(h.primary?.deployment_target_id).toBe('t-ewm-qas');
    expect(h.environment).toBe('QAS');
    expect(h.health).toBe('HEALTHY');
    expect(h.stale).toBe(true);
    expect(h.contractVersion).toBe('v1');
  });

  it('una app sin destino no se evalúa', () => {
    const h = appHealth(TMS, [target()], [integration()], NOW);
    expect(h.primary).toBeNull();
    expect(h.health).toBe('NOT_EVALUATED');
  });

  it('tiempo relativo en español', () => {
    expect(relativeAge('2026-09-24T12:00:00Z', NOW)).toBe('hace 7 semanas');
    expect(relativeAge('2026-11-12T09:00:00Z', NOW)).toBe('hace 3 horas');
    expect(relativeAge('2026-11-12T11:59:40Z', NOW)).toBe('hace un momento');
    expect(relativeAge('2026-07-12T12:00:00Z', NOW)).toBe('hace 4 meses');
    expect(isStale('2026-11-12T09:00:00Z', NOW)).toBe(false);
    expect(isStale('2026-11-10T09:00:00Z', NOW)).toBe(true);
    expect(isStale(null, NOW)).toBe(true);
  });

  it('las apps de la suite son las que tienen integración, destino o tenants', () => {
    const products = [
      { id: 'p-tms', code: 'tms', short_name: 'TMS', accent_color: null, sort_order: 3, status: 'ACTIVE' as const },
      { id: 'p-ewm', code: 'ewm', short_name: 'EWM', accent_color: null, sort_order: 2, status: 'ACTIVE' as const },
      { id: 'p-x', code: 'x', short_name: 'X', accent_color: null, sort_order: 1, status: 'ACTIVE' as const },
    ];
    expect(suiteApps(products, { integrations: [{ saas_product_id: 'p-tms' }, { saas_product_id: 'p-ewm' }] }).map((a) => a.code)).toEqual(['ewm', 'tms']);
    expect(suiteApps(products, {}).map((a) => a.code)).toEqual(['x', 'ewm', 'tms']);
  });
});
