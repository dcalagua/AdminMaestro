import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

/*
 * E10 · Apariencia compartida (spec P30, AC01/AC06).
 * Una sola fuente para Shell y Configuración, por usuario, sin datos
 * financieros, y resistente a un storage no disponible.
 */

const authState = vi.hoisted(() => ({ userId: null as string | null }));
const remote = vi.hoisted(() => ({
  settings: new Map<string, Record<string, unknown>>(),
  updates: [] as Array<{ id: string; settings: Record<string, unknown> }>,
  failWrites: false,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ session: authState.userId ? { user: { id: authState.userId } } : null }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: () => Promise.resolve({ data: { settings: remote.settings.get(id) ?? { appearance: { mode: 'light', density: 'equilibrada' } } }, error: null }),
        }),
      }),
      update: (values: { settings: Record<string, unknown> }) => ({
        eq: (_col: string, id: string) => {
          if (remote.failWrites) return Promise.resolve({ error: { message: 'offline' } });
          remote.updates.push({ id, settings: values.settings });
          remote.settings.set(id, values.settings);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  },
}));

import { AppearanceProvider } from './AppearanceProvider';
import { useAppearance } from '@/hooks/useAppearance';

function ShellProbe() {
  const { mode, density, toggleMode } = useAppearance();
  return (
    <div>
      <span data-testid="shell-mode">{mode}</span>
      <span data-testid="shell-density">{density}</span>
      <button type="button" onClick={toggleMode}>shell-toggle</button>
    </div>
  );
}

function SettingsProbe() {
  const { setMode, setDensity, persistence } = useAppearance();
  return (
    <div>
      <button type="button" onClick={() => setMode('dark')}>settings-dark</button>
      <button type="button" onClick={() => setDensity('compacta')}>settings-compacta</button>
      <span data-testid="persistence">{persistence}</span>
      <label>
        Campo
        <input aria-label="Campo de prueba" />
      </label>
    </div>
  );
}

function Harness({ children }: { children?: ReactNode }) {
  return (
    <AppearanceProvider>
      <ShellProbe />
      <SettingsProbe />
      {children}
    </AppearanceProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  authState.userId = null;
  remote.settings.clear();
  remote.updates.length = 0;
  remote.failWrites = false;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-density');
});

describe('Apariencia compartida', () => {
  it('cambiar el modo desde Configuración actualiza el Shell y el documento', async () => {
    authState.userId = 'u1';
    render(<Harness />);
    fireEvent.click(screen.getByText('settings-dark'));
    expect(screen.getByTestId('shell-mode')).toHaveTextContent('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('cambiar la densidad conserva los controles y actualiza data-density', () => {
    authState.userId = 'u1';
    render(<Harness />);
    fireEvent.click(screen.getByText('settings-compacta'));
    expect(screen.getByTestId('shell-density')).toHaveTextContent('compacta');
    expect(document.documentElement.getAttribute('data-density')).toBe('compacta');
    expect(screen.getByLabelText('Campo de prueba')).toBeInTheDocument();
    expect(screen.getByText('settings-dark')).toBeInTheDocument();
  });

  it('dos usuarios del mismo navegador no comparten preferencias', async () => {
    authState.userId = 'userA';
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByText('settings-dark'));
    expect(screen.getByTestId('shell-mode')).toHaveTextContent('dark');

    // Otro usuario con preferencia propia guardada en el perfil (clara).
    remote.settings.set('userB', { appearance: { mode: 'light', density: 'comoda', updated_at: '2026-09-01T00:00:00Z' } });
    authState.userId = 'userB';
    rerender(<Harness />);
    await waitFor(() => expect(screen.getByTestId('shell-mode')).toHaveTextContent('light'));
    expect(screen.getByTestId('shell-density')).toHaveTextContent('comoda');
    expect(localStorage.getItem('ebim-cp-color-mode:userA')).toBe('dark');
  });

  it('migra la preferencia histórica local sin perderla y la sube al perfil', async () => {
    localStorage.setItem('ebim-cp-color-mode', 'dark');
    localStorage.setItem('ebim-cp-density', 'comoda');
    authState.userId = 'legacy';
    render(<Harness />);
    expect(screen.getByTestId('shell-mode')).toHaveTextContent('dark');
    await waitFor(() => expect(remote.updates.length).toBeGreaterThan(0));
    const saved = remote.updates.at(-1)!.settings.appearance as Record<string, unknown>;
    expect(saved).toMatchObject({ mode: 'dark', density: 'comoda' });
    expect(Object.keys(saved).sort()).toEqual(['density', 'mode', 'updated_at']);
    expect(localStorage.getItem('ebim-cp-color-mode:legacy')).toBe('dark');
  });

  it('declara la persistencia real: sin perfil escribible queda sólo en el navegador', async () => {
    authState.userId = 'u1';
    remote.failWrites = true;
    render(<Harness />);
    fireEvent.click(screen.getByText('settings-dark'));
    await waitFor(() => expect(screen.getByTestId('persistence')).toHaveTextContent('BROWSER_ONLY'));
  });

  it('storage no disponible no rompe el renderizado', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    render(<Harness />);
    expect(screen.getByTestId('shell-mode')).toHaveTextContent('light');
    act(() => {
      fireEvent.click(screen.getByText('shell-toggle'));
    });
    expect(screen.getByTestId('shell-mode')).toHaveTextContent('dark');
    get.mockRestore();
    set.mockRestore();
  });
});
