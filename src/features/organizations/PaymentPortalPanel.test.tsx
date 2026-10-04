import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
 * M1 · Ficha 360 → «Portal de pago».
 * - El URL del enlace se muestra UNA vez y se descarta al cerrar.
 * - Revocar exige motivo: sin él no se llama a la RPC.
 */
const ORG = '30000000-0000-4000-a000-000000000004';
const TOKEN = 'A'.repeat(39) + 'wxyz';
const q = (data: unknown) => ({ data, error: null, isLoading: false, refetch: vi.fn() });

const m = vi.hoisted(() => ({
  create: vi.fn(),
  revokeLink: vi.fn(),
  revokeCard: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ canReadFinance: true }) }));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: m.toastSuccess, error: m.toastError, push: vi.fn() }),
}));
vi.mock('@/services/queries', () => ({
  usePaymentLinks: () =>
    q([
      { id: 'l1', token_hint: 'abcd', status: 'ACTIVE', expires_at: '2026-11-03T00:00:00Z', allow_card_enrollment: true,
        last_accessed_at: null, access_count: 0, charges_ok: 1, charges_failed: 0, rate_limited: 0, revoke_reason: null },
      { id: 'l2', token_hint: 'zzzz', status: 'REVOKED', expires_at: '2026-10-10T00:00:00Z', allow_card_enrollment: false,
        last_accessed_at: '2026-10-02T10:00:00Z', access_count: 3, charges_ok: 0, charges_failed: 2, rate_limited: 0,
        revoke_reason: 'Cliente lo pidió' },
    ]),
  usePaymentLinkEvents: () => q([]),
  useCardOnFileAuthorizations: () =>
    q([{ id: 'a1', brand: 'VISA', last4: '4242', accepted_at: '2026-10-01T00:00:00Z', terms_version: 'CARD_ON_FILE_V1',
         provider_account_code: 'culqi-pe-test', provider_environment: 'TEST', subscriptions_on_card: 2, is_active: true }]),
}));
vi.mock('@/services/mutations', () => ({
  useCreatePaymentLink: () => ({ mutateAsync: m.create, isPending: false }),
  useRevokePaymentLink: () => ({ mutateAsync: m.revokeLink, isPending: false }),
  useRevokeCardOnFile: () => ({ mutateAsync: m.revokeCard, isPending: false }),
}));

import { PaymentPortalPanel } from './PaymentPortalPanel';

function renderPanel() {
  return render(
    <MemoryRouter>
      <PaymentPortalPanel organizationId={ORG} organizationName="Empresa Alpha" billingEmail="pagos@alpha.ebim.test" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
});

describe('PaymentPortalPanel', () => {
  it('genera el enlace y muestra el URL una sola vez (copiar y mailto); al cerrar desaparece', async () => {
    m.create.mockResolvedValue({ id: 'l3', token: TOKEN, hint: 'wxyz', expires_at: '2026-11-03T00:00:00Z' });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Generar enlace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    await waitFor(() => expect(m.create).toHaveBeenCalledTimes(1));
    expect(m.create.mock.calls[0]![0]).toMatchObject({
      p_organization_id: ORG, p_expires_in_days: 30, p_allow_card_enrollment: true,
    });

    const dialog = await screen.findByRole('dialog', { name: 'Enlace de pago generado' });
    const url = `${window.location.origin}/pagar#${TOKEN}`;
    expect(within(dialog).getByDisplayValue(url)).toBeInTheDocument();
    expect(within(dialog).getByText(/una sola vez/)).toBeInTheDocument();
    const mail = within(dialog).getByRole('link', { name: 'Enviar por correo' }).getAttribute('href') ?? '';
    expect(mail.startsWith('mailto:pagos@alpha.ebim.test?')).toBe(true);
    expect(decodeURIComponent(mail)).toContain(url);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Listo' }));
    expect(screen.queryByDisplayValue(url)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('rechaza una vigencia fuera de 1–90 días sin llamar a la base', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Generar enlace' }));
    fireEvent.change(screen.getByLabelText(/Vigencia/), { target: { value: '120' } });
    // submit directo: el guard propio funciona aunque el navegador no valide el campo.
    fireEvent.submit(screen.getByRole('dialog', { name: 'Generar enlace de pago' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('entre 1 y 90 días');
    expect(m.create).not.toHaveBeenCalled();
  });

  it('revocar un enlace exige motivo', async () => {
    m.revokeLink.mockResolvedValue({ already_revoked: false });
    renderPanel();
    // Solo el enlace ACTIVO ofrece «Revocar».
    expect(screen.getAllByRole('button', { name: 'Revocar' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Revocar' }));

    const dialog = screen.getByRole('dialog', { name: 'Revocar enlace de pago' });
    fireEvent.submit(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('motivo');
    expect(m.revokeLink).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'Se envió por error' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revocar' }));
    await waitFor(() =>
      expect(m.revokeLink).toHaveBeenCalledWith({ p_link_id: 'l1', p_reason: 'Se envió por error' }),
    );
  });

  it('lista la tarjeta guardada y filtra enlaces por estado', () => {
    renderPanel();
    expect(screen.getByText('VISA •••• 4242')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revocar autorización' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Revocados/ }));
    expect(screen.getByText('…zzzz')).toBeInTheDocument();
    expect(screen.queryByText('…abcd')).not.toBeInTheDocument();
  });
});
