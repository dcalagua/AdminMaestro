import { describe, expect, it } from 'vitest';
import {
  altaState,
  commercialState,
  latestRequestByTenant,
  matchesTenantFilter,
  modelLabel,
  sortTenants,
} from './tenantListModel';

describe('tenantListModel', () => {
  it('toma la última solicitud de alta de cada tenant', () => {
    const map = latestRequestByTenant([
      { tenant_id: 't1', status: 'FAILED', requested_at: '2026-10-01T00:00:00Z' },
      { tenant_id: 't1', status: 'ACTIVE', requested_at: '2026-10-05T00:00:00Z' },
      { tenant_id: 't2', status: 'PENDING', requested_at: '2026-10-02T00:00:00Z' },
      { tenant_id: null, status: 'ACTIVE', requested_at: '2026-10-09T00:00:00Z' },
    ]);
    expect(map.get('t1')?.status).toBe('ACTIVE');
    expect(map.get('t2')?.status).toBe('PENDING');
    expect(map.size).toBe(2);
  });

  it('resume el alta en una etiqueta corta con su tono', () => {
    expect(altaState(undefined)).toMatchObject({ key: 'NONE', short: 'Sin alta' });
    expect(altaState({ status: 'ACTIVE' })).toMatchObject({ key: 'ACTIVE', tone: 'ok' });
    expect(altaState({ status: 'FAILED' })).toMatchObject({ key: 'FAILED', tone: 'danger' });
    expect(altaState({ status: 'WAITING_INFRA' })).toMatchObject({ key: 'IN_FLIGHT', short: 'Alta en curso' });
  });

  it('modelo en una línea y estado comercial corto', () => {
    expect(modelLabel({ deployment_mode: 'SHARED', tenant_type: 'PRODUCTION' })).toBe('Compartido · Producción');
    expect(modelLabel({ deployment_mode: 'PARTNER_DEDICATED', tenant_type: 'DEMO' })).toBe('Dedicado partner · Demo');
    expect(commercialState('SUSPENDED')).toEqual({ short: 'Suspendido', tone: 'danger' });
  });

  it('«Sin alta en la app» excluye altas registradas o en curso y tenants de baja', () => {
    const t = { status: 'ACTIVE', tenant_type: 'PRODUCTION', deployment_mode: 'SHARED' };
    expect(matchesTenantFilter(t, 'NO_ALTA', altaState(undefined))).toBe(true);
    expect(matchesTenantFilter(t, 'NO_ALTA', altaState({ status: 'FAILED' }))).toBe(true);
    expect(matchesTenantFilter(t, 'NO_ALTA', altaState({ status: 'ACTIVE' }))).toBe(false);
    expect(matchesTenantFilter(t, 'NO_ALTA', altaState({ status: 'PROVISIONING' }))).toBe(false);
    expect(matchesTenantFilter({ ...t, status: 'CHURNED' }, 'NO_ALTA', altaState(undefined))).toBe(false);
    expect(matchesTenantFilter(t, 'DEDICATED', altaState(undefined))).toBe(false);
    expect(matchesTenantFilter({ ...t, deployment_mode: 'TENANT_DEDICATED' }, 'DEDICATED', altaState(undefined))).toBe(true);
  });

  it('ordena por MRR dejando al final los que no tienen recurrente', () => {
    const rows = [
      { name: 'B', mrr: 0 },
      { name: 'A', mrr: 480 },
      { name: 'C', mrr: 520 },
    ];
    expect(sortTenants(rows, 'mrr', 'desc').map((r) => r.name)).toEqual(['C', 'A', 'B']);
    expect(sortTenants(rows, 'mrr', 'asc').map((r) => r.name)).toEqual(['A', 'C', 'B']);
    expect(sortTenants(rows, 'name', 'asc').map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });
});
