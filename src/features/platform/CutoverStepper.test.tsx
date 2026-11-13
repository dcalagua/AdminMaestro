import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CutoverStepper } from './CutoverStepper';

describe('CutoverStepper (V6 · T6/T7)', () => {
  it('marca la etapa actual sin depender del color y las anteriores como completadas, en lenguaje de negocio', () => {
    render(<CutoverStepper axis="entitlements" state="DUAL_READ" />);
    const steps = within(
      screen.getByRole('list', { name: 'Migración de módulos habilitados: Doble control (3 de 5)' }),
    ).getAllByRole('listitem');
    expect(steps).toHaveLength(5);
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).toHaveTextContent('La app manda (completado)');
    expect(steps[1]).toHaveTextContent('En comparación (completado)');
    expect(steps[3]).toHaveTextContent(/^Manda el Admin Maestro$/);
  });

  it('el eje de cobro tiene cuatro etapas y un estado desconocido no marca ninguna', () => {
    render(<CutoverStepper axis="billing" state="ALGO_RARO" />);
    const list = screen.getByRole('list', { name: 'Migración de cobro: Etapa fuera del recorrido' });
    const steps = within(list).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps.some((s) => s.getAttribute('aria-current') === 'step')).toBe(false);
  });

  it('solo la etapa actual lleva nombre visible (nada encimado); el resto va al tooltip', () => {
    const { container } = render(<CutoverStepper axis="billing" state="BILLING_SHADOW" />);
    const visible = [...container.querySelectorAll('p')].map((p) => p.textContent);
    expect(visible).toEqual(['Cobro', 'En comparación']);
    expect(container.querySelector('[data-stepper-bar]')!.children).toHaveLength(4);
    expect(container.querySelector('[title]')!.getAttribute('title')).toContain('3. Cobra el Admin Maestro');
    // Ninguna jerga técnica en lo visible ni en el tooltip.
    expect(container.innerHTML).not.toMatch(/Legacy|Primario|Lectura dual|Paso \d de/);
  });
});
