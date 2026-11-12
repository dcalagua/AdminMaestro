import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { login, USERS } from '../fixtures';
import { setAppearance } from '../executive/support';

/**
 * Capturas de las pantallas públicas (fase 07 del programa V4 «visual para
 * Gerencia»): login claro/oscuro a 1440 y 390 px, `/bienvenida` (formulario con
 * medidor y enlace inválido) y el portal de pago `/pagar` (estado de cuenta,
 * comprobante y enlace inválido).
 *
 * Igual que `capturas.spec.ts`: material de inspección humana, solo corre con
 * `VISUAL_LABEL`; el navegador habla con localhost y Google Fonts, nada más.
 *
 * El portal con datos necesita las Edge Functions locales en MOCK
 * (`supabase functions serve --env-file <PAYMENT_PORTAL_ALLOW_MOCK=true,
 * MASTERADMIN_ALLOWED_ORIGINS=http://127.0.0.1:5199>`) y la demo gerencia-v4:
 * el enlace se genera como finanzas para Transportes Qhapaq Cargo (id
 * determinista de la demo) y se paga una factura con la tarjeta simulada.
 * El pago queda en la base local: recargar la demo después
 * (`bash scripts/demo/load-demo-data.sh`). Sin `CCP_PORTAL_E2E=1` solo se
 * fotografía el enlace inválido.
 */

const LABEL = process.env.VISUAL_LABEL;
const OUT = resolve(process.cwd(), 'docs/superpowers/evidence/visual-gerencia/capturas', LABEL ?? 'adhoc', 'acceso');
const ALLOWED = new Set(['127.0.0.1', 'localhost', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const QHAPAQ_ORG_ID = '6d03995f-05b7-ec32-b89b-b6b756e1bf4c';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

interface Shot {
  file: string;
  route: string;
  overflow: boolean;
  alerts: string[];
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page
    .locator('[aria-busy="true"]')
    .first()
    .waitFor({ state: 'detached', timeout: 15_000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  // Con movimiento reducido el isotipo y el check ya están quietos.
  await page.waitForTimeout(500);
}

async function shot(page: Page, shots: Shot[], file: string, fullPage = true) {
  await page.screenshot({ path: resolve(OUT, file), fullPage });
  const info = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.textContent?.trim() ?? '').filter(Boolean),
  }));
  shots.push({ file, route: new URL(page.url()).pathname, ...info });
}

async function publicContext(
  browser: Browser,
  blocked: string[],
  viewport: { width: number; height: number },
  mode: 'light' | 'dark',
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport,
    locale: 'es-PE',
    // El isotipo «gira y para»: con movimiento reducido las capturas son estables.
    reducedMotion: 'reduce',
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
  });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:' || ALLOWED.has(url.hostname)) return route.continue();
    blocked.push(url.hostname);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  await setAppearance(page, mode);
  return { context, page };
}

/**
 * Abre el estado de cuenta. El edge runtime local corta isolates por CPU cuando
 * la máquina está cargada: el portal muestra entonces «No pudimos conectar» con
 * «Reintentar» (el mismo camino que tendría un cliente) y se reintenta.
 */
async function openStatement(page: Page, hash: string) {
  await page.goto(`/pagar${hash}`);
  const ready = page.getByText('Total pendiente');
  const retry = page.getByRole('button', { name: 'Reintentar' });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await expect(ready.or(retry)).toBeVisible({ timeout: 45_000 });
    if (await ready.isVisible()) return;
    await retry.click();
  }
  await expect(ready).toBeVisible({ timeout: 45_000 });
}

/** El auth local tiene timeouts intermitentes con la máquina cargada: un reintento. */
async function loginWithRetry(page: Page, email: string) {
  try {
    await login(page, email);
  } catch {
    await login(page, email);
  }
}

