import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SubscriptionBillingStatus } from '@/lib/billing';

/*
 * La cadence NO se prueba aquí: vive en PostgreSQL (pgTAP 18/19). Este test
 * comprueba que la pantalla pinta lo que responde la base, llama a la RPC con
 * el periodo elegido y traduce cada desenlace.
 */

const statusHook = vi.fn();
const mutateAsync = vi.fn();
const mutationState = { isPending: false };
const toast = { success: vi.fn(), error: vi.fn(), push: vi.fn() };

vi.mock('@/services/queries', () => ({
  useSubscriptionBillingStatus: (...args: unknown[]) => statusHook(...args),
}));
vi.mock('@/services/mutations', () => ({
  useIssueSubscriptionInvoice: () => ({ mutateAsync, isPending: mutationState.isPending }),
}));
vi.mock('@/components/ui/toast-context', () => ({ useToast: () => toast }));

import { PeriodInvoiceAction } from './PeriodInvoiceAction';

function status(overrides: Partial<SubscriptionBillingStatus> = {}): SubscriptionBillingStatus {
  return {
    subscription_id: 'sub-1',
    currency: 'PEN',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    subscription_billable: true,
    has_due_items: true,
    due_item_count: 2,
    estimated_total: 36000,
    existing_invoice: null,
    can_issue: true,
    next_billing_period: '2026-03-01',
    ...overrides,
  };
}

function mockStatus(value: { data?: SubscriptionBillingStatus; isLoading?: boolean; error?: unknown }) {
  statusHook.mockReturnValue({ data: undefined, isLoading: false, error: null, ...value });
}

const button = () => screen.getByRole('button', { name: /Emitir factura del período|Emitiendo/ });

beforeEach(() => {
  statusHook.mockReset();
  mutateAsync.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  mutationState.isPending = false;
});

