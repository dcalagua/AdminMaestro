import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { navAccessFor, type NavAccess } from './navigation';

/** Perfil con el que se decide qué entradas y pestañas se ofrecen (UX; RLS decide los datos). */
export function useNavAccess(): NavAccess & { loading: boolean } {
  const { persona, roles, loading } = useAuth();
  return useMemo(() => ({ ...navAccessFor(persona, roles), loading }), [persona, roles, loading]);
}
