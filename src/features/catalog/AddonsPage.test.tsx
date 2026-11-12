import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
 * CCP fase 07 · Add-ons y tarifas. Un add-on sin tarifa vigente NO es gratis:
 * se lee «Sin precio definido». El mercado va siempre junto al importe y una
 * tarifa programada se marca «desde <fecha>». Finanzas fija tarifas; producto
 * cambia el ciclo de vida.
 */

const itemsHook = vi.fn();
const pricesHook = vi.fn();
const permissions = vi.fn();

vi.mock('@/services/queries', () => ({
  useCatalogItemsWithLifecycle: () => itemsHook(),
  useCatalogItemPrices: () => pricesHook(),
  useProducts: () => ({ data: [{ id: 'prod-ewm', code: 'ewm', short_name: 'EWM' }] }),
  useCurrencies: () => ({ data: [] }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => permissions(),
}));
vi.mock('./AddonDialogs', () => ({
  AddonPriceDialog: () => null,
  AddonLifecycleDialog: () => null,
}));

import { AddonsPage } from './AddonsPage';
import { AddonPriceList } from './AddonPriceList';
import type { CatalogItemPriceRow } from './AddonPriceList';

function item(overrides: Record<string, unknown>) {
  return {
    id: 'i1',
    code: 'ewm-extra-warehouse',
    name: 'Almacén adicional',
    description: null,
    saas_product_id: 'prod-ewm',
    lifecycle_status: 'AVAILABLE',
    billing_model: 'PER_UNIT',
    ...overrides,
  };
}

function price(overrides: Partial<CatalogItemPriceRow>): CatalogItemPriceRow {
  return {
    price_id: 'p1',
    catalog_item_id: 'i1',
    catalog_item_code: 'ewm-extra-warehouse',
    catalog_item_name: 'Almacén adicional',
    saas_product_id: 'prod-ewm',
    lifecycle_status: 'AVAILABLE',
    billing_model: 'PER_UNIT',
    market_id: 'm-pe',
    market_code: 'PE',
    market_name: 'Perú',
    charge_kind: 'ADDON',
    billing_interval: 'MONTHLY',
    amount: 45,
    currency: 'USD',
    valid_from: '2026-01-01',
    valid_to: null,
    is_current: true,
    is_scheduled: false,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AddonsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  itemsHook.mockReset();
  pricesHook.mockReturnValue({ data: [], isLoading: false, error: null });
  permissions.mockReturnValue({ canManagePlatform: false, canReadFinance: false });
});

describe('AddonsPage', () => {
  it('lista add-ons con ciclo de vida, modelo de cobro y tarifa por mercado', () => {
    itemsHook.mockReturnValue({ data: [item({})], isLoading: false, error: null });
    pricesHook.mockReturnValue({
      data: [
        price({}),
        price({ price_id: 'p2', market_code: 'EC', amount: 50, valid_from: '2099-01-01', is_current: false, is_scheduled: true }),
      ],
      isLoading: false,
      error: null,
    });
    renderPage();

    const row = screen.getByRole('row', { name: /Almacén adicional/ });
    expect(within(row).getByText('Disponible')).toBeInTheDocument();
    expect(within(row).getByText('Por unidad')).toBeInTheDocument();
    expect(within(row).getByText('EWM')).toBeInTheDocument();
    expect(within(row).getByText('PE')).toBeInTheDocument();
    expect(row.textContent).toMatch(/USD\s*45\.00/);
    expect(within(row).getByText('EC')).toBeInTheDocument();
    expect(row.textContent).toContain('desde');
  });

  it('un add-on sin tarifa dice «Sin precio definido», nunca gratis ni 0', () => {
    itemsHook.mockReturnValue({ data: [item({})], isLoading: false, error: null });
    renderPage();
    const row = screen.getByRole('row', { name: /Almacén adicional/ });
    expect(within(row).getByText('Sin precio definido')).toBeInTheDocument();
    expect(within(row).queryByText(/gratis/i)).toBeNull();
    expect(row.textContent).not.toMatch(/\b0[.,]00\b/);
  });

  it('finanzas ve «Nueva tarifa»; producto ve «Cambiar ciclo de vida» (en el menú de la fila)', async () => {
    itemsHook.mockReturnValue({ data: [item({})], isLoading: false, error: null });
    permissions.mockReturnValue({ canManagePlatform: false, canReadFinance: true });
    const { unmount } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Acciones de Almacén adicional' }));
    expect(await screen.findByRole('menuitem', { name: 'Nueva tarifa' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Cambiar ciclo de vida' })).toBeNull();
    unmount();

    permissions.mockReturnValue({ canManagePlatform: true, canReadFinance: false });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Acciones de Almacén adicional' }));
    expect(screen.queryByRole('menuitem', { name: 'Nueva tarifa' })).toBeNull();
    expect(await screen.findByRole('menuitem', { name: 'Cambiar ciclo de vida' })).toBeInTheDocument();
  });

  it('sin permisos no ofrece acciones', () => {
    itemsHook.mockReturnValue({ data: [item({})], isLoading: false, error: null });
    renderPage();
    expect(screen.queryByRole('button', { name: /^Acciones de/ })).toBeNull();
  });

  it('estado vacío', () => {
    itemsHook.mockReturnValue({ data: [], isLoading: false, error: null });
    renderPage();
    expect(screen.getByText('Sin add-ons')).toBeInTheDocument();
  });

  it('un error de lectura se muestra como error, no como lista vacía', () => {
    itemsHook.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom'), refetch: vi.fn() });
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la información');
    expect(screen.queryByText('Sin add-ons')).toBeNull();
  });
});

describe('AddonPriceList', () => {
  it('sin filas, historia cerrada o importe nulo: «Sin precio definido», nunca 0', () => {
    for (const prices of [
      null,
      [],
      [price({ is_current: false, is_scheduled: false, valid_to: '2025-12-31' })],
      [price({ amount: null })],
    ]) {
      const { container, unmount } = render(<AddonPriceList prices={prices} />);
      expect(screen.getByText('Sin precio definido')).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/gratis/i);
      expect(container.textContent).not.toMatch(/\b0([.,]00)?\b/);
      unmount();
    }
  });

  it('pinta el mercado junto al importe y marca la programada con «desde»', () => {
    const { container } = render(
      <AddonPriceList
        prices={[
          price({}),
          price({ price_id: 'p2', amount: 60, valid_from: '2099-03-01', is_current: false, is_scheduled: true }),
        ]}
      />,
    );
    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toMatch(/^PE.*USD\s*45\.00.*\/ mes$/);
    expect(items[0]!.textContent).not.toContain('desde');
    expect(items[1]!.textContent).toMatch(/^PE.*USD\s*60\.00/);
    expect(items[1]!.textContent).toContain('desde');
  });
});
