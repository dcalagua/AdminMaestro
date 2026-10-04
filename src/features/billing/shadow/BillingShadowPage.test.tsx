import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/*
 * CCP M4 · «Billing shadow» (spec §5.3, D-14). El eje BILLING se mueve un paso
 * con motivo (comercial/finanzas); la vista previa es solo lectura; la
 * comparación solo se registra con el eje en BILLING_SHADOW.
 */

const integrationsHook = vi.fn();
const comparisonsHook = vi.fn();
const expectedHook = vi.fn();
const permissions = vi.fn();
const setCutover = vi.fn();
const recordComparison = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

const mutation = (fn = vi.fn()) => ({ mutateAsync: fn, isPending: false, error: null, reset: vi.fn() });

vi.mock('@/services/queries', () => ({
  useProductIntegrations: () => integrationsHook(),
  useBillingShadowComparisons: () => comparisonsHook(),
  useBillingShadowExpected: (p: unknown) => expectedHook(p),
  useProducts: () => ({
    data: [
      { id: 'p-eexp', code: 'eexpense', short_name: 'eExpense' },
      { id: 'p-gmao', code: 'gmao', short_name: 'GMAO' },
    ],
  }),
  useTenantOverview: () => ({
    data: [
      { tenant_id: 't-alpha', name: 'Alpha Retail', slug: 'alpha', saas_product_id: 'p-eexp', product_code: 'eexpense', product_short_name: 'eExpense' },
      { tenant_id: 't-gm', name: 'Planta Norte', slug: 'norte', saas_product_id: 'p-gmao', product_code: 'gmao', product_short_name: 'GMAO' },
    ],
  }),
  useCurrencies: () => ({ data: [] }),
}));
vi.mock('@/services/mutations', () => ({
  useSetCommercialCutoverState: () => mutation(setCutover),
  useRecordBillingShadowComparison: () => mutation(recordComparison),
}));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => permissions() }));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, push: vi.fn() }),
}));

import { BillingShadowPage } from './BillingShadowPage';
import { ShadowAxisTab } from './ShadowAxisTab';
import { ShadowPreviewTab } from './ShadowPreviewTab';
import { ShadowHistoryTab } from './ShadowHistoryTab';

const ok = (data: unknown) => ({ data, isLoading: false, error: null, refetch: vi.fn() });
const failed = () => ({ data: undefined, isLoading: false, error: new Error('boom'), refetch: vi.fn() });

const FINANCE = { canManagePlatform: false, canReadFinance: true, canManageCommercial: true };
const COMMERCIAL_ONLY = { canManagePlatform: true, canReadFinance: false, canManageCommercial: true };
const READER = { canManagePlatform: false, canReadFinance: false, canManageCommercial: false };

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

function integration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'int-eexp', code: 'eexpense-m2m-dev', saas_product_id: 'p-eexp', cutover_state_billing: 'BILLING_LEGACY',
    usage_ingest_enabled: false, saas_products: { code: 'eexpense', short_name: 'eExpense' },
    ...overrides,
  };
}

function comparison(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmp-1', saas_product_id: 'p-eexp', tenant_id: 't-alpha', subscription_id: 'sub-1', period_start: '2026-09-01',
    source: 'eexpense-biller', actor: 'qa', actor_user_id: null, created_at: '2026-10-03T12:00:00Z',
    expected: { periodStart: '2026-09-01', currency: 'PEN', total: 120, lines: [{ itemCode: 'plan:pro', quantity: 1, amount: 120, currency: 'PEN' }] },
    local: { currency: 'PEN', total: 100, lines: [{ itemCode: 'plan:pro', quantity: 1, amount: 100, currency: 'PEN' }] },
    diffs: [{ itemCode: 'plan:pro', type: 'AMOUNT_MISMATCH', masteradmin: { quantity: 1, amount: 120 }, local: { quantity: 1, amount: 100 } }],
    mismatches: 1,
    report_checksum: `sha256:${'b'.repeat(64)}`,
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of [setCutover, recordComparison, toastSuccess, toastError]) fn.mockReset();
  permissions.mockReturnValue(READER);
  integrationsHook.mockReturnValue(ok([]));
  comparisonsHook.mockReturnValue(ok([]));
  expectedHook.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
  window.location.hash = '';
});

