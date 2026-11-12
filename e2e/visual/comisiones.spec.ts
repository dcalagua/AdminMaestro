import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login, logout, USERS } from '../fixtures';
import { applyAppearance, setAppearance } from '../executive/support';

/**
 * Capturas del módulo de liquidación de comisiones (fase 13).
 *
 * `VISUAL_LABEL=faseNN npx playwright test e2e/visual/comisiones.spec.ts` deja en
 * `capturas/<label>/comisiones/`: Devengado y Liquidaciones a 1440 y 1280, el
 * detalle de una aprobada y de una pagada, los diálogos de pago y de generar, el
 * modo oscuro y la vista del comercial. Solo abre y cierra: NO escribe (el ciclo
 * real lo prueba `e2e/v4-commission-settlements.spec.ts`). Necesita la demo
 * `gerencia-v4` (una liquidación abierta, una aprobada y las pagadas).
 */

const LABEL = process.env.VISUAL_LABEL;
const OUT = resolve(process.cwd(), 'docs/superpowers/evidence/visual-gerencia/capturas', LABEL ?? 'adhoc', 'comisiones');
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

async function shoot(page: Page, file: string, shots: Array<Record<string, unknown>>, fullPage = true) {
  await settle(page);
  const info = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    alerts: [...document.querySelectorAll('main [role="alert"]')].map((n) => n.textContent?.trim() ?? ''),
    theme: document.documentElement.getAttribute('data-theme'),
  }));
  await page.screenshot({ path: resolve(OUT, file), fullPage });
  shots.push({ file, ...info });
  expect.soft(info.overflow, `${file} desborda`).toBe(false);
  expect.soft(info.alerts, `${file} con errores`).toEqual([]);
  return info;
}

async function openSettlements(page: Page) {
  await page.goto('/commissions');
  await expect(page.getByRole('heading', { level: 1, name: 'Comisiones y liquidaciones' })).toBeVisible();
  await page.getByRole('tab', { name: /^Liquidaciones/ }).click();
  await expect(page.locator('tr[data-settlement]').first()).toBeVisible({ timeout: 15_000 });
}

async function openDetail(page: Page, status: 'APPROVED' | 'PAID') {
  const row = page.locator(`tr[data-settlement-status="${status}"]`).first();
  await row.locator('button.ebim-link').click();
  await expect(page.locator('[data-settlement-detail]')).toBeVisible();
  await page.locator('[data-settlement-detail] table, [data-settlement-detail] [role="status"]').first().waitFor();
}

test.describe('comisiones · capturas', () => {
  test.skip(!LABEL, 'Definir VISUAL_LABEL=faseNN para generar las capturas');
  test.setTimeout(300_000);

  test('devengado, liquidaciones, detalle, diálogos y vista del comercial', async ({ browser }) => {
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
    let n = 0;
    const name = (slug: string) => `${String(++n).padStart(2, '0')}-${slug}.png`;

    await page.goto('/commissions');
    await expect(page.getByRole('heading', { level: 1, name: 'Comisiones y liquidaciones' })).toBeVisible();
    await shoot(page, name('devengado-1440-claro'), shots);

    await openSettlements(page);
    await shoot(page, name('liquidaciones-1440-claro'), shots);

    await openDetail(page, 'APPROVED');
    await shoot(page, name('detalle-aprobada-1440-claro'), shots, false);
    await page.getByRole('button', { name: 'Registrar pago…' }).click();
    const pay = page.getByRole('dialog', { name: /Registrar pago/ });
    await expect(pay).toBeVisible();
    await pay.getByLabel(/Referencia/).fill('TRF-000123');
    await shoot(page, name('dialogo-pago-1440-claro'), shots, false);
    await pay.getByRole('button', { name: 'Cancelar' }).click();

    await openDetail(page, 'PAID');
    await shoot(page, name('detalle-pagada-1440-claro'), shots, false);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Generar liquidación' }).click();
    const gen = page.getByRole('dialog', { name: 'Generar liquidación' });
    await gen.getByLabel(/Comercial/).selectOption({ label: 'Lucía Paredes (lucia-paredes)' });
    await gen.getByLabel(/Moneda/).selectOption('PEN');
    await expect(gen.locator('[data-settle-preview]')).toContainText(/Entran|No hay/);
    await shoot(page, name('dialogo-generar-1440-claro'), shots, false);
    await gen.getByRole('button', { name: 'Cancelar' }).click();

    await page.setViewportSize({ width: 1280, height: 800 });
    await shoot(page, name('liquidaciones-1280-claro'), shots);
    await page.setViewportSize({ width: 1440, height: 900 });

    await setTheme(page, 'dark');
    await openSettlements(page);
    await shoot(page, name('liquidaciones-1440-oscuro'), shots);
    await openDetail(page, 'APPROVED');
    await shoot(page, name('detalle-aprobada-1440-oscuro'), shots, false);
    await page.keyboard.press('Escape');
    await setTheme(page, 'light');

    // Vista del comercial: sus liquidaciones, sin acciones.
    await logout(page);
    await login(page, USERS.salesAgent);
    await openSettlements(page).catch(() => undefined);
    await expect(page.getByRole('button', { name: 'Generar liquidación' })).toHaveCount(0);
    await shoot(page, name('vendedor-liquidaciones-1440-claro'), shots);

    await context.close();
    writeFileSync(resolve(OUT, 'index.json'), JSON.stringify({ label: LABEL, generatedAt: new Date().toISOString(), shots }, null, 2));
  });
});
