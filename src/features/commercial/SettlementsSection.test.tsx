import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/*
 * Fase 13 · Liquidaciones de comisiones.
 * - Buscador único + pestañas de estado; el detalle abre el ciclo y sus comisiones.
 * - Finanzas: Aprobar (OPEN), Registrar pago (APPROVED), Anular con motivo; cada
 *   acción llama a SU RPC con los argumentos que la base exige.
 * - Un comercial ve sus liquidaciones y su estado, sin acciones.
 * - Generar: vista previa de lo elegible; sin comisiones no se llama a la RPC.
 */

const q = (data: unknown) => ({ data, error: null, isLoading: false, refetch: vi.fn() });

const m = vi.hoisted(() => ({
  events: vi.fn(),
  eligible: vi.fn(),
  settle: vi.fn(),
  approve: vi.fn(),
  pay: vi.fn(),
  cancel: vi.fn(),
  toastSuccess: vi.fn(),
}));

const mutation = (fn: ReturnType<typeof vi.fn>) => ({ mutateAsync: fn, isPending: false, error: null, reset: vi.fn() });

vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: m.toastSuccess, error: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/services/queries', () => ({
  useSettlementEvents: (id: string | null) => m.events(id),
  useEligibleCommissions: (p: unknown) => m.eligible(p),
  useSalesAgents: () => q([{ id: 'ag-1', full_name: 'Lucía Paredes', code: 'lucia-paredes', status: 'ACTIVE' }]),
  useCurrencies: () => q([{ code: 'USD', name: 'Dólar', status: 'ACTIVE' }, { code: 'PEN', name: 'Sol', status: 'ACTIVE' }]),
}));
vi.mock('@/services/mutations', () => ({
  useSettleCommissions: () => mutation(m.settle),
  useApproveCommissionSettlement: () => mutation(m.approve),
  usePayCommissionSettlement: () => mutation(m.pay),
  useCancelCommissionSettlement: () => mutation(m.cancel),
}));

import { SettlementsSection } from './SettlementsSection';

function settlement(over: Record<string, unknown> = {}) {
  return {
    id: 'stl-open', code: 'STL-lucia-paredes-202607-USD', sales_agent_id: 'ag-1',
    sales_agents: { full_name: 'Lucía Paredes', code: 'lucia-paredes' },
    period_start: '2026-07-01', period_end: '2026-09-30', currency: 'USD', status: 'OPEN', total_amount: 769.38,
    event_count: 3, created_at: '2026-10-05T15:00:00Z', approved_at: null, approved_by: null, approval_note: null,
    paid_at: null, paid_by: null, payment_reference: null, payment_method: null, payment_note: null,
    cancelled_at: null, cancelled_by: null, cancellation_reason: null, notes: null, updated_at: '2026-10-05T15:00:00Z',
    ...over,
  };
}
const approved = settlement({
  id: 'stl-appr', code: 'STL-diego-rojas-202607-USD', sales_agents: { full_name: 'Diego Rojas', code: 'diego-rojas' },
  status: 'APPROVED', total_amount: 582, approved_at: '2026-10-08T20:00:00Z', approval_note: 'Revisada',
});
const paid = settlement({
  id: 'stl-paid', code: 'STL-lucia-paredes-202604-USD', status: 'PAID', total_amount: 900,
  approved_at: '2026-07-08T20:00:00Z', paid_at: '2026-07-15T12:00:00Z', payment_reference: 'LIQ-2026Q2-LUCIA',
  payment_method: 'BANK_TRANSFER',
});
const cancelled = settlement({
  id: 'stl-void', code: 'STL-lucia-paredes-202605-USD', status: 'CANCELLED', total_amount: -100, event_count: 0,
  cancelled_at: '2026-06-02T15:00:00Z', cancellation_reason: 'Netear con el próximo mes',
});
const ALL = [settlement(), approved, paid, cancelled];

function renderSection({ canManage = true, rows = ALL, generateOpen = false } = {}) {
  return render(
    <MemoryRouter>
      <SettlementsSection
        query={q(rows) as never}
        canManage={canManage}
        generateOpen={generateOpen}
        onGenerateClose={vi.fn()}
      />
    </MemoryRouter>,
  );
}

async function menuOf(code: string): Promise<string[]> {
  await userEvent.click(screen.getByRole('button', { name: `Acciones de ${code}` }));
  return within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  m.events.mockReturnValue(q([]));
  m.eligible.mockReturnValue({ data: undefined, isLoading: false, error: null });
});

