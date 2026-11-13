import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/*
 * V5 · F4 · «Emitir factura» en Cobranza: elegir contrato y período y reutilizar
 * la emisión del contrato (`PeriodInvoiceAction` → issue_subscription_invoice).
 * Sólo finanzas, y sólo contratos que EBIM factura en estado facturable.
 */
const q = (data: unknown) => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const m = vi.hoisted(() => ({ finance: true }));

vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ canReadFinance: m.finance }) }));
vi.mock('@/services/queries', () => ({
  useSubscriptions: () =>
    q([
      { id: 's-1', code: 'SUB-1', currency: 'PEN', status: 'ACTIVE', billing_channel: 'DIRECT', organizations: { display_name: 'Alpha' }, saas_products: { short_name: 'EWM' } },
      { id: 's-2', code: 'SUB-2', currency: 'USD', status: 'PAST_DUE', billing_channel: 'DIRECT', organizations: { display_name: 'Beta' }, saas_products: { short_name: 'TMS' } },
      { id: 's-3', code: 'SUB-3', currency: 'USD', status: 'DRAFT', billing_channel: 'DIRECT', organizations: { display_name: 'Borrador' }, saas_products: { short_name: 'TMS' } },
      { id: 's-4', code: 'SUB-4', currency: 'USD', status: 'ACTIVE', billing_channel: 'PARTNER_STATEMENT', organizations: { display_name: 'Partner' }, saas_products: { short_name: 'TMS' } },
    ]),
}));
vi.mock('./PeriodInvoiceAction', () => ({
  PeriodInvoiceAction: ({ subscriptionId, currency, onIssued }: { subscriptionId: string; currency: string; onIssued: (r: unknown) => void }) => (
    <button type="button" onClick={() => onIssued({ number: 'INV-9' })}>
      Emitir factura del período de {subscriptionId} ({currency})
    </button>
  ),
}));

import { IssueInvoiceAction } from './IssueInvoiceDialog';

function renderAction(path = '/cobranza') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IssueInvoiceAction />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  m.finance = true;
});

describe('Emitir factura', () => {
  it('lista sólo contratos facturables por EBIM y reutiliza la emisión del período', async () => {
    renderAction();
    await userEvent.click(screen.getByRole('button', { name: 'Emitir factura' }));
    const dialog = screen.getByRole('dialog', { name: 'Emitir factura' });
    const select = within(dialog).getByLabelText('Contrato');
    const labels = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['Elige el contrato…', 'Alpha · EWM · SUB-1 (PEN)', 'Beta · TMS · SUB-2 (USD)']);

    await userEvent.type(within(dialog).getByLabelText('Buscar contrato'), 'beta');
    expect(within(select).getAllByRole('option')).toHaveLength(2);
    await userEvent.selectOptions(select, 's-2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Emitir factura del período de s-2 (USD)' }));
    expect(within(dialog).getByRole('link', { name: 'Ver INV-9 en el contrato' })).toHaveAttribute('href', '/subscriptions/s-2#invoices');
  });

  it('sin finanzas no hay botón', () => {
    m.finance = false;
    renderAction();
    expect(screen.queryByRole('button', { name: 'Emitir factura' })).toBeNull();
  });

  it('⌘K «Emitir factura…» llega con ?accion=emitir-factura y abre el diálogo; cerrarlo limpia el parámetro', async () => {
    renderAction('/cobranza?accion=emitir-factura');
    const dialog = screen.getByRole('dialog', { name: 'Emitir factura' });
    await userEvent.keyboard('{Escape}');
    expect(dialog).not.toBeInTheDocument();
  });

  it('sin finanzas, ni el parámetro de ⌘K abre el diálogo', () => {
    m.finance = false;
    renderAction('/cobranza?accion=emitir-factura');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
