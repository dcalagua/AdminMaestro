import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { validateProviderAccount, type ProviderAccountDraft } from './providerAccountForm';

/*
 * M1 · Configuración → Cuentas de pago: la clave secreta nunca se escribe en el
 * navegador. Solo la llave pública (pk_) y el NOMBRE del secret del servidor.
 */
const m = vi.hoisted(() => ({ upsert: vi.fn() }));
const q = (data: unknown) => ({ data, error: null, isLoading: false, refetch: vi.fn() });

vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/services/queries', () => ({
  useProviderAccountRoutes: () =>
    q([{ provider_account_id: 'acc1', code: 'culqi-pe-test', name: 'Culqi Perú (TEST)', provider_kind: 'CULQI',
         environment: 'TEST', market_code: 'PE', currencies: ['PEN', 'USD'], routing_priority: 100, status: 'ACTIVE' }]),
  useProviderAccounts: () =>
    q([{ id: 'acc1', public_key: null, secret_key_ref: null, owner_organization_id: null, rsa_public_key_ref: null,
         rsa_id_ref: null, webhook_endpoint: null, metadata: { note: 'x' } }]),
  useMarkets: () =>
    q([{ id: 'm1', code: 'PE', name: 'Perú', countryCode: 'PE', defaultCurrency: 'PEN', allowedCurrencies: ['PEN', 'USD'] }]),
}));
vi.mock('@/services/mutations', () => ({
  useUpsertProviderAccount: () => ({ mutateAsync: m.upsert, isPending: false }),
}));

import { PaymentAccountsPanel } from './PaymentAccountsPanel';

const base: ProviderAccountDraft = {
  id: null, code: 'culqi-pe-test', name: 'Culqi Perú', providerKind: 'CULQI', environment: 'TEST', marketCode: 'PE',
  currencies: ['PEN'], publicKey: '', secretKeyRef: 'CULQI_SECRET_KEY', routingPriority: '100', status: 'ACTIVE',
};

beforeEach(() => m.upsert.mockReset());

describe('validateProviderAccount', () => {
  it('rechaza una clave secreta en la llave pública y una clave en el nombre del secret', () => {
    expect(validateProviderAccount({ ...base, publicKey: 'sk_test_abc' }).publicKey).toMatch(/SECRETA/);
    expect(validateProviderAccount({ ...base, secretKeyRef: 'SK_LIVE_ABC' }).secretKeyRef).toMatch(/parece una clave/);
    expect(validateProviderAccount({ ...base, secretKeyRef: 'culqi_secret' }).secretKeyRef).toMatch(/MAYÚSCULAS/);
  });

  it('exige coherencia pk_test_/pk_live_ con el entorno y acepta una ficha válida', () => {
    expect(validateProviderAccount({ ...base, publicKey: 'pk_live_abc' }).publicKey).toMatch(/LIVE/);
    expect(validateProviderAccount({ ...base, publicKey: 'pk_test_abc' })).toEqual({});
  });
});

describe('PaymentAccountsPanel', () => {
  it('lista la cuenta con llave pendiente y sin referencia de secreto', () => {
    render(<PaymentAccountsPanel />);
    expect(screen.getByText('culqi-pe-test')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText('sin referencia')).toBeInTheDocument();
  });

  it('una sk_ pegada en la llave pública NO llega a la base', async () => {
    render(<PaymentAccountsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar cuenta de pago' });
    fireEvent.change(within(dialog).getByLabelText('Llave pública'), { target: { value: 'sk_test_abc' } });
    fireEvent.submit(dialog);
    expect(await within(dialog).findByText(/clave SECRETA/)).toBeInTheDocument();
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it('guarda pk_ y el NOMBRE del secret conservando los campos no editados', async () => {
    m.upsert.mockResolvedValue('acc1');
    render(<PaymentAccountsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar cuenta de pago' });
    fireEvent.change(within(dialog).getByLabelText('Llave pública'), { target: { value: 'pk_test_abc' } });
    fireEvent.change(within(dialog).getByLabelText('Nombre del secret del servidor'), { target: { value: 'CULQI_SECRET_KEY' } });
    fireEvent.submit(dialog);
    await waitFor(() => expect(m.upsert).toHaveBeenCalledTimes(1));
    expect(m.upsert.mock.calls[0]![0]).toMatchObject({
      p_id: 'acc1', p_code: 'culqi-pe-test', p_public_key: 'pk_test_abc', p_secret_key_ref: 'CULQI_SECRET_KEY',
      p_market_code: 'PE', p_currencies: ['PEN', 'USD'], p_metadata: { note: 'x' },
    });
  });
});