describe('SettlementsSection · lista', () => {
  it('pestañas de estado con su conteo y buscador único', async () => {
    renderSection();
    expect(screen.getByRole('tab', { name: 'Abiertas 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Aprobadas 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pagadas 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Anuladas 1' })).toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox'), 'LIQ-2026Q2');
    const rows = document.querySelectorAll('tr[data-settlement]');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-settlement-status', 'PAID');
    expect(rows[0]).toHaveTextContent('Transferencia bancaria');
  });

  it('la anulada muestra su total al anularse, sin contar comisiones liberadas', () => {
    renderSection();
    const row = document.querySelector('tr[data-settlement-status="CANCELLED"]') as HTMLElement;
    expect(row).toHaveTextContent('Anulada');
    expect(row).toHaveTextContent(/-USD\s100\.00/);
    expect(within(row).getByTitle('Liberadas al anular')).toBeInTheDocument();
  });

  it('finanzas ve el siguiente paso de cada una; pagadas y anuladas, solo el detalle', async () => {
    renderSection();
    expect(await menuOf('STL-lucia-paredes-202607-USD')).toEqual(['Ver detalle', 'Aprobar…', 'Anular…']);
    await userEvent.keyboard('{Escape}');
    expect(await menuOf('STL-diego-rojas-202607-USD')).toEqual(['Ver detalle', 'Registrar pago…', 'Anular…']);
    await userEvent.keyboard('{Escape}');
    expect(await menuOf('STL-lucia-paredes-202604-USD')).toEqual(['Ver detalle']);
  });

  it('un comercial ve sus liquidaciones y su estado, sin acciones', async () => {
    renderSection({ canManage: false });
    expect(screen.getByText(/Ves tus liquidaciones/)).toBeInTheDocument();
    expect(await menuOf('STL-lucia-paredes-202607-USD')).toEqual(['Ver detalle']);
  });

  it('sin liquidaciones, finanzas recibe la indicación de generar una', () => {
    renderSection({ rows: [] });
    expect(screen.getByText('Sin liquidaciones')).toBeInTheDocument();
    expect(screen.getByText(/Generar liquidación/)).toBeInTheDocument();
  });
});

