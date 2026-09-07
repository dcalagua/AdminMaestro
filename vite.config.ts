import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Puerto 5199 y no el 5173 por defecto: el 5173 lo ocupa de forma permanente
  // el dev server de otro proyecto de esta máquina. Con `strictPort` el arranque
  // FALLA en vez de saltar a otro puerto en silencio — que es lo que hacía que
  // Playwright «reutilizara» el servidor equivocado y todos los tests colgaran.
  // Mismo criterio que el blocker B-01 del baseline: se mueve NUESTRO puerto,
  // no se mata el servidor de otro proyecto.
  server: { port: 5199, host: '127.0.0.1', strictPort: true },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: { provider: 'v8', reporter: ['text', 'json-summary'] },
  },
});
