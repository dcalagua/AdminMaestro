import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CommissionSummary } from '@/services/financeRead';

/*
 * Comisiones (P14): «Pendiente» = ELEGIBLE + DEVENGADA. El estado PENDING
 * («En espera») todavía no es deuda: se muestra aparte y no infla el pendiente.
 */

const commissionPage = vi.fn();
const commissionSummary = vi.fn();

vi.mock('@/services/financeRead', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/financeRead')>();
  return {
    ...actual,
    useCommissionPage: (...args: unknown[]) => commissionPage(...args),
    useCommissionSummary: (...args: unknown[]) => commissionSummary(...args),
  };
});
const settlements = vi.fn();
vi.mock('@/services/queries', () => ({
  useSettlements: () => settlements(),
  useFinanceMonthlySeries: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

import { CommissionsPage } from './CommissionsPage';

function summary(overrides: Partial<CommissionSummary> = {}): CommissionSummary {
  return {
    row_count: 5,
    by_status: {
      PENDING: { PEN: '999.00' },
      ELIGIBLE: { PEN: '60.00' },
      ACCRUED: { PEN: '40.00' },
      PAID: { PEN: '50.00', USD: '10.00' },
    },
    pending: { PEN: '100.00' },
    paid: { PEN: '50.00', USD: '10.00' },
    observed_at: '2026-09-25T10:00:00Z',
    ...overrides,
  };
}

const total = (label: string) => document.querySelector(`[data-total="${label}"]`) as HTMLElement;
const strip = () => document.querySelector('[data-kpi-strip]') as HTMLElement;

function renderAt(url = '/commissions') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CommissionsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.location.hash = '';
  commissionPage.mockReset();
  commissionSummary.mockReset();
  settlements.mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() });
  commissionPage.mockReturnValue({ data: { rows: [], total: 5 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
});

describe('CommissionsPage', () => {
  it('el pendiente excluye PENDING, que se muestra aparte como «En espera»', () => {
    commissionSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    renderAt();

    const pending = total('Comisión pendiente');
    expect(pending).toHaveTextContent(/PEN\s100\.00/);
    expect(pending).not.toHaveTextContent('999');

    expect(total('En espera')).toHaveTextContent(/PEN\s999\.00/);
    expect(total('Comisión pagada')).toHaveTextContent(/PEN\s50\.00 · USD\s10\.00/);
  });

  it('la pestaña de estado llega igual al resumen y a la tabla', () => {
    commissionSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    renderAt('/commissions?estado=WAITING&q=carla');
    expect(commissionSummary).toHaveBeenCalledWith({ search: 'carla', filter: 'WAITING' });
    expect(commissionPage).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'carla', filter: 'WAITING' }));
  });

  it('si el resumen falla, totales y franja muestran error y no un cero', () => {
    commissionSummary.mockReturnValue({ data: undefined, error: new Error('fallo de lectura'), isFetching: false, refetch: vi.fn() });
    renderAt();
    const box = document.querySelector('[data-filter-totals]') as HTMLElement;
    expect(within(box).getByRole('alert')).toHaveTextContent('No se pudieron leer los totales del resultado');
    expect(box).not.toHaveTextContent(/PEN|0\.00/);
    expect(within(strip()).getAllByText('No disponible').length).toBe(2);
    expect(strip()).not.toHaveTextContent(/PEN\s|0\.00/);
  });
});

describe('CommissionsPage · franja de la página', () => {
  it('por liquidar, en liquidación y pagado salen por moneda, sin sumar monedas', () => {
    commissionSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    settlements.mockReturnValue({
      data: [
        { id: 's1', status: 'OPEN', total_amount: 300, currency: 'PEN' },
        { id: 's2', status: 'APPROVED', total_amount: 200, currency: 'PEN' },
        { id: 's3', status: 'PAID', total_amount: 50, currency: 'PEN' },
        { id: 's4', status: 'APPROVED', total_amount: 40, currency: 'USD' },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt();
    const kpis = within(strip());
    // Por liquidar: una sola moneda → prefijo + cifra.
    expect(kpis.getByTitle('PEN 100.00')).toHaveTextContent('100');
    // En liquidación: OPEN + APPROVED, una línea por moneda (PEN 500 y USD 40, nunca 540).
    expect(kpis.getByTitle('PEN 500.00')).toBeInTheDocument();
    expect(kpis.getByTitle('USD 40.00')).toBeInTheDocument();
    expect(strip()).not.toHaveTextContent('540');
    expect(kpis.getByText('3 liquidaciones abiertas o aprobadas')).toBeInTheDocument();
    expect(kpis.getByText('Histórico · 1 liquidación pagada')).toBeInTheDocument();
  });
});
