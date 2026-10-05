import { createContext, useContext } from 'react';
import type { Crumb } from './primitives';

/**
 * Migas «de contexto» que el shell conoce por la ruta (grupo del menú y, en una
 * ficha, el listado del que viene). `PageContainer` les añade el título de la
 * página como última miga (§5.13). Fuera del shell (login, portal) no hay migas.
 */
export const PageTrailContext = createContext<Crumb[]>([]);

export function usePageTrail(): Crumb[] {
  return useContext(PageTrailContext);
}
