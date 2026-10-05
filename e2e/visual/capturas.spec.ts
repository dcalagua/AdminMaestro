import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { NAV_ITEMS } from '../../src/app/navigation';
import { login, USERS } from '../fixtures';
import { SEED, applyAppearance, setAppearance } from '../executive/support';

/**
 * Inventario visual de la consola (programa V4 «visual para Gerencia»).
 *
 * `VISUAL_LABEL=antes|despues|faseNN` decide la carpeta de salida. Sin la
 * variable el spec no corre: es material de inspección humana (antes/después),
 * no un test de regresión con snapshots auto-aprobados.
 *
 * Una pantalla rota NO detiene el recorrido: el fallo queda anotado en
 * `index.json` y se sigue con la siguiente ruta.
 *
 * Red: el navegador sólo habla con 127.0.0.1/localhost y con Google Fonts (la
 * app carga DM Sans desde ahí igual que en producción). Cualquier otro host se
 * aborta y queda registrado.
 */

const LABEL = process.env.VISUAL_LABEL;
const OUT = resolve(
  process.cwd(),
  'docs/superpowers/evidence/visual-gerencia/capturas',
  LABEL ?? 'adhoc',
);
const API_HOST = '127.0.0.1:54421';

const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  1280: { width: 1280, height: 800 },
} as const;

type Theme = 'claro' | 'oscuro';

interface Target {
  slug: string;
  path: string;
  /** Sin sesión (login, portal de pago, bienvenida). */
  public?: boolean;
  /** Ruta de listado desde la que se resuelve el id de una ficha. */
  detailFrom?: string;
  fallbackId?: string;
  /** La pantalla DEBE mostrar un estado de error (p. ej. enlace inválido). */
  expectError?: boolean;
}

interface Shot {
  route: string;
  file: string;
  theme: Theme;
  width: number;
  title: string | null;
  finalUrl: string;
  error: boolean;
  /** El error es el estado esperado de la pantalla, no un defecto. */
  expectedError: boolean;
  errorText: string | null;
  httpErrors: number;
  horizontalOverflow: boolean;
  /** Contenedores con scroll horizontal propio dentro de `main` (tablas que no caben). */
  innerOverflow: string[];
}

const ALLOWED_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);

async function guardRemote(context: BrowserContext, blocked: string[]) {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:' || ALLOWED_HOSTS.has(url.hostname)) {
      return route.continue();
    }
    blocked.push(url.hostname);
    return route.abort('blockedbyclient');
  });
}

