import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login, USERS } from '../fixtures';
import { applyAppearance, setAppearance } from '../executive/support';

/**
 * Capturas del modo presentación del Resumen Ejecutivo (fase 14).
 *
 * `VISUAL_LABEL=faseNN npx playwright test e2e/visual/presentacion.spec.ts`
 * deja en `capturas/<label>/presentacion/`: las seis diapositivas a 1440×900
 * (abiertas con el botón «Presentar» y recorridas con el teclado), el top y el
 * puente con «Ocultar nombres», dos diapositivas a 1280×800, el tema claro
 * forzado sobre una persona en oscuro, y la impresión: `presentacion.pdf`
 * (A4 apaisado, una diapositiva por hoja) más su vista en papel en PNG.
 * Comprueba que ninguna diapositiva desborde a lo ancho ni tenga paneles en
 * error y que, con nombres ocultos, ningún nombre real quede en pantalla.
 * Necesita la demo `gerencia-v4`. Sin la variable no corre.
 */

const LABEL = process.env.VISUAL_LABEL;
const OUT = resolve(
  process.cwd(),
  'docs/superpowers/evidence/visual-gerencia/capturas',
  LABEL ?? 'adhoc',
  'presentacion',
);
const ALLOWED = new Set(['127.0.0.1', 'localhost', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const SLIDES = ['kpis', 'mrr', 'puente', 'cobranza', 'mix', 'tops'] as const;

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await page
    .locator('[data-presentation] [aria-busy="true"]')
    .first()
    .waitFor({ state: 'detached', timeout: 15_000 })
    .catch(() => undefined);
  await page
    .locator('[data-chart-skeleton]')
    .first()
    .waitFor({ state: 'detached', timeout: 15_000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(500);
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  for (let attempt = 1; ; attempt += 1) {
    const saved = page
      .waitForResponse(
        (r) => r.url().includes('/rest/v1/profiles') && r.request().method() === 'PATCH',
        { timeout: 8_000 },
      )
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
  const info = await page.evaluate(() => {
    const stage = document.querySelector('.ebim-presentation-stage') as HTMLElement | null;
    return {
      slide: document.querySelector('[data-slide]')?.getAttribute('data-slide') ?? null,
      overflowX: stage ? stage.scrollWidth > stage.clientWidth + 1 : null,
      // La diapositiva cabe sin desplazarse (a 1280×800 algunas desplazan dentro del escenario).
      fits: stage ? stage.scrollHeight <= stage.clientHeight + 1 : null,
      alerts: [...document.querySelectorAll('[data-presentation] [role="alert"]')].map(
        (n) => n.textContent?.trim() ?? '',
      ),
      theme: document.documentElement.getAttribute('data-theme'),
      fullscreen: Boolean(document.fullscreenElement),
    };
  });
  await page.screenshot({ path: resolve(OUT, file) });
  shots.push({ file, ...info });
  return info;
}

test.describe('modo presentación · capturas', () => {
  test.skip(!LABEL, 'Definir VISUAL_LABEL=faseNN para generar las capturas');
  test.setTimeout(300_000);

  test('diapositivas, nombres ocultos, anchos, tema e impresión', async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'es-PE',
      reducedMotion: 'reduce',
    });
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === 'data:' || url.protocol === 'blob:' || ALLOWED.has(url.hostname))
        return route.continue();
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    await setAppearance(page, 'light');
    await login(page, USERS.superAdmin);
    await setTheme(page, 'light');
    const shots: Array<Record<string, unknown>> = [];

    // Entrada por el botón del Resumen Ejecutivo (y recorrido con el teclado).
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Resumen ejecutivo' })).toBeVisible();
    await settle(page);
    await page.getByRole('button', { name: /Presentar/ }).click();
    const deck = page.getByRole('region', { name: 'Presentación del resumen ejecutivo' });
    await expect(deck).toBeVisible();
    await expect(page).toHaveURL(/presentacion=1/);

    for (const [i, id] of SLIDES.entries()) {
      if (i > 0) await page.keyboard.press('ArrowRight');
      await expect(page.locator(`[data-slide="${id}"]`)).toBeVisible();
      const info = await shoot(page, `${String(i + 1).padStart(2, '0')}-${id}-1440.png`, shots);
      expect(info.overflowX).toBe(false);
      // A 1440×900 (proyector típico) cada diapositiva cabe entera, sin desplazarse.
      expect(info.fits).toBe(true);
      expect(info.alerts).toEqual([]);
    }

    // Ocultar nombres: los nombres reales del top desaparecen de la pantalla.
    const realNames = await page
      .locator(
        '[data-panel="top-clientes"] [data-ranked-row] .truncate, [data-panel="top-partners"] [data-ranked-row] .truncate',
      )
      .allTextContents();
    expect(realNames.length).toBeGreaterThan(3);
    await page.getByRole('button', { name: 'Ocultar nombres' }).click();
    await expect(page).toHaveURL(/anonimo=1/);
    const masked = await shoot(page, '07-tops-nombres-ocultos-1440.png', shots);
    expect(masked.alerts).toEqual([]);
    const visible = await deck.innerText();
    for (const name of realNames) expect(visible).not.toContain(name.trim());
    await expect(page.locator('[data-panel="top-clientes"]')).toContainText('Cliente A');

    // Puente con el detalle de clientes abierto, también anonimizado.
    await page.keyboard.press('3');
    await page
      .getByRole('group', { name: 'Ver clientes por movimiento' })
      .getByRole('button', { disabled: false })
      .first()
      .click();
    await expect(page.getByTestId('bridge-customers')).toContainText('Cliente');
    await shoot(page, '08-puente-detalle-nombres-ocultos-1440.png', shots);
    const bridgeText = await page.getByTestId('bridge-customers').innerText();
    for (const name of realNames) expect(bridgeText).not.toContain(name.trim());
    await page.getByRole('button', { name: 'Ocultar nombres' }).click();

    // Salir de pantalla completa con su botón NO cierra la presentación (solo Esc o «Salir»).
    const fsToggle = page.getByRole('button', { name: 'Pantalla completa' });
    if ((await fsToggle.getAttribute('aria-pressed')) === 'true') {
      await fsToggle.click();
      await expect(fsToggle).toHaveAttribute('aria-pressed', 'false');
    }
    await expect(deck).toBeVisible();

    // 1280×800: las seis diapositivas (09…14), sin desborde horizontal.
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const [i, id] of SLIDES.entries()) {
      await page.keyboard.press(String(i + 1));
      await expect(page.locator(`[data-slide="${id}"]`)).toBeVisible();
      expect(
        (await shoot(page, `${String(i + 9).padStart(2, '0')}-${id}-1280.png`, shots)).overflowX,
      ).toBe(false);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // Esc sale y el foco vuelve a «Presentar».
    await page.keyboard.press('Escape');
    await expect(deck).toBeHidden();
    await expect(page.getByRole('button', { name: /Presentar/ })).toBeFocused();
    expect(page.url()).not.toContain('presentacion');

    // Persona en oscuro: la presentación se ve en claro (sin tocar su preferencia) y puede volver a su tema.
    await setTheme(page, 'dark');
    await page.goto('/?presentacion=1&diapositiva=2');
    await expect(deck).toBeVisible();
    expect((await shoot(page, '15-mrr-tema-claro-forzado.png', shots)).theme).toBe('light');
    await page.getByRole('button', { name: 'Tema claro' }).click();
    expect((await shoot(page, '16-mrr-tema-propio-oscuro.png', shots)).theme).toBe('dark');
    await page.getByRole('button', { name: 'Tema claro' }).click();
    await page.getByRole('button', { name: /Salir/ }).click();
    await expect(deck).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
      'dark',
    );
    await setTheme(page, 'light');

    // Impresión: «Imprimir» dibuja las 6 diapositivas al ancho de la hoja y llama a window.print().
    // El diálogo no existe en headless: se reemplaza print() por una copia estática del DOM en ese
    // instante (lo que el navegador imprimiría) y se genera el PDF con el CSS de impresión real.
    await page.goto('/?presentacion=1');
    await expect(deck).toBeVisible();
    await settle(page);
    await page.evaluate(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        const live = document.querySelector('.ebim-presentation') as HTMLElement;
        const copy = live.cloneNode(true) as HTMLElement;
        copy.id = 'copia-impresion';
        document.body.appendChild(copy);
        const style = document.createElement('style');
        style.textContent = '.ebim-presentation:not(#copia-impresion){display:none!important}';
        document.head.appendChild(style);
        (window as unknown as { __printed: number }).__printed += 1;
      };
    });
    await page.getByRole('button', { name: /Imprimir/ }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed))
      .toBe(1);
    // Cada gráfico del documento impreso tiene su dibujo (no un hueco).
    const printedCharts = await page.evaluate(() =>
      [...document.querySelectorAll('#copia-impresion .recharts-surface')].map(
        (svg) => `${svg.getAttribute('width')}×${svg.getAttribute('height')}`,
      ),
    );
    shots.push({ file: 'graficos-impresos', charts: printedCharts });
    expect(printedCharts.length).toBeGreaterThanOrEqual(3);
    const pdfPath = resolve(OUT, 'presentacion.pdf');
    await page.emulateMedia({ media: 'print' });
    // Alto de cada diapositiva en papel (la hoja A4 apaisada con 10 mm de margen deja ~718 px).
    const slideHeights = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('#copia-impresion [data-slide]')].map((n) => [
          n.getAttribute('data-slide'),
          [
            Math.round((n as HTMLElement).getBoundingClientRect().height),
            ...[...n.children].map((c) => Math.round(c.getBoundingClientRect().height)),
          ],
        ]),
      ),
    );
    shots.push({ file: 'alturas-en-papel', slideHeights });
    await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
    const pages = (
      readFileSync(pdfPath)
        .toString('latin1')
        .match(/\/Type\s*\/Page[^s]/g) ?? []
    ).length;
    expect(pages).toBe(6);
    // Vista en papel (pantalla con CSS de impresión, ancho de A4 apaisado): para revisar sin visor de PDF.
    await page.setViewportSize({ width: 1047, height: 718 });
    await page.screenshot({ path: resolve(OUT, '17-impresion-vista-papel.png'), fullPage: true });
    shots.push({ file: 'presentacion.pdf', pages });
    await page.emulateMedia({ media: 'screen' });

    // Tablero normal impreso con Ctrl/⌘+P (sin modo presentación): sin menús, una sección por hoja.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Resumen ejecutivo' })).toBeVisible();
    await settle(page);
    await page.emulateMedia({ media: 'print' });
    const boardPdf = resolve(OUT, 'tablero.pdf');
    await page.pdf({ path: boardPdf, preferCSSPageSize: true, printBackground: true });
    const boardPages = (
      readFileSync(boardPdf)
        .toString('latin1')
        .match(/\/Type\s*\/Page[^s]/g) ?? []
    ).length;
    shots.push({ file: 'tablero.pdf', pages: boardPages });
    expect(boardPages).toBeGreaterThanOrEqual(5);
    await page.emulateMedia({ media: 'screen' });

    await context.close();
    writeFileSync(
      resolve(OUT, 'index.json'),
      JSON.stringify({ label: LABEL, generatedAt: new Date().toISOString(), shots }, null, 2),
    );
  });
});
