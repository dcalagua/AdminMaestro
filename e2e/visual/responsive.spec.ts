import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { USERS } from '../fixtures';
import { login, setAppearance } from '../executive/support';

/**
 * Responsive de las tres pantallas que más se proyectan o se abren en el
 * teléfono (fase 15 del programa V4): Resumen Ejecutivo, login y portal de pago
 * a 390, 768, 1280 y 1440 px. Falla si alguna desborda horizontalmente.
 *
 * Material de inspección: solo corre con `VISUAL_LABEL`. El portal con datos
 * necesita las Edge Functions locales en MOCK y `CCP_PORTAL_E2E=1` (ver
 * `acceso.spec.ts`); sin ellas se fotografía el enlace inválido.
 */

const LABEL = process.env.VISUAL_LABEL;
const OUT = resolve(
  process.cwd(),
  'docs/superpowers/evidence/visual-gerencia/capturas',
  LABEL ?? 'adhoc',
  'responsive',
);
const QHAPAQ_ORG_ID = '6d03995f-05b7-ec32-b89b-b6b756e1bf4c';
const WIDTHS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

interface Shot {
  file: string;
  width: number;
  overflow: boolean;
  alerts: string[];
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page
    .locator('[aria-busy="true"], .ebim-skeleton')
    .first()
    .waitFor({ state: 'detached', timeout: 20_000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(600);
}

async function shot(page: Page, shots: Shot[], file: string, width: number) {
  await page.screenshot({ path: resolve(OUT, file), fullPage: true });
  const info = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    alerts: [...document.querySelectorAll('main [role="alert"]')]
      .map((n) => n.textContent?.trim() ?? '')
      .filter(Boolean),
  }));
  shots.push({ file, width, ...info });
}

async function context(browser: Browser, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({
    viewport,
    locale: 'es-PE',
    reducedMotion: 'reduce',
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
  });
  const page = await ctx.newPage();
  await setAppearance(page, 'light');
  return { ctx, page };
}

test.describe('responsive (fase 15)', () => {
  test.skip(!LABEL, 'Definir VISUAL_LABEL=faseNN para generar las capturas');

  test('resumen ejecutivo, login y portal a 390/768/1280/1440', async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    mkdirSync(OUT, { recursive: true });
    const shots: Shot[] = [];

    for (const viewport of WIDTHS) {
      const { ctx, page } = await context(browser, viewport);
      await page.goto('/login');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Ingresa a tu consola' }),
      ).toBeVisible();
      await settle(page);
      await shot(page, shots, `login-${viewport.width}.png`, viewport.width);

      await page.goto('/pagar');
      await expect(page.getByRole('heading', { name: 'No reconocemos este enlace' })).toBeVisible();
      await settle(page);
      await shot(page, shots, `pagar-enlace-invalido-${viewport.width}.png`, viewport.width);

      await login(page, USERS.superAdmin).catch(() => login(page, USERS.superAdmin));
      await page.goto('/');
      await expect(page.locator('[data-hero]')).toBeVisible({ timeout: 20_000 });
      await settle(page);
      await shot(page, shots, `resumen-ejecutivo-${viewport.width}.png`, viewport.width);
      await ctx.close();
    }

    if (process.env.CCP_PORTAL_E2E === '1') {
      const { ctx: ops, page: finance } = await context(browser, WIDTHS[3]);
      await login(finance, USERS.finance).catch(() => login(finance, USERS.finance));
      await finance.goto(`/organizations/${QHAPAQ_ORG_ID}#payment-portal`);
      await finance.getByRole('button', { name: 'Generar enlace' }).click();
      await finance
        .getByRole('dialog')
        .getByRole('button', { name: /Generar/ })
        .click();
      const hash = new URL(await finance.getByLabel('Enlace para el cliente').inputValue()).hash;
      await ops.close();
      for (const viewport of WIDTHS) {
        const { ctx, page } = await context(browser, viewport);
        await page.goto(`/pagar${hash}`);
        const ready = page.getByText('Total pendiente');
        const retry = page.getByRole('button', { name: 'Reintentar' });
        for (let attempt = 0; attempt < 4 && !(await ready.isVisible()); attempt += 1) {
          await expect(ready.or(retry)).toBeVisible({ timeout: 45_000 });
          if (await retry.isVisible()) await retry.click();
        }
        await expect(ready).toBeVisible({ timeout: 45_000 });
        await settle(page);
        await shot(page, shots, `pagar-estado-cuenta-${viewport.width}.png`, viewport.width);
        await ctx.close();
      }
    }

    writeFileSync(
      resolve(OUT, 'index.json'),
      JSON.stringify({ label: LABEL, generatedAt: new Date().toISOString(), shots }, null, 2),
    );
    for (const s of shots) {
      expect(s.overflow, `${s.file} desborda horizontalmente`).toBe(false);
      // El enlace inválido muestra su error a propósito (estado esperado, U-14).
      if (!s.file.startsWith('pagar-enlace-invalido')) {
        expect(s.alerts, `${s.file} muestra un error`).toEqual([]);
      }
    }
  });
});
