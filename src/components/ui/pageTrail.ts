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

/**
 * V5 · F1: una pantalla que vive como PESTAÑA de otra (Cobranza › Renovaciones,
 * Apps › Uso…) no repite el encabezado de página: `PageContainer` deja el `h1`
 * y las migas a la pantalla contenedora y pinta sólo la descripción y las
 * acciones, con el título como `h2` para lectores de pantalla.
 */
export const EmbeddedPageContext = createContext(false);

export function useEmbeddedPage(): boolean {
  return useContext(EmbeddedPageContext);
}
