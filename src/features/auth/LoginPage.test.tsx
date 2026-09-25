import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
 * P01 · Sin anclas vacías: no existe flujo de restablecimiento ni de solicitud,
 * así que la consola lo explica con honestidad sin simular un proceso.
 */

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signIn: vi.fn() }) }));
vi.mock('@/hooks/useAppearance', () => ({ useAppearance: () => ({ mode: 'light', toggleMode: vi.fn() }) }));
vi.mock('@/components/ui/EbimMark', () => ({ EbimMark: () => null }));

import { LoginPage } from './LoginPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  it('no contiene anclas #recuperar ni #solicitar', () => {
    const { container } = renderPage();
    expect(container.querySelector('a[href="#recuperar"]')).toBeNull();
    expect(container.querySelector('a[href="#solicitar"]')).toBeNull();
  });

  it('mantiene un único enlace secundario de acceso que abre la explicación', () => {
    renderPage();
    const links = screen.getAllByRole('link', { name: /Solicítalo al equipo/ });
    expect(links).toHaveLength(1);
    fireEvent.click(links[0]!);
    expect(links[0]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('note')).toHaveTextContent(/equipo de plataforma EBIM \(operador\)/);
    expect(screen.getByRole('note')).toHaveTextContent(/no permite auto-registro/);
  });

  it('«¿Olvidaste tu contraseña?» explica que no hay restablecimiento automático', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));
    expect(screen.getByRole('note')).toHaveTextContent(/no tiene restablecimiento automático/);
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('los campos conservan sus etiquetas', () => {
    renderPage();
    expect(screen.getByLabelText('Correo corporativo')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
  });
});
