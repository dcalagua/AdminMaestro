import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompactStepper } from './Stepper';

const STEPS = [
  { id: 'a', label: 'Uno' },
  { id: 'b', label: 'Dos' },
  { id: 'c', label: 'Tres' },
];

describe('CompactStepper (V6 · T6)', () => {
  it('una barra por etapa; visible solo la actual y, si se pide, su posición', () => {
    const { container } = render(<CompactStepper label="Avance" steps={STEPS} current="b" showPosition heading="Eje" />);
    const bar = container.querySelector('[data-stepper-bar]')!;
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect([...bar.children].map((c) => c.className.match(/bg-[a-z-]+/)?.[0])).toEqual([
      'bg-accent',
      'bg-accent-deep',
      'bg-border',
    ]);
    expect(screen.getByText('Dos')).toBeInTheDocument();
    expect(screen.getByText('2 de 3')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Avance: Dos (2 de 3)' })).toBeInTheDocument();
  });
});
