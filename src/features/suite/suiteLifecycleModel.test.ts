import { describe, it, expect } from 'vitest';
import {
  appLifecycleChannels, buildSuiteMatrix, cycleSummary, deliveryOf, operationalDeliveryOf, parseCycleResult, stageOf, suiteKpis, suiteProducts, worstStage,
  type TenantLifecycleRow,
} from './suiteLifecycleModel';

function row(overrides: Partial<TenantLifecycleRow>): TenantLifecycleRow {
  return {
    applied_version: null, auto_suspend_due: false, cohort_state: null, customer_organization_id: 'org-a',
    days_past_due: null, deployment_mode: 'SHARED', desired_dirty: false, desired_version: null,
    environment: 'PRODUCTION', grace_ends_on: null, grace_expired: false, integration_code: null,
    last_change_at: null, last_change_reason: null, last_push_at: null, last_verified_at: null,
    lifecycle_stage: 'CURRENT', managing_organization_id: null, managing_organization_name: null,
    oldest_due_date: null, open_suspension_id: null, organization_name: 'Alpha', overdue_balance: null,
    overdue_currency: null, overdue_invoices: 0, product_accent_color: null, product_code: 'esupplier',
    product_short_name: 'eSupplier', product_sort_order: 10, push_enabled: false, saas_product_id: 'p1',
    suspended_at: null, suspension_cause: null, suspension_reason: null, sync_state: null, tenant_id: 't1',
    tenant_name: 'Alpha · eSupplier', tenant_slug: 'alpha', tenant_status: 'ACTIVE',
    lifecycle_applied_at: null, lifecycle_applied_state: null, lifecycle_applied_version: null, lifecycle_attempts: null,
    lifecycle_channel: false, lifecycle_desired_reason: null, lifecycle_desired_state: null,
    lifecycle_desired_version: null, lifecycle_last_error: null, lifecycle_last_result: null,
    lifecycle_next_attempt_at: null,
    ...overrides,
  };
}

describe('stageOf', () => {
  it('traduce la etapa de la base y cae a INACTIVE ante un valor desconocido', () => {
    expect(stageOf({ lifecycle_stage: 'SUSPENSION_SCHEDULED' })).toBe('SUSPENSION_SCHEDULED');
    expect(stageOf({ lifecycle_stage: 'OTRA' })).toBe('INACTIVE');
    expect(stageOf({ lifecycle_stage: null })).toBe('INACTIVE');
  });
});

describe('operationalDeliveryOf (lifecycle.v1)', () => {
  it('sin nada que entregar por el canal operativo no opina', () => {
    expect(operationalDeliveryOf(row({}))).toBeNull();
  });

  it('una app sin el canal configurado lo dice: el bloqueo no llega', () => {
    expect(deliveryOf(row({ lifecycle_desired_state: 'SUSPENDED', lifecycle_desired_version: 1, sync_state: 'IN_SYNC',
      cohort_state: 'MASTERADMIN_PRIMARY' }))).toMatchObject({ kind: 'NO_CHANNEL', label: 'App sin canal de suspensión' });
  });

  it('confirmado por la app: bloqueo o reactivación aplicados', () => {
    const base = { lifecycle_channel: true, lifecycle_desired_version: 3, lifecycle_applied_version: 3 };
    expect(deliveryOf(row({ ...base, lifecycle_desired_state: 'SUSPENDED', lifecycle_applied_state: 'SUSPENDED' })))
      .toMatchObject({ kind: 'ENFORCED', label: 'Bloqueo aplicado en la app' });
    expect(deliveryOf(row({ ...base, lifecycle_desired_state: 'ACTIVE', lifecycle_applied_state: 'ACTIVE' })))
      .toMatchObject({ kind: 'ENFORCED', label: 'Reactivado en la app' });
  });

  it('pendiente mientras la versión aplicada no alcanza la deseada; rechazo = incidente con el código', () => {
    const base = { lifecycle_channel: true, lifecycle_desired_state: 'SUSPENDED', lifecycle_desired_version: 4, lifecycle_applied_version: 3 };
    expect(deliveryOf(row({ ...base, lifecycle_last_result: 'RETRYABLE', lifecycle_last_error: 'HTTP_503' })))
      .toMatchObject({ kind: 'PENDING', label: 'Bloqueo pendiente en la app' });
    expect(deliveryOf(row({ ...base, lifecycle_last_result: 'REJECTED', lifecycle_last_error: 'TENANT_NOT_PROVISIONED' })))
      .toMatchObject({ kind: 'INCIDENT', detail: expect.stringContaining('TENANT_NOT_PROVISIONED') });
  });
});

describe('appLifecycleChannels', () => {
  it('por app: canal configurado y cuántos tenants tienen el bloqueo aplicado o pendiente', () => {
    const rows = [
      row({ tenant_id: 'a', lifecycle_channel: true, lifecycle_desired_state: 'SUSPENDED', lifecycle_desired_version: 1,
        lifecycle_applied_version: 1, lifecycle_applied_state: 'SUSPENDED' }),
      row({ tenant_id: 'b', lifecycle_channel: true, lifecycle_desired_state: 'SUSPENDED', lifecycle_desired_version: 2 }),
      row({ tenant_id: 'c', product_code: 'tms', product_short_name: 'TMS', product_sort_order: 30 }),
    ];
    expect(appLifecycleChannels(rows).map((a) => [a.code, a.configured, a.tenants, a.enforced, a.pending])).toEqual([
      ['esupplier', true, 2, 1, 1],
      ['tms', false, 1, 0, 0],
    ]);
  });
});

