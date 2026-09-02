import { createContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { SessionRoles } from '@/types/domain';
import type { PersonaKind } from './session';

export interface AuthContextValue {
  session: Session | null;
  roles: SessionRoles | null;
  persona: PersonaKind;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
}

/**
 * El contexto vive en su propio módulo para que `AuthContext.tsx` exporte sólo
 * componentes y Fast Refresh siga funcionando en desarrollo.
 */
export const AuthContext = createContext<AuthContextValue | null>(null);
