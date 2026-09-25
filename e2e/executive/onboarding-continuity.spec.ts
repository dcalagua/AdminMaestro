import { expect, test } from '@playwright/test';
import { USERS, guardRemote, login, unexpectedRemoteHosts } from './support';

/**
 * T20 · Nueva venta (P20, spec §11.3, AC16). Contra el Supabase LOCAL dedicado.
 *  - doble clic en «Crear cliente» crea UNA operación;
 *  - volver atrás conserva lo escrito;
 *  - al terminar, el Tenant 360 recibe el contexto (enlace al contrato);
 *  - navegar por esos enlaces no crea ninguna alta SaaS.
 */
const RUN = Date.now().toString(36).slice(-6);

test('nueva venta: sin doble operación, datos conservados y continuidad sin alta SaaS', async ({ browser }) => {
  const context = await browser.newContext();
  const guard = await guardRemote(context);
  const page = await context.newPage();

  // Cuenta las llamadas a la RPC de alta y cualquier intento de provisioning SaaS.
  const rpcCalls: string[] = [];
  page.on('request', (r) => {
    const m = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(r.url());
    if (m && r.method() === 'POST') rpcCalls.push(m[1]!);
  });

  await login(page, USERS.superAdmin);
  await page.goto('/onboarding');
  await page.getByLabel('Organización cliente').selectOption({ label: 'Empresa Directa Alpha' });
  await page.getByLabel('Producto SaaS').selectOption({ label: 'eSupplier (esupplier)' });
  await page.getByRole('button', { name: 'Continuar' }).click();

  await page.getByLabel('Nombre del tenant').fill(`Exec E2E ${RUN}`);
  await page.getByLabel('Slug').fill(`exec-e2e-${RUN}`);
  await page.getByLabel('Correo del administrador del cliente').fill(`admin-${RUN}@exec-e2e.com`);
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Volver atrás conserva lo escrito.
  await page.getByRole('button', { name: 'Atrás' }).click();
  await expect(page.getByLabel('Nombre del tenant')).toHaveValue(`Exec E2E ${RUN}`);
  await expect(page.getByLabel('Slug')).toHaveValue(`exec-e2e-${RUN}`);
  await page.getByRole('button', { name: 'Continuar' }).click();

  await page.getByLabel('Moneda').selectOption('USD');
  await page.getByLabel('Plan').selectOption({ label: 'eSupplier Shared Standard' });
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Doble clic: una sola operación.
  await page.getByRole('button', { name: 'Crear cliente' }).dblclick();
  await expect(page.getByText('Alta completada')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: `Exec E2E ${RUN}` })).toBeVisible({ timeout: 15_000 });
  expect(rpcCalls.filter((c) => c === 'onboard_customer_subscription')).toHaveLength(1);

  // Continuidad: el Tenant 360 ofrece los siguientes pasos con contexto.
  const next = page.getByRole('region', { name: 'Venta registrada: siguientes pasos' });
  await expect(next).toBeVisible();
  await expect(next.getByRole('link', { name: 'Revisar el contrato' })).toHaveAttribute('href', /^\/subscriptions\//);
  // Las cuatro dimensiones se ven sin semáforo global.
  await expect(page.getByLabel('Estado del tenant por dimensión')).toBeVisible();

  // Navegar por los enlaces no crea ninguna alta SaaS.
  await next.getByRole('link', { name: 'Ver estado del alta en el producto' }).click();
  await next.getByRole('link', { name: 'Ir a Altas SaaS (decisión manual)' }).click();
  await expect(page.getByRole('heading', { name: 'Altas SaaS', level: 1 })).toBeVisible();
  const provisioningRpcs = rpcCalls.filter((c) =>
    /saas_provisioning|begin_saas|complete_saas|register_manual_provisioning|execute/.test(c),
  );
  expect(provisioningRpcs).toEqual([]);

  expect(unexpectedRemoteHosts(guard)).toEqual([]);
  await context.close();
});
