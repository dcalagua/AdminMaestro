import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login, USERS } from '../fixtures';
import { applyAppearance, setAppearance } from '../executive/support';

/**
 * Capturas del Resumen Ejecutivo (fase 09 en adelante).
 *
 * `VISUAL_LABEL=faseNN npx playwright test e2e/visual/dashboard.spec.ts` deja
 * en `capturas/<label>/dashboard/`: la perspectiva Ejecutiva a 1440 y 1280 en
 * claro y oscuro, el puente con el detalle de clientes abierto y las
 * perspectivas Finanzas y Operación. Además comprueba que no haya desborde
 * horizontal ni paneles en error. Necesita la demo `gerencia-v4` cargada.
 * Sin la variable no corre (material de inspección, no regresión).
 */

const LABEL = process.env.VISUAL_LABEL;
const OUT = resolve(process.cwd(), 'docs/superpowers/evidence/visual-gerencia/capturas', LABEL ?? 'adhoc', 'dashboard');
const ALLOWED = new Set(['127.0.0.1', 'localhost', 'fonts.googleapis.com', 'fonts.gstatic.com']);

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(600);
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  for (let attempt = 1; ; attempt += 1) {
    const saved = page
      .waitForResponse((r) => r.url().includes('/rest/v1/profiles') && r.request().method() === 'PATCH', { timeout: 8_000 })
      .catch(() => undefined);
    try {
      await applyAppearance(page, theme);
      await saved;
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      return;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
}

async function shoot(page: Page, file: string, shots: Array<Record<string, unknown>>) {
  await settle(page);
  const info = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    alerts: [...document.querySelectorAll('main [role="alert"]')].map((n) => n.textContent?.trim() ?? ''),
    theme: document.documentElement.getAttribute('data-theme'),
  }));
  await page.screenshot({ path: resolve(OUT, file), fullPage: true });
  shots.push({ file, ...info });
  return info;
}

test.describe('resumen ejecutivo · capturas', () => {
  test.skip(!LABEL, 'Definir VISUAL_LABEL=faseNN para generar las capturas');
  test.setTimeout(240_000);

  test('perspectivas, temas y anchos', async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-PE', reducedMotion: 'reduce' });
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === 'data:' || url.protocol === 'blob:' || ALLOWED.has(url.hostname)) return route.continue();
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    await setAppearance(page, 'light');
    await login(page, USERS.superAdmin);
    await setTheme(page, 'light');
    const shots: Array<Record<string, unknown>> = [];

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Resumen ejecutivo' })).toBeVisible();
    const light1440 = await shoot(page, '01-ejecutivo-1440-claro.png', shots);
    expect(light1440.overflow).toBe(false);
    expect(light1440.alerts).toEqual([]);
    await expect(page.locator('[data-hero] > *')).toHaveCount(6);

    // Puente: abrir el detalle de clientes del primer movimiento con clientes.
    const chip = page.getByRole('group', { name: 'Ver clientes por movimiento' }).getByRole('button', { disabled: false }).first();
    await chip.click();
    await expect(page.getByTestId('bridge-customers')).toBeVisible();
    await settle(page);
    await page.locator('[data-panel="puente"]').screenshot({ path: resolve(OUT, '02-puente-detalle-claro.png') });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const light1280 = await shoot(page, '03-ejecutivo-1280-claro.png', shots);
    expect(light1280.overflow).toBe(false);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#finanzas');
    await shoot(page, '04-finanzas-1440-claro.png', shots);
    await page.goto('/#operacion');
    await shoot(page, '05-operacion-1440-claro.png', shots);
    await page.goto('/?cierre=' + new Date().toISOString().slice(0, 7));
    await shoot(page, '06-ejecutivo-mes-en-curso-claro.png', shots);

    await setTheme(page, 'dark');
    await page.goto('/');
    const dark1440 = await shoot(page, '07-ejecutivo-1440-oscuro.png', shots);
    expect(dark1440.theme).toBe('dark');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await shoot(page, '08-ejecutivo-1280-oscuro.png', shots);

    // Deja el perfil local en claro para las corridas siguientes.
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, 'light');
    await context.close();
    writeFileSync(resolve(OUT, 'index.json'), JSON.stringify({ label: LABEL, generatedAt: new Date().toISOString(), shots }, null, 2));
  });
});
