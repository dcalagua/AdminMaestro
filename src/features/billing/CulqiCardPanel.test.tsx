import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
 * M1 · Corrección de CulqiCardPanel: las credenciales salen de la cuenta
 * RESUELTA del perfil vigente, no de una suscripción del proveedor previa.
 */
const state = vi.hoisted(() => ({
  profile: null as unknown,
  providerSubs: [] as unknown[],
  auths: [] as unknown[],
}));
const q = (data: unknown) => ({ data, error: null, isLoading: false, refetch: vi.fn() });

vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ canReadFinance: true }) }));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/services/queries', () => ({
  useCurrentCollectionProfile: () => q(state.profile),
  useProviderSubscription: () => q(state.providerSubs),
  useCardOnFileAuthorizations: () => q(state.auths),
}));
vi.mock('@/services/mutations', () => ({
  useRevokeCardOnFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { CulqiCardPanel } from './CulqiCardPanel';

const account = (publicKey: string | null) => ({
  code: 'culqi-pe-test', environment: 'TEST', public_key: publicKey, secret_key_ref: 'CULQI_SECRET_KEY', status: 'ACTIVE',
});

function renderPanel(method = 'CULQI_CARD') {
  return render(
    <MemoryRouter>
      <CulqiCardPanel
        subscriptionId="s1"
        organizationId="o1"
        collectionMethod={method}
        providerAccountCode="culqi-pe-test"
        providerEnvironment="TEST"
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.profile = null;
  state.providerSubs = [];
  state.auths = [];
});

describe('CulqiCardPanel', () => {
  it('con llave pública en la cuenta resuelta NO muestra «pendiente», aunque no haya suscripción del proveedor', () => {
    state.profile = { recurring_mode: 'PROVIDER_SUBSCRIPTION', payment_method_id: null, payment_provider_accounts: account('pk_test_abc') };
    renderPanel();
    expect(screen.queryByText('Culqi pendiente de configurar')).not.toBeInTheDocument();
    expect(screen.getByText('Suscripción del proveedor')).toBeInTheDocument();
    expect(screen.getByText(/Sin método de pago registrado/)).toBeInTheDocument();
  });

  it('sin llave pública en la cuenta resuelta avisa que opera en MOCK', () => {
    state.profile = { recurring_mode: 'PROVIDER_SUBSCRIPTION', payment_method_id: null, payment_provider_accounts: account(null) };
    renderPanel();
    expect(screen.getByText('Culqi pendiente de configurar')).toBeInTheDocument();
  });

  it('muestra la tarjeta guardada, la autorización y el modo CARD_ON_FILE', () => {
    state.profile = { recurring_mode: 'CARD_ON_FILE', payment_method_id: 'pm1', payment_provider_accounts: account('pk_test_abc') };
    state.auths = [{ id: 'a1', brand: 'VISA', last4: '4242', accepted_at: '2026-10-01T00:00:00Z', terms_version: 'CARD_ON_FILE_V1',
                     is_active: true, external_payment_method_id: 'crd_mock_1' }];
    renderPanel();
    expect(screen.getByText('Tarjeta guardada · cobro por factura')).toBeInTheDocument();
    expect(screen.getByText('VISA •••• 4242')).toBeInTheDocument();
    expect(screen.getByText('Vigente')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revocar autorización' })).toBeInTheDocument();
  });

  it('no se pinta para métodos que no son tarjeta', () => {
    const { container } = renderPanel('BANK_TRANSFER');
    expect(container).toBeEmptyDOMElement();
  });
});
