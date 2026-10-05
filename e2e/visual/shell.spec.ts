import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login, logout, USERS } from '../fixtures';
import { applyAppearance, setAppearance } from '../executive/support';

/**
 * Capturas del shell (fase 06 del programa V4 «visual para Gerencia»): sidebar
 * de marca expandido y en iconos, topbar, paleta ⌘K, menú de cuenta, menú móvil
 * y el encabezado de página unificado en cuatro pantallas.
 *
 * Igual que `capturas.spec.ts`: material de inspección humana, solo corre con
 * `VISUAL_LABEL`; el navegador habla con localhost y Google Fonts, nada más.
 * Además comprueba en navegador real el foco al `h1` tras navegar.
 */

const LABEL = process.env.VISUAL_LABEL;
const OUT = resolve(process.cwd(), 'docs/superpowers/evidence/visual-gerencia/capturas', LABEL ?? 'adhoc', 'shell');
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
  await page
    .locator('[aria-busy="true"]')
    .first()
    .waitFor({ state: 'detached', timeout: 15_000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(600);
}

/** Cambia el tema en Configuración y espera a que el perfil lo guarde (manda al recargar). */
async function theme(page: Page, mode: 'light' | 'dark') {
  const saved = page
    .waitForResponse((r) => r.url().includes('/rest/v1/profiles') && r.request().method() === 'PATCH', { timeout: 8_000 })
    .catch(() => undefined);
  await applyAppearance(page, mode);
  await saved;
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
}

async function shot(page: Page, shots: Shot[], file: string, fullPage = true) {
  await page.screenshot({ path: resolve(OUT, file), fullPage });
  const info = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.textContent?.trim() ?? '').filter(Boolean),
  }));
  shots.push({ file, route: new URL(page.url()).pathname, ...info });
}

test.describe('shell y navegación (fase 06)', () => {
  test.skip(!LABEL, 'Definir VISUAL_LABEL=faseNN para generar las capturas');

  test('sidebar, topbar, ⌘K y encabezados', async ({ browser }) => {
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
    await page.evaluate(() => localStorage.removeItem('ebim-cp-sidebar-rail'));

    // 1) Cuatro pantallas con el shell nuevo (página completa: el sidebar debe continuar).
    await page.goto('/');
    await settle(page);
    await shot(page, shots, '01-resumen-ejecutivo-claro.png');

    // Navegar desde el menú: el foco queda en el h1 de la página nueva.
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link', { name: 'Facturación y cobros' })
      .click();
    await settle(page);
    await expect(page.locator('h1').first()).toBeFocused();
    await shot(page, shots, '02-facturacion-claro.png');

    await page.goto('/tenants');
    await settle(page);
    await page.locator('main table a[href^="/tenants/"]').first().click();
    await settle(page);
    await expect(page.getByRole('navigation', { name: 'Migas de pan' }).getByRole('link', { name: 'Tenants' })).toBeVisible();
    await shot(page, shots, '03-tenant-360-claro.png');

    await page.goto('/settings');
    await settle(page);
    await shot(page, shots, '04-configuracion-claro.png');

    // 2) Overlays del topbar.
    await page.goto('/');
    await settle(page);
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Buscar y navegar' });
    await expect(palette).toBeVisible();
    await shot(page, shots, '05-paleta-vacia-claro.png', false);
    await palette.getByRole('combobox').fill('andes');
    await expect(palette.getByRole('group', { name: 'Organizaciones' }).getByRole('option').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(palette.getByText(/^Buscando/)).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(300);
    await shot(page, shots, '06-paleta-busqueda-claro.png', false);
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();

    await page.getByRole('button', { name: 'Menú de cuenta' }).click();
    await expect(page.getByRole('menu', { name: 'Cuenta' })).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, shots, '07-menu-cuenta-claro.png', false);
    await page.keyboard.press('Escape');

    // 3) Sidebar en iconos (persistido), con tooltip.
    await page.getByRole('button', { name: 'Reducir menú lateral a iconos' }).click();
    await page.waitForTimeout(400);
    await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Clientes' }).hover();
    await expect(page.locator('.ebim-tooltip')).toHaveText('Clientes');
    await page.waitForTimeout(300);
    await shot(page, shots, '08-sidebar-iconos-claro.png', false);
    await page.reload();
    await settle(page);
    await expect(page.getByRole('button', { name: 'Expandir menú lateral' })).toBeVisible();
    await page.goto('/customers');
    await settle(page);
    await shot(page, shots, '09-clientes-sidebar-iconos-claro.png');
    await page.getByRole('button', { name: 'Expandir menú lateral' }).click();

    // 4) Oscuro y 1280.
    await theme(page, 'dark');
    await page.goto('/');
    await settle(page);
    await shot(page, shots, '10-resumen-ejecutivo-oscuro.png', false);
    await page.keyboard.press('Control+k');
    const darkPalette = page.getByRole('dialog', { name: 'Buscar y navegar' });
    await darkPalette.getByRole('combobox').fill('cob');
    // Pasado el debounce (200 ms) aparecen los grupos; se espera a que terminen de leer.
    await page.waitForTimeout(500);
    await expect(darkPalette.getByText(/^Buscando/)).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(300);
    await shot(page, shots, '11-paleta-oscuro.png', false);
    await page.keyboard.press('Escape');
    await page.goto('/subscriptions');
    await settle(page);
    await shot(page, shots, '12-contratos-oscuro.png', false);
    await theme(page, 'light');

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/billing');
    await settle(page);
    await shot(page, shots, '13-facturacion-1280-claro.png', false);

    // 5) Móvil: topbar compacto y menú en cajón.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await settle(page);
    await shot(page, shots, '14-movil-claro.png', false);
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    await page.waitForTimeout(400);
    await shot(page, shots, '15-movil-menu-claro.png', false);
    await page.keyboard.press('Escape');

    // 6) Salir desde el menú de cuenta vuelve al login.
    await page.setViewportSize({ width: 1440, height: 900 });
    await logout(page);
    await expect(page.getByLabel('Correo corporativo')).toBeVisible({ timeout: 15_000 });

    await context.close();
    writeFileSync(
      resolve(OUT, 'index.json'),
      JSON.stringify({ label: LABEL, generatedAt: new Date().toISOString(), total: shots.length, blockedHosts: [...new Set(blocked)], shots }, null, 2),
    );
    expect([...new Set(blocked)], 'ningún host remoto inesperado').toEqual([]);
  });
});
