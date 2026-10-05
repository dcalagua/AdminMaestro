import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
 * P11 · El número de productos y sus estados salen de los datos (no un «8/8»
 * fijo) y el estado técnico (integración) va separado del comercial.
 */

const productsHook = vi.fn();
const tenantsHook = vi.fn();
const integrationsHook = vi.fn();

vi.mock('@/services/queries', () => ({
  useProducts: () => productsHook(),
  useTenantOverview: () => tenantsHook(),
  useProductIntegrations: () => integrationsHook(),
}));
vi.mock('@/services/mutations', () => ({
  useArchiveProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ canManagePlatform: false }),
}));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));
vi.mock('./ProductFormDialog', () => ({ ProductFormDialog: () => null }));

import { ProductsPage } from './ProductsPage';

function product(id: string, name: string, status: string) {
  return {
    id,
    code: id.toUpperCase(),
    name,
    short_name: name,
    lockup_name: `${name} by EBIM`,
    description: null,
    accent_color: null,
    billing_unit: 'TENANT',
    is_billable: true,
    status,
    sort_order: 1,
  };
}

const PRODUCTS = [
  product('esup', 'eSupplier', 'ACTIVE'),
  product('ewm', 'EWM', 'ACTIVE'),
  product('tms', 'TMS', 'INACTIVE'),
];

function renderPage() {
  return render(
    <MemoryRouter>
      <ProductsPage />
    </MemoryRouter>,
  );
}

function statValue(label: string): string {
  // El KpiTile anida la etiqueta en su fila (icono, info, estado): se lee el tile entero.
  const card = screen.getByText(label).closest('.ebim-card')!;
  return card.textContent ?? '';
}

beforeEach(() => {
  productsHook.mockReturnValue({ data: PRODUCTS, isLoading: false, error: null });
  tenantsHook.mockReturnValue({
    data: [{ saas_product_id: 'esup' }, { saas_product_id: 'esup' }],
    isLoading: false,
    error: null,
  });
  integrationsHook.mockReturnValue({
    data: [{ id: 'i1', code: 'ESUP-M2M', saas_product_id: 'esup', status: 'READY', enabled: true }],
    isLoading: false,
    error: null,
  });
});

describe('ProductsPage', () => {
  it('deriva los conteos de los datos y nunca muestra un 8/8 fijo', () => {
    renderPage();
    expect(document.body.textContent).not.toContain('8/8');
    expect(statValue('Productos en catálogo')).toContain('3');
    expect(statValue('Activos en catálogo')).toContain('2');
    expect(statValue('Integración lista y habilitada')).toContain('1');
    // Tabs de estado con conteos reales.
    expect(screen.getByRole('tab', { name: /Activos\s*2/ })).toBeInTheDocument();
  });

  it('separa estado comercial de integración técnica y no infiere certificación', () => {
    renderPage();
    const ewm = screen.getByRole('article', { name: /EWM by EBIM/ });
    expect(within(ewm).getByText('Activo')).toBeInTheDocument();
    expect(within(ewm).getByText('Sin integración registrada')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/certificad/i);
  });

  it('tarjeta por producto: tenants, MRR por moneda y unidad de cobro en español (A13)', () => {
    tenantsHook.mockReturnValue({
      data: [
        { saas_product_id: 'esup', mrr: 100, currency: 'USD' },
        { saas_product_id: 'esup', mrr: 200, currency: 'PEN' },
      ],
      isLoading: false,
      error: null,
    });
    renderPage();
    const card = screen.getByRole('article', { name: /eSupplier by EBIM/ });
    expect(within(card).getByText('Por tenant')).toBeInTheDocument();
    expect(within(card).queryByText('TENANT')).toBeNull();
    expect(within(card).getByText('2')).toBeInTheDocument();
    // Una línea por moneda: nunca un total que mezcle PEN y USD.
    expect(card.textContent).toMatch(/PEN\s?200\.00/);
    expect(card.textContent).toMatch(/USD\s?100\.00/);
    expect(within(screen.getByRole('article', { name: /EWM by EBIM/ })).getByText('Sin recurrente')).toBeInTheDocument();
  });

  it('si la lectura de tenants falla no pinta 0', () => {
    tenantsHook.mockReturnValue({ data: undefined, isLoading: false, error: new Error('timeout') });
    renderPage();
    const card = screen.getByRole('article', { name: /TMS by EBIM/ });
    expect(within(card).getAllByText('No se pudo leer').length).toBeGreaterThan(0);
    expect(within(card).queryByText('0')).toBeNull();
  });

  it('un error de productos es un error, no una lista vacía', () => {
    productsHook.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom'), refetch: vi.fn() });
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la información');
    expect(screen.queryByText('Sin productos')).toBeNull();
    expect(statValue('Productos en catálogo')).toContain('No se pudo leer');
  });
});
