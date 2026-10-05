import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CostSummary } from '@/services/financeRead';
import type { FinanceMonthlyPoint } from '@/services/queries';
import { currentMonth, lastMonths } from '@/features/executive/reportContext';

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
const monthlySeries = vi.fn();
vi.mock('@/services/queries', () => ({
  useFinanceMonthlySeries: (...args: unknown[]) => monthlySeries(...args),
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

const total = (label: string) => document.querySelector(`[data-total="${label}"]`) as HTMLElement;
const strip = () => document.querySelector('[data-kpi-strip]') as HTMLElement;

function monthPoint(month: string, overrides: Partial<FinanceMonthlyPoint> = {}): FinanceMonthlyPoint {
  return {
    month: `${month}-01`,
    asOf: `${month}-28`,
    isPartial: month === currentMonth(),
    reportingCurrency: 'USD',
    collected: 50_000,
    cost: 10_000,
    commission: 2_000,
    commissionPaid: 2_000,
    commissionPending: 0,
    margin: 38_000,
    collectedNative: {},
    costNative: {},
    commissionNative: {},
    complete: true,
    missingCurrencies: [],
    fxIsDemo: true,
    ...overrides,
  };
}

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
  monthlySeries.mockReset();
  monthlySeries.mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() });
  costPage.mockReturnValue({ data: { rows: [], total: 4 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
});

describe('CostsPage', () => {
  it('muestra el costo de plataforma separado del asignado y explica que no se reparte', () => {
    costSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    renderAt();

    const platform = total('Costo de plataforma');
    expect(platform).toHaveTextContent(/USD\s300\.00/);
    expect(within(platform).getByTitle(/No se reparte/)).toBeInTheDocument();
    expect(total('Asignado')).toHaveTextContent(/USD\s600\.00/);
    expect(total('Sin asignar')).toHaveTextContent(/USD\s100\.00/);
    // Registrado por moneda, sin mezclar PEN y USD.
    expect(total('Costo registrado')).toHaveTextContent(/PEN\s200\.00 · USD\s1,000\.00/);
    expect(total('Costo registrado')).not.toHaveTextContent('1,200');

    expect(screen.getByText(/margen gerencial = cobrado − costo asignado − comisión/i)).toBeInTheDocument();
    expect(screen.getByText(/no utilidad neta, EBITDA/i)).toBeInTheDocument();
    expect(screen.getByText(/costo de plataforma no se reparte/i)).toBeInTheDocument();
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
    const box = document.querySelector('[data-filter-totals]') as HTMLElement;
    expect(within(box).getByRole('alert')).toHaveTextContent('No se pudieron leer los totales del resultado');
    expect(box).not.toHaveTextContent(/USD|0\.00/);
  });
});

describe('CostsPage · franja del margen (moneda de reporte)', () => {
  it('muestra el último mes cerrado: costo como % de lo cobrado y margen sobre lo cobrado', () => {
    costSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    const months = lastMonths(currentMonth(), 3);
    monthlySeries.mockReturnValue({
      data: [monthPoint(months[0]!), monthPoint(months[1]!), monthPoint(months[2]!, { collected: 1_000, margin: 900 })],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();
    const kpis = within(strip());
    expect(kpis.getByText('50.0 K')).toBeInTheDocument();
    expect(kpis.getByText('38.0 K')).toBeInTheDocument();
    expect(kpis.getByText('20.0% de lo cobrado')).toBeInTheDocument();
    expect(kpis.getByText('76.0% sobre lo cobrado')).toBeInTheDocument();
    // El mes en curso (parcial) no es la cifra de la franja.
    expect(strip()).not.toHaveTextContent('900');
  });

  it('si falta una tasa el margen no se inventa', () => {
    costSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    const months = lastMonths(currentMonth(), 2);
    monthlySeries.mockReturnValue({
      data: [monthPoint(months[0]!, { collected: null, margin: null, complete: false, missingCurrencies: ['BOB'] }), monthPoint(months[1]!)],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();
    expect(within(strip()).getAllByText('Falta tasa BOB: no se consolida').length).toBe(4);
  });
});
