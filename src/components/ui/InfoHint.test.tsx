import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InfoHint } from './InfoHint';

describe('InfoHint (V6 · T1)', () => {
  it('el texto queda plegado tras el icono y se anuncia como descripción del botón', () => {
    render(<InfoHint label="Qué es el MRR" title="MRR">Suma por moneda.</InfoHint>);
    const button = screen.getByRole('button', { name: 'Qué es el MRR' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAccessibleDescription('MRR Suma por moneda.');
    expect(screen.getByRole('note', { hidden: true })).not.toBeVisible();
  });

  it('clic abre; Escape cierra y devuelve el foco; un clic fuera también cierra', () => {
    render(
      <>
        <InfoHint label="Ayuda">Texto.</InfoHint>
        <button type="button">fuera</button>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Ayuda' });
    fireEvent.click(button);
    expect(screen.getByRole('note')).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('note', { hidden: true })).not.toBeVisible();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'fuera' }));
    expect(screen.getByRole('note', { hidden: true })).not.toBeVisible();
  });
});