function slugFromPath(path: string): string {
  return path === '/' ? 'resumen-ejecutivo' : path.replace(/^\//, '').replace(/\//g, '-');
}

function targets(): Target[] {
  return [
    { slug: 'login', path: '/login', public: true },
    ...NAV_ITEMS.map((item) => ({ slug: slugFromPath(item.to), path: item.to })),
    {
      slug: 'organizacion-ficha-360',
      path: '/organizations/:id',
      detailFrom: '/organizations',
      fallbackId: SEED.organizationId,
    },
    {
      slug: 'tenant-ficha',
      path: '/tenants/:id',
      detailFrom: '/tenants',
      fallbackId: SEED.tenantId,
    },
    {
      slug: 'suscripcion-ficha',
      path: '/subscriptions/:id',
      detailFrom: '/subscriptions',
      fallbackId: SEED.subscriptionId,
    },
    { slug: 'usuario-ficha', path: '/users/:id', detailFrom: '/users' },
    {
      slug: 'producto-ficha',
      path: '/products/:id',
      detailFrom: '/products',
      fallbackId: SEED.productId,
    },
    { slug: 'integracion-ficha', path: '/integrations/:id', detailFrom: '/integrations' },
    { slug: 'pagar-enlace-invalido', path: '/pagar', public: true, expectError: true },
    { slug: 'bienvenida-sin-enlace', path: '/bienvenida', public: true, expectError: true },
  ];
}

/** Espera a que la pantalla termine de cargar: red quieta, h1 visible, sin spinner/skeleton. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page
    .locator('h1')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => undefined);
  await page
    .locator('[aria-busy="true"], .animate-pulse, .animate-spin, .ebim-skeleton')
    .first()
    .waitFor({ state: 'detached', timeout: 20_000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  // Las animaciones de entrada de Recharts duran ~1.5 s.
  await page.waitForTimeout(1_600);
}

async function resolveDetailPath(page: Page, target: Target): Promise<string | null> {
  const base = target.detailFrom!;
  await page.goto(base);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  const link = page.locator(`a[href^="${base}/"]`).first();
  const href = await link
    .waitFor({ timeout: 10_000 })
    .then(() => link.getAttribute('href'))
    .catch(() => null);
  const id = href?.split(/[?#]/)[0]?.split('/').pop() ?? target.fallbackId;
  return id ? `${base}/${id}` : null;
}

async function capture(
  page: Page,
  route: string,
  file: string,
  theme: Theme,
  width: keyof typeof VIEWPORTS,
  counter: { http: number },
  expectError = false,
): Promise<Shot> {
  await page.setViewportSize(VIEWPORTS[width]);
  counter.http = 0;
  let errorText: string | null = null;
  try {
    await page.goto(route);
    await settle(page);
    await page.screenshot({ path: resolve(OUT, file), fullPage: true });
  } catch (e) {
    errorText = `captura fallida: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`;
  }
  const info = await page
    .evaluate(() => {
      const h1 = document.querySelector('h1')?.textContent?.trim() ?? null;
      const alerts = [...document.querySelectorAll('[role="alert"]')]
        .map((n) => n.textContent?.trim() ?? '')
        .filter(Boolean);
      return {
        dataTheme: document.documentElement.getAttribute('data-theme'),
        title: h1,
        alerts,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        // Tablas que no caben: el scroll propio esconde columnas (p. ej. acciones).
        // Las filas de pestañas desbordan a propósito (SectionTabs lleva la activa a la vista).
        inner: [...document.querySelectorAll('main *')]
          .filter((el) => {
            const ox = getComputedStyle(el).overflowX;
            return (
              (ox === 'auto' || ox === 'scroll') &&
              el.scrollWidth > el.clientWidth + 1 &&
              el.getAttribute('role') !== 'tablist' &&
              !el.querySelector(':scope > [role="tablist"]')
            );
          })
          .map((el) => {
            const card = el.closest('section, article, [data-panel], .ebim-card');
            const head = card?.querySelector('h2, h3')?.textContent?.trim();
            return `${head ?? el.tagName.toLowerCase()} (+${el.scrollWidth - el.clientWidth}px)`;
          }),
      };
    })
    .catch(() => ({
      dataTheme: null,
      title: null,
      alerts: [] as string[],
      overflow: false,
      inner: [] as string[],
    }));
  const finalUrl = new URL(page.url()).pathname;
  if (!errorText && info.alerts.length) errorText = info.alerts.join(' | ').slice(0, 300);
  const expectedTheme = theme === 'oscuro' ? 'dark' : 'light';
  if (!errorText && info.dataTheme !== expectedTheme)
    errorText = `tema ${info.dataTheme ?? '?'} (se esperaba ${expectedTheme})`;
  if (!errorText && finalUrl === '/404' && route !== '/404') errorText = 'redirigida a /404';
  return {
    route,
    file,
    theme,
    width,
    title: info.title,
    finalUrl,
    error: errorText !== null,
    expectedError: expectError && errorText !== null,
    errorText,
    httpErrors: counter.http,
    horizontalOverflow: info.overflow,
    innerOverflow: info.inner,
  };
}

/**
 * Fija el tema desde Configuración y espera a que el perfil lo guarde: la
 * preferencia del perfil manda al recargar, y navegar antes de que termine el
 * PATCH dejaría el tema anterior. Justo después del login la hidratación del
 * perfil puede pisar el clic: se reintenta.
 */
async function setTheme(page: Page, theme: Theme) {
  for (let attempt = 1; ; attempt += 1) {
    const saved = page
      .waitForResponse(
        (r) => r.url().includes('/rest/v1/profiles') && r.request().method() === 'PATCH',
        { timeout: 8_000 },
      )
      .catch(() => undefined);
    try {
      await applyAppearance(page, theme === 'oscuro' ? 'dark' : 'light');
      await saved;
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      return;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
}

async function newContext(browser: Browser, theme: Theme, blocked: string[]) {
  const context = await browser.newContext({ viewport: VIEWPORTS[1440], locale: 'es-PE' });
  await guardRemote(context, blocked);
  const page = await context.newPage();
  await setAppearance(page, theme === 'oscuro' ? 'dark' : 'light');
  const counter = { http: 0 };
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes(API_HOST)) counter.http += 1;
  });
  return { context, page, counter };
}

