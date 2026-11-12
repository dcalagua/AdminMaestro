import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/*
 * M5 · Configuración → «Mi perfil»: los datos propios van por
 * `admin_update_profile` (auditado) y el cambio de contraseña verifica antes
 * la contraseña actual.
 */
const USER = '10000000-0000-4000-a000-00000000000b';
const m = vi.hoisted(() => ({
  update: vi.fn(),
  signIn: vi.fn(),
  updateUser: vi.fn(),
  refreshRoles: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ roles: { userId: USER, email: 'user@alpha.ebim.test' }, refreshRoles: m.refreshRoles }),
}));
// Objeto estable entre renders, como lo entrega React Query.
const profileQuery = vi.hoisted(() => ({
  data: { id: '10000000-0000-4000-a000-00000000000b', email: 'user@alpha.ebim.test', full_name: 'Ale Alpha',
          phone: null, job_title: 'Analista' },
  isLoading: false, error: null, refetch: () => undefined,
}));
vi.mock('@/services/queries', () => ({ useMyProfile: () => profileQuery }));
vi.mock('@/services/mutations', () => ({
  useAdminUpdateProfile: () => ({ mutateAsync: m.update, isPending: false, error: null }),
}));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: m.toastSuccess, error: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: m.signIn, updateUser: m.updateUser } },
}));

import { MyProfilePanel } from './MyProfilePanel';

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.update.mockResolvedValue(USER);
  m.refreshRoles.mockResolvedValue(undefined);
  m.signIn.mockResolvedValue({ error: null });
  m.updateUser.mockResolvedValue({ error: null });
});

describe('MyProfilePanel', () => {
  it('guarda nombre, teléfono y cargo propios con admin_update_profile', async () => {
    render(<MyProfilePanel />);
    const form = screen.getByRole('form', { name: 'Mis datos' });
    expect(within(form).getByLabelText('Correo')).toBeDisabled();
    fireEvent.change(within(form).getByLabelText(/Nombre completo/), { target: { value: 'Ale Alpha Ruiz' } });
    fireEvent.change(within(form).getByLabelText('Teléfono'), { target: { value: '+51 999 888 777' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({
        p_user_id: USER, p_full_name: 'Ale Alpha Ruiz', p_phone: '+51 999 888 777', p_job_title: 'Analista',
      }),
    );
    expect(m.refreshRoles).toHaveBeenCalled();
    expect(m.toastSuccess).toHaveBeenCalledWith('Perfil actualizado', 'Ale Alpha Ruiz');
  });

  it('cambia la contraseña solo tras verificar la actual', async () => {
    render(<MyProfilePanel />);
    const form = screen.getByRole('form', { name: 'Cambiar contraseña' });
    fireEvent.change(within(form).getByLabelText('Contraseña actual'), { target: { value: 'mala' } });
    fireEvent.change(within(form).getByLabelText('Nueva contraseña'), { target: { value: 'Nueva2026x' } });
    fireEvent.change(within(form).getByLabelText('Repite la nueva contraseña'), { target: { value: 'Nueva2026x' } });

    m.signIn.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('La contraseña actual no es correcta.');
    expect(m.updateUser).not.toHaveBeenCalled();

    fireEvent.click(within(form).getByRole('button', { name: 'Cambiar contraseña' }));
    await waitFor(() => expect(m.updateUser).toHaveBeenCalledWith({ password: 'Nueva2026x' }));
    expect(m.signIn).toHaveBeenLastCalledWith({ email: 'user@alpha.ebim.test', password: 'mala' });
    expect(m.toastSuccess).toHaveBeenCalledWith('Contraseña actualizada', 'Úsala en tu próximo ingreso.');
  });

  it('valida la nueva contraseña antes de llamar a Auth', () => {
    render(<MyProfilePanel />);
    const form = screen.getByRole('form', { name: 'Cambiar contraseña' });
    fireEvent.change(within(form).getByLabelText('Contraseña actual'), { target: { value: 'actual' } });
    fireEvent.change(within(form).getByLabelText('Nueva contraseña'), { target: { value: 'abc' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Cambiar contraseña' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Usa al menos 8 caracteres.');
    expect(m.signIn).not.toHaveBeenCalled();
  });
});
