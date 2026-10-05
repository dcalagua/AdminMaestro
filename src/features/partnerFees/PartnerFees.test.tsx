import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/*
 * M3 · Tarifa de plataforma de partners (spec §4.4).
 * - «Tarifas de partners»: período, buscador único, pestañas de estado,
 *   calcular (uno o todos), emitir, anular con motivo, compartir el enlace.
 * - Tarifa del acuerdo: solo «Sin tarifa» si factura EBIM; % en fracción.
 * - Ficha del partner: saldo pendiente por moneda.
 * - Canal de facturación de la suscripción, con motivo.
 * La autoridad es la base: la UI solo ofrece la acción a finanzas.
 */

const PARTNER = '30000000-0000-4000-a000-000000000002';
const q = (data: unknown) => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = () => ({ data: undefined, error: new Error('boom'), isLoading: false, refetch: vi.fn() });

const m = vi.hoisted(() => ({
  statements: vi.fn(),
  lines: vi.fn(),
  agreements: vi.fn(),
  permissions: vi.fn(),
  compute: vi.fn(),
  computeAll: vi.fn(),
  issue: vi.fn(),
  voidSt: vi.fn(),
  setFee: vi.fn(),
  setChannel: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const mutation = (fn: ReturnType<typeof vi.fn>) => ({ mutateAsync: fn, isPending: false, error: null, reset: vi.fn() });

vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => m.permissions() }));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: m.toastSuccess, error: m.toastError, push: vi.fn() }),
}));
vi.mock('@/services/queries', () => ({
  usePartnerFeeStatements: (p: unknown) => m.statements(p),
  usePartnerFeeStatementLines: (id: string | null) => m.lines(id),
  usePlatformFeeAgreements: () => m.agreements(),
  useCurrencies: () => q([{ code: 'USD' }, { code: 'PEN' }]),
}));
vi.mock('@/services/mutations', () => ({
  useComputePartnerFeeStatement: () => mutation(m.compute),
  useComputeAllPartnerFeeStatements: () => mutation(m.computeAll),
  useIssuePartnerFeeStatement: () => mutation(m.issue),
  useVoidPartnerFeeStatement: () => mutation(m.voidSt),
  useSetAgreementPlatformFee: () => mutation(m.setFee),
  useSetSubscriptionBillingChannel: () => mutation(m.setChannel),
}));

import { PartnerFeesPage } from './PartnerFeesPage';
import { PartnerFeeStatementsPanel } from './PartnerFeeStatementsPanel';
import { PlatformFeeDialog, type PlatformFeeTarget } from './PlatformFeeDialog';
import { BillingChannelDialog } from '@/features/billing/BillingChannelDialog';
import { feeTermsText } from './feeLabels';

const FINANCE = { canReadFinance: true, canManagePlatform: false, canManageCommercial: true, isOrgAdmin: () => false };
const READER = { canReadFinance: false, canManagePlatform: false, canManageCommercial: false, isOrgAdmin: () => false };

function statement(over: Record<string, unknown> = {}) {
  return {
    id: 'st-draft', partner_organization_id: PARTNER, partner_name: 'Consultora Andina', partner_slug: 'andina',
    period_start: '2026-10-01', period_end: '2026-10-31', currency: 'USD', status: 'DRAFT', tenant_count: 6,
    line_count: 6, base_total: 3240, fee_total: 354, source_hash: `sha256:${'a'.repeat(64)}`,
    computed_at: '2026-10-04T10:00:00Z', computed_by: null, issued_at: null, issued_by: null, voided_at: null,
    voided_by: null, void_reason: null, invoice_id: null, invoice_number: null, invoice_status: null,
    invoice_due_date: null, invoice_total: null, invoice_balance: null, created_at: '2026-10-04T10:00:00Z',
    updated_at: '2026-10-04T10:00:00Z',
    ...over,
  };
}
const issued = statement({
  id: 'st-issued', currency: 'BOB', status: 'ISSUED', fee_total: 590, base_total: 5900, tenant_count: 1,
  invoice_id: 'inv-1', invoice_number: 'INV-202610-PFEE-ANDINA-BOB', invoice_status: 'ISSUED',
  invoice_due_date: '2026-10-19', invoice_total: 590, invoice_balance: 590,
});
const voided = statement({ id: 'st-void', partner_name: 'Reseller Pacífico', status: 'VOID', void_reason: 'Error' });

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

/** Abre el menú de acciones (DotsThree) de la fila y devuelve sus ítems. */
async function menuOf(row: RegExp): Promise<string[]> {
  await userEvent.click(within(screen.getByRole('row', { name: row })).getByRole('button', { name: /^Acciones de / }));
  return within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent ?? '');
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.permissions.mockReturnValue(FINANCE);
  m.statements.mockReturnValue(q([statement(), issued, voided]));
  m.lines.mockReturnValue(q([]));
  m.agreements.mockReturnValue(
    q([{ id: 'ag-1', organization_id: PARTNER, status: 'ACTIVE', organizations: { display_name: 'Consultora Andina' } }]),
  );
});

