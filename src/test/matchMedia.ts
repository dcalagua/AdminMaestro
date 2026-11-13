import { MOBILE_QUERY, TABLET_QUERY } from '@/hooks/useMediaQuery';

/**
 * V5 · F7 · Simula el ancho de pantalla en jsdom: `matchMedia` responde `true`
 * a las media queries del tamaño pedido. Devuelve la función que restaura el mock global.
 */
export function mockViewport(size: 'mobile' | 'tablet' | 'desktop'): () => void {
  const original = window.matchMedia;
  const matches = (query: string) =>
    (size === 'mobile' && query === MOBILE_QUERY) || (size === 'tablet' && query === TABLET_QUERY);
  window.matchMedia = ((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
