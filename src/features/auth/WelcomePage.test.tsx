import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/*
 * M5 · /bienvenida: recoge la sesión del enlace (invitación o restablecimiento),
 * borra los tokens de la URL, pide una contraseña válida, marca aceptada la
 * invitación y entra. Un enlace vencido se explica sin tecnicismos.
 */
const m = vi.hoisted(() => ({
  setSession: vi.fn(),
  getSession: vi.fn(),
  updateUser: vi.fn(),
  rpc: vi.fn(),
  refreshRoles: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: m.setSession,
      getSession: m.getSession,
      updateUser: m.updateUser,
      verifyOtp: vi.fn(),
      exchangeCodeForSession: vi.fn(),
    },
    rpc: m.rpc,
  },
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ session: { user: { email: 'nora@ebim.test' } }, refreshRoles: m.refreshRoles }),
}));
vi.mock('@/components/ui/EbimMark', () => ({ EbimMark: () => null }));

import { WelcomePage } from './WelcomePage';
import { passwordProblem } from './welcomeSession';

function renderAt(url: string) {
  window.history.replaceState(null, '', url);
  return render(
    <MemoryRouter initialEntries={['/bienvenida']}>
      <Routes>
        <Route path="/bienvenida" element={<WelcomePage />} />
        <Route path="/" element={<p>Consola</p>} />
        <Route path="/login" element={<p>Ingreso</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.setSession.mockResolvedValue({ error: null });
  m.getSession.mockResolvedValue({ data: { session: null } });
  m.updateUser.mockResolvedValue({ error: null });
  m.rpc.mockResolvedValue({ data: 1, error: null });
  m.refreshRoles.mockResolvedValue(undefined);
});

describe('WelcomePage', () => {
  it('toma la sesión de la invitación, limpia la URL y fija la contraseña', async () => {
    renderAt('/bienvenida#access_token=at-1&refresh_token=rt-1&type=invite&expires_in=3600');
    expect(await screen.findByRole('heading', { name: 'Te damos la bienvenida' })).toBeInTheDocument();
    expect(m.setSession).toHaveBeenCalledWith({ access_token: 'at-1', refresh_token: 'rt-1' });
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('at-1');

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'corta' } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'corta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña y entrar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Usa al menos 8 caracteres.');
    expect(m.updateUser).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'Segura2026' } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'Segura2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña y entrar' }));
    await waitFor(() => expect(m.updateUser).toHaveBeenCalledWith({ password: 'Segura2026' }));
    expect(m.rpc).toHaveBeenCalledWith('accept_my_invitations', {});
    expect(await screen.findByText('Consola')).toBeInTheDocument();
  });

  it('el restablecimiento muestra «Crea una nueva contraseña» y conserva ?mode=reset', async () => {
    renderAt('/bienvenida?mode=reset#access_token=at-2&refresh_token=rt-2&type=recovery');
    expect(await screen.findByRole('heading', { name: 'Crea una nueva contraseña' })).toBeInTheDocument();
    expect(window.location.search).toBe('?mode=reset');
    expect(window.location.hash).toBe('');
  });

  it('un enlace vencido se explica y ofrece volver al ingreso', async () => {
    renderAt('/bienvenida#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid');
    expect(await screen.findByRole('alert')).toHaveTextContent(/no es válido o ya venció/);
    expect(screen.getByRole('link', { name: 'Ir al ingreso' })).toHaveAttribute('href', '/login');
    expect(m.setSession).not.toHaveBeenCalled();
  });

  it('sin enlace ni sesión pide abrir el enlace recibido', async () => {
    renderAt('/bienvenida');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Abre esta página desde el enlace/);
  });

  it('regla de contraseña: largo, letras y números, coincidencia', () => {
    expect(passwordProblem('abcdefgh', 'abcdefgh')).toBe('Combina letras y números.');
    expect(passwordProblem('abcd1234', 'abcd1235')).toBe('Las contraseñas no coinciden.');
    expect(passwordProblem('abcd1234', 'abcd1234')).toBeNull();
  });
});
