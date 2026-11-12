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
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        /*
         * V5 · F0: las librerías base van a chunks propios. Cambian mucho menos
         * que la consola, así que el navegador las conserva en caché entre
         * despliegues; las pantallas ya se cargan por ruta (`App.tsx`).
         * Recharts NO entra aquí: lo pide solo el resumen ejecutivo.
         */
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (id.includes('/node_modules/@supabase/')) return 'vendor-supabase';
          if (id.includes('/node_modules/@tanstack/')) return 'vendor-query';
          if (/[\\/]node_modules[\\/](zod|react-hook-form|@hookform)[\\/]/.test(id)) return 'vendor-forms';
          if (id.includes('/node_modules/@phosphor-icons/')) return 'vendor-icons';
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    /*
     * También los módulos puros de las Edge Functions. No es un capricho de
     * organización: las traducciones a Culqi (cadencia, importes, fechas,
     * clasificación de eventos) son donde se esconden los errores caros, y
     * hasta la V2.1 no las cubría ninguna prueba. Solo se incluyen módulos SIN
     * dependencias de Deno; lo que necesita el runtime se prueba contra la API.
     */
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'supabase/functions/**/*.{test,spec}.ts',
      // Contratos publicados (FIX-ENT-v1): receptor de referencia y pin.
      'contracts/**/*.test.ts',
    ],
    coverage: { provider: 'v8', reporter: ['text', 'json-summary'] },
  },
});
