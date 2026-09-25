import { defineConfig, devices } from '@playwright/test';

/**
 * Suite de la mejora «experiencia ejecutiva». Separada de `playwright.config.ts`
 * a propósito:
 *  - puerto 5209 propio: NUNCA reutiliza el 5199 del checkout principal;
 *  - apunta al Supabase local dedicado de la corrida (`VITE_SUPABASE_URL` de
 *    `.env.local`), no a QAS;
 *  - cada spec bloquea cualquier host que no sea 127.0.0.1/localhost
 *    (ver `e2e/executive/support.ts`), así que una captura no puede llamar a un
 *    proveedor remoto aunque la pantalla lo intentara.
 */
export default defineConfig({
  testDir: './e2e/executive',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 90_000,
  outputDir: './test-results/executive',
  use: {
    baseURL: 'http://127.0.0.1:5209',
    trace: 'off',
    locale: 'es-PE',
    timezoneId: 'America/Lima',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --port 5209 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5209',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
