import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { setSessionScope } from '@/app/queryClient';
import { loadSessionRoles, resolvePersona } from './session';
import { AuthContext } from './auth-context';
import type { AuthContextValue } from './auth-context';
import type { SessionRoles } from '@/types/domain';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<SessionRoles | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  // Identidad vigente. Una hidratación de roles que termina cuando la identidad
  // ya cambió (A salió, B entró) se descarta: nunca pinta roles de A en B (E11).
  const identityRef = useRef<string | null>(null);

  /**
   * Adopta la identidad de `next`. Si cambia (A→B, A→sin sesión), la caché de
   * consultas se cancela y se vacía ANTES de re-renderizar; un refresco de token
   * de la misma identidad no toca nada.
   */
  const adoptIdentity = useCallback(
    (next: Session | null) => {
      const userId = next?.user?.id ?? null;
      if (userId !== identityRef.current) {
        identityRef.current = userId;
        setRoles(null);
      }
      setSessionScope(queryClient, userId);
    },
    [queryClient],
  );

  const hydrateRoles = useCallback(async (next: Session | null) => {
    if (!next?.user?.email) {
      setRoles(null);
      return;
    }
    const requestedFor = next.user.id;
    const loaded = await loadSessionRoles(next.user.id, next.user.email);
    if (identityRef.current === requestedFor) setRoles(loaded);
  }, []);

  useEffect(() => {
    let active = true;
    // Si un evento de Auth llega antes que getSession(), manda el evento: la
    // sesión leída al arrancar ya podría ser de una identidad anterior.
    let sawAuthEvent = false;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active || sawAuthEvent) return;
        adoptIdentity(data.session);
        setSession(data.session);
        await hydrateRoles(data.session);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      sawAuthEvent = true;
      adoptIdentity(next);
      setSession(next);
      // No se hace await dentro del callback: Supabase advierte contra ejecutar
      // llamadas asíncronas al cliente dentro de onAuthStateChange (deadlock).
      void hydrateRoles(next);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [hydrateRoles, adoptIdentity]);

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
    // Por si el evento SIGNED_OUT tarda: la memoria de la sesión se descarta ya.
    adoptIdentity(null);
    setSession(null);
  }, [adoptIdentity]);

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
