import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { NAV_ITEMS } from '../../src/app/navigation';

/**
 * V6 · F5 · Guarda visual de TEXTO ENCIMADO y TRUNCADO.
 *
 * Recorre, con login, cada entrada del menú, cada pestaña del hub (`?tab=`) y
 * cada pestaña de sección de la página, más una ficha de cada tipo (las fichas
 * de app, todas) a 1440 y a 390 px. En cada pantalla busca:
 *
 * 1. **Solapes**: dos textos visibles cuyas cajas de línea (rangos de texto,
 *    no cajas de elemento) se intersectan, ya recortadas por sus contenedores
 *    con `overflow` distinto de `visible`.
 * 2. **Truncados sin `title`**: un elemento con texto que se corta
 *    (`text-overflow: ellipsis`, `line-clamp` o `overflow: hidden` en una
 *    línea) sin un `title` propio o de un antecesor que diga el texto entero.
 *
 * Generaliza `desbordes.spec.ts` y, a diferencia del resto de `e2e/`, NO
 * necesita el stack local: corre contra cualquier URL ya servida.
 *
 *   BASE_URL=http://127.0.0.1:5199 GUARD_EMAIL=… GUARD_PASSWORD=… \
 *     npx playwright test -c playwright.visual.config.ts
 *
 * Variables opcionales: `GUARD_ONLY=/cuentas,/apps` (limita rutas),
 * `GUARD_WIDTHS=390` (anchos), `GUARD_OUT=ruta.json` (informe de hallazgos),
 * `GUARD_SHOTS=carpeta` (captura de cada pantalla con hallazgos, marcados en rojo).
 */

const EMAIL = process.env.GUARD_EMAIL ?? process.env.SMOKE_EMAIL;
const PASSWORD = process.env.GUARD_PASSWORD ?? process.env.SMOKE_PASSWORD;
const ONLY = process.env.GUARD_ONLY?.split(',').filter(Boolean);
const WIDTHS = (process.env.GUARD_WIDTHS ?? '1440,390').split(',').map(Number);
const OUT = process.env.GUARD_OUT;
const SHOTS = process.env.GUARD_SHOTS;

interface Finding {
  width: number;
  screen: string;
  kind: 'solape' | 'truncado';
  detail: string;
}

/** Pantallas del menú: la entrada y cada pestaña `?tab=` (la primera es la entrada). */
function menuScreens(): string[] {
  const screens: string[] = [];
  for (const item of NAV_ITEMS) {
    screens.push(item.to);
    for (const tab of (item.tabs ?? []).slice(1)) screens.push(`${item.to}?tab=${tab.id}`);
  }
  return screens;
}

function wanted(route: string): boolean {
  if (!ONLY) return true;
  const path = route.split('?')[0]!;
  return ONLY.some((o) => path === o || path.startsWith(`${o}/`));
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  for (const sel of ['[aria-busy="true"]', '.ebim-skeleton']) {
    await page
      .locator(sel)
      .first()
      .waitFor({ state: 'detached', timeout: 15_000 })
      .catch(() => undefined);
  }
  await page.evaluate(() => document.fonts?.ready);
  // Animaciones de entrada (fade/slide) y gráficos: ya quietos.
  await page.waitForTimeout(700);
}

/**
 * Inspección en el navegador. Devuelve frases legibles: «"Texto A" ↔ "Texto B"»
 * o «"Texto…" (span.truncate)».
 */