describe('PartnerFeesPage', () => {
  it('lista por partner y moneda con pestañas de estado y buscador único', async () => {
    wrap(<PartnerFeesPage />);
    expect(m.statements).toHaveBeenCalledWith(expect.objectContaining({ periodStart: expect.stringMatching(/^\d{4}-\d{2}-01$/) }));
    expect(screen.getAllByRole('row')).toHaveLength(4);
    await userEvent.click(screen.getByRole('tab', { name: /Emitida/ }));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('INV-202610-PFEE-ANDINA-BOB')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Todas/ }));
    await userEvent.type(screen.getByPlaceholderText(/Buscar por partner/), 'Pacífico');
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('acciones según estado: emitir en borrador; compartir enlace solo emitida con saldo; anular salvo anuladas', async () => {
    wrap(<PartnerFeesPage />);
    expect(await menuOf(/Borrador/)).toEqual(['Ver detalle', 'Emitir factura…', 'Anular…']);
    await userEvent.keyboard('{Escape}');
    expect(await menuOf(/INV-202610-PFEE-ANDINA-BOB/)).toEqual(['Ver detalle', 'Compartir enlace de pago', 'Anular…']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Compartir enlace de pago' }));
    await userEvent.keyboard('{Escape}');
    expect(await menuOf(/Pacífico/)).toEqual(['Ver detalle']);
  });

  it('sin finanzas no ofrece calcular, emitir ni anular', async () => {
    m.permissions.mockReturnValue(READER);
    wrap(<PartnerFeesPage />);
    expect(screen.queryByRole('button', { name: 'Calcular todos' })).toBeNull();
    expect(await menuOf(/Borrador/)).toEqual(['Ver detalle']);
  });

  it('la franja resume el período por moneda, sin sumar monedas, y cuenta lo que falta emitir', () => {
    wrap(<PartnerFeesPage />);
    const strip = document.querySelector('[data-kpi-strip]') as HTMLElement;
    // Tarifa: USD 354 (borrador) y BOB 590 (emitida); la anulada no cuenta.
    expect(within(strip).getByTitle('USD 354.00')).toBeInTheDocument();
    // BOB 590: la tarifa emitida y, a la vez, su saldo por cobrar.
    expect(within(strip).getAllByTitle('BOB 590.00')).toHaveLength(2);
    expect(strip).not.toHaveTextContent('944');
    expect(within(strip).getByText('2 estado(s) de cuenta')).toBeInTheDocument();
    expect(within(strip).getByText('Borradores sin factura')).toBeInTheDocument();
    expect(within(strip).getByText('1 factura(s) con saldo')).toBeInTheDocument();
  });

  it('«Calcular» exige el partner y llama a compute_partner_fee_statement con el período', async () => {
    m.compute.mockResolvedValue({ statements: [{ changed: true }] });
    wrap(<PartnerFeesPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Calcular' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Calcular' }));
    expect(m.compute).not.toHaveBeenCalled();
    await userEvent.selectOptions(within(dialog).getByLabelText(/Partner/), PARTNER);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Calcular' }));
    expect(m.compute).toHaveBeenCalledWith({ p_partner_id: PARTNER, p_period_start: expect.stringMatching(/-01$/) });
  });

  it('«Calcular todos» confirma y llama a compute_all_partner_fee_statements', async () => {
    m.computeAll.mockResolvedValue({ partners: 2 });
    wrap(<PartnerFeesPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Calcular todos' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Calcular todos' }));
    await waitFor(() => expect(m.computeAll).toHaveBeenCalledWith({ p_period_start: expect.stringMatching(/-01$/) }));
    await waitFor(() => expect(m.toastSuccess).toHaveBeenCalled());
  });

  it('«Emitir» confirma y llama a issue_partner_fee_statement', async () => {
    m.issue.mockResolvedValue({ number: 'INV-202610-PFEE-ANDINA-USD' });
    wrap(<PartnerFeesPage />);
    await menuOf(/Borrador/);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Emitir factura…' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Emitir factura' }));
    await waitFor(() => expect(m.issue).toHaveBeenCalledWith({ p_statement_id: 'st-draft' }));
  });

  it('«Anular» exige motivo y avisa que también anula la factura', async () => {
    m.voidSt.mockResolvedValue({ status: 'VOID' });
    wrap(<PartnerFeesPage />);
    await menuOf(/INV-202610-PFEE-ANDINA-BOB/);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Anular…' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('También se anula la factura INV-202610-PFEE-ANDINA-BOB');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anular' }));
    expect(m.voidSt).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'Tarifa mal configurada');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anular' }));
    expect(m.voidSt).toHaveBeenCalledWith({ p_statement_id: 'st-issued', p_reason: 'Tarifa mal configurada' });
  });

  it('el detalle muestra las líneas por tenant', async () => {
    m.lines.mockReturnValue(
      q([{
        id: 'l1', statement_id: 'st-draft', tenant_name: 'Cliente P1', tenant_slug: 'cliente-p1', product_short_name: 'eSupplier',
        subscription_code: 'SUB-P1-ESUP', line_kind: 'TENANT', currency: 'USD', base_list_amount: 950, fee_rate: 0.1,
        fee_fixed_amount: 5, fee_amount: 100,
      }]),
    );
    wrap(<PartnerFeesPage />);
    await userEvent.click(within(screen.getByRole('row', { name: /Borrador/ })).getByRole('button', { name: 'Consultora Andina' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Cliente P1')).toBeInTheDocument();
    expect(m.lines).toHaveBeenCalledWith('st-draft');
  });

  it('vacío sin acuerdos con tarifa, y error', () => {
    m.statements.mockReturnValue(q([]));
    m.agreements.mockReturnValue(q([]));
    const { unmount } = wrap(<PartnerFeesPage />);
    expect(screen.getByText(/Ningún acuerdo tiene tarifa de plataforma/)).toBeInTheDocument();
    unmount();
    m.statements.mockReturnValue(failed());
    wrap(<PartnerFeesPage />);
    // La tabla y cada tile de la franja dicen que no pudieron leer; ninguno pinta un 0.
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('[data-kpi-strip]')).not.toHaveTextContent(/USD|BOB|0\.00/);
  });
});

