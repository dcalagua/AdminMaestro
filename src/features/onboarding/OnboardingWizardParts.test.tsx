import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ContractSummary, WizardStepper } from './OnboardingWizardParts';
import { flowFor } from './flowModel';

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
  const { steps, phases } = flowFor('SALE');

  it('muestra el hilo de seis fases, el progreso y solo deja volver atrás', () => {
    const onBack = vi.fn();
    render(<WizardStepper steps={steps} phases={phases} step={3} onBack={onBack} />);
    // Un solo sistema de pasos: el contador cuenta las seis fases del hilo y
    // nombra la pantalla dentro de la fase, sin un segundo contador.
    const nav = screen.getByRole('navigation', { name: 'Pasos del alta' });
    expect(nav).toHaveTextContent('Paso 2 de 6 · Plan y precio · Plan y precio regional');
    expect(nav).not.toHaveTextContent(/de 8/);
    const bar = screen.getByRole('progressbar', { name: 'Progreso del alta' });
    expect(bar).toHaveAttribute('aria-valuenow', '20');
    expect(bar).toHaveAttribute('aria-valuetext', 'Paso 2 de 6');
    const labels = screen.getAllByRole('button').map((b) => b.textContent?.replace(/^\d+/, '').replace(/^(Completado|Paso actual|Pendiente):\s*/, '').trim());
    expect(labels).toEqual(['Cuenta', 'Plan y precio', 'Contrato', 'Primera factura', 'Enlace de pago', 'Alta en las apps']);
    const current = screen.getByRole('button', { name: /Paso actual: Plan y precio/ });
    expect(current).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: /Completado: Cuenta/ }));
    expect(onBack).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: /Pendiente: Alta en las apps/ })).toBeDisabled();
  });

  it('la segunda pantalla de una fase avanza la barra sin cambiar el número de paso', () => {
    render(<WizardStepper steps={steps} phases={phases} step={4} onBack={vi.fn()} />);
    expect(screen.getByRole('navigation', { name: 'Pasos del alta' })).toHaveTextContent('Paso 2 de 6 · Plan y precio · Implementación y comercial');
    expect(screen.getByRole('progressbar', { name: 'Progreso del alta' })).toHaveAttribute('aria-valuenow', '30');
  });

  it('después de crear el contrato no se puede volver por detrás de lo creado', () => {
    const onBack = vi.fn();
    render(<WizardStepper steps={steps} phases={phases} step={7} minStep={6} onBack={onBack} />);
    expect(screen.getByRole('navigation', { name: 'Pasos del alta' })).toHaveTextContent('Paso 5 de 6 · Enlace de pago');
    expect(screen.getByRole('button', { name: /Completado: Contrato/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Completado: Cuenta/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Completado: Primera factura/ }));
    expect(onBack).toHaveBeenCalledWith(6);
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