async function inspect(page: Page): Promise<Array<{ kind: Finding['kind']; detail: string }>> {
  return page.evaluate(() => {
    type Box = { left: number; top: number; right: number; bottom: number };
    const found: Array<{ kind: 'solape' | 'truncado'; detail: string }> = [];
    const short = (s: string) => {
      const t = s.replace(/\s+/g, ' ').trim();
      return t.length > 48 ? `${t.slice(0, 47)}…` : t;
    };
    const isHidden = (el: Element) => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
        // `sr-only`: recortado a 1 px.
        if (cs.position === 'absolute' && (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)')) {
          return true;
        }
        if (n.getAttribute('aria-hidden') === 'true' && n.tagName.toLowerCase() === 'svg') return true;
        // Contenido de un `<details>` cerrado (solo se ve su `<summary>`): Chromium lo
        // sigue maquetando debajo, pero no se pinta.
        const parent = n.parentElement;
        if (parent instanceof HTMLDetailsElement && !parent.open && n.tagName !== 'SUMMARY') return true;
      }
      return false;
    };
    /** Rectángulo visible: recortado por cada antecesor con overflow ≠ visible y por la ventana. */
    const clipOf = (el: Element): Box | null => {
      let box: Box = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };
      // Empieza en el propio elemento: un `truncate` recorta su propio texto.
      for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const r = n.getBoundingClientRect();
          box = {
            left: Math.max(box.left, r.left),
            top: Math.max(box.top, r.top),
            right: Math.min(box.right, r.right),
            bottom: Math.min(box.bottom, r.bottom),
          };
        }
        if (cs.position === 'fixed') break;
      }
      return box.right > box.left && box.bottom > box.top ? box : null;
    };
    const intersect = (a: Box, b: Box): Box | null => {
      const r = {
        left: Math.max(a.left, b.left),
        top: Math.max(a.top, b.top),
        right: Math.min(a.right, b.right),
        bottom: Math.min(a.bottom, b.bottom),
      };
      return r.right > r.left && r.bottom > r.top ? r : null;
    };
    /** Capa de apilado aproximada: lo fijo o pegajoso (barra superior, cabeceras) va aparte. */
    const layerOf = (el: Element): Element | null => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const p = getComputedStyle(n).position;
        if (p === 'fixed' || p === 'sticky') return n;
      }
      return null;
    };

    // ---- 1) Solapes de texto ---------------------------------------------------------
    type Piece = { el: Element; text: string; rects: Box[]; layer: Element | null };
    const pieces: Piece[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      if (!text.trim()) continue;
      const el = node.parentElement;
      if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'OPTION'].includes(el.tagName)) continue;
      if (isHidden(el)) continue;
      const clip = clipOf(el);
      if (!clip) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects: Box[] = [];
      for (const r of range.getClientRects()) {
        if (r.width < 2 || r.height < 2) continue;
        // Caja de línea ajustada: el glifo ocupa ~70 % central del alto de línea.
        const pad = r.height * 0.15;
        const visible = intersect({ left: r.left, top: r.top + pad, right: r.right, bottom: r.bottom - pad }, clip);
        if (visible) rects.push(visible);
      }
      if (rects.length) pieces.push({ el, text, rects, layer: layerOf(el) });
    }
    const seen = new Set<string>();
    for (let i = 0; i < pieces.length; i += 1) {
      for (let j = i + 1; j < pieces.length; j += 1) {
        const a = pieces[i]!;
        const b = pieces[j]!;
        if (a.el === b.el) continue;
        // Un panel fijo o pegajoso tapa (no pisa) lo que pasa por debajo.
        if (a.layer !== b.layer) continue;
        let hit: Box | null = null;
        for (const ra of a.rects) {
          for (const rb of b.rects) {
            const x = intersect(ra, rb);
            if (x && x.right - x.left >= 3 && x.bottom - x.top >= 3) hit = x;
          }
        }
        if (!hit) continue;
        const key = `${short(a.text)}|${short(b.text)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ kind: 'solape', detail: `«${short(a.text)}» ↔ «${short(b.text)}»` });
        for (const el of [a.el, b.el]) (el as HTMLElement).style.outline = '2px solid red';
      }
    }

    // ---- 2) Truncados sin title -------------------------------------------------------
    const titled = (el: Element) => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        if (n.getAttribute('title')?.trim()) return true;
        if (n.tagName === 'MAIN' || n.tagName === 'BODY') break;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      if (!(el instanceof HTMLElement)) continue;
      if (['SVG', 'svg', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE'].includes(el.tagName)) continue;
      const cs = getComputedStyle(el);
      const ellipsis = cs.textOverflow === 'ellipsis';
      const clamp = cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '' && cs.webkitLineClamp !== undefined;
      const clipsOneLine = cs.overflowX === 'hidden' && cs.whiteSpace === 'nowrap';
      if (!ellipsis && !clamp && !clipsOneLine) continue;
      const text = el.textContent?.trim() ?? '';
      if (!text) continue;
      const cut = (clamp && el.scrollHeight > el.clientHeight + 1) || el.scrollWidth > el.clientWidth + 1;
      if (!cut) continue;
      if (isHidden(el) || el.getBoundingClientRect().width < 1) continue;
      if (titled(el)) continue;
      const cls = (el.getAttribute('class') ?? '').split(/\s+/).slice(0, 3).join('.');
      el.style.outline = '2px dashed red';
      found.push({ kind: 'truncado', detail: `«${short(text)}» (${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''})` });
    }
    return found;
  });
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/correo/i).fill(EMAIL!);
  await page.locator('#login-password').fill(PASSWORD!);
  await page.getByRole('button', { name: /ingresar|iniciar|entrar/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

/** Una ficha de cada tipo, tomada del propio listado (los ids dependen del entorno). */
async function discoverDetails(page: Page): Promise<string[]> {
  const details: string[] = [];
  // Las 8 fichas de app: la franja de salud del Centro de la suite lleva el código de cada una.
  await page.goto('/suite');
  await settle(page);
  const codes = await page
    .locator('[data-app-health]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-app-health') ?? '').filter(Boolean));
  details.push(...[...new Set(codes)].map((c) => `/apps/${c}`));
  const sources: Array<[string, RegExp, number]> = [
    ['/cuentas', /^\/organizations\/[0-9a-f-]{36}$/, 1],
    ['/tenants', /^\/tenants\/[0-9a-f-]{36}$/, 1],
    ['/subscriptions', /^\/subscriptions\/[0-9a-f-]{36}$/, 1],
    ['/catalogo', /^\/products\/[0-9a-f-]{36}$/, 1],
    ['/apps', /^\/integrations\/[0-9a-f-]{36}$/, 1],
    ['/users', /^\/users\/[0-9a-f-]{36}$/, 1],
  ];
  for (const [from, pattern, max] of sources) {
    await page.goto(from);
    await settle(page);
    const hrefs = await page.locator('main a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    const unique = [...new Set(hrefs.filter((h) => pattern.test(h)))];
    details.push(...unique.slice(0, max));
  }
  return details;
}

test('ningún texto se encima ni se trunca sin title (1440 y 390)', async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, 'Definir GUARD_EMAIL y GUARD_PASSWORD (y BASE_URL)');
  test.setTimeout(60 * 60_000);
  await login(page);
  const screens = [...menuScreens(), ...(await discoverDetails(page))].filter(wanted);
  const findings: Finding[] = [];
  const record = async (width: number, screen: string, list: Array<{ kind: Finding['kind']; detail: string }>) => {
    for (const f of list) findings.push({ width, screen, ...f });
    if (SHOTS && list.length > 0) {
      mkdirSync(SHOTS, { recursive: true });
      const name = `${screen.replace(/^\/(?=$| )/, 'inicio').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}@${width}.png`;
      await page.screenshot({ path: resolve(SHOTS, name), fullPage: true });
    }
  };

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    for (const screen of screens) {
      await page.goto(screen);
      await page.locator('h1').first().waitFor({ timeout: 20_000 }).catch(() => undefined);
      await settle(page);
      await record(width, screen, await inspect(page));
      // Pestañas de sección dentro de la página (SectionTabs): otra pantalla cada una.
      // En móvil, si no caben, son un `select` con el mismo nombre (V6 · F5).
      const tabs = page.locator('main [role="tablist"][aria-label="Secciones"]').first().getByRole('tab');
      const select = page.locator('main select[aria-label="Secciones"]').first();
      const names = (await tabs.allTextContents()).map((t) => t.trim());
      for (const [i, name] of names.entries()) {
        if (i === 0) continue;
        await tabs.nth(i).click();
        await settle(page);
        await record(width, `${screen} › ${name}`, await inspect(page));
      }
      if (names.length === 0 && (await select.count()) > 0) {
        const options = await select.locator('option').evaluateAll((os) =>
          os.map((o) => [(o as HTMLOptionElement).value, o.textContent?.trim() ?? ''] as const),
        );
        for (const [value, name] of options.slice(1)) {
          await select.selectOption(value);
          await settle(page);
          await record(width, `${screen} › ${name}`, await inspect(page));
        }
      }
    }
  }

  if (OUT) {
    mkdirSync(dirname(resolve(OUT)), { recursive: true });
    writeFileSync(resolve(OUT), JSON.stringify({ screens: screens.length, widths: WIDTHS, findings }, null, 2));
  }
  const lines = findings.map((f) => `${f.width} ${f.screen} · ${f.kind}: ${f.detail}`);
  expect(lines, lines.join('\n')).toEqual([]);
});
