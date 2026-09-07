import { defineConfig, devices } from '@playwright/test';
/**
 * Smoke E2E contra la app real y el Supabase local con seed cargado.
 * No hay mocks: si RLS bloquea algo, el test lo ve igual que un usuario.
 */
export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: process.env.CI ? [['github'], ['list']] : 'list',
    timeout: 45_000,
    use: {
        baseURL: 'http://127.0.0.1:5173',
        trace: 'retain-on-failure',
        locale: 'es-PE',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'npm run dev',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
});
