import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * M1/M2 · Portal de pago público (spec §2.4, §3.1).
 * - El token sale del fragmento `#` y viaja en el cuerpo; sin token no se llama a nada.
 * - Nunca se pintan ids internos ni códigos técnicos: solo el mensaje para el cliente.
 * - Cuenta MOCK → formulario «Modo de prueba» con token tkn_mock_*; TEST → Culqi Checkout.
 */

const TOKEN = 'T'.repeat(40) + 'x_y';
const INVOICE_ID = '11111111-1111-4111-8111-111111111111';

const api = vi.hoisted(() => ({ callPortal: vi.fn() }));
const checkout = vi.hoisted(() => ({ openCulqiCheckout: vi.fn(), mockToken: vi.fn() }));

vi.mock('./portalApi', async () => {
  const actual = await vi.importActual<typeof import('./portalApi')>('./portalApi');
  return { ...actual, callPortal: api.callPortal };
});
vi.mock('./culqiCheckout', () => ({ openCulqiCheckout: checkout.openCulqiCheckout, mockToken: checkout.mockToken }));
vi.mock('@/lib/env', () => ({ env: { supabaseUrl: 'http://x', supabaseAnonKey: 'anon' } }));
vi.mock('@/components/ui/EbimMark', () => ({ EbimMark: () => null }));

import { PaymentPortalPage } from './PaymentPortalPage';
import type { PortalStatement } from './portalApi';

function statement(over: Partial<PortalStatement> = {}): PortalStatement {
  return {
    organization: { name: 'Empresa Alpha', billing_email_masked: 'p***s@alpha.ebim.test' },
    expires_at: '2026-11-01T00:00:00Z',
    allow_card_enrollment: true,
    invoices: [
      {
        id: INVOICE_ID, number: 'INV-202610-0001', status: 'ISSUED', currency: 'USD', total: 1200, paid: 0,
        balance: 1200, issue_date: '2026-10-01', due_date: '2099-10-16', period_start: '2026-10-01',
        period_end: '2026-10-31', product: 'eSupplier', payable_by_card: true,
        checkout: { public_key: null, mode: 'MOCK' },
      },
    ],
    card_on_file: null,
    enrollment: { available: true, missing_fields: [], terms_version: 'CARD_ON_FILE_V1', checkout: { public_key: null, mode: 'MOCK' } },
    ...over,
  };
}

function okStatement(st: PortalStatement) {
  return { ok: true, data: st };
}

beforeEach(() => {
  window.location.hash = `#${TOKEN}`;
  api.callPortal.mockReset();
  checkout.openCulqiCheckout.mockReset();
  checkout.mockToken.mockReset().mockReturnValue('tkn_mock_abc123');
});
afterEach(() => {
  window.location.hash = '';
});