test.describe('pantallas públicas (fase 07)', () => {
  test.skip(!LABEL, 'Definir VISUAL_LABEL=faseNN para generar las capturas');

  test('login, bienvenida y portal de pago', async ({ browser }) => {
    test.setTimeout(12 * 60_000);
    mkdirSync(OUT, { recursive: true });
    const shots: Shot[] = [];
    const blocked: string[] = [];

    // 1) Login: claro/oscuro × 1440/390. En móvil el panel de marca no se apila.
    for (const [mode, suffix] of [
      ['light', 'claro'],
      ['dark', 'oscuro'],
    ] as const) {
      for (const [viewport, size] of [
        [DESKTOP, '1440'],
        [MOBILE, '390'],
      ] as const) {
        const { context, page } = await publicContext(browser, blocked, viewport, mode);
        await page.goto('/login');
        await expect(page.getByRole('heading', { level: 1, name: 'Ingresa a tu consola' })).toBeVisible();
        // U-04: el panel de marca se oculta en móvil (no se apila).
        const eyebrow = page.getByText('Consola central de la suite EBIM');
        if (viewport.width >= 768) await expect(eyebrow).toBeVisible();
        else await expect(eyebrow).toBeHidden();
        await settle(page);
        await shot(page, shots, `01-login-${size}-${suffix}.png`);
        await context.close();
      }
    }

    // Login con la ayuda de recuperación abierta (estado secundario).
    {
      const { context, page } = await publicContext(browser, blocked, DESKTOP, 'light');
      await page.goto('/login');
      await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
      await expect(page.getByRole('note')).toBeVisible();
      await settle(page);
      await shot(page, shots, '02-login-recuperar-1440-claro.png');
      await context.close();
    }

    // 2) Bienvenida sin enlace (estado de error amable), 1440 y 390.
    for (const [viewport, size] of [
      [DESKTOP, '1440'],
      [MOBILE, '390'],
    ] as const) {
      const { context, page } = await publicContext(browser, blocked, viewport, 'light');
      await page.goto('/bienvenida');
      await expect(page.getByRole('heading', { name: 'No pudimos abrir tu enlace' })).toBeVisible();
      await settle(page);
      await shot(page, shots, `03-bienvenida-sin-enlace-${size}-claro.png`);
      await context.close();
    }

    // Bienvenida con sesión: el formulario con el medidor de fortaleza.
    {
      const { context, page } = await publicContext(browser, blocked, DESKTOP, 'light');
      await loginWithRetry(page, USERS.tenantAdmin);
      await page.goto('/bienvenida');
      await expect(page.getByRole('heading', { name: 'Te damos la bienvenida' })).toBeVisible({ timeout: 15_000 });
      await page.getByLabel('Nueva contraseña').fill('Andina2026');
      await page.getByLabel('Repite la contraseña').fill('Andina20');
      await settle(page);
      await shot(page, shots, '04-bienvenida-formulario-1440-claro.png');
      await page.setViewportSize(MOBILE);
      await page.getByLabel('Nueva contraseña').fill('Andina-2026-segura');
      await page.getByLabel('Repite la contraseña').fill('Andina-2026-segura');
      await settle(page);
      await shot(page, shots, '05-bienvenida-formulario-390-claro.png');
      await context.close();
    }

    // 3) Portal de pago: enlace inválido (siempre) y, con funciones locales, el real.
    for (const [viewport, size] of [
      [DESKTOP, '1440'],
      [MOBILE, '390'],
    ] as const) {
      const { context, page } = await publicContext(browser, blocked, viewport, 'light');
      await page.goto('/pagar');
      await expect(page.getByRole('heading', { name: 'No reconocemos este enlace' })).toBeVisible();
      await settle(page);
      await shot(page, shots, `06-pagar-enlace-invalido-${size}-claro.png`);
      await context.close();
    }

    if (process.env.CCP_PORTAL_E2E === '1') {
      const { context: ops, page: finance } = await publicContext(browser, blocked, DESKTOP, 'light');
      await loginWithRetry(finance, USERS.finance);
      await finance.goto(`/organizations/${QHAPAQ_ORG_ID}#payment-portal`);
      await finance.getByRole('button', { name: 'Generar enlace' }).click();
      await finance.getByRole('dialog').getByRole('button', { name: /Generar/ }).click();
      const url = await finance.getByLabel('Enlace para el cliente').inputValue();
      await ops.close();
      const hash = new URL(url).hash;

      for (const [viewport, size, mode, suffix] of [
        [DESKTOP, '1440', 'light', 'claro'],
        [MOBILE, '390', 'light', 'claro'],
        [MOBILE, '390', 'dark', 'oscuro'],
        [DESKTOP, '1440', 'dark', 'oscuro'],
      ] as const) {
        const { context, page } = await publicContext(browser, blocked, viewport, mode);
        await openStatement(page, hash);
        await settle(page);
        await shot(page, shots, `07-pagar-estado-cuenta-${size}-${suffix}.png`);
        await context.close();
      }

      // Pago con la tarjeta simulada → comprobante (móvil: así pagan los clientes).
      const { context, page } = await publicContext(browser, blocked, MOBILE, 'light');
      await openStatement(page, hash);
      await page.getByRole('button', { name: 'Pagar' }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Modo de prueba');
      await settle(page);
      await shot(page, shots, '08-pagar-tarjeta-simulada-390-claro.png', false);
      await dialog.getByRole('button', { name: 'Continuar' }).click();
      await expect(page.getByRole('heading', { name: /Pago recibido/ })).toBeVisible({ timeout: 60_000 });
      await settle(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, shots, '09-pagar-comprobante-390-claro.png');
      await context.close();
    }

    writeFileSync(
      resolve(OUT, 'index.json'),
      JSON.stringify({ label: LABEL, generatedAt: new Date().toISOString(), blockedHosts: [...new Set(blocked)], shots }, null, 2),
    );
    for (const s of shots) expect(s.overflow, `${s.file} desborda horizontalmente`).toBe(false);
  });
});
