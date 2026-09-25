import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoles } from '@/types/domain';

/*
 * E11 · Aislamiento entre sesiones en el MISMO navegador (spec §4.1, AC06).
 *
 * Secuencia: A (superadmin) consulta; su respuesta queda pendiente; A sale; B
 * (alcance limitado) entra; la respuesta tardía de A se completa. Nada de A —
 * filas, roles ni opciones — puede aparecer en la sesión de B.
 *
 * La base (RLS) no participa aquí: se prueba la MEMORIA del cliente.
 */

type Listener = (event: string, session: unknown) => void;
const auth = vi.hoisted(() => ({
  listener: null as Listener | null,
  initial: null as unknown,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: auth.initial } }),
      onAuthStateChange: (cb: Listener) => {
        auth.listener = cb;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: () => Promise.resolve({ error: null }),
      signInWithPassword: () => Promise.resolve({ error: null }),
    },
  },
}));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const rolesFor = new Map<string, ReturnType<typeof deferred<SessionRoles>>>();
vi.mock('./session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./session')>();
  return {
    ...actual,
    loadSessionRoles: (userId: string) => {
      const d = deferred<SessionRoles>();
      rolesFor.set(userId, d);
      return d.promise;
    },
  };
});

import { AuthProvider } from './AuthContext';
import { useAuth } from '@/hooks/useAuth';
import { createAppQueryClient } from '@/app/queryClient';

const session = (id: string) => ({ user: { id, email: `${id}@ebim.test` }, access_token: `t-${id}` });
const roles = (id: string, platformRole: SessionRoles['platformRole']): SessionRoles => ({
  userId: id,
  email: `${id}@ebim.test`,
  fullName: id,
  platformRole,
  organizations: platformRole ? [] : [{ organizationId: 'org-b', role: 'PARTNER_ADMIN', displayName: 'Org B' }],
  tenantRoles: [],
  salesAgentId: null,
  provisioningRoles: [],
  ownedProductIds: [],
});

const invoiceCalls: Array<ReturnType<typeof deferred<string[]>>> = [];

/** Igual que `RequireAuth`: sin sesión no se monta ninguna pantalla con datos. */
function Probe() {
  const { session: current } = useAuth();
  return current ? <Screen /> : <span data-testid="rows">sin-sesion</span>;
}

function Screen() {
  const { roles: r, persona } = useAuth();
  const invoices = useQuery({
    queryKey: ['invoices'],
    queryFn: () => {
      const d = deferred<string[]>();
      invoiceCalls.push(d);
      return d.promise;
    },
  });
  return (
    <div>
      <span data-testid="who">{r?.email ?? 'sin-roles'}</span>
      <span data-testid="persona">{persona}</span>
      <span data-testid="rows">{invoices.data ? invoices.data.join(',') : 'cargando'}</span>
    </div>
  );
}

beforeEach(() => {
  auth.listener = null;
  auth.initial = session('userA');
  rolesFor.clear();
  invoiceCalls.length = 0;
});

describe('E11 · cambio de identidad en el mismo navegador', () => {
  it('la respuesta tardía de A no aparece en la sesión de B (roles ni filas)', async () => {
    const client = createAppQueryClient();
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    // A consulta; sus roles y su lista quedan PENDIENTES.
    await waitFor(() => expect(rolesFor.has('userA')).toBe(true));
    await waitFor(() => expect(invoiceCalls.length).toBe(1));
    const lateRolesA = rolesFor.get('userA')!;
    const lateInvoicesA = invoiceCalls[0]!;

    // A sale y B entra.
    await act(async () => {
      auth.listener?.('SIGNED_OUT', null);
      auth.listener?.('SIGNED_IN', session('userB'));
    });
    await waitFor(() => expect(rolesFor.has('userB')).toBe(true));

    // B resuelve lo suyo.
    await act(async () => {
      rolesFor.get('userB')!.resolve(roles('userB', null));
    });
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('userB@ebim.test'));
    await waitFor(() => expect(invoiceCalls.length).toBeGreaterThanOrEqual(2));
    await act(async () => {
      invoiceCalls[invoiceCalls.length - 1]!.resolve(['FAC-B-1']);
    });
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('FAC-B-1'));

    // Llegan TARDE las respuestas de A.
    await act(async () => {
      lateRolesA.resolve(roles('userA', 'EBIM_SUPER_ADMIN'));
      lateInvoicesA.resolve(['FAC-A-SECRETA']);
      await Promise.resolve();
    });

    expect(screen.getByTestId('who')).toHaveTextContent('userB@ebim.test');
    expect(screen.getByTestId('persona')).toHaveTextContent('PARTNER');
    expect(screen.getByTestId('rows')).toHaveTextContent('FAC-B-1');
    expect(screen.getByTestId('rows')).not.toHaveTextContent('FAC-A-SECRETA');
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toContain('FAC-A-SECRETA');
  });

  it('un refresco de token de la MISMA identidad no vacía la caché', async () => {
    const client = createAppQueryClient();
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(rolesFor.has('userA')).toBe(true));
    await act(async () => {
      rolesFor.get('userA')!.resolve(roles('userA', 'EBIM_SUPER_ADMIN'));
    });
    await waitFor(() => expect(invoiceCalls.length).toBe(1));
    await act(async () => {
      invoiceCalls[0]!.resolve(['FAC-A-1']);
    });
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('FAC-A-1'));

    await act(async () => {
      auth.listener?.('TOKEN_REFRESHED', { ...session('userA'), access_token: 't-refrescado' });
    });

    expect(screen.getByTestId('rows')).toHaveTextContent('FAC-A-1');
    expect(invoiceCalls.length).toBe(1);
  });
});