describe('PaymentPortalPage', () => {
  it('sin token válido en el fragmento no llama al portal y lo explica', () => {
    window.location.hash = '#corto';
    render(<PaymentPortalPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('no es válido');
    expect(api.callPortal).not.toHaveBeenCalled();
  });

  it('pide el estado de cuenta con el token en el cuerpo y lista las facturas sin ids internos', async () => {
    api.callPortal.mockResolvedValue(okStatement(statement()));
    const { container } = render(<PaymentPortalPage />);
    expect(await screen.findByText('Empresa Alpha')).toBeInTheDocument();
    expect(api.callPortal).toHaveBeenCalledWith('statement', { token: TOKEN });
    expect(screen.getByText(/INV-202610-0001/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pagar' })).toBeEnabled();
    expect(screen.getByRole('note')).toHaveTextContent('Modo de prueba');
    expect(container.textContent).not.toContain(INVOICE_ID);
    expect(container.textContent).toContain('p***s@alpha.ebim.test');
  });

  it('un enlace vencido muestra el mensaje para el cliente, no el código', async () => {
    api.callPortal.mockResolvedValue({
      ok: false, status: 410, error: 'ENLACE_VENCIDO', message: 'Este enlace de pago venció. Pide uno nuevo a tu contacto en EBIM.',
    });
    render(<PaymentPortalPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('venció');
    expect(alert).not.toHaveTextContent('ENLACE_VENCIDO');
  });

  it('modo de prueba: formulario simulado → tkn_mock_* → cobro → comprobante y recarga', async () => {
    api.callPortal
      .mockResolvedValueOnce(okStatement(statement()))
      .mockResolvedValueOnce({
        ok: true,
        data: {
          simulated: true,
          receipt: { invoice_number: 'INV-202610-0001', charge: 'chr_…9f3a', amount: 1200, currency: 'USD', paid_at: '2026-10-04T12:00:00Z' },
        },
      })
      .mockResolvedValueOnce(okStatement(statement({ invoices: [] })));
    render(<PaymentPortalPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pagar' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Modo de prueba');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    await waitFor(() =>
      expect(api.callPortal).toHaveBeenCalledWith('charge', {
        token: TOKEN, invoice_id: INVOICE_ID, source_token: 'tkn_mock_abc123',
      }),
    );
    expect(await screen.findByText('Pago recibido (simulado)')).toBeInTheDocument();
    expect(screen.getByText('chr_…9f3a')).toBeInTheDocument();
    expect(await screen.findByText(/No tienes facturas pendientes/)).toBeInTheDocument();
    expect(checkout.openCulqiCheckout).not.toHaveBeenCalled();
  });

  it('tarjeta rechazada: muestra el mensaje del portal', async () => {
    api.callPortal
      .mockResolvedValueOnce(okStatement(statement()))
      .mockResolvedValueOnce({
        ok: false, status: 402, error: 'TARJETA_RECHAZADA',
        message: 'Tu tarjeta fue rechazada. Prueba con otra tarjeta o contacta a tu banco.',
      })
      .mockResolvedValueOnce(okStatement(statement()));
    render(<PaymentPortalPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pagar' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Continuar' }));
    const alert = await screen.findByText(/Tu tarjeta fue rechazada/);
    expect(alert).toHaveAttribute('role', 'alert');
    expect(screen.queryByText('TARJETA_RECHAZADA')).not.toBeInTheDocument();
  });

  it('cobro en curso (doble clic / otra pestaña): mensaje de espera, sin código y recarga el estado', async () => {
    api.callPortal
      .mockResolvedValueOnce(okStatement(statement()))
      .mockResolvedValueOnce({
        ok: false, status: 409, error: 'COBRO_EN_CURSO',
        message: 'Ya hay un pago en curso para esta factura. Espera un momento y recarga la página.',
      })
      .mockResolvedValueOnce(okStatement(statement()));
    render(<PaymentPortalPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pagar' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Continuar' }));
    const alert = await screen.findByText(/Ya hay un pago en curso para esta factura/);
    expect(alert).toHaveAttribute('role', 'alert');
    expect(screen.queryByText(/COBRO_EN_CURSO/)).not.toBeInTheDocument();
    await waitFor(() => expect(api.callPortal).toHaveBeenCalledTimes(3));
  });

  it('cuenta TEST: abre Culqi Checkout con la llave pública y el saldo en céntimos', async () => {
    const test = statement();
    test.invoices[0]!.checkout = { public_key: 'pk_test_demo', mode: 'TEST' };
    test.enrollment.checkout = { public_key: 'pk_test_demo', mode: 'TEST' };
    api.callPortal
      .mockResolvedValueOnce(okStatement(test))
      .mockResolvedValueOnce({ ok: true, data: { simulated: false, receipt: { invoice_number: 'X', charge: 'chr_…0001', amount: 1200, currency: 'USD', paid_at: '2026-10-04T12:00:00Z' } } })
      .mockResolvedValueOnce(okStatement(test));
    checkout.openCulqiCheckout.mockResolvedValue({ token: 'tkn_test_fromculqi', email: null });
    render(<PaymentPortalPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pagar' }));
    await waitFor(() =>
      expect(checkout.openCulqiCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ publicKey: 'pk_test_demo', currency: 'USD', amountMinor: 120000 }),
      ),
    );
    await waitFor(() =>
      expect(api.callPortal).toHaveBeenCalledWith('charge', expect.objectContaining({ source_token: 'tkn_test_fromculqi' })),
    );
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('una factura no pagable con tarjeta lo dice y no ofrece «Pagar»', async () => {
    const st = statement();
    st.invoices[0]!.payable_by_card = false;
    st.invoices[0]!.checkout = null;
    api.callPortal.mockResolvedValue(okStatement(st));
    render(<PaymentPortalPage />);
    expect(await screen.findByText(/No pagable con tarjeta/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pagar' })).not.toBeInTheDocument();
  });

  it('pago automático: exige aceptar los términos y completar los datos que faltan', async () => {
    api.callPortal
      .mockResolvedValueOnce(okStatement(statement({ enrollment: { available: true, missing_fields: ['billing_phone'], terms_version: 'CARD_ON_FILE_V1', checkout: { public_key: null, mode: 'MOCK' } } })))
      .mockResolvedValueOnce({ ok: true, data: { card: { brand: 'VISA', last4: '4242' } } })
      .mockResolvedValueOnce(okStatement(statement()));
    render(<PaymentPortalPage />);
    const activate = await screen.findByRole('button', { name: 'Guardar tarjeta y activar' });
    expect(activate).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(activate).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: '51987654321' } });
    expect(activate).toBeEnabled();
    fireEvent.click(activate);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Continuar' }));
    await waitFor(() =>
      expect(api.callPortal).toHaveBeenCalledWith('enroll', {
        token: TOKEN, source_token: 'tkn_mock_abc123', accepted_terms: true, billing_contact: { phone: '51987654321' },
      }),
    );
    expect(await screen.findByText(/Pago automático activado/)).toBeInTheDocument();
  });

  it('pago automático activo: muestra la tarjeta y permite desactivarlo con confirmación', async () => {
    const st = statement({ card_on_file: { brand: 'VISA', last4: '4242', authorized: true, authorized_at: '2026-10-04T12:00:00Z' } });
    api.callPortal
      .mockResolvedValueOnce(okStatement(st))
      .mockResolvedValueOnce({ ok: true, data: { revoked: 1 } })
      .mockResolvedValueOnce(okStatement(statement()));
    render(<PaymentPortalPage />);
    expect(await screen.findByText(/VISA •••• 4242/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar pago automático' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, desactivar' }));
    await waitFor(() => expect(api.callPortal).toHaveBeenCalledWith('unenroll', { token: TOKEN }));
    expect(await screen.findByText(/Pago automático desactivado/)).toBeInTheDocument();
  });
});
