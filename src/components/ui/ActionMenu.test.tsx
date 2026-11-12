import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ActionMenu } from './ActionMenu';

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderMenu(items: Parameters<typeof ActionMenu>[0]['items'], variant?: 'row' | 'page') {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <ActionMenu label="Acciones de INV-1" items={items} variant={variant} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ActionMenu', () => {
  it('abre un menú con foco en el primer ítem; las destructivas van al final tras un separador', () => {
    const onEdit = vi.fn();
    renderMenu([
      { label: 'Anular', tone: 'danger', onSelect: vi.fn() },
      { label: 'Editar', onSelect: onEdit },
      null,
      false,
    ]);
    const button = screen.getByRole('button', { name: 'Acciones de INV-1' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Acciones de INV-1' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Editar', 'Anular']);
    expect(within(menu).getByRole('separator')).toBeInTheDocument();
    expect(items[0]).toHaveFocus();
    expect(items[1]).toHaveClass('text-danger');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus();
    fireEvent.click(items[0]!);
    expect(onEdit).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('Escape cierra y devuelve el foco; un ítem con ruta navega', () => {
    renderMenu([{ label: 'Ver detalle', to: '/billing' }]);
    const button = screen.getByRole('button', { name: 'Acciones de INV-1' });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ver detalle' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/billing');
  });

  it('sin ítems visibles no pinta nada; la variante de página muestra su texto', () => {
    const { container, unmount } = renderMenu([null, false]);
    expect(container.querySelector('button')).toBeNull();
    unmount();
    renderMenu([{ label: 'Ejecutar suspensiones…', tone: 'danger', onSelect: vi.fn() }], 'page');
    expect(screen.getByRole('button', { name: 'Acciones de INV-1' })).toHaveTextContent('Más acciones');
  });
});
