import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ToastProvider } from '@/components/ui/Toast';
import { DesignGalleryPage } from './DesignGalleryPage';

const setMode = vi.fn();
vi.mock('@/hooks/useAppearance', () => ({
  useAppearance: () => ({ mode: 'light', density: 'equilibrada', setMode, setDensity: vi.fn() }),
}));

function renderGallery() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <DesignGalleryPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Galería de componentes (/design)', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('data-density', 'equilibrada');
    window.location.hash = '';
  });

  it('muestra cada familia de componentes', () => {
    renderGallery();
    expect(screen.getByRole('heading', { level: 1, name: 'Galería de componentes' })).toBeInTheDocument();
    for (const name of ['Tipografía', 'Botones', 'Campos de formulario', 'Badges', 'KPI', 'Tarjeta y tabla', 'Pestañas de sección', 'Estados', 'Diálogos, panel lateral y avisos']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    // Estados de campo: error anunciado y control marcado.
    expect(screen.getByLabelText('Código')).toHaveAttribute('aria-invalid', 'true');
    // El error técnico de PostgREST sale en español (A01).
    expect(screen.getByText(/relación ambigua/)).toBeInTheDocument();
  });

  it('la vista previa de modo cambia el documento sin guardar la preferencia y se restaura al salir', async () => {
    const user = userEvent.setup();
    const { unmount } = renderGallery();
    await user.click(screen.getByRole('tab', { name: 'Oscuro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await user.click(screen.getByRole('tab', { name: 'Compacta' }));
    expect(document.documentElement.getAttribute('data-density')).toBe('compacta');
    expect(setMode).not.toHaveBeenCalled();
    unmount();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-density')).toBe('equilibrada');
  });

  it('abre el diálogo de formulario con su error de negocio traducido', async () => {
    const user = userEvent.setup();
    renderGallery();
    await user.click(screen.getByRole('button', { name: 'Abrir diálogo de formulario' }));
    const dialog = screen.getByRole('dialog', { name: 'Nuevo cliente' });
    expect(dialog).toHaveTextContent('Ya existe un registro con ese valor único.');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