describe('BillingShadowPage', () => {
  it('pestañas Productos, Vista previa e Historial', () => {
    wrap(<BillingShadowPage />);
    for (const name of ['Productos', 'Vista previa', 'Historial']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Sin integraciones visibles')).toBeInTheDocument();
  });
});

describe('ShadowAxisTab', () => {
  it('muestra el eje y solo ofrece transiciones a quien gestiona lo comercial', () => {
    integrationsHook.mockReturnValue(ok([integration()]));
    const { unmount } = wrap(<ShadowAxisTab />);
    const row = screen.getByRole('row', { name: /eExpense/ });
    expect(within(row).getByText('Biller local (legacy)')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
    unmount();

    permissions.mockReturnValue(COMMERCIAL_ONLY);
    wrap(<ShadowAxisTab />);
    expect(screen.getByRole('button', { name: 'Avanzar a SHADOW' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /RETIRED/ })).toBeNull();
  });

  it('desde SHADOW avanza a PRIMARY o retrocede; nunca ofrece el retiro', () => {
    permissions.mockReturnValue(FINANCE);
    integrationsHook.mockReturnValue(ok([integration({ cutover_state_billing: 'BILLING_PRIMARY' })]));
    wrap(<ShadowAxisTab />);
    expect(screen.getByRole('button', { name: 'Retroceder a SHADOW' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /RETIRED/ })).toBeNull();
  });

  it('la transición exige motivo y llama a set_commercial_cutover_state con el eje BILLING', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(FINANCE);
    integrationsHook.mockReturnValue(ok([integration()]));
    setCutover.mockResolvedValue('BILLING_SHADOW');
    wrap(<ShadowAxisTab />);
    await user.click(screen.getByRole('button', { name: 'Avanzar a SHADOW' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Motivo/), '  ');
    await user.click(within(dialog).getByRole('button', { name: 'Cambiar eje' }));
    expect(await within(dialog).findByText('El motivo es obligatorio')).toBeInTheDocument();
    expect(setCutover).not.toHaveBeenCalled();
    await user.clear(within(dialog).getByLabelText(/Motivo/));
    await user.type(within(dialog).getByLabelText(/Motivo/), 'D-14 DEV: inicia shadow');
    await user.click(within(dialog).getByRole('button', { name: 'Cambiar eje' }));
    expect(setCutover).toHaveBeenCalledWith({
      p_integration_id: 'int-eexp', p_axis: 'BILLING', p_to_state: 'BILLING_SHADOW', p_reason: 'D-14 DEV: inicia shadow',
    });
  });

  it('error de lectura', () => {
    integrationsHook.mockReturnValue(failed());
    wrap(<ShadowAxisTab />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('ShadowPreviewTab', () => {
  it('calcula solo con producto, tenant y mes, y pinta líneas con total', async () => {
    const user = userEvent.setup();
    wrap(<ShadowPreviewTab />);
    expect(screen.getByText('Elige producto, tenant y mes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calcular' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Producto'), 'eexpense');
    // Solo los tenants del producto elegido.
    expect(within(screen.getByLabelText('Tenant')).queryByText('Planta Norte')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Tenant'), 't-alpha');
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '2026-09' } });

    expectedHook.mockReturnValue(
      ok({
        subscriptionId: 'sub-1', periodStart: '2026-09-01', currency: 'PEN', total: '150.00',
        lines: [
          { itemCode: 'plan:pro', quantity: 1, amount: 120, currency: 'PEN' },
          { itemCode: 'usage:ai.pages', quantity: 3, amount: 30, currency: 'PEN' },
        ],
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Calcular' }));
    expect(expectedHook).toHaveBeenLastCalledWith({ productCode: 'eexpense', tenantId: 't-alpha', periodStart: '2026-09-01' });
    expect(screen.getByRole('row', { name: /usage:ai\.pages/ })).toBeInTheDocument();
    expect(screen.getByText(/PEN\s*150\.00/)).toBeInTheDocument();
  });

  it('un error de negocio se muestra legible', async () => {
    const user = userEvent.setup();
    expectedHook.mockReturnValue({
      data: undefined, isLoading: false, refetch: vi.fn(),
      error: new Error('SUSCRIPCION_NO_ENCONTRADA: el tenant no tiene una suscripción ACTIVE/PAST_DUE de eexpense'),
    });
    wrap(<ShadowPreviewTab />);
    await user.selectOptions(screen.getByLabelText('Producto'), 'eexpense');
    await user.selectOptions(screen.getByLabelText('Tenant'), 't-alpha');
    await user.click(screen.getByRole('button', { name: 'Calcular' }));
    expect(screen.getByRole('alert')).toHaveTextContent('el tenant no tiene una suscripción ACTIVE/PAST_DUE');
  });
});

describe('ShadowHistoryTab', () => {
  it('verde/rojo, checksum y diff línea a línea', async () => {
    comparisonsHook.mockReturnValue(ok([comparison(), comparison({ id: 'cmp-2', mismatches: 0, diffs: [], tenant_id: 't-gm', saas_product_id: 'p-gmao' })]));
    wrap(<ShadowHistoryTab />);
    expect(within(screen.getByRole('row', { name: /Alpha Retail/ })).getByText('Rojo · 1 diferencia(s)')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Planta Norte/ })).getByText('Verde · sin diferencias')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('row', { name: /Alpha Retail/ })).getByRole('button', { name: 'Ver diferencias' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(`sha256:${'b'.repeat(64)}`)).toBeInTheDocument();
    expect(within(drawer).getByText('Importe distinto')).toBeInTheDocument();
  });

  it('«Registrar comparación» solo para finanzas y solo con un producto en BILLING_SHADOW', () => {
    integrationsHook.mockReturnValue(ok([integration()]));
    const { unmount } = wrap(<ShadowHistoryTab />);
    expect(screen.queryByRole('button', { name: 'Registrar comparación' })).toBeNull();
    unmount();

    permissions.mockReturnValue(FINANCE);
    const legacy = wrap(<ShadowHistoryTab />);
    expect(screen.getByRole('button', { name: 'Registrar comparación' })).toBeDisabled();
    legacy.unmount();

    integrationsHook.mockReturnValue(ok([integration({ cutover_state_billing: 'BILLING_SHADOW' })]));
    wrap(<ShadowHistoryTab />);
    expect(screen.getByRole('button', { name: 'Registrar comparación' })).toBeEnabled();
  });

  it('valida el JSON local con zod antes de llamar a record_billing_shadow_comparison', async () => {
    const user = userEvent.setup();
    permissions.mockReturnValue(FINANCE);
    integrationsHook.mockReturnValue(ok([integration({ cutover_state_billing: 'BILLING_SHADOW' })]));
    recordComparison.mockResolvedValue({ green: true, mismatches: 0 });
    wrap(<ShadowHistoryTab />);
    await user.click(screen.getByRole('button', { name: 'Registrar comparación' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Tenant/), 't-alpha');
    fireEvent.change(within(dialog).getByLabelText(/^Mes/), { target: { value: '2026-09' } });
    const json = within(dialog).getByLabelText(/JSON del biller local/);
    fireEvent.change(json, { target: { value: '{"currency":"PEN","lines":[{"itemCode":"a","quantity":1,"amount":"x"}]}' } });
    await user.click(within(dialog).getByRole('button', { name: 'Comparar y registrar' }));
    expect(await within(dialog).findByText(/amount debe ser numérico/)).toBeInTheDocument();
    expect(recordComparison).not.toHaveBeenCalled();

    const local = { source: 'eexpense-biller', currency: 'PEN', lines: [{ itemCode: 'plan:pro', quantity: 1, amount: 120 }] };
    fireEvent.change(json, { target: { value: JSON.stringify(local) } });
    await user.click(within(dialog).getByRole('button', { name: 'Comparar y registrar' }));
    expect(recordComparison).toHaveBeenCalledWith({
      p_saas_product_code: 'eexpense', p_tenant_id: 't-alpha', p_period_start: '2026-09-01', p_local: local,
      p_actor: 'masteradmin-console',
    });
    expect(toastSuccess).toHaveBeenCalledWith('Comparación verde', expect.any(String));
  });

  it('vacío y error', () => {
    const { unmount } = wrap(<ShadowHistoryTab />);
    expect(screen.getByText('Sin comparaciones registradas')).toBeInTheDocument();
    unmount();
    comparisonsHook.mockReturnValue(failed());
    wrap(<ShadowHistoryTab />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
