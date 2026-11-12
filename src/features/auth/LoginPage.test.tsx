import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
 * P01 · Sin anclas vacías. La solicitud de acceso se explica (no hay formulario);
 * M5 · «¿Olvidaste tu contraseña?» envía el enlace de restablecimiento al correo
 * del titular, con la misma respuesta exista o no la cuenta.
 */

const m = vi.hoisted(() => ({ reset: vi.fn(), notice: null as string | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signIn: vi.fn(), notice: m.notice }) }));
vi.mock('./passwordReset', () => ({ requestPasswordReset: m.reset }));
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

  it('«¿Olvidaste tu contraseña?» pide el correo antes de enviar el enlace', () => {
    m.reset.mockReset();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));
    expect(screen.getByRole('note')).toHaveTextContent(/enlace a tu correo corporativo/);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de restablecimiento' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Escribe arriba tu correo/);
    expect(m.reset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('envía el enlace y responde igual exista o no la cuenta', async () => {
    m.reset.mockReset();
    m.reset.mockResolvedValue(undefined);
    renderPage();
    fireEvent.change(screen.getByLabelText('Correo corporativo'), { target: { value: 'ana@andina.ebim.test' } });
    fireEvent.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de restablecimiento' }));
    await waitFor(() => expect(m.reset).toHaveBeenCalledWith('ana@andina.ebim.test'));
    expect(await screen.findByText(/Si ana@andina.ebim.test tiene una cuenta/)).toBeInTheDocument();
  });

  it('muestra el aviso de cuenta desactivada tras un cierre forzado', () => {
    m.notice = 'Tu cuenta está desactivada.';
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Tu cuenta está desactivada.');
    m.notice = null;
  });

  it('los campos conservan sus etiquetas', () => {
    renderPage();
    expect(screen.getByLabelText('Correo corporativo')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
  });

  it('anatomía U-04: título, wordmark «Admin Maestro», EXACTAMENTE 3 bullets y un solo enlace secundario', () => {
    const { container } = renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Ingresa a tu consola' })).toBeInTheDocument();
    expect(container.textContent).toContain('Consola central de la suite EBIM');
    expect(container.querySelectorAll('ul > li')).toHaveLength(3);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Ingresar' })).toHaveClass('w-full');
    expect(container.textContent).not.toContain('Control Plane');
  });

  it('el ojo muestra y oculta la contraseña', () => {
    renderPage();
    const input = screen.getByLabelText('Contraseña');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toHaveAttribute('aria-pressed', 'true');
  });
});
