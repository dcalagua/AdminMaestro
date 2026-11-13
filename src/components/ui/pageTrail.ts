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
 * y las migas a la pantalla contenedora, con el título como `h2` para lectores
 * de pantalla.
 *
 * V6 · T1 · cabecera única: la contenedora (`HubPage`) además ofrece dos
 * huecos en SU cabecera, y el `PageContainer` incrustado lleva allí con un
 * portal sus `actions` (junto al título, a la derecha) y su `description`
 * (como «¿Qué es esto?» junto al título, en lugar de un párrafo bajo las
 * pestañas). Mientras la contenedora no montó sus huecos, son `null`.
 */
export interface EmbeddedSlots {
  /** Hueco de acciones de la cabecera de la contenedora. */
  actions: HTMLElement | null;
  /** Hueco del «¿Qué es esto?» junto al `h1` de la contenedora. */
  hint: HTMLElement | null;
}

export const EmbeddedPageContext = createContext<EmbeddedSlots | null>(null);

/** ¿Este `PageContainer` es una pestaña de otra pantalla? */
export function useEmbeddedPage(): boolean {
  return useContext(EmbeddedPageContext) !== null;
}

/** Huecos de la cabecera de la contenedora (o `null` fuera de un hub). */
export function useEmbeddedSlots(): EmbeddedSlots | null {
  return useContext(EmbeddedPageContext);
}