test.describe('inventario visual de la consola', () => {
  test.skip(!LABEL, 'Definir VISUAL_LABEL=antes|despues|faseNN para generar el inventario');

  test('super admin · todas las rutas', async ({ browser }) => {
    test.setTimeout(30 * 60_000);
    mkdirSync(OUT, { recursive: true });
    const shots: Shot[] = [];
    const blocked: string[] = [];
    const all = targets();
    const num = (i: number) => String(i + 1).padStart(2, '0');

    // 1) Pantallas públicas, sin sesión.
    {
      const { context, page, counter } = await newContext(browser, 'claro', blocked);
      for (const [i, t] of all.entries()) {
        if (!t.public) continue;
        shots.push(
          await capture(
            page,
            t.path,
            `${num(i)}-${t.slug}-claro.png`,
            'claro',
            1440,
            counter,
            t.expectError,
          ),
        );
      }
      await context.close();
    }

    // 2) Consola completa en claro a 1440×900 como super admin.
    const { context, page, counter } = await newContext(browser, 'claro', blocked);
    await login(page, USERS.superAdmin);
    // La preferencia del perfil manda sobre el almacenamiento local: se fija explícitamente.
    await setTheme(page, 'claro');
    for (const [i, t] of all.entries()) {
      if (t.public) continue;
      const route = t.detailFrom ? await resolveDetailPath(page, t).catch(() => null) : t.path;
      if (!route) {
        shots.push({
          route: t.path,
          file: '',
          theme: 'claro',
          width: 1440,
          title: null,
          finalUrl: '',
          error: true,
          expectedError: false,
          errorText: 'no se encontró un registro para abrir la ficha',
          httpErrors: 0,
          horizontalOverflow: false,
          innerOverflow: [],
        });
        continue;
      }
      shots.push(
        await capture(page, route, `${num(i)}-${t.slug}-claro.png`, 'claro', 1440, counter),
      );
    }

    // 3) Resumen ejecutivo a 1280×800 y en oscuro.
    const dashboard = all.findIndex((t) => t.path === '/');
    const dashSlug = `${num(dashboard)}-${all[dashboard]!.slug}`;
    shots.push(await capture(page, '/', `${dashSlug}-1280-claro.png`, 'claro', 1280, counter));
    await page.setViewportSize(VIEWPORTS[1440]);
    await setTheme(page, 'oscuro');
    shots.push(await capture(page, '/', `${dashSlug}-oscuro.png`, 'oscuro', 1440, counter));
    shots.push(await capture(page, '/', `${dashSlug}-1280-oscuro.png`, 'oscuro', 1280, counter));
    // Deja el perfil local como estaba (claro) para las corridas siguientes.
    await page.setViewportSize(VIEWPORTS[1440]);
    await setTheme(page, 'claro');
    await context.close();

    const unexpected = [...new Set(blocked)];
    writeFileSync(
      resolve(OUT, 'index.json'),
      JSON.stringify(
        {
          label: LABEL,
          generatedAt: new Date().toISOString(),
          total: shots.length,
          withErrors: shots.filter((s) => s.error && !s.expectedError).length,
          withInnerOverflow: shots.filter((s) => s.innerOverflow.length).length,
          blockedHosts: unexpected,
          shots,
        },
        null,
        2,
      ),
    );
    expect(unexpected, 'ningún host remoto inesperado').toEqual([]);
  });
});
