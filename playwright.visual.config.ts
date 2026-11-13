import { defineConfig, devices } from '@playwright/test';

/**
 * V6 · F5 · Guarda visual (texto encimado y truncado) contra una URL YA servida:
 * no levanta servidor ni necesita el stack local (Docker). Por defecto, el
 * `vite preview` del puerto 5199.
 *
 *   BASE_URL=http://127.0.0.1:5199 GUARD_EMAIL=… GUARD_PASSWORD=… \
 *     npx playwright test -c playwright.visual.config.ts
 */
export default defineConfig({
  testDir: './e2e/visual',
  testMatch: 'solapes.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60 * 60_000,
  outputDir: './test-results/visual-guard',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:5199',
    locale: 'es-PE',
    colorScheme: 'light',
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
