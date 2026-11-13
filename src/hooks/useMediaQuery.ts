import { useCallback, useSyncExternalStore } from 'react';

/**
 * V5 · F7 · Suscripción a una media query (`matchMedia`). Sin `matchMedia`
 * (SSR, entornos de prueba antiguos) devuelve `false`: la consola cae en su
 * diseño de escritorio, que es el de siempre.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
      }
      mql.addListener?.(onChange);
      return () => mql.removeListener?.(onChange);
    },
    [query],
  );
  const snapshot = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? Boolean(window.matchMedia(query)?.matches) : false;
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Por debajo de `sm` (640 px): móvil «de consulta». */
export const MOBILE_QUERY = '(max-width: 639.98px)';
/** De `md` a `lg` (768–1023 px): tableta, menú lateral en modo iconos. */
export const TABLET_QUERY = '(min-width: 768px) and (max-width: 1023.98px)';

export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);
export const useIsTablet = () => useMediaQuery(TABLET_QUERY);
