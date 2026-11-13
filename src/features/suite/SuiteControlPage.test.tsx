import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/*
 * Centro de la suite (20261020000100): matriz cuenta × app, cobranza y cortes,
 * política del ciclo de vida. La base decide; la pantalla muestra y ofrece.
 */

const lifecycleHook = vi.fn();
const settingsHook = vi.fn();
const runMutateAsync = vi.fn();
const saveMutateAsync = vi.fn();
const suspendMutateAsync = vi.fn();
const resumeMutateAsync = vi.fn();
const perms = { canManagePlatform: true, canReadFinance: false, isSuperAdmin: false };

vi.mock('@/services/queries', () => ({
  useTenantLifecycle: () => lifecycleHook(),
  useTenantLifecycleSettings: () => settingsHook(),
  useTenantSuspensions: () => ({ data: [], isLoading: false, error: null }),
  useLifecycleJobRuns: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('@/services/mutations', () => ({
  useRunTenantLifecycleCycle: () => ({ mutateAsync: runMutateAsync, isPending: false, error: null }),
  useSetTenantLifecycleSettings: () => ({ mutateAsync: saveMutateAsync, isPending: false }),
  useRequestTenantSuspension: () => ({ mutateAsync: suspendMutateAsync, isPending: false }),
  useRequestTenantResume: () => ({ mutateAsync: resumeMutateAsync, isPending: false }),
}));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => perms }));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));

import { SuiteControlPage } from './SuiteControlPage';

function row(overrides: Record<string, unknown>) {
  return {
    applied_version: 3, auto_suspend_due: false, cohort_state: 'MASTERADMIN_PRIMARY', customer_organization_id: 'org-a',
    days_past_due: null, deployment_mode: 'SHARED', desired_dirty: false, desired_version: 3,
    environment: 'PRODUCTION', grace_ends_on: null, grace_expired: false, integration_code: 'esupplier-m2m',
    last_change_at: null, last_change_reason: null, last_push_at: null, last_verified_at: null,
    lifecycle_stage: 'CURRENT', managing_organization_id: null, managing_organization_name: null,
    oldest_due_date: null, open_suspension_id: null, organization_name: 'Alpha Retail', overdue_balance: null,
    overdue_currency: null, overdue_invoices: 0, product_accent_color: null, product_code: 'esupplier',
    product_short_name: 'eSupplier', product_sort_order: 10, push_enabled: true, saas_product_id: 'p1',
    suspended_at: null, suspension_cause: null, suspension_reason: null, sync_state: 'IN_SYNC', tenant_id: 't-a1',
    tenant_name: 'Alpha · eSupplier', tenant_slug: 'alpha', tenant_status: 'ACTIVE',
    ...overrides,
  };
}

const ROWS = [
  row({}),
  row({
    tenant_id: 't-a2', tenant_name: 'Alpha · EWM', product_code: 'ewm', product_short_name: 'EWM', product_sort_order: 20,
    lifecycle_stage: 'IN_GRACE', overdue_invoices: 1, overdue_balance: 250, overdue_currency: 'USD', days_past_due: 3,
    grace_ends_on: '2026-10-20', sync_state: 'IN_SYNC', cohort_state: 'SHADOW',
  }),
  row({
    tenant_id: 't-b1', customer_organization_id: 'org-b', organization_name: 'Beta Logística', tenant_name: 'Beta · EWM',
    product_code: 'ewm', product_short_name: 'EWM', product_sort_order: 20, lifecycle_stage: 'SUSPENDED_NON_PAYMENT',
    tenant_status: 'SUSPENDED', suspension_cause: 'NON_PAYMENT', suspended_at: '2026-10-01T11:00:00Z',
    overdue_invoices: 2, overdue_balance: 900, overdue_currency: 'USD', days_past_due: 45, grace_expired: true,
    desired_dirty: true,
  }),
  row({
    tenant_id: 't-c1', customer_organization_id: 'org-c', organization_name: 'Ceta Minería', tenant_name: 'Ceta · TMS',
    product_code: 'tms', product_short_name: 'TMS', product_sort_order: 30, lifecycle_stage: 'SUSPENSION_SCHEDULED',
    overdue_invoices: 1, overdue_balance: 400, overdue_currency: 'USD', days_past_due: 20, grace_expired: true,
    sync_state: null, cohort_state: null,
  }),
];

function renderPage() {
  return render(
    <MemoryRouter>
      <SuiteControlPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.location.hash = '';
  lifecycleHook.mockReset();
  settingsHook.mockReset();
  runMutateAsync.mockReset();
  saveMutateAsync.mockReset();
  suspendMutateAsync.mockReset();
  resumeMutateAsync.mockReset();
  Object.assign(perms, { canManagePlatform: true, canReadFinance: false, isSuperAdmin: false });
  lifecycleHook.mockReturnValue({ data: ROWS, isLoading: false, error: null });
  settingsHook.mockReturnValue({
    data: {
      auto_suspend_enabled: false, auto_resume_enabled: true, entitlement_sync_enabled: true, autocharge_enabled: false,
      last_cycle_at: null, last_cycle_result: null,
    },
    isLoading: false,
    error: null,
  });
});

