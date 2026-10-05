import { expect, test } from '@playwright/test';
import { login, USERS } from './fixtures';

/**
 * Humo de los módulos de cobro y usuarios (spec 2026-10-04) contra la app real
 * y el Supabase local con seed. El pago del portal necesita las Edge Functions
 * locales en MOCK:
 *
 *   supabase functions serve --env-file <archivo con PAYMENT_PORTAL_ALLOW_MOCK=true
 *     y MASTERADMIN_ALLOWED_ORIGINS=http://127.0.0.1:5199>
 *
 * Sin `CCP_PORTAL_E2E=1` solo se recorren las pantallas de consola.
 */

const ALPHA_ORG_ID = '30000000-0000-4000-a000-000000000004'; // Empresa Directa Alpha (seed)

const CONSOLE_PAGES: Array<{ path: string; heading: RegExp }> = [
  { path: '/users', heading: /Usuarios y accesos/ },
  { path: '/usage', heading: /Uso/ },
  { path: '/ai-credits', heading: /Créditos IA/ },
  { path: '/billing-shadow', heading: /Billing shadow/i },
  { path: '/partner-fees', heading: /Tarifas de partners/ },
];

test('las pantallas nuevas cargan para el super admin', async ({ page }) => {
  await login(page, USERS.superAdmin);
  for (const { path, heading } of CONSOLE_PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText('No se pudo cargar')).toHaveCount(0);
  }
});

test('finanzas genera un enlace y el cliente paga en /pagar (MOCK)', async ({ page, browser }) => {
  test.skip(process.env.CCP_PORTAL_E2E !== '1', 'requiere supabase functions serve en MOCK');

  await login(page, USERS.finance);
  await page.goto(`/organizations/${ALPHA_ORG_ID}#payment-portal`);
  await page.getByRole('button', { name: 'Generar enlace' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Generar/ }).click();
  const url = await page.getByLabel('Enlace para el cliente').inputValue();
  expect(url).toMatch(/\/pagar#[A-Za-z0-9_-]{43}$/);

  // El cliente no tiene sesión: contexto nuevo.
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(url);
  await expect(customer.getByText('Modo de prueba', { exact: false }).first()).toBeVisible();
  await customer.getByRole('button', { name: 'Pagar' }).first().click();
  await customer.getByRole('dialog').getByRole('button', { name: 'Continuar' }).click();
  await expect(customer.getByText(/Pago (registrado|recibido|confirmado)/i).first()).toBeVisible({ timeout: 20_000 });
});
