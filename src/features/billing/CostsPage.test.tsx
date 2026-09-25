import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CostSummary } from '@/services/financeRead';

/*
 * Costos (P03): el costo de plataforma se informa APARTE (no se reparte en el
 * margen), y la tabla y el resumen reciben el mismo alcance.
 */

const costPage = vi.fn();
const costSummary = vi.fn();

vi.mock('@/services/financeRead', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/financeRead')>();
  return {
    ...actual,
    useCostPage: (...args: unknown[]) => costPage(...args),
    useCostSummary: (...args: unknown[]) => costSummary(...args),
  };
});
vi.mock('@/services/queries', () => ({
  useProductMargin: () => ({ data: [], isLoading: false, error: null }),
  usePartnerMargin: () => ({ data: [], isLoading: false, error: null }),
  useTenantMargin: () => ({ data: [], isLoading: false, error: null }),
}));

import { CostsPage } from './CostsPage';

function summary(overrides: Partial<CostSummary> = {}): CostSummary {
  return {
    row_count: 4,
    registered: { USD: '1000.00', PEN: '200.00' },
    allocated: { USD: '600.00', PEN: '200.00' },
    platform: { USD: '300.00' },
    unallocated: { USD: '100.00' },
    by_category: [
      { category: 'COMPUTE', currency: 'USD', amount: '700.00' },
      { category: 'DATABASE', currency: 'PEN', amount: '200.00' },
    ],
    observed_at: '2026-09-25T10:00:00Z',
    ...overrides,
  };
}

const kpi = (id: string) => document.querySelector(`[data-kpi="${id}"]`) as HTMLElement;

function renderAt(url = '/costs') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CostsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.location.hash = '';
  costPage.mockReset();
  costSummary.mockReset();
  costPage.mockReturnValue({ data: { rows: [], total: 4 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
});

describe('CostsPage', () => {
  it('muestra el costo de plataforma separado del asignado y explica que no se reparte', () => {
    costSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    renderAt();

    const platform = kpi('cost-platform');
    expect(within(platform).getByText(/USD\s300\.00/)).toBeInTheDocument();
    expect(platform).toHaveTextContent('No se reparte');
    expect(within(kpi('cost-allocated')).getByText(/USD\s600\.00/)).toBeInTheDocument();
    expect(within(kpi('cost-unallocated')).getByText(/USD\s100\.00/)).toBeInTheDocument();
    // Registrado por moneda, sin mezclar PEN y USD.
    expect(within(kpi('cost-registered')).getByText(/PEN\s200\.00/)).toBeInTheDocument();
    expect(within(kpi('cost-registered')).getByText(/USD\s1,000\.00/)).toBeInTheDocument();

    expect(screen.getByText(/margen gerencial = cobrado − costo asignado − comisión/i)).toBeInTheDocument();
    expect(screen.getByText(/no es\s+utilidad neta, EBITDA/i)).toBeInTheDocument();
  });

  it('la pestaña de alcance llega igual al resumen y a la tabla', () => {
    costSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    renderAt('/costs?estado=PLATFORM');
    expect(costSummary).toHaveBeenLastCalledWith({ search: '', filter: 'PLATFORM' });
    expect(costPage).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'PLATFORM' }));
  });

  it('un fallo del resumen se ve como error, no como costo cero', () => {
    costSummary.mockReturnValue({ data: undefined, error: new Error('sin conexión'), isFetching: false, refetch: vi.fn() });
    renderAt();
    expect(within(kpi('cost-platform')).getByRole('alert')).toHaveTextContent('No se pudo leer este dato');
    expect(kpi('cost-platform')).not.toHaveTextContent(/USD|0\.00/);
  });
});
