import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { CreatedSale } from '../useOnboardingWizard';

/*
 * V5 · F4 · Pasos después de crear el contrato: primera factura (la misma
 * acción del contrato), enlace de pago (el mismo diálogo del portal) y alta en
 * cada app contratada. Cada uno explica por qué no aplica cuando no aplica.
 */
const q = (data: unknown) => ({ data, error: null, isLoading: false, refetch: vi.fn() });

const m = vi.hoisted(() => ({ finance: true }));

vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ canReadFinance: m.finance }) }));
vi.mock('@/services/queries', () => ({
  useTenantOverview: () =>
    q([
      { tenant_id: 'tn-1', name: 'Alpha EWM', customer_organization_id: 'o-1', subscription_id: 's-1', status: 'PENDING', saas_product_id: 'p-ewm', product_short_name: 'EWM' },
      { tenant_id: 'tn-2', name: 'Alpha TMS', customer_organization_id: 'o-1', subscription_id: 's-2', status: 'ACTIVE', saas_product_id: 'p-tms', product_short_name: 'TMS' },
      { tenant_id: 'tn-3', name: 'Alpha demo', customer_organization_id: 'o-1', subscription_id: null, status: 'ACTIVE', saas_product_id: 'p-x', product_short_name: 'X' },
      { tenant_id: 'tn-4', name: 'Alpha baja', customer_organization_id: 'o-1', subscription_id: 's-4', status: 'CHURNED', saas_product_id: 'p-y', product_short_name: 'Y' },
      { tenant_id: 'tn-5', name: 'Otra cuenta', customer_organization_id: 'o-2', subscription_id: 's-5', status: 'ACTIVE', saas_product_id: 'p-tms', product_short_name: 'TMS' },
    ]),
}));
vi.mock('@/features/billing/PeriodInvoiceAction', () => ({
  PeriodInvoiceAction: ({ subscriptionId, currency, onIssued }: { subscriptionId: string; currency: string; onIssued: (r: unknown) => void }) => (
    <button type="button" onClick={() => onIssued({ number: 'INV-1' })}>
      Emitir factura de {subscriptionId} en {currency}
    </button>
  ),
}));
vi.mock('@/features/organizations/PaymentLinkDialog', () => ({
  GeneratePaymentLinkDialog: ({ open, onCreated, reasonHint }: { open: boolean; onCreated: () => void; reasonHint: string }) =>
    open ? (
      <div role="dialog" aria-label="Generar enlace de pago">
        {reasonHint}
        <button type="button" onClick={onCreated}>Generar</button>
      </div>
    ) : null,
}));
vi.mock('../AppProvisioningPanel', () => ({
  AppProvisioningPanel: ({ tenants }: { tenants: Array<{ tenantName: string }> }) => <div>Altas: {tenants.map((t) => t.tenantName).join(', ')}</div>,
}));

import { AppsStep, FirstInvoiceStep, PaymentLinkStep } from './AfterSaleSteps';

const SALE: CreatedSale = {
  tenantId: 'tn-1', tenantName: 'Alpha EWM', organizationId: 'o-1', organizationName: 'Alpha', billingEmail: 'p@alpha.pe',
  productId: 'p-ewm', productName: 'EWM', productCode: 'ewm', subscriptionId: 's-1', billingChannel: 'DIRECT',
  currency: 'PEN', activated: true,
};

const r = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  m.finance = true;
});

describe('primera factura', () => {
  it('reutiliza la emisión del período y confirma la factura', async () => {
    r(<FirstInvoiceStep created={SALE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Emitir factura de s-1 en PEN' }));
    expect(screen.getByText('Factura INV-1 lista. Sigue con el enlace de pago.')).toBeInTheDocument();
  });

  it.each([
    [{ subscriptionId: null }, /Sin contrato recurrente/],
    [{ billingChannel: 'PARTNER_STATEMENT' }, /lo factura el partner/],
    [{ activated: false }, /quedó en borrador/],
  ])('explica por qué no aplica (%o)', (patch, text) => {
    r(<FirstInvoiceStep created={{ ...SALE, ...patch }} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Emitir factura/ })).toBeNull();
  });

  it('sin finanzas queda pendiente, sin botón', () => {
    m.finance = false;
    r(<FirstInvoiceStep created={SALE} />);
    expect(screen.getByText(/Emitir la factura es de finanzas/)).toBeInTheDocument();
  });
});

describe('enlace de pago', () => {
  it('abre el diálogo del portal con el motivo sugerido', async () => {
    r(<PaymentLinkStep created={SALE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Generar enlace de pago' }));
    expect(screen.getByRole('dialog', { name: 'Generar enlace de pago' })).toHaveTextContent('Alta de Alpha EWM');
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
    expect(screen.getByText('Enlace generado para Alpha.')).toBeInTheDocument();
  });

  it('sin finanzas no se ofrece', () => {
    m.finance = false;
    r(<PaymentLinkStep created={SALE} />);
    expect(screen.queryByRole('button', { name: 'Generar enlace de pago' })).toBeNull();
  });
});

describe('alta en las apps', () => {
  it('venta: la app vendida primero y las demás apps contratadas y vivas de la cuenta', () => {
    r(<AppsStep created={SALE} onlyThisTenant={false} />);
    expect(screen.getByText('Altas: Alpha EWM, Alpha TMS')).toBeInTheDocument();
  });

  it('«Nuevo tenant»: sólo esa app', () => {
    r(<AppsStep created={SALE} onlyThisTenant />);
    expect(screen.getByText('Altas: Alpha EWM')).toBeInTheDocument();
  });
});
