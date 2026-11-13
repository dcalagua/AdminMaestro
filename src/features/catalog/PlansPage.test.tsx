import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';

/*
 * P09 · Un plan sin tarifa abierta NO es un plan gratis: se lee «Sin precio
 * definido». Lo recurrente y los cargos únicos van en columnas separadas.
 */

const plansHook = vi.fn();

vi.mock('@/services/queries', () => ({
  usePlans: () => plansHook(),
  useCurrencies: () => ({ data: [] }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ canManagePlatform: false }),
}));
vi.mock('./PlanDialogs', () => ({
  PlanFormDialog: () => null,
  PlanPriceDialog: () => null,
}));

import { PlansPage } from './PlansPage';

function plan(overrides: Record<string, unknown>) {
  return {
    id: 'p1',
    code: 'ESUP-BASIC',
    name: 'Básico',
    description: null,
    saas_product_id: 'prod-1',
    saas_products: { code: 'ESUP', short_name: 'eSupplier' },
    deployment_mode: 'SHARED',
    included_companies: 1,
    multi_country: false,
    is_partner_base: false,
    status: 'ACTIVE',
    sort_order: 1,
    plan_prices: [],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PlansPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  plansHook.mockReset();
});

describe('PlansPage', () => {
  it('un plan sin precio dice «Sin precio definido», nunca gratis ni 0', () => {
    plansHook.mockReturnValue({ data: [plan({ plan_prices: [] })], isLoading: false, error: null });
    renderPage();

    const row = screen.getByRole('row', { name: /Básico/ });
    expect(within(row).getByText('Sin precio definido')).toBeInTheDocument();
    expect(within(row).queryByText(/gratis/i)).toBeNull();
    expect(row.textContent).not.toMatch(/\b0[.,]00\b/);
  });

  it('una tarifa cerrada no cuenta como precio vigente', () => {
    plansHook.mockReturnValue({
      data: [
        plan({
          plan_prices: [
            {
              id: 'pr-old', amount: 99, currency: 'USD', charge_kind: 'LICENSE',
              billing_interval: 'MONTHLY', valid_from: '2025-01-01', valid_to: '2025-12-31', markets: { code: 'PE' },
            },
          ],
        }),
      ],
      isLoading: false,
      error: null,
    });
    renderPage();
    expect(screen.getByText('Sin precio definido')).toBeInTheDocument();
  });

  it('V6: fila compacta con «desde», mercados y n.º de cargos únicos; el detalle completo en el panel', async () => {
    plansHook.mockReturnValue({
      data: [
        plan({
          included_companies: 3,
          plan_prices: [
            {
              id: 'pr-1', amount: 120, currency: 'USD', charge_kind: 'LICENSE',
              billing_interval: 'MONTHLY', valid_from: '2026-01-01', valid_to: null, markets: { code: 'PE' },
            },
            {
              id: 'pr-3', amount: 100, currency: 'USD', charge_kind: 'LICENSE',
              billing_interval: 'MONTHLY', valid_from: '2026-01-01', valid_to: null, markets: { code: 'EC' },
            },
            {
              id: 'pr-4', amount: 3300, currency: 'BOB', charge_kind: 'LICENSE',
              billing_interval: 'MONTHLY', valid_from: '2026-01-01', valid_to: null, markets: { code: 'BO' },
            },
            {
              id: 'pr-2', amount: 500, currency: 'USD', charge_kind: 'IMPLEMENTATION_FEE',
              billing_interval: 'ONE_TIME', valid_from: '2026-01-01', valid_to: null, markets: { code: 'PE' },
            },
          ],
        }),
      ],
      isLoading: false,
      error: null,
    });
    renderPage();

    const row = screen.getByRole('row', { name: /Básico/ });
    const cells = within(row).getAllByRole('cell');
    // «Desde»: el precio mensual más bajo en la moneda principal, sin sumar monedas.
    expect(cells[3]!.textContent).toMatch(/USD\s*100/);
    expect(cells[3]!.textContent).toContain('/mes');
    expect(cells[3]!.textContent).toContain('también en BOB');
    expect(cells[3]!.textContent).not.toMatch(/500/);
    expect(within(cells[4]!).getByRole('list', { name: 'Mercados de Básico' })).toHaveTextContent('BOECPE');
    expect(cells[5]!.textContent).toBe('1 cargo');
    expect(row).toHaveTextContent('3 sociedades');
    expect(screen.queryByText('Sin precio definido')).toBeNull();

    await userEvent.click(within(row).getByRole('button', { name: 'Ver las tarifas de Básico' }));
    const drawer = screen.getByRole('dialog', { name: 'Tarifas · Básico' });
    expect(drawer.textContent).toMatch(/USD\s*120\.00/);
    expect(drawer.textContent).toContain('/ mes');
    expect(drawer.textContent).toMatch(/USD\s*500\.00/);
    expect(drawer.textContent).toContain('pago único');
  });

  it('un error de lectura se muestra como error, no como lista vacía', () => {
    plansHook.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom'), refetch: vi.fn() });
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la información');
    expect(screen.queryByText('Sin planes')).toBeNull();
  });
});
