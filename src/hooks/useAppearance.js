import { useCallback, useEffect, useState } from 'react';
const MODE_KEY = 'ebim-cp-color-mode';
const DENSITY_KEY = 'ebim-cp-density';
function readStored(key, fallback, allowed) {
    try {
        const raw = localStorage.getItem(key);
        return raw && allowed.includes(raw) ? raw : fallback;
    }
    catch {
        // Modo privado o cookies bloqueadas: se cae al default sin romper la app.
        return fallback;
    }
}
export function useAppearance() {
    const [mode, setModeState] = useState(() => readStored(MODE_KEY, 'light', ['light', 'dark']));
    const [density, setDensityState] = useState(() => readStored(DENSITY_KEY, 'equilibrada', ['comoda', 'equilibrada', 'compacta']));
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', mode);
        try {
            localStorage.setItem(MODE_KEY, mode);
        }
        catch {
            /* almacenamiento no disponible: la preferencia dura la sesión */
        }
    }, [mode]);
    useEffect(() => {
        document.documentElement.setAttribute('data-density', density);
        try {
            localStorage.setItem(DENSITY_KEY, density);
        }
        catch {
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
