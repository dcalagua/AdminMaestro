import '@testing-library/jest-dom/vitest';
/**
 * Variables de entorno para los tests unitarios.
 * Valores obviamente falsos: los tests no tocan una base real.
 */
Object.assign(import.meta.env, {
    VITE_SUPABASE_URL: 'http://127.0.0.1:54421',
    VITE_SUPABASE_ANON_KEY: 'test-anon-key-no-es-un-secreto',
    VITE_APP_ENV: 'LOCAL',
});
// jsdom no implementa matchMedia y varios componentes lo consultan.
if (!window.matchMedia) {
    window.matchMedia = ((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => { },
        removeListener: () => { },
        addEventListener: () => { },
        removeEventListener: () => { },
        dispatchEvent: () => false,
    }));
}
