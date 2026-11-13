import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/queries', () => ({
  useSubscriptionBillingStatus: () => ({
    isLoading: false,
    error: null,
    data: { existing_invoice: { number: 'F-1' }, has_due_items: false, next_billing_period: '2026-12-01', estimated_total: 0, currency: 'USD' },
  }),
}));

import { ContractSummaryBar } from './ContractSummaryBar';

const base = {
  subscriptionId: 's-1',
  status: { label: 'Activa', tone: 'ok' as const },
  monthly: { USD: 1200 },
  oneTime: {},
  interval: 'Mensual',
  method: { label: 'Tarjeta (Culqi)', auto: true, cardOnFile: false },
  document: { required: false, label: 'Ninguno', tone: 'warn' as const, validTo: null },
};

const item = (label: string) => document.querySelector(`[data-summary-item="${label}"]`) as HTMLElement;

describe('ContractSummaryBar', () => {
  it('texto compacto en la barra y plurales reales', () => {
    render(
      <ContractSummaryBar
        {...base}
        showMoney
        balance={{ amounts: { USD: 1200 }, open: 1, overdue: 1, partnerStatement: false }}
      />,
    );
    expect(screen.getByRole('region', { name: 'Resumen del contrato' })).toHaveAttribute('data-summary-bar');
    expect(item('Saldo por cobrar').querySelector('[data-balance-detail]')).toHaveTextContent('1 vencida');
    expect(item('Saldo por cobrar')).not.toHaveTextContent('(s)');
    expect(item('Próxima factura')).toHaveTextContent('01/12/2026');
    expect(within(item('Método de cobro')).getByText(/Tarjeta \(Culqi\)/)).toBeInTheDocument();
    expect(item('Documento vigente')).toHaveTextContent('No aplica');
  });

  it('sin vista financiera no hay saldo ni próxima factura', () => {
    render(<ContractSummaryBar {...base} showMoney={false} balance={{ amounts: {}, open: 0, overdue: 0, partnerStatement: false }} />);
    expect(item('Saldo por cobrar')).toBeNull();
    expect(item('Próxima factura')).toBeNull();
    expect(item('Recurrente / mes')).toHaveTextContent(/USD/);
  });
});
