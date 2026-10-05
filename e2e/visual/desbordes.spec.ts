import { expect, test, type Page } from '@playwright/test';
import { NAV_ITEMS } from '../../src/app/navigation';
import { SEED, login, settle } from '../executive/support';
import { USERS } from '../fixtures';

/**
 * Criterio de aceptación visual del programa V4 (QUALITY_GATE): ninguna
 * pantalla desborda a 1440×900 ni a 1280×800 — ni la página ni una tabla que
 * esconda columnas tras su propio scroll horizontal (la última suele ser la de
 * acciones). Las filas de pestañas pueden desbordar: SectionTabs lleva la
 * activa a la vista.
 *
 * Recorre cada ruta del menú y las fichas del seed, con todas sus pestañas
 * de sección, como super admin (ve todas las columnas).
 */

const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
] as const;

/** `DESBORDES_ONLY=/billing,/costs` limita el recorrido al iterar. */
const ONLY = process.env.DESBORDES_ONLY?.split(',').filter(Boolean);

function routes(): string[] {
  const all = [
    ...NAV_ITEMS.map((item) => item.to),
    `/organizations/${SEED.organizationId}`,
    `/tenants/${SEED.tenantId}`,
    `/subscriptions/${SEED.subscriptionId}`,
    `/products/${SEED.productId}`,
  ];
  return ONLY ? all.filter((r) => ONLY.some((o) => r === o || r.startsWith(`${o}/`))) : all;
}

async function quiet(page: Page) {
  await settle(page);
  await page
    .locator('.ebim-skeleton')
    .first()
    .waitFor({ state: 'detached', timeout: 15_000 })
    .catch(() => undefined);
}

async function overflowsOf(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      found.push(`página (+${doc.scrollWidth - doc.clientWidth}px)`);
    }
    for (const el of document.querySelectorAll('main *')) {
      const ox = getComputedStyle(el).overflowX;
      if (ox !== 'auto' && ox !== 'scroll') continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      if (el.getAttribute('role') === 'tablist' || el.querySelector(':scope > [role="tablist"]')) {
        continue;
      }
      const card = el.closest('section, article, [data-panel], .ebim-card');
      const head = card?.querySelector('h2, h3')?.textContent?.trim();
      // Ancho de cada columna: dice qué celda empuja la tabla.
      const cols = [...el.querySelectorAll('thead th')]
        .map(
          (th) =>
            `${th.textContent?.trim() || '·'} ${Math.round(th.getBoundingClientRect().width)}`,
        )
        .join(' | ');
      found.push(
        `${head ?? el.tagName.toLowerCase()} (+${el.scrollWidth - el.clientWidth}px)${cols ? ` [${cols}]` : ''}`,
      );
    }
    return found;
  });
}

test('ninguna pantalla desborda a 1440 ni a 1280', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  // El auth local tiene timeouts intermitentes con la máquina cargada: un reintento.
  await login(page, USERS.superAdmin).catch(() => login(page, USERS.superAdmin));
  const problems: string[] = [];
  for (const viewport of WIDTHS) {
    await page.setViewportSize(viewport);
    for (const route of routes()) {
      await page.goto(route);
      await page.locator('h1').first().waitFor({ timeout: 15_000 });
      await settle(page);
      await quiet(page);
      for (const what of await overflowsOf(page)) {
        problems.push(`${viewport.width} ${route}: ${what}`);
      }
      // Cada pestaña de sección de la página (SectionTabs) es otra pantalla.
      const tabs = page
        .locator('main [role="tablist"][aria-label="Secciones"]')
        .first()
        .getByRole('tab');
      const names = (await tabs.allTextContents()).map((t) => t.trim());
      for (const [i, name] of names.entries()) {
        if (i === 0) continue;
        await tabs.nth(i).click();
        await quiet(page);
        for (const what of await overflowsOf(page)) {
          problems.push(`${viewport.width} ${route} › ${name}: ${what}`);
        }
      }
    }
  }
  expect(problems, problems.join('\n')).toEqual([]);
});
