import { useCallback, useEffect, useState } from 'react';

/**
 * Apariencia por usuario — contrato §4.4.
 *
 * El usuario elige SÓLO modo y densidad. El color/accent NUNCA es elegible:
 * lo fija la marca (enmienda 2026-08-11, esupplier-021). Por eso este hook no
 * expone ningún selector de paleta.
 *
 * Persistencia: `localStorage` para evitar el flash al cargar. La copia
 * cross-device vive en `profiles.settings.appearance`.
 */
export type ColorMode = 'light' | 'dark';
export type Density = 'comoda' | 'equilibrada' | 'compacta';

const MODE_KEY = 'ebim-cp-color-mode';
const DENSITY_KEY = 'ebim-cp-density';

function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const raw = localStorage.getItem(key);
    return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  } catch {
    // Modo privado o cookies bloqueadas: se cae al default sin romper la app.
    return fallback;
  }
}

export function useAppearance() {
  const [mode, setModeState] = useState<ColorMode>(() =>
    readStored<ColorMode>(MODE_KEY, 'light', ['light', 'dark']),
  );
  const [density, setDensityState] = useState<Density>(() =>
    readStored<Density>(DENSITY_KEY, 'equilibrada', ['comoda', 'equilibrada', 'compacta']),
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* almacenamiento no disponible: la preferencia dura la sesión */
    }
  }, [mode]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
    try {
      localStorage.setItem(DENSITY_KEY, density);
    } catch {
      /* idem */
    }
  }, [density]);

  const toggleMode = useCallback(() => {
    setModeState((current) => (current === 'light' ? 'dark' : 'light'));
  }, []);

  return {
    mode,
    density,
    setMode: setModeState,
    setDensity: setDensityState,
    toggleMode,
  };
}
