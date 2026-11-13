import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { dueText } from './collectionsModel';

/*
 * V5 · F4 · Cobranza → «Por cobrar»: facturas vencidas o por vencer con las
 * acciones de siempre por fila (enlace de pago, pago manual, cobro con tarjeta
 * guardada si existe, suspender por mora con la vista previa del impacto).
 */
const q = (data: unknown) => ({ data, error: null, isLoading: false, isFetching: false, refetch: vi.fn() });

const m = vi.hoisted(() => ({
  pageParams: [] as unknown[],
  autocharge: vi.fn(),
  confirmPayment: vi.fn(),
  finance: true,
  platform: true,
}));

const ROWS = [
  {
    invoice_id: 'inv-1', number: 'INV-0001', customer_organization_id: 'o-alpha', organization_name: 'Alpha', subscription_id: 's-1',
    due_date: '2026-10-01', days_overdue: 42, balance: 500, total: 800, currency: 'PEN', status: 'PARTIALLY_PAID',
  },
  {
    invoice_id: 'inv-2', number: 'INV-0002', customer_organization_id: 'o-beta', organization_name: 'Beta', subscription_id: 's-2',
    due_date: '2099-01-01', days_overdue: 0, balance: 100, total: 100, currency: 'USD', status: 'ISSUED',
  },
];

vi.mock('@/services/financeRead', () => ({
  useInvoicePage: (p: unknown) => {
    m.pageParams.push(p);
    return q({ rows: ROWS, total: ROWS.length });
  },
  useInvoiceSummary: () => q({ row_count: 2, receivable: { PEN: 500, USD: 100 }, overdue: { PEN: 500 }, status_counts: {} }),
  useReceivablesAging: () =>
    q([
      { aging_bucket: 'VIGENTE', currency: 'USD', invoice_count: 1, balance: 100 },
      { aging_bucket: 'D31_60', currency: 'PEN', invoice_count: 1, balance: 500 },
      { aging_bucket: 'D31_60', currency: 'USD', invoice_count: 2, balance: 1200 },
    ]),
}));
vi.mock('@/services/queries', () => ({
  useActiveCardsByOrganization: () => q(new Map([['o-alpha', { brand: 'VISA', last4: '4242' }]])),
  useOrganization: () => q({ billing_email: 'pagos@alpha.pe' }),
  useAdminUsers: () => q([]),
}));
vi.mock('@/features/organizations/org360Queries', () => ({
  useOrgTenants: () =>
    q([
      { tenant_id: 't1', name: 'Alpha EWM', status: 'ACTIVE', customer_organization_id: 'o-alpha', product_short_name: 'EWM' },
      { tenant_id: 't2', name: 'Alpha TMS', status: 'ACTIVE', customer_organization_id: 'o-alpha', product_short_name: 'TMS' },
      { tenant_id: 't3', name: 'Cliente del canal', status: 'ACTIVE', customer_organization_id: 'otra', product_short_name: 'TMS' },
    ]),
}));
vi.mock('@/services/mutations', () => ({
  useAutocharge: () => ({ mutateAsync: m.autocharge, isPending: false }),
  useConfirmManualPayment: () => ({ mutateAsync: m.confirmPayment, isPending: false, error: null, reset: vi.fn() }),
  useCreatePaymentLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRequestTenantSuspension: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRequestTenantResume: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ canReadFinance: m.finance, canManagePlatform: m.platform }),
}));
vi.mock('@/components/ui/toast-context', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }) }));

import { CollectionsInboxPage } from './CollectionsInboxPage';

function renderPage(url = '/cobranza?tab=por-cobrar') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CollectionsInboxPage />
    </MemoryRouter>,
  );
}

const row = (n: string) => screen.getByRole('row', { name: new RegExp(n) });
async function openMenu(n: string) {
  await userEvent.click(within(row(n)).getByRole('button', { name: `Acciones de ${n}` }));
}

beforeEach(() => {
  m.pageParams = [];
  m.autocharge.mockReset().mockResolvedValue({ processed: 1, succeeded: 1, failed: 0, skipped: 0, results: [{ status: 'SUCCEEDED' }] });
  m.confirmPayment.mockReset().mockResolvedValue({});
  m.finance = true;
  m.platform = true;
});