describe('SettlementsSection · detalle y acciones', () => {
  it('el detalle muestra el ciclo, el pago y las comisiones incluidas', async () => {
    m.events.mockReturnValue(
      q([
        { commission_event_id: 'e1', earned_on: '2026-04-10', tenant_name: 'Qhapaq', product_short_name: 'eSupplier',
          source_label: 'Licencia', invoice_number: 'INV-1', base_amount: 1000, amount: 100, currency: 'USD', is_reversal: false },
        { commission_event_id: 'e2', earned_on: '2026-05-02', tenant_name: 'Qhapaq', product_short_name: 'eSupplier',
          source_label: 'Reverso', invoice_number: 'INV-0', base_amount: -500, amount: -50, currency: 'USD', is_reversal: true },
      ]),
    );
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'STL-lucia-paredes-202604-USD' }));
    const drawer = screen.getByRole('dialog', { name: 'STL-lucia-paredes-202604-USD' });
    expect(m.events).toHaveBeenLastCalledWith('stl-paid');
    const steps = within(drawer).getByRole('list', { name: /Ciclo de la liquidación: Pagada/ });
    expect(within(steps).getAllByRole('listitem')[2]).toHaveAttribute('aria-current', 'step');
    expect(drawer).toHaveTextContent('LIQ-2026Q2-LUCIA');
    expect(within(drawer).getByRole('table', { name: /Comisiones de/ })).toHaveTextContent(/-USD\s50\.00/);
    expect(within(drawer).getByText('Reverso', { selector: 'span' })).toBeInTheDocument();
    // Pagada: el panel no ofrece acciones.
    expect(within(drawer).queryByRole('button', { name: /Aprobar|Registrar pago|Anular/ })).toBeNull();
  });

  it('aprobar llama a la RPC con la nota', async () => {
    m.approve.mockResolvedValue({ status: 'APPROVED' });
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'STL-lucia-paredes-202607-USD' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aprobar…' }));
    const dialog = screen.getByRole('dialog', { name: /Aprobar STL-lucia-paredes-202607-USD/ });
    expect(within(dialog).getByText(/USD\s769\.38/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Nota/), 'Revisada contra cobros');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprobar' }));
    await waitFor(() =>
      expect(m.approve).toHaveBeenCalledWith({ p_settlement_id: 'stl-open', p_note: 'Revisada contra cobros' }),
    );
    expect(m.toastSuccess).toHaveBeenCalledWith('Liquidación aprobada', expect.stringContaining('STL-lucia-paredes-202607-USD'));
  });

  it('registrar pago exige referencia y envía fecha, medio y referencia', async () => {
    m.pay.mockResolvedValue({ status: 'PAID' });
    renderSection();
    await menuOf('STL-diego-rojas-202607-USD');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Registrar pago…' }));
    const dialog = screen.getByRole('dialog', { name: /Registrar pago · STL-diego-rojas/ });
    await userEvent.selectOptions(within(dialog).getByLabelText(/Medio/), 'PAYROLL');
    await userEvent.clear(within(dialog).getByLabelText(/Fecha del pago/));
    await userEvent.type(within(dialog).getByLabelText(/Fecha del pago/), '2026-10-04');
    await userEvent.type(within(dialog).getByLabelText(/Referencia/), '  PLAN-2026-10 ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar pago' }));
    await waitFor(() =>
      expect(m.pay).toHaveBeenCalledWith({
        p_settlement_id: 'stl-appr', p_paid_at: '2026-10-04', p_payment_reference: 'PLAN-2026-10',
        p_method: 'PAYROLL', p_note: undefined,
      }),
    );
  });

  it('anular exige motivo y avisa cuántas comisiones vuelven a por liquidar', async () => {
    m.cancel.mockResolvedValue({ events_released: 3 });
    renderSection();
    await menuOf('STL-lucia-paredes-202607-USD');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Anular…' }));
    const dialog = screen.getByRole('dialog', { name: /Anular STL-lucia-paredes-202607-USD/ });
    expect(dialog).toHaveTextContent('Sus 3 comisión(es) vuelven a estar por liquidar');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anular liquidación' }));
    expect(m.cancel).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'Importe en revisión');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anular liquidación' }));
    await waitFor(() =>
      expect(m.cancel).toHaveBeenCalledWith({ p_settlement_id: 'stl-open', p_reason: 'Importe en revisión' }),
    );
    expect(m.toastSuccess).toHaveBeenCalledWith('Liquidación anulada', '3 comisión(es) vuelven a estar por liquidar');
  });

  it('una abierta negativa explica por qué no se aprueba y solo ofrece anular', async () => {
    renderSection({ rows: [settlement({ total_amount: -100, event_count: 1 })] });
    await userEvent.click(screen.getByRole('button', { name: 'STL-lucia-paredes-202607-USD' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent(/reversos superan lo devengado/);
    expect(within(drawer).queryByRole('button', { name: 'Aprobar…' })).toBeNull();
    expect(within(drawer).getByRole('button', { name: 'Anular…' })).toBeInTheDocument();
  });
});

describe('SettlementsSection · generar', () => {
  it('muestra lo que entra y llama a settle_commissions con comercial, período y moneda', async () => {
    m.eligible.mockReturnValue({ data: { count: 2, rows: [{ amount: 100 }, { amount: 50.5 }] }, isLoading: false, error: null });
    m.settle.mockResolvedValue('stl-new');
    renderSection({ generateOpen: true });
    const dialog = screen.getByRole('dialog', { name: 'Generar liquidación' });
    await userEvent.selectOptions(within(dialog).getByLabelText(/Comercial/), 'ag-1');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Moneda/), 'USD');
    expect(dialog.querySelector('[data-settle-preview]')).toHaveTextContent(/Entran 2 comisión\(es\) elegibles por USD\s150\.50/);
    const range = m.eligible.mock.lastCall?.[0] as { from: string; to: string };
    await userEvent.click(within(dialog).getByRole('button', { name: 'Generar liquidación' }));
    await waitFor(() =>
      expect(m.settle).toHaveBeenCalledWith({
        p_sales_agent_id: 'ag-1', p_period_start: range.from, p_period_end: range.to, p_currency: 'USD',
      }),
    );
  });

  it('sin comisiones elegibles no se genera una liquidación vacía', async () => {
    m.eligible.mockReturnValue({ data: { count: 0, rows: [] }, isLoading: false, error: null });
    renderSection({ generateOpen: true });
    const dialog = screen.getByRole('dialog', { name: 'Generar liquidación' });
    await userEvent.selectOptions(within(dialog).getByLabelText(/Comercial/), 'ag-1');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Moneda/), 'USD');
    expect(dialog).toHaveTextContent('No hay comisiones elegibles');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Generar liquidación' }));
    expect(m.settle).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('no hay comisiones elegibles');
  });
});
