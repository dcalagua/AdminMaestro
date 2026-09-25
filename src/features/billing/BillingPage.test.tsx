import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { InvoiceSummary } from '@/services/financeRead';

/*
 * Facturación (P02): las tarjetas salen del RESUMEN agregado en servidor, con
 * los mismos filtros que la tabla, una línea por moneda y nunca un «0» cuando
 * la lectura falla.
 */

const invoicePage = vi.fn();
const invoiceSummary = vi.fn();

vi.mock('@/services/financeRead', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/financeRead')>();
  return {
    ...actual,
    useInvoicePage: (...args: unknown[]) => invoicePage(...args),
    useInvoiceSummary: (...args: unknown[]) => invoiceSummary(...args),
    useCollectedPaymentPage: () => ({ data: { rows: [], total: 0 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }),
    useCollectionsByMonth: () => ({ data: [], error: null, refetch: vi.fn() }),
  };
});

import { BillingPage } from './BillingPage';

function summary(overrides: Partial<InvoiceSummary> = {}): InvoiceSummary {
  return {
    row_count: 2,
    status_counts: { ISSUED: 1, PAID: 1 },
    invoiced: { PEN: '1000.00', USD: '250.00' },
    collected: { PEN: '400.00', USD: '250.00' },
    receivable: { PEN: '600.00' },
    overdue: { PEN: '-15.00' },
    observed_at: '2026-09-25T10:00:00Z',
    ...overrides,
  };
}

function renderAt(url = '/billing') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <BillingPage />
    </MemoryRouter>,
  );
}

const kpi = (id: string) => document.querySelector(`[data-kpi="${id}"]`) as HTMLElement;

beforeEach(() => {
  invoicePage.mockReset();
  invoiceSummary.mockReset();
  window.location.hash = '';
  invoicePage.mockReturnValue({
    data: { rows: [], total: 2 },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  });
});

describe('BillingPage · resumen del servidor', () => {
  it('las tarjetas pintan el resumen por moneda, sin sumar monedas', () => {
    invoiceSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    renderAt();

    const invoiced = within(kpi('billing-invoiced'));
    expect(invoiced.getByText(/PEN\s1,000\.00/)).toBeInTheDocument();
    expect(invoiced.getByText(/USD\s250\.00/)).toBeInTheDocument();
    // 1 000 + 250 no existe como cifra: cada moneda va en su línea.
    expect(kpi('billing-invoiced')).not.toHaveTextContent('1,250');

    expect(within(kpi('billing-collected')).getByText(/PEN\s400\.00/)).toBeInTheDocument();
    expect(within(kpi('billing-receivable')).getByText(/PEN\s600\.00/)).toBeInTheDocument();
    // Un saldo negativo (sobrepago) se conserva, no se recorta a cero.
    expect(within(kpi('billing-overdue')).getByText(/-PEN\s15\.00|PEN\s-15\.00/)).toBeInTheDocument();
  });

  it('resumen y tabla sobre el mismo universo: lo declara; si difieren, avisa', () => {
    invoiceSummary.mockReturnValue({ data: summary({ row_count: 2 }), error: null, isFetching: false, refetch: vi.fn() });
    const { unmount } = renderAt();
    expect(screen.getByTestId('consistency-note')).toHaveTextContent('Resumen y tabla cubren las mismas 2 facturas');
    unmount();

    invoiceSummary.mockReturnValue({ data: summary({ row_count: 3 }), error: null, isFetching: false, refetch: vi.fn() });
    renderAt();
    expect(screen.getByTestId('consistency-note')).toHaveTextContent('El resumen cubre 3 facturas y la tabla 2');
  });

  it('si el resumen falla, cada tarjeta muestra error con reintento, nunca un 0', () => {
    const refetch = vi.fn();
    invoiceSummary.mockReturnValue({ data: undefined, error: new Error('timeout del servidor'), isFetching: false, refetch });
    renderAt();

    const card = kpi('billing-receivable');
    expect(within(card).getByRole('alert')).toHaveTextContent('No se pudo leer este dato');
    expect(card).not.toHaveTextContent(/PEN|USD|\b0\.00\b/);
    fireEvent.click(within(card).getByRole('button', { name: 'Reintentar lectura' }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('BillingPage · contexto heredado por URL', () => {
  it('`antiguedad` llega al resumen y a la tabla, y se ve como chip removible', () => {
    invoiceSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    renderAt('/billing?estado=OPEN&antiguedad=D31_60&q=acme');

    expect(invoiceSummary).toHaveBeenLastCalledWith({ search: 'acme', filter: 'OPEN', aging: 'D31_60' });
    expect(invoicePage).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'acme', filter: 'OPEN', aging: 'D31_60', page: 0 }),
    );

    const remove = screen.getByRole('button', { name: /Quitar filtro «Antigüedad: 31–60 días»/ });
    fireEvent.click(remove);
    expect(invoiceSummary).toHaveBeenLastCalledWith({ search: 'acme', filter: 'OPEN', aging: '' });
    expect(invoicePage).toHaveBeenLastCalledWith(expect.objectContaining({ aging: '' }));
  });

  it('un valor de antigüedad desconocido se ignora', () => {
    invoiceSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    renderAt('/billing?antiguedad=D999');
    expect(invoiceSummary).toHaveBeenLastCalledWith({ search: '', filter: 'ALL', aging: '' });
    expect(screen.queryByRole('button', { name: /Quitar filtro/ })).not.toBeInTheDocument();
  });
});
