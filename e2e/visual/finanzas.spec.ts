import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login, USERS } from '../fixtures';
import { applyAppearance, setAppearance } from '../executive/support';

/**
 * Capturas de las pantallas de Finanzas (fase 10 en adelante).
 *
 * `VISUAL_LABEL=faseNN npx playwright test e2e/visual/finanzas.spec.ts` deja en
 * `capturas/<label>/finanzas/` las 10 rutas de Finanzas y la ficha de contrato
 * (pestaña de cobros) a 1440 en claro, más 1280 y oscuro de las tres con
 * gráfico. Comprueba que no haya desborde horizontal ni errores en `main`.
 * `VISUAL_ONLY=billing,costs` limita las rutas (iteración). Necesita la demo
 * `gerencia-v4`. Sin la variable no corre (material de inspección).
 */

const LABEL = process.env.VISUAL_LABEL;
const ONLY = process.env.VISUAL_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);
const OUT = resolve(process.cwd(), 'docs/superpowers/evidence/visual-gerencia/capturas', LABEL ?? 'adhoc', 'finanzas');
const ALLOWED = new Set(['127.0.0.1', 'localhost', 'fonts.googleapis.com', 'fonts.gstatic.com']);

const ROUTES: Array<{ slug: string; path: string; title: string }> = [
  { slug: 'billing', path: '/billing', title: 'Facturación y cobros' },
  { slug: 'costs', path: '/costs', title: 'Costos y margen' },
  { slug: 'commissions', path: '/commissions', title: 'Comisiones y liquidaciones' },
  { slug: 'commission-plans', path: '/commission-plans', title: 'Reglas de comisión' },
  { slug: 'renewals', path: '/renewals', title: 'Renovaciones y alertas' },
  { slug: 'reconciliation', path: '/reconciliation', title: 'Reconciliación' },
  { slug: 'regional', path: '/regional', title: 'Monedas y FX' },
  { slug: 'ai-credits', path: '/ai-credits', title: 'Créditos IA' },
  { slug: 'billing-shadow', path: '/billing-shadow', title: 'Billing shadow' },
  { slug: 'partner-fees', path: '/partner-fees', title: 'Tarifas de partners' },
];
const CHARTED = new Set(['billing', 'costs', 'commissions']);

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

test.describe('finanzas · capturas', () => {
  test.skip(!LABEL, 'Definir VISUAL_LABEL=faseNN para generar las capturas');
  test.setTimeout(420_000);

  test('pantallas de finanzas, temas y anchos', async ({ browser }) => {
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
    const routes = ROUTES.filter((r) => !ONLY || ONLY.includes(r.slug));

    let n = 0;
    const name = (slug: string, suffix: string) => `${String(++n).padStart(2, '0')}-${slug}-${suffix}.png`;

    for (const r of routes) {
      await page.goto(r.path);
      await expect(page.getByRole('heading', { level: 1, name: r.title })).toBeVisible();
      const info = await shoot(page, name(r.slug, '1440-claro'), shots);
      expect.soft(info.overflow, `${r.path} desborda a 1440`).toBe(false);
      expect.soft(info.alerts, `${r.path} con errores`).toEqual([]);
    }

    if (!ONLY || ONLY.includes('subscription')) {
      await page.goto('/subscriptions');
      await page.locator('main a[href^="/subscriptions/"]').first().click();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const detail = page.url().split('#')[0];
      await page.goto(`${detail}#invoices`);
      await shoot(page, name('subscription', 'cobros-1440-claro'), shots);
      await page.goto(`${detail}#collection`);
      await shoot(page, name('subscription', 'cobranza-1440-claro'), shots);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    for (const r of routes.filter((x) => CHARTED.has(x.slug))) {
      await page.goto(r.path);
      const info = await shoot(page, name(r.slug, '1280-claro'), shots);
      expect.soft(info.overflow, `${r.path} desborda a 1280`).toBe(false);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, 'dark');
    for (const r of routes.filter((x) => CHARTED.has(x.slug))) {
      await page.goto(r.path);
      const info = await shoot(page, name(r.slug, '1440-oscuro'), shots);
      expect.soft(info.theme).toBe('dark');
    }

    // Deja el perfil local en claro para las corridas siguientes.
    await setTheme(page, 'light');
    await context.close();
    writeFileSync(resolve(OUT, 'index.json'), JSON.stringify({ label: LABEL, generatedAt: new Date().toISOString(), shots }, null, 2));
  });
});
