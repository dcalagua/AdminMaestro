import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { validateProviderAccount, validateSecretKey, type ProviderAccountDraft } from './providerAccountForm';

/*
 * Configuración → Cuentas de pago.
 *   · M1: la ficha guarda la llave pública (pk_) y, como opción avanzada, el
 *     NOMBRE de una variable de entorno.
 *   · §11: la llave secreta (sk_) se configura desde aquí, viaja una vez a la
 *     RPC (que la cifra en Vault), el campo se vacía y la pantalla solo vuelve a
 *     ver su pista.
 *
 * Las llaves se COMPONEN: un literal con forma de llave dispararía el escáner.
 */
const sk = (env: 'test' | 'live', body: string) => ['sk', env, body].join('_');
const SECRET = sk('test', 'Abcdef0123456789');

const m = vi.hoisted(() => ({
  upsert: vi.fn(),
  setApiBase: vi.fn(),
  clear: vi.fn(),
  setSecret: vi.fn(),
  canReadFinance: true,
  account: {} as Record<string, unknown>,
}));
const q = (data: unknown) => ({ data, error: null, isLoading: false, refetch: vi.fn() });

vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ canReadFinance: m.canReadFinance }),
}));
vi.mock('@/services/queries', () => ({
  useProviderAccountRoutes: () =>
    q([{ provider_account_id: 'acc1', code: 'culqi-pe-test', name: 'Culqi Perú (TEST)', provider_kind: 'CULQI',
         environment: 'TEST', market_code: 'PE', currencies: ['PEN', 'USD'], routing_priority: 100, status: 'ACTIVE' }]),
  useProviderAccounts: () =>
    q([{ id: 'acc1', public_key: null, secret_key_ref: null, owner_organization_id: null, rsa_public_key_ref: null,
         rsa_id_ref: null, webhook_endpoint: null, metadata: { note: 'x' }, secret_hint: null, secret_set_at: null,
         api_base_url: null, ...m.account }]),
  useMarkets: () =>
    q([{ id: 'm1', code: 'PE', name: 'Perú', countryCode: 'PE', defaultCurrency: 'PEN', allowedCurrencies: ['PEN', 'USD'] }]),
}));
vi.mock('@/services/mutations', () => ({
  useUpsertProviderAccount: () => ({ mutateAsync: m.upsert, isPending: false }),
  useSetPaymentProviderApiBase: () => ({ mutateAsync: m.setApiBase, isPending: false }),
  useClearPaymentProviderSecret: () => ({ mutateAsync: m.clear, isPending: false }),
  useSetPaymentProviderSecret: () => ({ mutateAsync: m.setSecret, isPending: false }),
}));

import { PaymentAccountsPanel } from './PaymentAccountsPanel';

const base: ProviderAccountDraft = {
  id: null, code: 'culqi-pe-test', name: 'Culqi Perú', providerKind: 'CULQI', environment: 'TEST', marketCode: 'PE',
  currencies: ['PEN'], publicKey: '', secretKeyRef: 'CULQI_SECRET_KEY', apiBaseUrl: '', routingPriority: '100',
  status: 'ACTIVE', hasEncryptedKey: false,
};

beforeEach(() => {
  for (const fn of [m.upsert, m.setApiBase, m.clear, m.setSecret]) fn.mockReset();
  m.canReadFinance = true;
  m.account = {};
});

