import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CutoverStepper } from './CutoverStepper';

describe('CutoverStepper', () => {
  it('marca el paso actual sin depender del color y los anteriores como completados', () => {
    render(<CutoverStepper axis="entitlements" state="DUAL_READ" />);
    const steps = within(screen.getByRole('list', { name: 'Migración de módulos habilitados: Lectura dual' })).getAllByRole('listitem');
    expect(steps).toHaveLength(5);
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).toHaveTextContent('Legacy (completado)');
    expect(steps[1]).toHaveTextContent('Comparación (completado)');
    expect(steps[3]).toHaveTextContent(/^Primario$/);
  });

  it('el eje de facturación tiene sus cuatro pasos y un estado desconocido no marca ninguno', () => {
    render(<CutoverStepper axis="billing" state="ALGO_RARO" />);
    const list = screen.getByRole('list', { name: /Migración de facturación: ALGO_RARO/ });
    const steps = within(list).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps.some((s) => s.getAttribute('aria-current') === 'step')).toBe(false);
  });

  it('V5 · F7: cada paso tiene su nombre visible (no solo un círculo) y la posición en texto', () => {
    const { container } = render(<CutoverStepper axis="billing" state="BILLING_SHADOW" />);
    const list = screen.getByRole('list', { name: 'Migración de facturación: Comparación' });
    const steps = within(list).getAllByRole('listitem');
    // Texto visible (fuera de sr-only) en cada paso.
    expect(steps.map((s) => [...s.querySelectorAll('span')].find((e) => e.className.includes('text-center'))?.firstChild?.textContent)).toEqual([
      'Legacy', 'Comparación', 'Primario', 'Retirado',
    ]);
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[1]).toHaveTextContent('Comparación (actual)');
    expect(container).toHaveTextContent('Paso 2 de 4');
    // Los círculos son decoración: no duplican el texto para el lector.
    for (const s of steps) expect(s.querySelector('[aria-hidden]')).not.toBeNull();
  });
});
