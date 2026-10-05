import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login, USERS } from '../fixtures';
import { applyAppearance, setAppearance } from '../executive/support';

/**
 * Capturas de Operación SaaS y Gobierno (fase 12 en adelante).
 *
 * `VISUAL_LABEL=faseNN npx playwright test e2e/visual/operacion.spec.ts` deja en
 * `capturas/<label>/operacion/` integraciones (tarjetas y ficha), sincronización
 * de entitlements, uso (medidores, agregados), despliegues, altas SaaS,
 * solicitudes de infraestructura, usuarios (listado y ficha), auditoría,
 * configuración (apariencia, mi perfil, cuentas de pago) y la 404 a 1440 en
 * claro, más 1280 y oscuro de las pantallas principales. Comprueba que no haya
 * desborde horizontal ni errores en `main`. `VISUAL_ONLY=integrations,users`
 * limita las rutas (iteración). Sin la variable no corre.
 */

const LABEL = process.env.VISUAL_LABEL;
const ONLY = process.env.VISUAL_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);
const OUT = resolve(process.cwd(), 'docs/superpowers/evidence/visual-gerencia/capturas', LABEL ?? 'adhoc', 'operacion');
const ALLOWED = new Set(['127.0.0.1', 'localhost', 'fonts.googleapis.com', 'fonts.gstatic.com']);

const ROUTES: Array<{ slug: string; path: string; title: string }> = [
  { slug: 'integrations', path: '/integrations', title: 'Integraciones SaaS' },
  { slug: 'entitlement-sync', path: '/commercial/entitlement-sync', title: 'Sincronización de entitlements' },
  { slug: 'usage', path: '/usage#meters', title: 'Uso' },
  { slug: 'usage-aggregates', path: '/usage#aggregates', title: 'Uso' },
  { slug: 'usage-alerts', path: '/usage#alerts', title: 'Uso' },
  { slug: 'deployments', path: '/deployments', title: 'Entornos y despliegues' },
  { slug: 'saas-provisioning', path: '/saas-provisioning', title: 'Altas SaaS' },
  { slug: 'provisioning', path: '/provisioning', title: 'Solicitudes de infraestructura' },
  { slug: 'users', path: '/users', title: 'Usuarios y accesos' },
  { slug: 'audit', path: '/audit', title: 'Auditoría' },
  { slug: 'settings', path: '/settings#appearance', title: 'Configuración' },
  { slug: 'settings-profile', path: '/settings#profile', title: 'Configuración' },
  { slug: 'settings-payment', path: '/settings#payment-accounts', title: 'Configuración' },
  { slug: 'not-found', path: '/404', title: 'Página no encontrada' },
];

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
  await page.locator('[data-chart-skeleton]').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
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

/** Abre la primera ficha enlazada desde un listado y devuelve su URL. */
async function firstDetail(page: Page, list: string, hrefPrefix: string): Promise<string | null> {
  await page.goto(list);
  await settle(page);
  const link = page.locator(`main a[href^="${hrefPrefix}"]`).first();
  if ((await link.count()) === 0) return null;
  await link.click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return page.url().split('#')[0]!;
}

test.describe('operación y gobierno · capturas', () => {
  test.skip(!LABEL, 'Definir VISUAL_LABEL=faseNN para generar las capturas');
  test.setTimeout(480_000);

  test('integraciones, uso, despliegues, usuarios, auditoría y configuración', async ({ browser }) => {
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

    const integrationUrl = wanted('integration') ? await firstDetail(page, '/integrations', '/integrations/') : null;
    if (integrationUrl) {
      check(integrationUrl, await shoot(page, name('integration', 'resumen-1440-claro'), shots));
      await page.goto(`${integrationUrl}#audit`);
      await shoot(page, name('integration', 'eventos-1440-claro'), shots);
    }
    const userUrl = wanted('user') ? await firstDetail(page, '/users', '/users/') : null;
    if (userUrl) check(userUrl, await shoot(page, name('user', 'detalle-1440-claro'), shots));

    await page.setViewportSize({ width: 1280, height: 800 });
    for (const [slug, url] of [
      ['integrations', wanted('integrations') ? '/integrations' : null],
      ['users', wanted('users') ? '/users' : null],
      ['audit', wanted('audit') ? '/audit' : null],
      ['usage', wanted('usage') ? '/usage#meters' : null],
      ['integration', integrationUrl],
    ] as const) {
      if (!url) continue;
      await page.goto(url);
      check(url, await shoot(page, name(slug, '1280-claro'), shots), 1280);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, 'dark');
    for (const [slug, url] of [
      ['integrations', wanted('integrations') ? '/integrations' : null],
      ['audit', wanted('audit') ? '/audit' : null],
      ['settings-payment', wanted('settings-payment') ? '/settings#payment-accounts' : null],
      ['users', wanted('users') ? '/users' : null],
    ] as const) {
      if (!url) continue;
      // Cambiar solo el #hash en la misma ruta no remonta la pestaña: se pasa por otra ruta.
      if (url.includes('#')) await page.goto('/404');
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
