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
// La emisión real (`usePeriodInvoice` → issue_subscription_invoice) se prueba en PeriodInvoiceAction.
const issued = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('./periodInvoice', () => ({
  usePeriodInvoice: ({ subscriptionId, onIssued }: { subscriptionId?: string; onIssued?: (r: unknown) => void }) => ({
    disabled: !subscriptionId,
    pending: false,
    issue: async () => {
      issued.calls.push(subscriptionId ?? '');
      onIssued?.({ number: 'INV-9' });
    },
  }),
}));
vi.mock('./PeriodInvoiceAction', () => ({
  PeriodInvoiceFields: () => <p>Período de facturación</p>,
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
  it('lista sólo contratos facturables por EBIM en un único buscador y emite desde el pie', async () => {
    issued.calls = [];
    renderAction();
    await userEvent.click(screen.getByRole('button', { name: 'Emitir factura' }));
    const dialog = screen.getByRole('dialog', { name: 'Emitir factura' });
    // V6: la acción primaria va a la derecha, desactivada hasta elegir; cerrar es secundario.
    const primary = within(dialog).getByRole('button', { name: 'Emitir factura' });
    expect(primary).toHaveClass('ebim-btn-primary');
    expect(primary).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveClass('ebim-btn-secondary');
    expect(within(dialog).queryByRole('combobox', { name: 'Buscar contrato' })).toBeNull();

    const combo = within(dialog).getByRole('combobox', { name: 'Contrato' });
    await userEvent.click(combo);
    const list = within(dialog).getByRole('listbox');
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Alpha · EWMSUB-1 · PEN',
      'Beta · TMSSUB-2 · USD',
    ]);
    await userEvent.type(combo, 'beta');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    await userEvent.keyboard('{Enter}');
    expect(combo).toHaveValue('Beta · TMS · SUB-2');
    expect(within(dialog).getByText('Período de facturación')).toBeInTheDocument();

    const ready = within(dialog).getByRole('button', { name: 'Emitir factura (USD)' });
    expect(ready).toBeEnabled();
    await userEvent.click(ready);
    expect(issued.calls).toEqual(['s-2']);
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
