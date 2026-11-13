import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/*
 * V5 · F4 · Hilo de progreso del cliente en la ficha 360: contrato, factura,
 * enlace, pago y alta en cada app, calculado con lo que ya existe, y la
 * siguiente acción a un clic. Lo financiero sólo con vista financiera.
 */
const ORG = '30000000-0000-4000-a000-000000000004';
const q = (data: unknown) => ({ data, error: null, isLoading: false, refetch: vi.fn() });

const state = vi.hoisted(() => ({
  finance: true,
  invoices: { status_counts: { ISSUED: 1, DRAFT: 2 }, collected: {} } as Record<string, unknown>,
  links: [] as unknown[],
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ persona: 'EBIM' }) }));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ canReadFinance: state.finance, canManageCommercial: true }),
}));
vi.mock('@/hooks/useProvisioningAccess', () => ({
  useProvisioningAccess: () => ({ hasAnyAccess: true, canForProduct: () => true }),
}));
vi.mock('@/services/queries', () => ({ usePaymentLinks: () => q(state.links) }));
vi.mock('@/services/financeRead', () => ({ useInvoiceSummary: () => q(state.invoices) }));
vi.mock('./org360Queries', () => ({
  useOrgSubscriptions: () => q([{ subscription_id: 's-1' }]),
  useOrgTenants: () =>
    q([
      { tenant_id: 't1', name: 'Alpha EWM', status: 'ACTIVE', customer_organization_id: ORG, saas_product_id: 'p-ewm', product_short_name: 'EWM', subscription_id: 's-1' },
      { tenant_id: 't2', name: 'Alpha TMS', status: 'PENDING', customer_organization_id: ORG, saas_product_id: 'p-tms', product_short_name: 'TMS', subscription_id: null },
      { tenant_id: 't3', name: 'Ajeno', status: 'ACTIVE', customer_organization_id: 'otra', managing_organization_id: ORG, saas_product_id: 'p-tms', product_short_name: 'TMS' },
    ]),
  useOrgSaasProvisioning: () => q([{ id: 'r1', tenant_id: 't1', saas_product_id: 'p-ewm', status: 'ACTIVE', requested_at: '2026-10-01' }]),
}));
vi.mock('@/features/onboarding/AppProvisioningPanel', () => ({
  AppProvisioningPanel: ({ tenants }: { tenants: Array<{ tenantName: string }> }) => (
    <div>Panel de alta: {tenants.map((t) => t.tenantName).join(', ')}</div>
  ),
}));
vi.mock('./PaymentLinkDialog', () => ({
  GeneratePaymentLinkDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Generar enlace de pago" /> : null),
}));

import { CustomerProgress } from './CustomerProgress';

function renderCard() {
  return render(
    <MemoryRouter>
      <CustomerProgress organizationId={ORG} organizationName="Alpha" showFinance={state.finance} />
    </MemoryRouter>,
  );
}

const step = (id: string) => document.querySelector(`[data-progress-step="${id}"]`) as HTMLElement;

beforeEach(() => {
  state.finance = true;
  state.invoices = { status_counts: { ISSUED: 1, DRAFT: 2 }, collected: {} };
  state.links = [];
});

describe('CustomerProgress', () => {
  it('marca lo hecho y propone el siguiente paso: aquí, el enlace de pago', async () => {
    renderCard();
    expect(step('contrato')).toHaveAttribute('data-state', 'done');
    // Los borradores no cuentan como factura emitida.
    expect(within(step('factura')).getByText('1 factura emitida')).toBeInTheDocument();
    expect(step('enlace')).toHaveAttribute('aria-current', 'step');
    expect(within(step('alta')).getByText('1 de 2 apps activas')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generar enlace de pago' }));
    expect(screen.getByRole('dialog', { name: 'Generar enlace de pago' })).toBeInTheDocument();
  });

  it('el alta en las apps se ofrece aunque no sea el siguiente paso, sólo con los tenants propios', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Dar de alta en las apps' }));
    expect(screen.getByText('Panel de alta: Alpha EWM, Alpha TMS')).toBeInTheDocument();
  });

  it('sin vista financiera: factura, enlace y pago «no visibles», nunca «hecho»', () => {
    state.finance = false;
    renderCard();
    for (const id of ['factura', 'enlace', 'pago']) {
      expect(step(id)).toHaveAttribute('data-state', 'unknown');
    }
    expect(step('alta')).toHaveAttribute('aria-current', 'step');
  });
});
