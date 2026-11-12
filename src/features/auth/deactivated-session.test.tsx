import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

/*
 * M5 · Una cuenta DESACTIVADA (profiles.is_active = false) no obtiene persona
 * aunque conserve un JWT vigente: la consola cierra la sesión y el login
 * muestra el motivo. La base ya apagó sus membresías en cascada; esto es UX.
 */

const sb = vi.hoisted(() => ({
  signOut: vi.fn(() => Promise.resolve({ error: null })),
  profile: { full_name: 'Nora Nueva', is_active: false } as { full_name: string; is_active: boolean } | null,
}));

/** Cadena mínima de PostgREST: select/eq devuelven la misma consulta; await o maybeSingle resuelven. */
function chain(table: string) {
  const result =
    table === 'profiles'
      ? { data: sb.profile, error: null }
      : table === 'platform_admins' || table === 'sales_agents'
        ? { data: null, error: null }
        : { data: table === 'organization_memberships'
            ? [{ organization_id: 'o1', role: 'PARTNER_ADMIN', organizations: { display_name: 'Andina' } }]
            : [], error: null };
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.maybeSingle = () => Promise.resolve(result);
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return q;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => chain(table),
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: 'u1', email: 'nora@ebim.test' }, access_token: 't' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: sb.signOut,
      signInWithPassword: () => Promise.resolve({ error: null }),
    },
  },
}));

import { AuthProvider } from './AuthContext';
import { loadSessionRoles, resolvePersona, DEACTIVATED_ACCOUNT_NOTICE } from './session';
import { useAuth } from '@/hooks/useAuth';
import { createAppQueryClient } from '@/app/queryClient';

function Probe() {
  const { persona, notice, loading } = useAuth();
  if (loading) return <span>cargando</span>;
  return (
    <>
      <span data-testid="persona">{persona}</span>
      <span data-testid="notice">{notice ?? ''}</span>
    </>
  );
}

describe('cuenta desactivada', () => {
  it('loadSessionRoles marca el perfil inactivo y resolvePersona no le da persona', async () => {
    sb.profile = { full_name: 'Nora Nueva', is_active: false };
    const roles = await loadSessionRoles('u1', 'nora@ebim.test');
    expect(roles.isActive).toBe(false);
    // Aunque la lectura aún devolviera una membresía, sin perfil activo no hay persona.
    expect(roles.organizations).toHaveLength(1);
    expect(resolvePersona(roles)).toBe('UNKNOWN');

    sb.profile = { full_name: 'Nora Nueva', is_active: true };
    const active = await loadSessionRoles('u1', 'nora@ebim.test');
    expect(active.isActive).toBe(true);
    expect(resolvePersona(active)).toBe('PARTNER');
  });

  it('el proveedor de sesión cierra la sesión y deja el aviso para el login', async () => {
    sb.profile = { full_name: 'Nora Nueva', is_active: false };
    sb.signOut.mockClear();
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(sb.signOut).toHaveBeenCalled());
    expect(screen.getByTestId('persona')).toHaveTextContent('UNKNOWN');
    expect(screen.getByTestId('notice')).toHaveTextContent(DEACTIVATED_ACCOUNT_NOTICE);
  });
});
