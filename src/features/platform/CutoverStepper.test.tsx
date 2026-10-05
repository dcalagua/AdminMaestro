import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CutoverStepper } from './CutoverStepper';

describe('CutoverStepper', () => {
  it('marca el paso actual sin depender del color y los anteriores como completados', () => {
    render(<CutoverStepper axis="entitlements" state="DUAL_READ" />);
    const steps = within(screen.getByRole('list', { name: 'Cutover de entitlements: Lectura dual' })).getAllByRole('listitem');
    expect(steps).toHaveLength(5);
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).toHaveTextContent('Legacy (completado)');
    expect(steps[1]).toHaveTextContent('Shadow (completado)');
    expect(steps[3]).toHaveTextContent(/^Primario$/);
  });

  it('el eje de facturación tiene sus cuatro pasos y un estado desconocido no marca ninguno', () => {
    render(<CutoverStepper axis="billing" state="ALGO_RARO" />);
    const list = screen.getByRole('list', { name: /Cutover de facturación: ALGO_RARO/ });
    const steps = within(list).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps.some((s) => s.getAttribute('aria-current') === 'step')).toBe(false);
  });
});
