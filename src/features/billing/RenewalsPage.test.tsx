import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
 * M2 · «Ejecutar cobros pendientes»: solo finanzas, con confirmación que explica
 * la política de reintentos, y un resumen (procesadas, cobradas, fallidas, omitidas).
 */
const m = vi.hoisted(() => ({
  run: vi.fn(),
  q: (data: unknown) => ({ data, error: null, isLoading: false, isFetching: false, refetch: () => {}, dataUpdatedAt: 1 }),
  mut: () => ({ mutateAsync: () => Promise.resolve(null), isPending: false }),
}));

const perms = vi.hoisted(() => ({ canReadFinance: true, canManageCommercial: true, canManagePlatform: false }));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => perms,
}));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/services/queries', () => ({ useBillingAlerts: () => m.q([]) }));
vi.mock('@/services/financeRead', () => ({ useRenewalPipeline: () => m.q([]) }));
vi.mock('@/services/mutations', () => ({
  useRefreshBillingAlerts: m.mut,
  useApplyDueSuspensions: m.mut,
  useSetAlertStatus: m.mut,
  useAutocharge: () => ({ mutateAsync: m.run, isPending: false }),
}));

import { RenewalsPage } from './RenewalsPage';

describe('RenewalsPage · cobros con tarjeta guardada', () => {
  it('confirma con la política y pinta el resumen del servidor', async () => {
    m.run.mockResolvedValue({
      processed: 3, succeeded: 1, failed: 1, skipped: 1,
      results: [
        { invoice_number: 'INV-1', status: 'SUCCEEDED', amount: 100, currency: 'USD' },
        { invoice_number: 'INV-2', status: 'FAILED', error_code: 'TARJETA_RECHAZADA', amount: 50, currency: 'PEN' },
        { invoice_number: 'INV-3', status: 'SKIPPED', error_code: 'COBRO_NO_PROCEDE' },
      ],
    });
    render(<MemoryRouter><RenewalsPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar cobros pendientes' }));
    const dialog = screen.getByRole('dialog', { name: '¿Ejecutar los cobros pendientes?' });
    expect(dialog).toHaveTextContent('3 días');
    expect(dialog).toHaveTextContent('7 días');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ejecutar cobros' }));

    await waitFor(() => expect(m.run).toHaveBeenCalledWith({ run: true }));
    const summary = await screen.findByTestId('autocharge-summary');
    expect(within(summary).getByText('Procesadas').nextSibling).toHaveTextContent('3');
    expect(within(summary).getByText('Cobradas').nextSibling).toHaveTextContent('1');
    expect(screen.getByText('TARJETA_RECHAZADA')).toBeInTheDocument();
    expect(screen.getByText('INV-3')).toBeInTheDocument();
  });
});

describe('RenewalsPage · jerarquía de acciones (A11)', () => {
  it('la suspensión no compite con las demás acciones: vive en «Más acciones», al final y en rojo', () => {
    perms.canManagePlatform = true;
    render(<MemoryRouter><RenewalsPage /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /Ejecutar suspensiones/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Más acciones de renovaciones' }));
    const item = screen.getByRole('menuitem', { name: 'Ejecutar suspensiones…' });
    expect(item).toHaveClass('text-danger');
    fireEvent.click(item);
    expect(screen.getByRole('dialog', { name: '¿Ejecutar las suspensiones pendientes?' })).toBeInTheDocument();
    perms.canManagePlatform = false;
  });

  it('las ventanas de renovación son pestañas, no tarjetas que parezcan KPIs', () => {
    render(<MemoryRouter><RenewalsPage /></MemoryRouter>);
    const tabs = screen.getByRole('tablist', { name: 'Renuevan en' });
    expect(within(tabs).getByRole('tab', { name: /^30 días/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(tabs).getByRole('tab', { name: /^60 días/ }));
    expect(within(tabs).getByRole('tab', { name: /^60 días/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Renuevan en 60 días')).toBeInTheDocument();
  });
});
