import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { InvoiceSummary } from '@/services/financeRead';
import type { ExecutiveBillingPoint } from '@/services/queries';
import { currentMonth, lastMonths } from '@/features/executive/reportContext';

/*
 * Facturación (P02, V4 fase 10): la franja de KPIs sale de la serie mensual en
 * moneda de reporte (S06); los totales del resultado salen del RESUMEN agregado
 * en servidor, con los mismos filtros que la tabla, por moneda y nunca un «0»
 * cuando la lectura falla.
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

const billingSeries = vi.fn();

vi.mock('@/services/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/queries')>();
  return {
    ...actual,
    useExecutiveBillingSeries: (...args: unknown[]) => billingSeries(...args),
    useWeeklyCollections: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn(), isPlaceholderData: false }),
  };
});

import { BillingPage } from './BillingPage';

function point(month: string, overrides: Partial<ExecutiveBillingPoint> = {}): ExecutiveBillingPoint {
  return {
    month: `${month}-01`,
    asOf: `${month}-28`,
    isPartial: month === currentMonth(),
    reportingCurrency: 'USD',
    invoiced: 40_000,
    collected: 36_000,
    collectionRate: 0.9,
    overdue: 20_000,
    invoiceCount: 50,
    paymentCount: 45,
    overdueInvoiceCount: 12,
    invoicedNative: {},
    collectedNative: {},
    complete: true,
    missingCurrencies: [],
    fxIsDemo: true,
    ...overrides,
  };
}

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

const totals = () => document.querySelector('[data-filter-totals]') as HTMLElement;
const strip = () => document.querySelector('[data-kpi-strip]') as HTMLElement;

beforeEach(() => {
  invoicePage.mockReset();
  invoiceSummary.mockReset();
  billingSeries.mockReset();
  billingSeries.mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() });
  window.location.hash = '';
  invoicePage.mockReturnValue({
    data: { rows: [], total: 2 },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  });
});

describe('BillingPage · franja de KPIs (moneda de reporte)', () => {
  it('muestra el último mes cerrado con su variación y la vencida a hoy', () => {
    const months = lastMonths(currentMonth(), 3);
    billingSeries.mockReturnValue({
      data: [
        point(months[0]!, { invoiced: 32_000 }),
        point(months[1]!, { invoiced: 40_000, collected: 36_000, collectionRate: 0.9, overdue: 18_000 }),
        point(months[2]!, { invoiced: 5_000, overdue: 21_600, overdueInvoiceCount: 14 }),
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    invoiceSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    renderAt();

    const kpis = within(strip());
    expect(kpis.getByText('40.0 K')).toBeInTheDocument();
    // 40 000 vs 32 000 del mes anterior = +25 %.
    expect(kpis.getByText('+25.0%')).toBeInTheDocument();
    expect(kpis.getByText('90.0%')).toBeInTheDocument();
    // Vencida: el punto de HOY (mes en curso), no el del cierre.
    expect(kpis.getByText('21.6 K')).toBeInTheDocument();
    expect(kpis.getByText('14 facturas vencidas')).toBeInTheDocument();
    // El facturado parcial del mes en curso no es la cifra protagonista.
    expect(strip()).not.toHaveTextContent('5.0 K');
  });

  it('sin tasa para una moneda, la cifra queda en «—» y lo explica', () => {
    const months = lastMonths(currentMonth(), 2);
    billingSeries.mockReturnValue({
      data: [
        point(months[0]!, { invoiced: null, collected: null, collectionRate: null, complete: false, missingCurrencies: ['BOB'] }),
        point(months[1]!),
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    invoiceSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    renderAt();
    expect(within(strip()).getAllByText('Falta tasa BOB: no se consolida').length).toBeGreaterThan(0);
    expect(strip()).not.toHaveTextContent(/\b0\.0 K\b/);
  });
});

describe('BillingPage · totales del resultado (resumen del servidor)', () => {
  it('pintan el resumen por moneda, sin sumar monedas', () => {
    invoiceSummary.mockReturnValue({ data: summary(), error: null, isFetching: false, refetch: vi.fn() });
    renderAt();

    const box = totals();
    expect(box).toHaveTextContent(/Facturado \(emitido\)USD 250\.00 · PEN 1,000\.00|Facturado \(emitido\)PEN 1,000\.00 · USD 250\.00/);
    // 1 000 + 250 no existe como cifra: cada moneda va aparte.
    expect(box).not.toHaveTextContent('1,250');
    expect(box).toHaveTextContent(/Cobrado \(confirmado\)PEN 400\.00 · USD 250\.00/);
    expect(box).toHaveTextContent(/Saldo por cobrarPEN 600\.00/);
    // Un saldo negativo (sobrepago) se conserva, no se recorta a cero.
    expect(box).toHaveTextContent(/Cartera vencida(-PEN\s15\.00|PEN\s-15\.00)/);
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

  it('si el resumen falla, los totales muestran error con reintento, nunca un 0', () => {
    const refetch = vi.fn();
    invoiceSummary.mockReturnValue({ data: undefined, error: new Error('timeout del servidor'), isFetching: false, refetch });
    renderAt();

    const box = totals();
    expect(within(box).getByRole('alert')).toHaveTextContent('No se pudieron leer los totales del resultado');
    expect(box).not.toHaveTextContent(/PEN|USD|\b0\.00\b/);
    fireEvent.click(within(box).getByRole('button', { name: 'Reintentar' }));
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
