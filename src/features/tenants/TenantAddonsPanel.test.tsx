import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * CCP fase 07 · Add-ons de un tenant. Cada transición se ofrece sólo en el
 * estado que la base admite y a la autoridad que la ejecuta (comercial vs.
 * finanzas), siempre con motivo. Es UX: la RPC es la autoridad.
 */

const historyHook = vi.fn();
const entitlementsHook = vi.fn();
const permissions = vi.fn();
const approve = vi.fn();

const mutation = (fn = vi.fn()) => ({ mutateAsync: fn, isPending: false, error: null, reset: vi.fn() });

vi.mock('@/services/queries', () => ({
  useTenantAddonHistory: () => historyHook(),
  useTenantEntitlements: () => entitlementsHook(),
  useCatalogItemsWithLifecycle: () => ({ data: [] }),
  useCurrencies: () => ({ data: [] }),
}));
vi.mock('@/services/mutations', () => ({
  useApproveTenantAddon: () => mutation(approve),
  useRejectTenantAddon: () => mutation(),
  useScheduleCancelTenantAddon: () => mutation(),
  useReactivateTenantAddon: () => mutation(),
  useSuspendTenantAddon: () => mutation(),
  useResumeTenantAddon: () => mutation(),
  useCancelTenantAddon: () => mutation(),
  useRequestTenantAddon: () => mutation(),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => permissions(),
}));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));

import { TenantAddonsPanel } from './TenantAddonsPanel';

function addon(overrides: Record<string, unknown>) {
  return {
    id: 'ta-1',
    tenant_id: 't1',
    addon_code: 'ewm-extra-warehouse',
    addon_name: 'Almacén adicional',
    billing_model: 'PER_UNIT',
    company_name: null,
    status: 'REQUESTED',
    active: false,
    request_source: 'CONSOLE',
    requested_at: '2026-09-01T10:00:00Z',
    approved_at: null,
    effective_from: null,
    effective_to: null,
    status_reason: null,
    unit_amount: null,
    currency: null,
    billing_valid_to: null,
    ...overrides,
  };
}

const ROWS = [
  addon({ id: 'ta-req', addon_name: 'Solicitado uno', status: 'REQUESTED' }),
  addon({
    id: 'ta-act', addon_name: 'Activo uno', status: 'ACTIVE', effective_from: '2026-08-01T00:00:00Z',
    unit_amount: 45, currency: 'USD',
  }),
  addon({ id: 'ta-sus', addon_name: 'Suspendido uno', status: 'SUSPENDED', effective_from: '2026-07-01T00:00:00Z' }),
  addon({ id: 'ta-can', addon_name: 'Baja uno', status: 'CANCELLED' }),
];

function renderPanel() {
  return render(<TenantAddonsPanel tenantId="t1" saasProductId="prod-ewm" />);
}

beforeEach(() => {
  historyHook.mockReturnValue({ data: ROWS, isLoading: false, error: null });
  entitlementsHook.mockReturnValue({ data: [], isLoading: false, error: null });
  permissions.mockReturnValue({ canManageCommercial: true, canReadFinance: false, canManagePlatform: true });
  approve.mockReset();
});