describe('validateProviderAccount', () => {
  it('rechaza una clave secreta en la llave pública y una clave en el nombre de la variable', () => {
    expect(validateProviderAccount({ ...base, publicKey: 'sk_test_abc' }).publicKey).toMatch(/SECRETA/);
    expect(validateProviderAccount({ ...base, secretKeyRef: 'SK_LIVE_ABC' }).secretKeyRef).toMatch(/parece una clave/);
    expect(validateProviderAccount({ ...base, secretKeyRef: 'culqi_secret' }).secretKeyRef).toMatch(/MAYÚSCULAS/);
  });

  it('exige coherencia pk_test_/pk_live_ con el entorno y acepta una ficha válida', () => {
    expect(validateProviderAccount({ ...base, publicKey: 'pk_live_abc' }).publicKey).toMatch(/LIVE/);
    expect(validateProviderAccount({ ...base, publicKey: 'pk_test_abc' })).toEqual({});
  });

  it('una cuenta LIVE activa necesita llave (cifrada o variable); una nueva se crea Inactiva', () => {
    const live = { ...base, environment: 'LIVE' as const, secretKeyRef: '' };
    expect(validateProviderAccount(live).status).toMatch(/Inactiva/);
    expect(validateProviderAccount({ ...live, status: 'INACTIVE' }).status).toBeUndefined();
    expect(validateProviderAccount({ ...live, id: 'acc9', hasEncryptedKey: true }).status).toBeUndefined();
    expect(validateProviderAccount({ ...live, secretKeyRef: 'CULQI_LIVE_KEY' }).status).toBeUndefined();
  });

  it('la URL de la API es https, sin usuario ni llaves', () => {
    expect(validateProviderAccount({ ...base, apiBaseUrl: 'http://api.culqi.com/v2' }).apiBaseUrl).toMatch(/https/);
    expect(validateProviderAccount({ ...base, apiBaseUrl: 'https://u:p@api.culqi.com/v2' }).apiBaseUrl).toMatch(/https/);
    expect(validateProviderAccount({ ...base, apiBaseUrl: 'https://api.culqi.com/v2/' }).apiBaseUrl).toBeUndefined();
  });
});

describe('validateSecretKey', () => {
  it('acepta sk_test_ en TEST y rechaza llave pública, forma inválida y entorno cruzado sin repetir el valor', () => {
    expect(validateSecretKey(SECRET, 'TEST')).toBeNull();
    expect(validateSecretKey(['pk', 'test', 'Abcdef0123456789'].join('_'), 'TEST')).toMatch(/PÚBLICA/);
    expect(validateSecretKey(sk('test', 'corta'), 'TEST')).toMatch(/al menos 10/);
    expect(validateSecretKey(SECRET, 'LIVE')).toMatch(/TEST/);
    expect(validateSecretKey(sk('live', 'Abcdef0123456789'), 'TEST')).toMatch(/LIVE/);
    for (const v of [sk('test', 'corta'), SECRET]) {
      expect(validateSecretKey(v, 'LIVE') ?? '').not.toContain(v);
    }
  });
});

