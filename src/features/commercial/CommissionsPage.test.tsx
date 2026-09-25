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
vi.mock('@/services/queries', () => ({
  useSettlements: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
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

const kpi = (id: string) => document.querySelector(`[data-kpi="${id}"]`) as HTMLElement;

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
  commissionPage.mockReturnValue({ data: { rows: [], total: 5 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
});

describe('CommissionsPage', () => {
  it('el pendiente excluye PENDING, que se muestra aparte como «En espera»', () => {
    commissionSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    renderAt();

    const pending = kpi('commission-pending');
    expect(within(pending).getByText(/PEN\s100\.00/)).toBeInTheDocument();
    expect(pending).not.toHaveTextContent('999');

    const waiting = kpi('commission-waiting');
    expect(within(waiting).getByText(/PEN\s999\.00/)).toBeInTheDocument();

    const paid = kpi('commission-paid');
    expect(within(paid).getByText(/PEN\s50\.00/)).toBeInTheDocument();
    expect(within(paid).getByText(/USD\s10\.00/)).toBeInTheDocument();
  });

  it('la pestaña de estado llega igual al resumen y a la tabla', () => {
    commissionSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    renderAt('/commissions?estado=WAITING&q=carla');
    expect(commissionSummary).toHaveBeenLastCalledWith({ search: 'carla', filter: 'WAITING' });
    expect(commissionPage).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'carla', filter: 'WAITING' }));
  });

  it('si el resumen falla, las tarjetas muestran error y no un cero', () => {
    commissionSummary.mockReturnValue({ data: undefined, error: new Error('fallo de lectura'), isFetching: false, refetch: vi.fn() });
    renderAt();
    expect(within(kpi('commission-pending')).getByRole('alert')).toHaveTextContent('No se pudo leer este dato');
    expect(kpi('commission-pending')).not.toHaveTextContent(/PEN|0\.00/);
  });
});
