import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';

/*
 * Sincronización con las apps (Suite → Apps). La pantalla solo pinta lo que
 * decide la base y llama a la Edge Function / RPC con el hallazgo y nada más.
 */

const targetsHook = vi.fn();
const findingsHook = vi.fn();
const runsHook = vi.fn();
const runMutate = vi.fn();
const resolveMutateAsync = vi.fn();
const registerMutateAsync = vi.fn();
const runState = { isPending: false };

vi.mock('./syncApi', () => ({
  useTenantSyncTargets: () => targetsHook(),
  useTenantSyncFindings: (status: string) => findingsHook(status),
  useTenantSyncRuns: () => runsHook(),
  useUnlinkedTenants: () => ({ data: [{ id: 't-grupasa', name: 'GRUPASA · EWM', slug: 'grupasa-ewm' }], isLoading: false }),
  useRunTenantSync: () => ({ mutate: runMutate, ...runState }),
  useResolveFinding: () => ({ mutateAsync: resolveMutateAsync, isPending: false }),
  useRegisterFinding: () => ({ mutateAsync: registerMutateAsync, isPending: false }),
}));
vi.mock('@/services/queries', () => ({
  useOrganizations: () => ({ data: [{ id: 'org-1', display_name: 'Consorcio Minero Horizonte' }], isLoading: false }),
}));

import { TenantSyncPage } from './TenantSyncPage';

const ok = <T,>(data: T) => ({ data, isLoading: false, error: null, refetch: vi.fn() });

function target(over: Record<string, unknown>) {
  return {
    deployment_target_id: 'd-ewm', deployment_code: 'ewm-shared-qas', deployment_name: 'EWM Compartido · QAS',
    environment: 'QAS', product_short_name: 'EWM', product_code: 'ewm', can_check_existence: true, can_check_state: true,
    inventory_available: false, active_links: 2, open_findings: 1, last_checked_at: '2026-11-13T10:30:00Z',
    last_outcome: 'WITH_FINDINGS', last_error_code: null, last_links_total: 2, last_links_ok: 1, last_links_broken: 1,
    last_links_state_mismatch: 0, last_links_unverified: 0, last_inventory_status: 'NOT_AVAILABLE',
    last_inventory_items: 0, last_inventory_unknown: 0, ...over,
  };
}

function finding(over: Record<string, unknown>) {
  return {
    id: 'f-1', kind: 'APP_ONLY', status: 'OPEN', saas_product_id: 'p-esup', product_code: 'esupplier',
    product_short_name: 'eSupplier', environment: 'QAS', deployment_code: 'esupplier-shared-dev', tenant_name: null,
    external_tenant_id: '8', app_code: 'chm', app_name: 'CONSORCIO MINERO HORIZONTE S.R.L.', app_status: 'ACTIVE',
    masteradmin_state: null, app_state: 'ACTIVE', last_seen_at: '2026-11-13T10:30:00Z', times_seen: 1,
    resolution: null, resolution_reason: null, resolved_by_name: null, registered_tenant_name: null, ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <TenantSyncPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  runState.isPending = false;
  targetsHook.mockReturnValue(ok([
    target({}),
    target({
      deployment_target_id: 'd-esup', deployment_name: 'eSupplier · DEV', product_short_name: 'eSupplier', inventory_available: true,
      last_inventory_status: 'AVAILABLE', last_inventory_items: 8, last_inventory_unknown: 6, can_check_existence: false,
    }),
  ]));
  findingsHook.mockImplementation((status: string) =>
    ok(status === 'OPEN'
      ? [finding({}), finding({ id: 'f-2', kind: 'BROKEN_LINK', tenant_name: 'EBIM eCommerce QAS Smoke', external_tenant_id: 'af82', app_name: null, product_short_name: 'eCommerce' })]
      : [finding({ id: 'f-9', status: 'DISMISSED', resolution: 'DISMISSED', resolution_reason: 'Datos de demo', resolved_by_name: 'Paula Producto', app_name: 'Joltech' })]),
  );
  runsHook.mockReturnValue(ok([
    { id: 'r1', trigger_kind: 'MANUAL', status: 'COMPLETED', started_at: '2026-11-13T10:30:00Z', targets_checked: 8, targets_total: 8, findings_opened: 3, findings_closed: 1, error_code: null, requested_by_name: 'Paula Producto' },
  ]));
});