describe('SuiteControlPage', () => {
  it('muestra una fila por cuenta y una columna por app, con la cuenta más grave arriba', () => {
    renderPage();
    const table = screen.getByRole('table', { name: /Matriz de la suite/ });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Cuenta', 'eSupplier', 'EWM', 'TMS']);
    const firstRow = within(table).getAllByRole('row')[1]!;
    expect(firstRow).toHaveTextContent('Beta Logística');
    expect(within(firstRow).getAllByRole('link').map((l) => l.getAttribute('href'))).toContain('/tenants/t-b1');
    expect(firstRow).toHaveTextContent('Impago');
    expect(firstRow).toHaveTextContent('Entrega pendiente');
  });

  it('resume la suite en KPIs y avisa que el corte automático está apagado', () => {
    renderPage();
    const kpis = screen.getByRole('region', { name: 'Estado de la suite' });
    expect(kpis).toHaveTextContent('Por suspender');
    expect(kpis).toHaveTextContent('Corte automático apagado: decide una persona.');
    expect(kpis).toHaveTextContent('1 por impago · 0 manuales.');
  });

  it('cobranza y cortes: deuda, entrega a la app y acciones según el estado', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /Cobranza y cortes/ }));
    const table = screen.getByRole('table', { name: 'Cobranza y cortes por tenant' });
    const rows = within(table).getAllByRole('row').slice(1);
    // Solo los que requieren atención: en gracia, programado y suspendido.
    expect(rows).toHaveLength(3);
    const beta = rows.find((r) => r.textContent?.includes('Beta · EWM'))!;
    expect(beta).toHaveTextContent('Suspendido por impago');
    expect(beta).toHaveTextContent('2 facturas · 45 días de atraso');
    expect(within(beta).getByRole('button', { name: 'Reactivar' })).toBeInTheDocument();
    const ceta = rows.find((r) => r.textContent?.includes('Ceta · TMS'))!;
    expect(ceta).toHaveTextContent('Sin canal');
    expect(within(ceta).getByRole('button', { name: 'Suspender' })).toBeInTheDocument();
    const alpha = rows.find((r) => r.textContent?.includes('Alpha · EWM'))!;
    expect(alpha).toHaveTextContent('Entregado, en sombra');
  });

  it('suspender pide motivo y llama a la RPC con el tenant', async () => {
    const user = userEvent.setup();
    suspendMutateAsync.mockResolvedValue({});
    renderPage();
    await user.click(screen.getByRole('tab', { name: /Cobranza y cortes/ }));
    const ceta = screen.getAllByRole('row').find((r) => r.textContent?.includes('Ceta · TMS'))!;
    await user.click(within(ceta).getByRole('button', { name: 'Suspender' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Suspender' }));
    expect(suspendMutateAsync).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(/Motivo/), 'Incumplimiento');
    await user.click(within(dialog).getByRole('button', { name: 'Suspender' }));
    expect(suspendMutateAsync).toHaveBeenCalledWith({ p_tenant_id: 't-c1', p_reason: 'Incumplimiento' });
  });

  it('sin rol de plataforma no se ofrecen ciclo ni acciones', async () => {
    Object.assign(perms, { canManagePlatform: false, canReadFinance: true });
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByRole('button', { name: 'Ejecutar ciclo ahora' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Cobranza y cortes/ }));
    expect(screen.queryByRole('button', { name: 'Suspender' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivar' })).not.toBeInTheDocument();
  });

  it('simular el ciclo muestra quién cumple la regla sin suspender a nadie', async () => {
    const user = userEvent.setup();
    runMutateAsync.mockResolvedValue({
      dry_run: true, auto_suspend_enabled: false, alerts_created: 0,
      suspended: [], resumed: [], pending_resumes: [],
      pending_suspensions: [{ tenant_id: 't-c1', tenant: 'Ceta · TMS', product: 'TMS' }],
    });
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Simular ciclo' }));
    expect(runMutateAsync).toHaveBeenCalledWith({ p_dry_run: true });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Simulación: 1 tenant(s) cumplen la regla de suspensión');
    expect(status).toHaveTextContent('Ceta · TMS (TMS)');
  });

  it('la política solo la cambia el super admin', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /Política y tareas programadas/ }));
    expect(screen.getByRole('switch', { name: 'Suspensión automática por impago' })).toBeDisabled();

    Object.assign(perms, { isSuperAdmin: true });
    saveMutateAsync.mockResolvedValue({});
    const view = renderPage();
    const tab = within(view.container).getByRole('tab', { name: /Política y tareas programadas/ });
    await user.click(tab);
    const sw = within(view.container).getByRole('switch', { name: 'Suspensión automática por impago' });
    expect(sw).toBeEnabled();
    await user.click(sw);
    expect(saveMutateAsync).toHaveBeenCalledWith({ p_auto_suspend_enabled: true });
  });
});
