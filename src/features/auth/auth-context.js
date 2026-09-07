import { createContext } from 'react';
/**
 * El contexto vive en su propio módulo para que `AuthContext.tsx` exporte sólo
 * componentes y Fast Refresh siga funcionando en desarrollo.
 */
export const AuthContext = createContext(null);
