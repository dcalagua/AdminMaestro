import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login, USERS } from '../fixtures';
import { applyAppearance, setAppearance } from '../executive/support';

/**
 * Capturas de Clientes, canales, productos y contratos (fase 11 en adelante).
 *
 * `VISUAL_LABEL=faseNN npx playwright test e2e/visual/clientes.spec.ts` deja en
 * `capturas/<label>/clientes/` los listados, la Suite SaaS, la ficha de
 * producto, el asistente de Nueva venta y las fichas 360 (organización y
 * tenant) a 1440 en claro, más 1280 y oscuro de las fichas 360 y Clientes.
 * Comprueba que no haya desborde horizontal ni errores en `main`.
 * `VISUAL_ONLY=customers,org360` limita las rutas (iteración). Necesita la demo
 * `gerencia-v4`. Sin la variable no corre (material de inspección).
 */

const LABEL = process.env.VISUAL_LABEL;
const ONLY = process.env.VISUAL_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);
const OUT = resolve(process.cwd(), 'docs/superpowers/evidence/visual-gerencia/capturas', LABEL ?? 'adhoc', 'clientes');
const ALLOWED = new Set(['127.0.0.1', 'localhost', 'fonts.googleapis.com', 'fonts.gstatic.com']);

const ROUTES: Array<{ slug: string; path: string; title: string }> = [
  { slug: 'customers', path: '/customers', title: 'Clientes' },
  { slug: 'partners', path: '/partners', title: 'Partners y canales' },
  { slug: 'organizations', path: '/organizations', title: 'Directorio corporativo' },
  { slug: 'sales-agents', path: '/sales-agents', title: 'Equipo comercial' },
  { slug: 'attributions', path: '/attributions', title: 'Atribuciones comerciales' },
  { slug: 'products', path: '/products', title: 'Suite SaaS' },
  { slug: 'plans', path: '/plans', title: 'Planes y licencias' },
  { slug: 'feature-flags', path: '/feature-flags', title: 'Capacidades' },
  { slug: 'capabilities', path: '/commercial/capabilities', title: 'Registro de capacidades' },
  { slug: 'addons', path: '/catalog/addons', title: 'Add-ons y tarifas' },
  { slug: 'onboarding', path: '/onboarding', title: 'Nueva venta' },
  { slug: 'tenants', path: '/tenants', title: 'Tenants' },
  { slug: 'subscriptions', path: '/subscriptions', title: 'Contratos y suscripciones' },
];

/** Cliente de la demo con historia de 12+ meses (ficha 360 con gráficos). */
const DEMO_CUSTOMER = process.env.VISUAL_CUSTOMER ?? 'Qhapaq';

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

const wanted = (slug: string) => !ONLY || ONLY.includes(slug);

test.describe('clientes y catálogo · capturas', () => {
  test.skip(!LABEL, 'Definir VISUAL_LABEL=faseNN para generar las capturas');
  test.setTimeout(480_000);

  test('listados, fichas 360, catálogo y nueva venta', async ({ browser }) => {
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
    const name = (slug: string, suffix: string) => `${String(++n).padStart(2, '0')}-${slug}-${suffix}.png`;
    const check = (path: string, info: { overflow: boolean; alerts: string[] }, width = 1440) => {
      expect.soft(info.overflow, `${path} desborda a ${width}`).toBe(false);
      expect.soft(info.alerts, `${path} con errores`).toEqual([]);
    };

    for (const r of ROUTES.filter((x) => wanted(x.slug))) {
      await page.goto(r.path);
      await expect.soft(page.getByRole('heading', { level: 1, name: r.title })).toBeVisible();
      check(r.path, await shoot(page, name(r.slug, '1440-claro'), shots));
    }

    // Nueva venta con el asistente en el paso 2 (cliente elegido) para ver el resumen lateral.
    if (wanted('onboarding')) {
      await page.goto('/onboarding');
      const org = page.getByLabel('Organización cliente');
      if (await org.isVisible().catch(() => false)) {
        const value = await org.locator('option').nth(1).getAttribute('value');
        if (value) await org.selectOption(value);
        await page.getByRole('button', { name: /Siguiente|Continuar/ }).first().click().catch(() => undefined);
        check('/onboarding paso 2', await shoot(page, name('onboarding', 'paso2-1440-claro'), shots));
      }
    }

    let orgUrl: string | null = null;
    let tenantUrl: string | null = null;
    if (wanted('org360') || wanted('tenant360')) {
      await page.goto('/customers');
      await settle(page);
      await page.getByRole('searchbox').first().fill(DEMO_CUSTOMER);
      await page.locator('main a[href^="/organizations/"]').first().click();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      orgUrl = page.url().split('#')[0]!;
    }
    if (orgUrl && wanted('org360')) {
      await page.goto(orgUrl);
      check(orgUrl, await shoot(page, name('org360', 'resumen-1440-claro'), shots));
      await page.goto(`${orgUrl}#products`);
      await shoot(page, name('org360', 'productos-1440-claro'), shots);
    }
    if (wanted('tenant360')) {
      await page.goto('/tenants');
      await settle(page);
      await page.getByRole('searchbox').first().fill(DEMO_CUSTOMER);
      await page.locator('main a[href^="/tenants/"]').first().click();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      tenantUrl = page.url().split('#')[0]!;
      check(tenantUrl, await shoot(page, name('tenant360', 'resumen-1440-claro'), shots));
    }
    if (wanted('product')) {
      await page.goto('/products');
      await settle(page);
      await page.locator('main a[href^="/products/"]').first().click();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      check(page.url(), await shoot(page, name('product', 'detalle-1440-claro'), shots));
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    for (const [slug, url] of [
      ['customers', wanted('customers') ? '/customers' : null],
      ['org360', orgUrl],
      ['tenant360', tenantUrl],
    ] as const) {
      if (!url) continue;
      await page.goto(url);
      check(url, await shoot(page, name(slug, '1280-claro'), shots), 1280);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, 'dark');
    for (const [slug, url] of [
      ['customers', wanted('customers') ? '/customers' : null],
      ['org360', orgUrl],
      ['tenant360', tenantUrl],
    ] as const) {
      if (!url) continue;
      await page.goto(url);
      const info = await shoot(page, name(slug, '1440-oscuro'), shots);
      expect.soft(info.theme).toBe('dark');
    }

    // Deja el perfil local en claro para las corridas siguientes.
    await setTheme(page, 'light');
    await context.close();
    writeFileSync(resolve(OUT, 'index.json'), JSON.stringify({ label: LABEL, generatedAt: new Date().toISOString(), shots }, null, 2));
  });
});
