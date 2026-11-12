import { useEffect } from 'react';

/**
 * Tema claro temporal (U-08: el usuario elige claro/oscuro; esto NO cambia su
 * preferencia guardada). Mientras `enabled`, el documento se ve en claro; al
 * terminar vuelve exactamente al modo que tenía. Si la preferencia llega o
 * cambia mientras tanto (hidratación del perfil), se recuerda para restaurarla.
 */
export function useForcedLightTheme(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const html = document.documentElement;
    let previous = html.getAttribute('data-theme');
    html.setAttribute('data-theme', 'light');
    const observer = new MutationObserver(() => {
      const now = html.getAttribute('data-theme');
      if (now === 'light') return;
      previous = now;
      html.setAttribute('data-theme', 'light');
    });
    observer.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
      if (previous === null) html.removeAttribute('data-theme');
      else html.setAttribute('data-theme', previous);
    };
  }, [enabled]);
}

/** Al imprimir (Ctrl/⌘+P o menú) el tablero sale en claro aunque se vea en oscuro. */
export function usePrintInLightTheme(): void {
  useEffect(() => {
    const html = document.documentElement;
    let previous: string | null = null;
    const before = () => {
      previous = html.getAttribute('data-theme');
      html.setAttribute('data-theme', 'light');
    };
    const after = () => {
      if (previous === null) return;
      html.setAttribute('data-theme', previous);
      previous = null;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
}