describe('deliveryOf', () => {
  it('sin enrolar, la app no recibe el estado', () => {
    expect(deliveryOf(row({ sync_state: null })).kind).toBe('NO_CHANNEL');
    expect(deliveryOf(row({ sync_state: 'NOT_ENROLLED' })).kind).toBe('NO_CHANNEL');
  });

  it('un cambio sin emitir o en curso es entrega pendiente; con el envío apagado se advierte', () => {
    expect(deliveryOf(row({ sync_state: 'IN_SYNC', desired_dirty: true, push_enabled: true }))).toMatchObject({
      kind: 'PENDING', label: 'Entrega pendiente', tone: 'info',
    });
    expect(deliveryOf(row({ sync_state: 'PENDING_PUSH', push_enabled: false }))).toMatchObject({
      kind: 'PENDING', label: 'Pendiente · envío apagado', tone: 'warn',
    });
  });

  it('rechazos y desvíos son incidentes, aunque haya cambios pendientes', () => {
    expect(deliveryOf(row({ sync_state: 'REJECTED', desired_dirty: true })).kind).toBe('INCIDENT');
    expect(deliveryOf(row({ sync_state: 'DRIFT_AHEAD' })).kind).toBe('INCIDENT');
  });

  it('en sincronía solo es «aplicado» si la cohorte de la app aplica MasterAdmin', () => {
    expect(deliveryOf(row({ sync_state: 'IN_SYNC', cohort_state: 'MASTERADMIN_PRIMARY' })).kind).toBe('ENFORCED');
    expect(deliveryOf(row({ sync_state: 'IN_SYNC', cohort_state: 'DUAL_READ' })).kind).toBe('ENFORCED');
    expect(deliveryOf(row({ sync_state: 'IN_SYNC', cohort_state: 'SHADOW' })).kind).toBe('SHADOW');
    expect(deliveryOf(row({ sync_state: 'IN_SYNC_WITH_WARNINGS', cohort_state: null })).kind).toBe('SHADOW');
  });
});

describe('matriz de la suite', () => {
  const rows = [
    row({ tenant_id: 'a1', customer_organization_id: 'org-a', organization_name: 'Alpha', product_code: 'esupplier', product_short_name: 'eSupplier', product_sort_order: 10 }),
    row({ tenant_id: 'a2', customer_organization_id: 'org-a', organization_name: 'Alpha', product_code: 'ewm', product_short_name: 'EWM', product_sort_order: 20, lifecycle_stage: 'IN_GRACE' }),
    row({ tenant_id: 'b1', customer_organization_id: 'org-b', organization_name: 'Beta', product_code: 'ewm', product_short_name: 'EWM', product_sort_order: 20, lifecycle_stage: 'SUSPENDED_NON_PAYMENT', tenant_status: 'SUSPENDED' }),
    row({ tenant_id: 'c1', customer_organization_id: 'org-c', organization_name: 'Ceta', product_code: 'tms', product_short_name: 'TMS', product_sort_order: 30 }),
  ];

  it('ordena las apps como el catálogo', () => {
    expect(suiteProducts(rows).map((p) => p.code)).toEqual(['esupplier', 'ewm', 'tms']);
  });

  it('una fila por cuenta, con la cuenta más grave arriba', () => {
    const m = buildSuiteMatrix(rows);
    expect(m.map((r) => r.organizationName)).toEqual(['Beta', 'Alpha', 'Ceta']);
    expect(m[1]!.worst).toBe('IN_GRACE');
    expect(Object.keys(m[1]!.cells).sort()).toEqual(['esupplier', 'ewm']);
  });

  it('la etapa más grave gana', () => {
    expect(worstStage(['CURRENT', 'SUSPENSION_SUGGESTED', 'IN_GRACE'])).toBe('SUSPENSION_SUGGESTED');
    expect(worstStage([])).toBe('INACTIVE');
  });

  it('KPIs de la suite', () => {
    expect(suiteKpis(rows)).toMatchObject({
      tenants: 4, active: 3, inGrace: 1, toSuspend: 0, suspendedNonPayment: 1, apps: 3, accounts: 3,
    });
  });
});

describe('resultado del ciclo', () => {
  it('tolera un resultado incompleto', () => {
    expect(parseCycleResult(null)).toBeNull();
    expect(parseCycleResult({ dry_run: true })).toMatchObject({ suspended: [], pending_resumes: [], alerts_created: 0 });
  });

  it('resume la simulación y avisa si el corte automático está apagado', () => {
    const r = parseCycleResult({
      dry_run: true, auto_suspend_enabled: false,
      pending_suspensions: [{ tenant_id: 't', tenant: 'T', product: 'EWM' }], pending_resumes: [],
    })!;
    expect(cycleSummary(r)).toBe(
      'Simulación: 1 tenant(s) cumplen la regla de suspensión · 0 reactivación(es) pendientes · el corte automático está apagado.',
    );
  });

  it('resume una ejecución real', () => {
    const r = parseCycleResult({
      dry_run: false, auto_suspend_enabled: true, alerts_created: 2,
      suspended: [{ tenant_id: 't', tenant: 'T', product: 'EWM' }], resumed: [],
    })!;
    expect(cycleSummary(r)).toBe('Ciclo ejecutado: 1 suspendido(s) · 0 reactivado(s) · 2 alerta(s) nueva(s).');
  });
});
