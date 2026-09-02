import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { loadSessionRoles, resolvePersona } from './session';
import { AuthContext } from './auth-context';
import type { AuthContextValue } from './auth-context';
import type { SessionRoles } from '@/types/domain';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<SessionRoles | null>(null);
  const [loading, setLoading] = useState(true);

  const hydrateRoles = useCallback(async (next: Session | null) => {
    if (!next?.user?.email) {
      setRoles(null);
      return;
    }
    setRoles(await loadSessionRoles(next.user.id, next.user.email));
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return;
        setSession(data.session);
        await hydrateRoles(data.session);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // No se hace await dentro del callback: Supabase advierte contra ejecutar
      // llamadas asíncronas al cliente dentro de onAuthStateChange (deadlock).
      void hydrateRoles(next);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [hydrateRoles]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Mensaje en español (regla de suite) y sin filtrar si el correo existe.
      throw new Error(
        error.message === 'Invalid login credentials'
          ? 'Credenciales incorrectas. Verifica tu correo y contraseña.'
          : `No se pudo iniciar sesión: ${error.message}`,
      );
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setRoles(null);
  }, []);

  const refreshRoles = useCallback(async () => {
    await hydrateRoles(session);
  }, [hydrateRoles, session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      roles,
      persona: resolvePersona(roles),
      loading,
      signIn,
      signOut,
      refreshRoles,
    }),
    [session, roles, loading, signIn, signOut, refreshRoles],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
