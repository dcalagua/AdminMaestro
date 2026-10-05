import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ContractSummary, WizardStepper } from './OnboardingWizardParts';

const BASE = {
  currency: 'USD',
  channelText: 'Venta directa EBIM',
  quantity: 1,
  license: null,
  licenseIsListed: true,
  isDemo: false,
  implementationFee: null,
  infrastructureFee: null,
  supportFee: null,
  regionalPriceMissing: false,
};

describe('WizardStepper', () => {
  it('muestra el progreso, marca el paso actual y solo deja volver atrás', () => {
    const onBack = vi.fn();
    render(<WizardStepper step={3} onBack={onBack} />);
    expect(screen.getByText('Paso 3 de 5')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Progreso del alta' })).toHaveAttribute('aria-valuenow', '50');
    const current = screen.getByRole('button', { name: /Paso actual: Plan y precio regional/ });
    expect(current).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: /Completado: Cliente, mercado y producto/ }));
    expect(onBack).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: /Pendiente: Resumen/ })).toBeDisabled();
  });
});

describe('ContractSummary', () => {
  it('total = licencia × cantidad; la implementación va aparte y nunca se suma', () => {
    render(
      <ContractSummary
        {...BASE}
        customerName="Empresa Directa Alpha"
        planName="eSupplier Business"
        intervalText="Mensual"
        quantity={2}
        license={850}
        implementationFee={1500}
      />,
    );
    const aside = screen.getByRole('complementary', { name: 'Resumen del contrato' });
    expect(aside.textContent).toContain('1,700.00');
    expect(aside.textContent).not.toContain('3,200.00');
    expect(aside.textContent).toMatch(/USD\s?1,500\.00 · única/);
    expect(aside.textContent).toContain('Licencia · mensual');
  });

  it('DEMO y falta de tarifa se explican, sin un 0 que parezca precio', () => {
    const { rerender } = render(<ContractSummary {...BASE} isDemo />);
    expect(screen.getByText('Sin recurrente')).toBeInTheDocument();
    rerender(<ContractSummary {...BASE} regionalPriceMissing />);
    expect(screen.getByText('Falta tarifa regional')).toBeInTheDocument();
    expect(screen.queryByText(/0\.00/)).toBeNull();
  });
});
