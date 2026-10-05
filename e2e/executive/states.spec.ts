import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { USERS, applyAppearance, guardRemote, login, settle, unexpectedRemoteHosts } from './support';

/**
 * Estados, roles y densidades (spec §15.1, AC05/AC06/AC11/AC13).
 *
 * Además de capturas, cada caso AFIRMA la semántica: un error no se pinta como
 * cero, una función ausente se rotula «No disponible», el perfil técnico no
 * recibe finanzas y una sesión nueva no hereda datos de la anterior.
 * Los fallos se inyectan en el navegador (route.fulfill): no se toca la base.
 */
const OUT = resolve(process.cwd(), 'docs/superpowers/evidence/executive-experience/screenshots/after/states');
const shots: Array<{ file: string; case: string }> = [];

async function shot(page: Page, name: string, caseLabel: string) {
  mkdirSync(OUT, { recursive: true });
  await settle(page);
  const file = `${name}.jpg`;
  await page.screenshot({ path: resolve(OUT, file), fullPage: true, type: 'jpeg', quality: 70 });
  shots.push({ file, case: caseLabel });
}

test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'index.json'), JSON.stringify(shots, null, 2));
});

test('perfiles: partner, técnico, comercial y tenant sólo ven lo suyo', async ({ browser }) => {
  const cases: Array<{ user: string; name: string; paths: string[] }> = [
    { user: USERS.partnerAdmin, name: 'partner', paths: ['/', '/costs', '/billing'] },
    { user: 'ewm.owner@ebim.test', name: 'tecnico-ewm', paths: ['/', '/billing'] },
    { user: USERS.salesAgent, name: 'comercial', paths: ['/'] },
    { user: USERS.tenantAdmin, name: 'tenant', paths: ['/'] },
  ];
  for (const c of cases) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const guard = await guardRemote(context);
    const page = await context.newPage();
    await login(page, c.user);
    for (const path of c.paths) {
      await page.goto(path);
      await settle(page);
      await shot(page, `role-${c.name}${path.replace(/\//g, '-') || '-home'}`, `perfil ${c.name} en ${path}`);
    }
    if (c.name === 'tecnico-ewm') {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Resumen de operación SaaS' })).toBeVisible();
      await expect(page.locator('[data-hero]')).toHaveCount(0);
      await page.goto('/billing');
      await expect(page.getByRole('heading', { name: 'Sin acceso a información financiera' })).toBeVisible();
    }
    if (c.name === 'partner') {
      await page.goto('/costs');
      await expect(page.getByRole('heading', { name: 'Sin acceso a esta sección' })).toBeVisible();
    }
    expect(unexpectedRemoteHosts(guard)).toEqual([]);
    await context.close();
  }
});

test('error, no disponible, carga y vacío son distintos de cero', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const guard = await guardRemote(context);
  const page = await context.newPage();
  await login(page, USERS.superAdmin);

  // Error: la agregación responde 500.
  await page.route('**/rest/v1/rpc/invoice_summary', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'fallo simulado de lectura' }) }),
  );
  await page.goto('/billing');
  await expect(page.getByText('No se pudo leer este dato').first()).toBeVisible();
  await shot(page, 'state-error-billing-summary', 'error de la agregación: error explícito, nunca 0');
  await page.unroute('**/rest/v1/rpc/invoice_summary');
  // En el resumen V4 el cobrado y la vencida salen de executive_billing_series.
  await page.route('**/rest/v1/rpc/executive_billing_series', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'fallo simulado de lectura' }) }),
  );
  await page.goto('/');
  const hero = page.getByRole('region', { name: 'Indicadores clave' });
  await expect(hero.getByRole('alert').first()).toContainText('No disponible');
  await expect(hero).toContainText('MRR');
  await shot(page, 'state-error-dashboard-k03-k04', 'error en cobrado/vencida sin afectar al resto');
  await page.unroute('**/rest/v1/rpc/executive_billing_series');

  // No disponible: entorno SIN la migración nueva (función inexistente).
  await page.route('**/rest/v1/rpc/executive_billing_series', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function platform.executive_billing_series' }),
    }),
  );
  await page.goto('/');
  await expect(page.locator('[data-panel="facturado-cobrado"]')).toContainText('No disponible');
  await shot(page, 'state-unavailable-without-migration', 'entorno sin migración: «No disponible», no totales inventados');
  await page.unroute('**/rest/v1/rpc/executive_billing_series');

  // Carga: la serie de MRR tarda (skeletons del resumen).
  await page.route('**/rest/v1/rpc/executive_mrr_series', async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  await page.goto('/');
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(OUT, 'state-loading-dashboard.jpg'), type: 'jpeg', quality: 70 });
  shots.push({ file: 'state-loading-dashboard.jpg', case: 'carga de la serie de MRR' });
  await page.unroute('**/rest/v1/rpc/executive_mrr_series');

  // Vacío: búsqueda sin resultados.
  await page.goto('/billing?q=zzz-no-existe');
  await expect(page.getByText('Sin facturas').first()).toBeVisible();
  await shot(page, 'state-empty-billing-search', 'vacío por búsqueda');

  // Muchos registros: el total del universo, no el lote.
  await page.goto('/billing');
  await shot(page, 'state-many-records-billing', 'más de 200 facturas: total real y paginación');

  expect(unexpectedRemoteHosts(guard)).toEqual([]);
  await context.close();
});

test('densidades y modos del sistema de componentes', async ({ browser }) => {
  for (const mode of ['light', 'dark'] as const) {
    for (const density of ['comoda', 'equilibrada', 'compacta'] as const) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await guardRemote(context);
      const page = await context.newPage();
      await login(page, USERS.superAdmin);
      await applyAppearance(page, mode, density);
      await shot(page, `components-settings-${mode}-${density}`, `componentes ${mode} ${density}`);
      await page.goto('/billing');
      await shot(page, `components-billing-${mode}-${density}`, `tabla ${mode} ${density}`);
      await context.close();
    }
  }
});

test('E11 en navegador real: la sesión B no ve datos de A', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guardRemote(context);
  const page = await context.newPage();

  await login(page, USERS.superAdmin);
  await page.goto('/billing?q=DEMO-EXEC-0002');
  await expect(page.getByText('DEMO-EXEC-0002').first()).toBeVisible();
  await page.getByRole('button', { name: 'Menú de cuenta' }).first().click();
  await page.getByRole('menuitem', { name: 'Salir' }).click();
  await expect(page.getByLabel('Correo corporativo')).toBeVisible();

  // Mismo navegador, otra identidad (partner de otra organización).
  await login(page, USERS.otherPartnerAdmin);
  await page.goto('/billing?q=DEMO-EXEC-0002');
  await settle(page);
  await expect(page.getByText('DEMO-EXEC-0002')).toHaveCount(0);
  await expect(page.getByText('Dennis Calagua')).toHaveCount(0);
  await shot(page, 'session-b-after-a', 'sesión B tras A: sin filas ni identidad de A');
  await context.close();
});

test.afterAll(async ({ browser }) => {
  // Deja al super admin en claro/equilibrada para las capturas siguientes.
  const context = await browser.newContext();
  await guardRemote(context);
  const page = await context.newPage();
  await login(page, USERS.superAdmin);
  await applyAppearance(page, 'light', 'equilibrada');
  await context.close();
});