describe('TenantAddonsPanel', () => {
  it('«Aprobar» sólo aparece en filas REQUESTED', () => {
    renderPanel();
    const approveButtons = screen.getAllByRole('button', { name: 'Aprobar' });
    expect(approveButtons).toHaveLength(1);
    const requested = screen.getByRole('row', { name: /Solicitado uno/ });
    expect(within(requested).getByRole('button', { name: 'Aprobar' })).toBeInTheDocument();
    expect(within(requested).getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
    for (const name of [/Activo uno/, /Suspendido uno/, /Baja uno/]) {
      expect(within(screen.getByRole('row', { name })).queryByRole('button', { name: 'Aprobar' })).toBeNull();
    }
    // Comercial programa la baja de un activo, pero no suspende (finanzas).
    const active = screen.getByRole('row', { name: /Activo uno/ });
    expect(within(active).getByRole('button', { name: 'Programar baja' })).toBeInTheDocument();
    expect(within(active).queryByRole('button', { name: 'Suspender' })).toBeNull();
  });

  it('finanzas suspende, reanuda y da de baja; no aprueba', () => {
    permissions.mockReturnValue({ canManageCommercial: false, canReadFinance: true, canManagePlatform: false });
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
    const active = screen.getByRole('row', { name: /Activo uno/ });
    expect(within(active).getByRole('button', { name: 'Suspender' })).toBeInTheDocument();
    expect(within(active).getByRole('button', { name: 'Dar de baja' })).toBeInTheDocument();
    const suspended = screen.getByRole('row', { name: /Suspendido uno/ });
    expect(within(suspended).getByRole('button', { name: 'Reanudar' })).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Baja uno/ })).queryAllByRole('button')).toHaveLength(0);
  });

  it('sin permisos comerciales ni financieros sólo se ofrece solicitar', () => {
    permissions.mockReturnValue({ canManageCommercial: false, canReadFinance: false, canManagePlatform: false });
    renderPanel();
    expect(screen.getByRole('button', { name: 'Solicitar add-on' })).toBeInTheDocument();
    for (const name of ['Aprobar', 'Rechazar', 'Programar baja', 'Suspender', 'Reanudar', 'Dar de baja']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('muestra el importe congelado sólo cuando es visible', () => {
    renderPanel();
    expect(screen.getByRole('row', { name: /Activo uno/ }).textContent).toMatch(/USD\s*45\.00/);
    expect(within(screen.getByRole('row', { name: /Solicitado uno/ })).getByText('No visible')).toBeInTheDocument();
  });

  it('aprobar exige motivo y llama a la RPC con él', async () => {
    const user = userEvent.setup();
    approve.mockResolvedValue({});
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Aprobar' }));
    const dialog = screen.getByRole('dialog');
    // Sin motivo no se envía (campo obligatorio; un motivo en blanco lo rechaza zod).
    await user.type(within(dialog).getByLabelText(/Motivo/), '  ');
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar' }));
    expect(await within(dialog).findByText('El motivo es obligatorio')).toBeInTheDocument();
    expect(approve).not.toHaveBeenCalled();
    await user.clear(within(dialog).getByLabelText(/Motivo/));

    await user.type(within(dialog).getByLabelText(/Motivo/), 'Cliente firmó la adenda');
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar' }));
    expect(approve).toHaveBeenCalledWith({ p_tenant_addon_id: 'ta-req', p_reason: 'Cliente firmó la adenda' });
  });

  it('entitlements efectivos con valor, origen y pendiente de sincronizar', () => {
    entitlementsHook.mockReturnValue({
      data: [
        {
          tenant_id: 't1', product_code: 'ewm', capability_code: 'ewm.warehouses', kind: 'LIMIT',
          scope_level: 'TENANT', enabled: true, value: 3, included: null, enforcement: 'HARD', period: null,
          unit: 'warehouse', sources: ['PLAN:ewm-pro', 'ADDON:ewm-extra-warehouse'], company_ids: null,
          desired_revision: 4, desired_dirty: true,
        },
        {
          tenant_id: 't1', product_code: 'ewm', capability_code: 'ewm.waves', kind: 'FEATURE',
          scope_level: 'TENANT', enabled: true, value: null, included: null, enforcement: null, period: null,
          unit: null, sources: ['PLAN:ewm-pro'], company_ids: null, desired_revision: 4, desired_dirty: false,
        },
      ],
      isLoading: false,
      error: null,
    });
    renderPanel();
    const limit = screen.getByRole('row', { name: /ewm\.warehouses/ });
    expect(limit.textContent).toContain('Tope 3 warehouse');
    expect(within(limit).getByText('ADDON:ewm-extra-warehouse')).toBeInTheDocument();
    expect(within(limit).getByText('pendiente de sincronizar')).toBeInTheDocument();
    const feature = screen.getByRole('row', { name: /ewm\.waves/ });
    expect(within(feature).getByText('Habilitada')).toBeInTheDocument();
    expect(within(feature).getByText('Sincronizado')).toBeInTheDocument();
  });

  it('estados vacíos', () => {
    historyHook.mockReturnValue({ data: [], isLoading: false, error: null });
    renderPanel();
    expect(screen.getByText('Sin add-ons')).toBeInTheDocument();
    expect(screen.getByText('Sin entitlements')).toBeInTheDocument();
  });

  it('un error de lectura se muestra como error, no como lista vacía', () => {
    historyHook.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom'), refetch: vi.fn() });
    entitlementsHook.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom'), refetch: vi.fn() });
    renderPanel();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.queryByText('Sin add-ons')).toBeNull();
    expect(screen.queryByText('Sin entitlements')).toBeNull();
  });
});