describe('PartnerFeeStatementsPanel', () => {
  it('muestra el saldo pendiente por moneda de las facturas emitidas', () => {
    m.statements.mockReturnValue(q([statement(), issued]));
    wrap(<PartnerFeeStatementsPanel organizationId={PARTNER} />);
    expect(m.statements).toHaveBeenCalledWith({ partnerId: PARTNER });
    expect(screen.getByText('Saldo pendiente · BOB')).toBeInTheDocument();
    expect(screen.queryByText('Saldo pendiente · USD')).toBeNull();
    expect(screen.getByRole('link', { name: 'Ir a Tarifas de partners' })).toHaveAttribute('href', '/partner-fees');
  });
});

describe('PlatformFeeDialog', () => {
  const target: PlatformFeeTarget = {
    agreementId: 'ag-1', productName: 'eSupplier', partnerName: 'Consultora Andina', billingResponsibility: 'PARTNER',
    platform_fee_model: 'NONE', platform_fee_rate: null, platform_fee_fixed_amount: null, platform_fee_currency: null,
  };

  it('si factura EBIM solo ofrece «Sin tarifa» y lo explica', () => {
    wrap(<PlatformFeeDialog target={{ ...target, billingResponsibility: 'EBIM' }} onClose={vi.fn()} />);
    const select = screen.getByLabelText(/Modelo/);
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sin tarifa']);
    expect(screen.getByRole('note')).toHaveTextContent('lo factura EBIM');
  });

  it('% + fijo: convierte el porcentaje a fracción y envía moneda y motivo', async () => {
    m.setFee.mockResolvedValue({});
    wrap(<PlatformFeeDialog target={target} onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/Modelo/), 'PERCENT_PLUS_FIXED');
    await userEvent.type(screen.getByLabelText(/Porcentaje/), '12.5');
    await userEvent.type(screen.getByLabelText(/Fijo por tenant/), '5');
    await userEvent.selectOptions(screen.getByLabelText(/Moneda del fijo/), 'USD');
    await userEvent.type(screen.getByLabelText(/Motivo/), 'Acuerdo comercial 2026');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar tarifa' }));
    await waitFor(() =>
      expect(m.setFee).toHaveBeenCalledWith({
        p_agreement_id: 'ag-1', p_model: 'PERCENT_PLUS_FIXED', p_rate: 0.125, p_fixed_amount: 5, p_currency: 'USD',
        p_reason: 'Acuerdo comercial 2026',
      }),
    );
  });

  it('valida el porcentaje antes de llamar a la base', async () => {
    wrap(<PlatformFeeDialog target={target} onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/Modelo/), 'PERCENT_OF_LIST');
    await userEvent.type(screen.getByLabelText(/Porcentaje/), '150');
    await userEvent.type(screen.getByLabelText(/Motivo/), 'Prueba');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar tarifa' }));
    expect(await screen.findByText(/Porcentaje entre 0/)).toBeInTheDocument();
    expect(m.setFee).not.toHaveBeenCalled();
  });

  it('feeTermsText describe los términos sin inventar ceros', () => {
    expect(feeTermsText(null)).toBe('Sin tarifa');
    expect(
      feeTermsText({ platform_fee_model: 'PERCENT_OF_LIST', platform_fee_rate: 0.1, platform_fee_fixed_amount: null, platform_fee_currency: null }),
    ).toMatch(/10[.,]0\s?% de la base/);
  });
});

describe('BillingChannelDialog', () => {
  it('pasa de DIRECT a PARTNER_STATEMENT con motivo', async () => {
    m.setChannel.mockResolvedValue({});
    const onClose = vi.fn();
    wrap(<BillingChannelDialog open subscriptionId="sub-1" subscriptionCode="SUB-P1-ESUP" current="DIRECT" onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pasar a factura del partner' }));
    expect(m.setChannel).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'El partner factura desde octubre');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pasar a factura del partner' }));
    expect(m.setChannel).toHaveBeenCalledWith({
      p_subscription_id: 'sub-1', p_channel: 'PARTNER_STATEMENT', p_reason: 'El partner factura desde octubre',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