describe('bandeja «Por cobrar»', () => {
  it('por defecto: vencidas, sólo facturas abiertas, de la más antigua a la más nueva', () => {
    renderPage();
    expect(m.pageParams.at(-1)).toMatchObject({ filter: 'OPEN', aging: 'VENCIDA', sortBy: 'due_date', sortDir: 'asc' });
    expect(within(row('INV-0001')).getByText('vencida hace 42 días')).toBeInTheDocument();
    expect(within(row('INV-0001')).getByText('VISA •••• 4242')).toBeInTheDocument();
    expect(within(row('INV-0002')).getByText('Sin tarjeta guardada')).toBeInTheDocument();
  });

  it('V6: la franja muestra el saldo por tramo de antigüedad y filtra al pulsarla', async () => {
    renderPage();
    const strip = screen.getByRole('region', { name: 'Saldo por cobrar según antigüedad' });
    const tramo = within(strip).getByRole('button', { name: /^Vencido 31–60 días/ });
    expect(tramo).toHaveTextContent('PEN');
    expect(tramo).toHaveTextContent('USD');
    expect(tramo).toHaveTextContent('3 facturas');
    expect(within(strip).getByRole('button', { name: /^Vencido Más de 90 días/ })).toHaveTextContent('Nada en el tramo');
    await userEvent.click(tramo);
    expect(m.pageParams.at(-1)).toMatchObject({ filter: 'OPEN', aging: 'D31_60' });
    expect(screen.getByRole('tab', { name: /Vencidas 31–60 días/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('V6: número completo, «de X» solo con cobro parcial y «Enviar enlace» visible en la fila', () => {
    renderPage();
    expect(within(row('INV-0001')).getByText(/de PEN/)).toBeInTheDocument();
    expect(within(row('INV-0002')).queryByText(/^de /)).toBeNull();
    expect(within(row('INV-0001')).getByRole('button', { name: 'Enviar enlace de pago de INV-0001' })).toHaveClass('ebim-btn-secondary');
  });

  it('«Por vencer» filtra por la banda vigente', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Por vencer/ }));
    expect(m.pageParams.at(-1)).toMatchObject({ filter: 'OPEN', aging: 'VIGENTE' });
  });

  it('acciones por fila: la tarjeta sólo si hay tarjeta guardada; suspender sólo si está vencida', async () => {
    renderPage();
    await openMenu('INV-0001');
    for (const name of ['Enviar enlace de pago', 'Registrar pago manual', 'Cobrar con tarjeta guardada', 'Suspender por mora']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(name) })).toBeInTheDocument();
    }
    await userEvent.keyboard('{Escape}');
    await openMenu('INV-0002');
    expect(screen.queryByRole('menuitem', { name: /Cobrar con tarjeta guardada/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Suspender por mora/ })).toBeNull();
  });

  it('registrar pago manual usa confirm_manual_payment con el saldo de la factura', async () => {
    renderPage();
    await openMenu('INV-0001');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Registrar pago manual' }));
    const dialog = screen.getByRole('dialog', { name: 'Registrar cobro · INV-0001' });
    await userEvent.type(within(dialog).getByLabelText(/Referencia/), 'OP-123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cobro' }));
    expect(m.confirmPayment).toHaveBeenCalledWith(expect.objectContaining({ p_invoice_id: 'inv-1', p_amount: 500, p_reference: 'OP-123' }));
  });

  it('cobrar con la tarjeta guardada confirma antes de llamar a la pasarela', async () => {
    renderPage();
    await openMenu('INV-0001');
    await userEvent.click(screen.getByRole('menuitem', { name: /Cobrar con tarjeta guardada/ }));
    const dialog = screen.getByRole('dialog', { name: '¿Cobrar con la tarjeta guardada?' });
    expect(dialog).toHaveTextContent('VISA •••• 4242');
    expect(m.autocharge).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cobrar ahora' }));
    expect(m.autocharge).toHaveBeenCalledWith({ invoiceId: 'inv-1' });
  });

  it('enviar enlace de pago abre el generador del portal para esa cuenta', async () => {
    renderPage();
    await openMenu('INV-0001');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Enviar enlace de pago' }));
    const dialog = screen.getByRole('dialog', { name: 'Generar enlace de pago' });
    expect(dialog).toHaveTextContent('Estado de cuenta de Alpha');
    expect(within(dialog).getByLabelText(/Motivo/)).toHaveValue('Cobro de la factura INV-0001');
  });

  it('suspender por mora: vista previa con las apps y tenants PROPIOS de la cuenta y el motivo propuesto', async () => {
    renderPage();
    await openMenu('INV-0001');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Suspender por mora' }));
    const dialog = screen.getByRole('dialog', { name: 'Suspender Alpha por mora' });
    const impact = dialog.querySelector('[data-lifecycle-impact]') as HTMLElement;
    expect(within(impact).getByText('Alpha EWM')).toBeInTheDocument();
    expect(within(impact).getByText('Alpha TMS')).toBeInTheDocument();
    expect(within(impact).queryByText('Cliente del canal')).toBeNull();
    expect(within(dialog).getByText('La app aún no aplica la suspensión: canal pendiente.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Motivo/)).toHaveValue('Mora: factura INV-0001 vencida hace 42 días');
  });

  it('sin finanzas ni plataforma: sólo ver; ninguna acción que mueva dinero o suspenda', async () => {
    m.finance = false;
    m.platform = false;
    renderPage();
    await openMenu('INV-0001');
    expect(screen.getByRole('menuitem', { name: 'Ver cuenta' })).toBeInTheDocument();
    for (const name of [/Enviar enlace/, /Registrar pago/, /tarjeta/, /Suspender/]) {
      expect(screen.queryByRole('menuitem', { name })).toBeNull();
    }
  });
});

describe('dueText', () => {
  const today = new Date(2026, 10, 12);
  it('vencida, hoy, en N días y sin fecha', () => {
    expect(dueText({ due_date: '2026-11-01', days_overdue: 11 }, today)).toEqual({ text: 'vencida hace 11 días', overdue: true });
    expect(dueText({ due_date: '2026-11-12', days_overdue: 0 }, today).text).toBe('vence hoy');
    expect(dueText({ due_date: '2026-11-13', days_overdue: 0 }, today).text).toBe('vence en 1 día');
    expect(dueText({ due_date: null, days_overdue: null }, today).text).toBe('Sin fecha de vencimiento');
  });
});