describe('PaymentAccountsPanel · ficha', () => {
  it('lista la cuenta con llave pública pendiente y sin llave secreta (modo de prueba)', () => {
    render(<PaymentAccountsPanel />);
    expect(screen.getByText('culqi-pe-test')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText('No configurada · modo de prueba (MOCK)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configurar llave' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
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

  it('guarda pk_, la variable avanzada y la URL de la API conservando los campos no editados', async () => {
    m.upsert.mockResolvedValue('acc1');
    m.setApiBase.mockResolvedValue({ changed: true });
    render(<PaymentAccountsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar cuenta de pago' });
    fireEvent.change(within(dialog).getByLabelText('Llave pública'), { target: { value: 'pk_test_abc' } });
    fireEvent.change(within(dialog).getByLabelText('Variable de entorno (avanzado, opcional)'), { target: { value: 'CULQI_SECRET_KEY' } });
    fireEvent.change(within(dialog).getByLabelText('URL de la API (opcional)'), { target: { value: ' https://api.culqi.com/v2/ ' } });
    fireEvent.submit(dialog);
    await waitFor(() => expect(m.setApiBase).toHaveBeenCalledTimes(1));
    expect(m.upsert.mock.calls[0]![0]).toMatchObject({
      p_id: 'acc1', p_code: 'culqi-pe-test', p_public_key: 'pk_test_abc', p_secret_key_ref: 'CULQI_SECRET_KEY',
      p_market_code: 'PE', p_currencies: ['PEN', 'USD'], p_metadata: { note: 'x' },
    });
    expect(m.setApiBase).toHaveBeenCalledWith({ p_account_id: 'acc1', p_api_base_url: 'https://api.culqi.com/v2' });
  });

  it('si la URL no cambia, no se llama a su RPC', async () => {
    m.account = { api_base_url: 'https://api.culqi.com/v2' };
    m.upsert.mockResolvedValue('acc1');
    render(<PaymentAccountsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.submit(screen.getByRole('dialog', { name: 'Editar cuenta de pago' }));
    await waitFor(() => expect(m.upsert).toHaveBeenCalledTimes(1));
    expect(m.setApiBase).not.toHaveBeenCalled();
  });
});

describe('PaymentAccountsPanel · llave secreta', () => {
  function openSecretDialog() {
    render(<PaymentAccountsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Configurar llave' }));
    const dialog = screen.getByRole('dialog', { name: 'Configurar llave secreta' });
    const input = within(dialog).getByLabelText(/Llave secreta/) as HTMLInputElement;
    return { dialog, input };
  }

  it('el campo es de contraseña, sin autocompletar, con «Mostrar»', () => {
    const { dialog, input } = openSecretDialog();
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mostrar' }));
    expect(input.type).toBe('text');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ocultar' }));
    expect(input.type).toBe('password');
  });

  it('envía la llave UNA vez, vacía el campo y nunca la pinta', async () => {
    let resolve!: (v: unknown) => void;
    m.setSecret.mockReturnValue(new Promise((r) => (resolve = r)));
    const { dialog, input } = openSecretDialog();
    fireEvent.change(input, { target: { value: SECRET } });
    fireEvent.change(within(dialog).getByLabelText('Motivo (opcional)'), { target: { value: 'alta inicial' } });
    fireEvent.submit(dialog);

    await waitFor(() => expect(m.setSecret).toHaveBeenCalledTimes(1));
    expect(m.setSecret).toHaveBeenCalledWith({ p_account_id: 'acc1', p_secret: SECRET, p_reason: 'alta inicial' });
    // Mientras la RPC responde, el campo ya está vacío.
    expect(input.value).toBe('');
    expect(document.body.innerHTML).not.toContain('Abcdef0123456789');

    resolve({ hint: 'sk_test_…6789' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Configurar llave secreta' })).not.toBeInTheDocument());
    expect(document.body.innerHTML).not.toContain('Abcdef0123456789');
  });

  it('si la base rechaza, el campo queda vacío y el error no repite la llave', async () => {
    m.setSecret.mockRejectedValue(new Error('LLAVE_NO_COINCIDE_CON_ENTORNO: la cuenta "culqi-pe-test" es TEST y la llave es de producción'));
    const { dialog, input } = openSecretDialog();
    fireEvent.change(input, { target: { value: SECRET } });
    fireEvent.submit(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/TEST/);
    expect(input.value).toBe('');
    expect(document.body.innerHTML).not.toContain('Abcdef0123456789');
  });

  it('una llave mal formada no sale del navegador y el campo se vacía', async () => {
    const { dialog, input } = openSecretDialog();
    fireEvent.change(input, { target: { value: sk('live', 'Abcdef0123456789') } });
    fireEvent.submit(dialog);
    expect(await within(dialog).findByText(/solo corresponde a una cuenta LIVE/)).toBeInTheDocument();
    expect(m.setSecret).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('con llave configurada muestra la pista, la fecha, «Reemplazar» y «Quitar» con motivo', async () => {
    m.account = { secret_hint: 'sk_test_…abcd', secret_set_at: '2026-10-05T10:00:00Z' };
    m.clear.mockResolvedValue({ cleared: true });
    render(<PaymentAccountsPanel />);
    expect(screen.getByText('Configurada')).toBeInTheDocument();
    expect(screen.getByText('(sk_test_…abcd)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reemplazar' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    const dialog = screen.getByRole('dialog', { name: 'Quitar llave secreta' });
    fireEvent.submit(dialog);
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(m.clear).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'rotación' } });
    fireEvent.submit(dialog);
    await waitFor(() => expect(m.clear).toHaveBeenCalledWith({ p_account_id: 'acc1', p_reason: 'rotación' }));
  });

  it('la variable de entorno avanzada se muestra como tal', () => {
    m.account = { secret_key_ref: 'CULQI_SECRET_KEY' };
    render(<PaymentAccountsPanel />);
    expect(screen.getByText('Variable de entorno')).toBeInTheDocument();
    expect(screen.getByText('CULQI_SECRET_KEY')).toBeInTheDocument();
  });

  it('sin rol financiero no se ofrece configurar, quitar ni editar', () => {
    m.canReadFinance = false;
    m.account = { secret_hint: 'sk_test_…abcd', secret_set_at: '2026-10-05T10:00:00Z' };
    render(<PaymentAccountsPanel />);
    expect(screen.queryByRole('button', { name: 'Configurar llave' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reemplazar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nueva cuenta' })).not.toBeInTheDocument();
  });
});