describe('PeriodInvoiceAction · copy', () => {
  it('habla de período, no de mes, y muestra la moneda del contrato', () => {
    mockStatus({ data: status() });
    render(<PeriodInvoiceAction subscriptionId="sub-1" currency="PEN" />);
    expect(button()).toHaveTextContent('Emitir factura del período (PEN)');
    expect(screen.queryByText(/factura del mes/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Período de facturación')).toHaveAttribute('type', 'month');
  });
});

describe('PeriodInvoiceAction · estado servido por la base', () => {
  it('cargando: informa y no permite emitir todavía', () => {
    mockStatus({ isLoading: true });
    render(<PeriodInvoiceAction subscriptionId="sub-1" currency="USD" />);
    expect(screen.getByRole('status')).toHaveTextContent('Calculando cargos del período…');
    expect(button()).toBeDisabled();
  });

  it('con cargos: pinta cantidad, total estimado y próxima facturación DD/MM/YYYY tal como vienen', () => {
    mockStatus({ data: status({ currency: 'USD', due_item_count: 2, estimated_total: 36000, next_billing_period: '2026-03-01' }) });
    render(<PeriodInvoiceAction subscriptionId="sub-1" currency="USD" />);
    const box = screen.getByTestId('billing-status');
    expect(box).toHaveTextContent('2 cargos facturables en 03/2026');
    expect(box).toHaveTextContent(/USD\s36,000\.00/);
    expect(box).toHaveTextContent('Próxima facturación: 01/03/2026');
    expect(button()).toBeEnabled();
  });

  it('sin cargos (no-due): lo dice, no inventa fecha propia y deshabilita la emisión', () => {
    mockStatus({ data: status({ has_due_items: false, due_item_count: 0, estimated_total: 0, can_issue: false, next_billing_period: '2027-03-01' }) });
    render(<PeriodInvoiceAction subscriptionId="sub-1" currency="USD" />);
    expect(screen.getByText('No existen cargos facturables en este período.')).toBeInTheDocument();
    expect(screen.getByText('Próxima facturación: 01/03/2027')).toBeInTheDocument();
    expect(button()).toBeDisabled();
  });

  it('sin próxima facturación: no inventa una fecha', () => {
    mockStatus({ data: status({ has_due_items: false, due_item_count: 0, can_issue: false, next_billing_period: null }) });
    render(<PeriodInvoiceAction subscriptionId="sub-1" currency="USD" />);
    expect(screen.queryByText(/Próxima facturación:/)).not.toBeInTheDocument();
    expect(screen.getByText('Sin cargos pendientes de facturar en los próximos 12 meses.')).toBeInTheDocument();
  });

  it('periodo ya facturado: muestra la factura vigente y no ofrece duplicarla', () => {
    mockStatus({ data: status({ can_issue: false, existing_invoice: { invoice_id: 'i1', number: 'INV-202603-SUB-X', status: 'ISSUED', total: 3150, currency: 'PEN' } }) });
    render(<PeriodInvoiceAction subscriptionId="sub-1" currency="PEN" />);
    expect(screen.getByTestId('billing-status')).toHaveTextContent('INV-202603-SUB-X');
    expect(button()).toBeDisabled();
  });

  it('error al consultar el estado: lo muestra y deja decidir a la RPC de emisión', () => {
    mockStatus({ error: new Error('NO_AUTORIZADO: sin acceso') });
    render(<PeriodInvoiceAction subscriptionId="sub-1" currency="BOB" />);
    expect(screen.getByText(/No se pudo consultar el estado de facturación: sin acceso/)).toBeInTheDocument();
    expect(button()).toBeEnabled();
  });

  it('consulta el estado del periodo elegido', () => {
    mockStatus({ data: status() });
    render(<PeriodInvoiceAction subscriptionId="sub-1" currency="PEN" />);
    fireEvent.change(screen.getByLabelText('Período de facturación'), { target: { value: '2027-03' } });
    expect(statusHook).toHaveBeenLastCalledWith('sub-1', '2027-03-01');
  });
});

describe('PeriodInvoiceAction · emisión', () => {
  it('éxito: llama a la RPC con suscripción y periodo, y confirma con número y total', async () => {
    mockStatus({ data: status() });
    mutateAsync.mockResolvedValue({ created: true, number: 'INV-202603-SUB-X', total: 3150, currency: 'PEN' });
    render(<PeriodInvoiceAction subscriptionId="sub-1" currency="PEN" />);
    fireEvent.change(screen.getByLabelText('Período de facturación'), { target: { value: '2026-03' } });
    fireEvent.click(button());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({ p_subscription_id: 'sub-1', p_period_start: '2026-03-01' });
    expect(toast.success.mock.calls[0][0]).toBe('Factura emitida');
    expect(toast.success.mock.calls[0][1]).toMatch(/INV-202603-SUB-X · PEN\s3,150\.00/);
  });

  it('reintento del mismo periodo: informa la factura existente, no una nueva', async () => {
    mockStatus({ data: status() });
    mutateAsync.mockResolvedValue({ created: false, number: 'INV-202603-SUB-X', total: 3150, currency: 'PEN' });
    render(<PeriodInvoiceAction subscriptionId="sub-1" currency="PEN" />);
    fireEvent.click(button());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success.mock.calls[0][0]).toBe('La factura del período ya existía');
  });

  it('rechazo sin cargos debidos de la RPC: mensaje de negocio claro', async () => {
    mockStatus({ error: new Error('fallo de red') });
    mutateAsync.mockRejectedValue({ message: 'SIN_LINEAS_FACTURABLES: la suscripción X no tiene cargos facturables en el periodo 04/2026', code: '23514' });
    render(<PeriodInvoiceAction subscriptionId="sub-1" currency="USD" />);
    fireEvent.click(button());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('No se pudo emitir la factura', 'No existen cargos facturables en este período.');
  });

  it('error de autorización de la RPC: se muestra sin el prefijo técnico', async () => {
    mockStatus({ data: status() });
    mutateAsync.mockRejectedValue({ message: 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin emiten facturas', code: '42501' });
    render(<PeriodInvoiceAction subscriptionId="sub-1" currency="USD" />);
    fireEvent.click(button());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0][1]).toBe('solo EBIM_FINANCE o el super admin emiten facturas');
  });

  it('emitiendo: el botón lo indica y no admite un segundo clic', () => {
    mockStatus({ data: status() });
    mutationState.isPending = true;
    render(<PeriodInvoiceAction subscriptionId="sub-1" currency="PEN" />);
    expect(button()).toHaveTextContent('Emitiendo…');
    expect(button()).toBeDisabled();
  });
});
