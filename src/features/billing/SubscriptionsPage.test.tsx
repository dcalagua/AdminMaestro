import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/*
 * V6 · F3 · Contratos: franja que filtra, fila densa (plan, código en segunda
 * línea, cliente, tenant o nivel partner, recurrente, renovación y cobro).
 */
const q = (data: unknown) => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const soon = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);

vi.mock('@/services/queries', () => ({
  useSubscriptions: () =>
    q([
      {
        id: 's-1', code: 'SUB-ALPHA', status: 'ACTIVE', started_on: '2026-01-21', tenant_id: 't-1', billed_organization_id: 'o-1',
        channel_margin_rate: null, plans: { name: 'eSupplier Shared Standard' }, saas_products: { short_name: 'eSupplier' },
        organizations: { display_name: 'Alpha' }, tenants: { name: 'Alpha eSupplier', deployment_mode: 'SHARED' },
        subscription_items: [
          { amount: 1200, currency: 'USD', billing_interval: 'MONTHLY' },
          { amount: 3500, currency: 'USD', billing_interval: 'ONE_TIME' },
        ],
      },
      {
        id: 's-2', code: 'SUB-BASE', status: 'DRAFT', started_on: '2026-05-21', tenant_id: null, billed_organization_id: 'o-2',
        channel_margin_rate: 0.25, plans: { name: 'eSupplier Partner Base' }, saas_products: { short_name: 'eSupplier' },
        organizations: { display_name: 'Consultora Andina' }, tenants: null,
        subscription_items: [{ amount: 3100, currency: 'PEN', billing_interval: 'MONTHLY' }],
      },
    ]),
  useSubscriptionCollection: () =>
    q([{ subscription_id: 's-1', collection_method: 'CULQI_CARD', profile_missing: false }]),
}));
vi.mock('@/services/financeRead', () => ({
  useRenewalPipeline: () => q([{ subscription_id: 's-1', renewal_on: soon, days_to_renewal: 8 }]),
}));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ canManageCommercial: true }) }));
vi.mock('./SubscriptionDialogs', () => ({
  SubscriptionFormDialog: () => null,
  SubscriptionStatusDialog: () => null,
  SubscriptionItemDialog: () => null,
}));

import { SubscriptionsPage } from './SubscriptionsPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <SubscriptionsPage />
    </MemoryRouter>,
  );

describe('Contratos', () => {
  it('fila densa: plan como título, código en la segunda línea, recurrente compacto, renovación y cobro', () => {
    renderPage();
    const row = document.querySelector('[data-contract="SUB-ALPHA"]') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'eSupplier Shared Standard' })).toHaveAttribute('href', '/subscriptions/s-1');
    expect(row).toHaveTextContent('SUB-ALPHA');
    expect(row).toHaveTextContent('USD 1.2 K');
    expect(row).toHaveTextContent('único');
    expect(row).toHaveTextContent('en 8 días');
    expect(row).toHaveTextContent('Tarjeta (Culqi)');
    const base = document.querySelector('[data-contract="SUB-BASE"]') as HTMLElement;
    expect(base).toHaveTextContent('Nivel partner');
    expect(base).toHaveTextContent('Sin perfil');
    expect(base).toHaveTextContent('margen del canal');
  });

  it('la franja resume y filtra: renuevan pronto y borradores', async () => {
    renderPage();
    const strip = screen.getByRole('region', { name: 'Resumen de contratos' });
    // El recurrente vivo solo cuenta contratos activos o con pago atrasado.
    expect(within(strip).getByText('USD')).toBeInTheDocument();
    expect(within(strip).queryByText('PEN')).toBeNull();
    await userEvent.click(within(strip).getByRole('button', { name: /^Renuevan en 30 días/ }));
    expect(document.querySelector('[data-contract="SUB-BASE"]')).toBeNull();
    expect(screen.getByRole('tab', { name: /Renuevan pronto/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(within(strip).getByRole('button', { name: /^Borradores/ }));
    expect(document.querySelector('[data-contract="SUB-ALPHA"]')).toBeNull();
    expect(document.querySelector('[data-contract="SUB-BASE"]')).not.toBeNull();
  });
});