describe('TenantSyncPage', () => {
  it('muestra la última revisión por app y dice cuándo una app no tiene inventario', () => {
    renderPage();
    const table = screen.getByRole('table', { name: 'Revisión por app' });
    expect(within(table).getByText('Inventario no disponible en esta app')).toBeInTheDocument();
    expect(within(table).getByText('8 clientes en la app · 6 sin registrar aquí')).toBeInTheDocument();
    expect(within(table).getAllByText('1 de 2 coinciden · 1 rotos')).toHaveLength(2);
    expect(screen.getByText('A pedido de Paula Producto')).toBeInTheDocument();
  });

  it('«Sincronizar ahora» llama a la función sin parámetros', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Sincronizar ahora' }));
    expect(runMutate).toHaveBeenCalledWith(undefined, expect.any(Object));
  });

  it('cada diferencia abierta ofrece su acción: registrar (solo en la app) o marcar resuelta', () => {
    renderPage();
    const table = screen.getByRole('table', { name: 'Diferencias con las apps' });
    const appOnly = within(table).getByText('CONSORCIO MINERO HORIZONTE S.R.L.').closest('tr')!;
    expect(within(appOnly).getByText('Existe solo en la app')).toBeInTheDocument();
    expect(within(appOnly).getByRole('button', { name: 'Registrar en el Admin Maestro' })).toBeInTheDocument();
    expect(within(appOnly).queryByRole('button', { name: 'Marcar como resuelto' })).toBeNull();
    const broken = within(table).getByText('EBIM eCommerce QAS Smoke').closest('tr')!;
    expect(within(broken).getByText('Vínculo roto')).toBeInTheDocument();
    expect(within(broken).getByRole('button', { name: 'Marcar como resuelto' })).toBeInTheDocument();
    expect(within(broken).getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
  });

  it('descartar exige motivo y manda solo el hallazgo, la acción y el motivo', async () => {
    resolveMutateAsync.mockResolvedValue('f-2');
    renderPage();
    const broken = screen.getByText('EBIM eCommerce QAS Smoke').closest('tr')!;
    await userEvent.click(within(broken).getByRole('button', { name: 'Descartar' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar' }));
    expect(resolveMutateAsync).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'Tenant de prueba borrado a propósito');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar' }));
    expect(resolveMutateAsync).toHaveBeenCalledWith({ id: 'f-2', action: 'DISMISS', reason: 'Tenant de prueba borrado a propósito' });
  });

  it('registrar un cliente de la app propone sus datos y crea cuenta + tenant', async () => {
    registerMutateAsync.mockResolvedValue({ tenant_id: 't-new' });
    renderPage();
    const row = screen.getByText('CONSORCIO MINERO HORIZONTE S.R.L.').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Registrar en el Admin Maestro' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/Razón social/)).toHaveValue('CONSORCIO MINERO HORIZONTE S.R.L.');
    expect(within(dialog).getByLabelText(/Identificador del tenant/)).toHaveValue('chm-esupplier');
    expect(within(dialog).getByText(/no se llama a la app/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Correo del administrador/), 'ti@cmh.com.pe');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(registerMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      p_finding_id: 'f-1',
      p_org_legal_name: 'CONSORCIO MINERO HORIZONTE S.R.L.',
      p_org_country_code: 'PE',
      p_tenant_slug: 'chm-esupplier',
      p_admin_email: 'ti@cmh.com.pe',
      p_tenant_type: 'PRODUCTION',
    }));
  });

  it('también puede vincularlo a un tenant que ya existe sin alta', async () => {
    registerMutateAsync.mockResolvedValue({ tenant_id: 't-grupasa' });
    renderPage();
    const row = screen.getByText('CONSORCIO MINERO HORIZONTE S.R.L.').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Registrar en el Admin Maestro' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Cómo lo registras/), 'EXISTING_TENANT');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Tenant del Admin Maestro/), 't-grupasa');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(registerMutateAsync).toHaveBeenCalledWith({ p_finding_id: 'f-1', p_existing_tenant_id: 't-grupasa' });
  });

  it('las cerradas muestran cómo se cerraron y sin acciones', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Descartados/ }));
    expect(findingsHook).toHaveBeenLastCalledWith('DISMISSED');
    const row = screen.getByText('Joltech').closest('tr')!;
    expect(within(row).getByText(/Descartado · Datos de demo · Paula Producto/)).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('si el entorno aún no tiene la sincronización, un solo aviso en español (V6 · F5)', () => {
    const missing = { data: undefined, isLoading: false, refetch: vi.fn(), error: { code: 'PGRST205', message: 'Could not find the table' } };
    targetsHook.mockReturnValue(missing);
    runsHook.mockReturnValue(missing);
    findingsHook.mockReturnValue(missing);
    renderPage();
    expect(screen.getByText('La sincronización con las apps no está disponible')).toBeInTheDocument();
    expect(screen.getByText(/todavía no está disponible en este entorno/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Resumen de la sincronización' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Reintentar' })).toHaveLength(1);
  });
});

