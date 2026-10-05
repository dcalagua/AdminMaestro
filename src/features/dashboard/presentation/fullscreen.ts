/**
 * Pantalla completa del modo presentación (Fullscreen API con alternativa).
 *
 * El navegador solo concede pantalla completa dentro de un gesto (clic, tecla)
 * y puede negarla (iframe, política, iOS). Si no se concede, el modo
 * presentación igual cubre toda la ventana: la alternativa es ese overlay, sin
 * menús ni barra superior. Nada aquí lanza errores.
 */

export function fullscreenSupported(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.documentElement?.requestFullscreen === 'function' &&
    document.fullscreenEnabled !== false
  );
}

export function isFullscreen(): boolean {
  return typeof document !== 'undefined' && Boolean(document.fullscreenElement);
}

/** Pide pantalla completa; true si quedó concedida. */
export async function requestFullscreen(): Promise<boolean> {
  if (!fullscreenSupported() || isFullscreen()) return isFullscreen();
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen() || typeof document.exitFullscreen !== 'function') return;
  try {
    await document.exitFullscreen();
  } catch {
    /* el navegador ya salió */
  }
}
