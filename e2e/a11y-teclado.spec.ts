import { expect, test, type Page } from '@playwright/test';
import { login as loginOnce, settle } from './executive/support';
import { USERS } from './fixtures';

/**
 * Teclado y movimiento (VISUAL_SYSTEM_V2 §7, U-10): foco visible en el shell,
 * paleta ⌘K, trampa de foco en diálogos, pestañas con flechas y
 * `prefers-reduced-motion`. Contra la app real: lo que ve quien navega sin mouse.
 */

/** El auth local tiene timeouts intermitentes con la máquina cargada: un reintento. */
async function login(page: Page, email: string) {
  try {
    await loginOnce(page, email);
  } catch {
    await loginOnce(page, email);
  }
}

/** El elemento enfocado dibuja un anillo de al menos 2 px (outline o box-shadow). */
async function focusRing(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: 'body', visible: false };
    const cs = getComputedStyle(el);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
    const ring = cs.boxShadow !== 'none' && cs.boxShadow !== '';
    return {
      tag: `${el.tagName.toLowerCase()} ${el.textContent?.trim().slice(0, 30) ?? ''}`,
      visible: outline || ring,
    };
  });
}

async function activeInside(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    return Boolean(root && document.activeElement && root.contains(document.activeElement));
  }, selector);
}

test.describe('teclado y movimiento', () => {
  test('foco visible en el shell y saltar al contenido', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await page.goto('/customers');
    await settle(page);
    // Al navegar el foco va al h1 (fase 06): el enlace de salto se alcanza
    // volviendo hacia atrás con el teclado, como haría quien no usa mouse.
    const skip = page.getByRole('link', { name: 'Saltar al contenido' });
    await page.keyboard.press('Tab');
    for (
      let i = 0;
      i < 60 && !(await skip.evaluate((el) => el === document.activeElement));
      i += 1
    ) {
      await page.keyboard.press('Shift+Tab');
    }
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    expect((await focusRing(page)).visible).toBe(true);
    // Los siguientes pasos recorren marca, menú lateral y topbar: todos con anillo.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      const ring = await focusRing(page);
      expect(ring.visible, `sin anillo de foco en «${ring.tag}»`).toBe(true);
    }
    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#contenido$/);
  });

  test('⌘K abre la paleta, confina el foco y Escape la cierra', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await page.goto('/');
    await settle(page);
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Buscar y navegar' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('combobox')).toBeFocused();
    await palette.getByRole('combobox').fill('clientes');
    await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      expect(await activeInside(page, '[role="dialog"]')).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  });

  test('un diálogo atrapa el foco y lo devuelve al botón que lo abrió', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await page.goto('/customers');
    await settle(page);
    const opener = page.getByRole('button', { name: 'Nuevo cliente' });
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      expect(await activeInside(page, '[role="dialog"]'), `Tab ${i + 1} salió del diálogo`).toBe(
        true,
      );
      expect((await focusRing(page)).visible).toBe(true);
    }
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await activeInside(page, '[role="dialog"]')).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('las pestañas se recorren con flechas y actualizan el #hash', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await page.goto('/billing');
    await settle(page);
    const first = page.getByRole('tab', { name: 'Facturas' });
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await first.focus();
    await page.keyboard.press('ArrowRight');
    const second = page.getByRole('tab', { name: 'Cobros confirmados' });
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute('aria-selected', 'true');
    expect((await focusRing(page)).visible).toBe(true);
    await expect(page).toHaveURL(/#/);
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
  });

  test('prefers-reduced-motion apaga transiciones y animaciones', async ({ browser }) => {
    const measure = async (reducedMotion: 'reduce' | 'no-preference') => {
      const context = await browser.newContext({ locale: 'es-PE', reducedMotion });
      const page = await context.newPage();
      await page.goto('/login');
      const button = page.getByRole('button', { name: 'Ingresar' });
      await expect(button).toBeVisible();
      const durations = await button.evaluate((el) => {
        const cs = getComputedStyle(el);
        const max = (v: string) => Math.max(...v.split(',').map((s) => parseFloat(s) || 0));
        return { transition: max(cs.transitionDuration) };
      });
      // El skeleton es la animación infinita de la app: con «reduce» queda quieto.
      const skeleton = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.className = 'ebim-skeleton';
        document.body.append(probe);
        const cs = getComputedStyle(probe);
        const result = {
          duration: parseFloat(cs.animationDuration) || 0,
          iterations: cs.animationIterationCount,
        };
        probe.remove();
        return result;
      });
      await context.close();
      return { ...durations, skeleton };
    };
    const normal = await measure('no-preference');
    const reduced = await measure('reduce');
    expect(normal.transition).toBeGreaterThan(0.05);
    expect(normal.skeleton.iterations).toBe('infinite');
    expect(reduced.transition).toBeLessThan(0.01);
    expect(reduced.skeleton.duration).toBeLessThan(0.01);
    expect(reduced.skeleton.iterations).toBe('1');
  });
});
