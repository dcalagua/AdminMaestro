import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login, USERS } from '../fixtures';
import { applyAppearance, setAppearance } from '../executive/support';

/**
 * Capturas de los componentes base (fase 05 del programa V4 «visual para
 * Gerencia»): la galería `/design` en claro y oscuro con sus overlays, y
 * pantallas con formularios (diálogo con errores de validación, asistente,
 * configuración) para ver los campos nuevos en contexto.
 *
 * Igual que `capturas.spec.ts`: material de inspección humana, solo corre con
 * `VISUAL_LABEL`; el navegador habla con localhost y Google Fonts, nada más.
 */

const LABEL = process.env.VISUAL_LABEL;
const OUT = resolve(process.cwd(), 'docs/superpowers/evidence/visual-gerencia/capturas', LABEL ?? 'adhoc', 'componentes');
const ALLOWED = new Set(['127.0.0.1', 'localhost', 'fonts.googleapis.com', 'fonts.gstatic.com']);

interface Shot {
  file: string;
  route: string;
  overflow: boolean;
  alerts: string[];
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(600);
}

async function shot(page: Page, shots: Shot[], file: string, fullPage = true) {
  await page.screenshot({ path: resolve(OUT, file), fullPage });
  const info = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.textContent?.trim() ?? '').filter(Boolean),
  }));
  shots.push({ file, route: new URL(page.url()).pathname, ...info });
}

test.describe('componentes base (fase 05)', () => {
  test.skip(!LABEL, 'Definir VISUAL_LABEL=faseNN para generar las capturas');

  test('galería y formularios', async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    mkdirSync(OUT, { recursive: true });
    const shots: Shot[] = [];
    const blocked: string[] = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-PE' });
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === 'data:' || url.protocol === 'blob:' || ALLOWED.has(url.hostname)) return route.continue();
      blocked.push(url.hostname);
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    await setAppearance(page, 'light');
    await login(page, USERS.superAdmin);
    await applyAppearance(page, 'light');

    // 1) Galería en claro: página completa y overlays.
    await page.goto('/design');
    await settle(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Galería de componentes' })).toBeVisible();
    await shot(page, shots, '01-design-claro.png');
    await page.getByRole('button', { name: 'Abrir diálogo de formulario' }).click();
    await page.waitForTimeout(300);
    await shot(page, shots, '02-design-dialogo-claro.png', false);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Abrir confirmación' }).click();
    await page.waitForTimeout(300);
    await shot(page, shots, '03-design-confirmacion-claro.png', false);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Abrir panel lateral' }).click();
    await page.waitForTimeout(300);
    await shot(page, shots, '04-design-drawer-claro.png', false);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Aviso de éxito' }).click();
    await page.getByRole('button', { name: 'Aviso de error' }).click();
    await page.getByRole('button', { name: 'Aviso informativo' }).click();
    await page.waitForTimeout(300);
    await shot(page, shots, '05-design-avisos-claro.png', false);

    // 2) Galería en oscuro (vista previa local, no toca el perfil).
    await page.getByRole('tab', { name: 'Oscuro' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.waitForTimeout(300);
    await shot(page, shots, '06-design-oscuro.png');
    await page.getByRole('button', { name: 'Abrir diálogo de formulario' }).click();
    await page.waitForTimeout(300);
    await shot(page, shots, '07-design-dialogo-oscuro.png', false);
    await page.keyboard.press('Escape');

    // 3) Pantallas con formularios en claro.
    await page.goto('/organizations');
    await settle(page);
    await shot(page, shots, '08-organizaciones-listado-claro.png');
    await page.getByRole('button', { name: 'Nueva organización' }).click();
    await page.getByRole('button', { name: 'Crear organización' }).click();
    await page.waitForTimeout(400);
    await shot(page, shots, '09-organizacion-nueva-errores-claro.png', false);
    await page.keyboard.press('Escape');

    await page.goto('/products');
    await settle(page);
    await page.getByRole('button', { name: 'Nuevo producto' }).click();
    await page.waitForTimeout(400);
    await shot(page, shots, '10-producto-nuevo-claro.png', false);
    await page.keyboard.press('Escape');

    await page.goto('/onboarding');
    await settle(page);
    await shot(page, shots, '11-onboarding-claro.png');

    await page.goto('/settings');
    await settle(page);
    await shot(page, shots, '12-settings-claro.png');

    await page.goto('/tenants');
    await settle(page);
    await shot(page, shots, '13-tenants-kpis-claro.png', false);

    // 4) Un formulario en oscuro (preferencia real del perfil) y vuelta a claro.
    await applyAppearance(page, 'dark');
    await page.goto('/organizations');
    await settle(page);
    await page.getByRole('button', { name: 'Nueva organización' }).click();
    await page.getByRole('button', { name: 'Crear organización' }).click();
    await page.waitForTimeout(400);
    await shot(page, shots, '14-organizacion-nueva-errores-oscuro.png', false);
    await page.keyboard.press('Escape');
    await page.goto('/onboarding');
    await settle(page);
    await shot(page, shots, '15-onboarding-oscuro.png');
    await applyAppearance(page, 'light');

    await context.close();
    writeFileSync(
      resolve(OUT, 'index.json'),
      JSON.stringify({ label: LABEL, generatedAt: new Date().toISOString(), total: shots.length, blockedHosts: [...new Set(blocked)], shots }, null, 2),
    );
    expect([...new Set(blocked)], 'ningún host remoto inesperado').toEqual([]);
  });
});
