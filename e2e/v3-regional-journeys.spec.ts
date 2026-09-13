import { test, expect, type Locator, type Page } from '@playwright/test';
import { login, USERS } from './fixtures';

/**
 * Journeys V3 — Fase 17: Perú PEN, Bolivia BOB, Ecuador USD.
 *
 * Recorridos reales contra la app y el Supabase local con el seed regional:
 * venta regional → contrato → factura del mes → cobro manual → comisión →
 * dashboard nativo y consolidado. Sin Culqi LIVE ni integraciones externas: el
 * cobro es manual (transferencia). Cada ejecución usa slugs y referencias
 * únicas, así que la suite se repite sin `db:reset`.
 */

const RUN = Date.now().toString(36).slice(-6);
/** Fecha de las tasas DEMO del seed (`docs/demo/DEMO_SCENARIOS_V3.md`). */
const DEMO_FX_DATE = '2026-09-01';

function field(scope: Page | Locator, label: string) {
  return scope.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*\\*?$`));
}

interface RegionalSale {
  customer: string;
  expectedMarket: string;
  currency: string;
  plan: string;
  expectedPrice: RegExp;
  tenantName: string;
  slug: string;
  channel?: string;
  agent?: string;
  commissionPlan?: string;
}

/** Vende por el wizard y devuelve la URL del detalle de la suscripción creada. */
async function sellRegional(page: Page, sale: RegionalSale) {
  await page.goto('/onboarding');
  await expect(page.getByRole('heading', { name: 'Nueva venta / alta de cliente' })).toBeVisible();

  // 1 · cliente → mercado sugerido por su país
  await page.getByLabel('Organización cliente').selectOption({ label: sale.customer });
  await expect(field(page, 'País / mercado de la venta')).toHaveValue(sale.expectedMarket);
  await page.getByLabel('Producto SaaS').selectOption({ label: 'eSupplier (esupplier)' });
  await page.getByRole('button', { name: 'Continuar' }).click();

  // 2 · canal y tenant
  if (sale.channel) await page.getByLabel('Canal / partner que administra').selectOption({ label: sale.channel });
  await page.getByLabel('Nombre del tenant').fill(sale.tenantName);
  await page.getByLabel('Slug').fill(sale.slug);
  await page.getByLabel('Correo del administrador del cliente').fill(`admin-${sale.slug}@regional-e2e.com`);
  await page.getByRole('button', { name: 'Continuar' }).click();

  // 3 · moneda admitida → plan → tarifa DEL mercado
  await field(page, 'Moneda').selectOption(sale.currency);
  await field(page, 'Plan').selectOption({ label: sale.plan });
  await expect(page.getByText(sale.expectedPrice).first()).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // 4 · comercial
  if (sale.agent) await field(page, 'Comercial').selectOption({ label: sale.agent });
  if (sale.commissionPlan) await field(page, 'Plan de comisión').selectOption({ label: sale.commissionPlan });
  await page.getByRole('button', { name: 'Continuar' }).click();

  // 5 · resumen
  await expect(page.getByText('Moneda contractual')).toBeVisible();
  await page.getByRole('button', { name: 'Crear cliente' }).click();
  await expect(page.getByText('Alta completada')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: sale.tenantName })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('tab', { name: 'Suscripción' }).click();
  await page.locator('a[href^="/subscriptions/"]').first().click();
  await page.waitForURL('**/subscriptions/**');
  return page.url();
}

/** Emite la factura del mes y registra su cobro manual completo. */
async function invoiceAndCollect(page: Page, currency: string, total: RegExp, reference: string) {
  await page.getByRole('tab', { name: 'Facturación y cobros' }).click();
  await page.getByRole('button', { name: `Emitir factura del mes (${currency})` }).click();
  await expect(page.getByText('Factura emitida')).toBeVisible({ timeout: 15_000 });

  const row = page.getByRole('row').filter({ hasText: 'INV-' }).first();
  await expect(row).toContainText(total);
  await expect(row).toContainText('ISSUED');

  await row.getByRole('button', { name: 'Registrar cobro' }).click();
  const dialog = page.getByRole('dialog');
  await expect(field(dialog, 'Moneda')).toHaveValue(currency);
  await expect(field(dialog, 'Moneda')).toBeDisabled();
  await field(dialog, 'Referencia').fill(reference);
  await dialog.getByRole('button', { name: 'Confirmar cobro' }).click();
  await expect(page.getByText('Cobro registrado')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('row').filter({ hasText: 'INV-' }).first()).toContainText('PAID', { timeout: 15_000 });
}

async function regionalPanel(page: Page) {
  await page.goto('/');
  const panel = page.locator('section').filter({ hasText: 'Finanzas regionales' });
  await expect(panel).toBeVisible();
  return panel;
}

function kpi(panel: Locator, label: string) {
  return panel.locator('.ebim-card').filter({ has: panel.page().getByText(label, { exact: true }) }).first();
}

test.describe('Fase 17 · Journeys regionales', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.superAdmin);
  });

  test('A · Perú PEN: venta → contrato → factura → cobro manual → comisión → dashboard', async ({ page }) => {
    const tenantName = `Arequipa PEN ${RUN}`;
    await sellRegional(page, {
      customer: 'Textiles Arequipa',
      expectedMarket: 'PE',
      currency: 'PEN',
      plan: 'eSupplier Shared Standard',
      expectedPrice: /Tarifa PE\/PEN: PEN\s3,150\.00/,
      tenantName,
      slug: `arequipa-pen-${RUN}`,
      agent: 'Carla Comercial (carla-independiente)',
      commissionPlan: 'Comercial independiente · estándar',
    });

    await invoiceAndCollect(page, 'PEN', /PEN\s3,150\.00/, `TRF-PE-${RUN}`);

    // Comisión: 10% de la licencia cobrada, en PEN.
    await page.goto('/commissions');
    await page.getByRole('searchbox').fill(tenantName);
    const commission = page.getByRole('row').filter({ hasText: tenantName }).first();
    await expect(commission).toContainText(/PEN\s315\.00/);
    await expect(commission).toContainText('Carla Comercial');

    // Dashboard: Perú en nativo muestra PEN y USD por separado.
    const panel = await regionalPanel(page);
    await field(panel, 'Mercado').selectOption('PE');
    await expect(kpi(panel, 'Cobrado')).toContainText(/PEN\s[\d,.]+\s?K?/);
    await expect(kpi(panel, 'Cobrado')).toContainText(/USD\s/);
  });

  test('B · Bolivia BOB vía partner: tarifa BOB → contrato → cobro → dashboard nativo y consolidado', async ({ page }) => {
    const tenantName = `Illimani BOB ${RUN}`;
    await sellRegional(page, {
      customer: 'Minera Illimani',
      expectedMarket: 'BO',
      currency: 'BOB',
      plan: 'eSupplier Shared Standard',
      expectedPrice: /Tarifa BO\/BOB: BOB\s5,900\.00/,
      tenantName,
      slug: `illimani-bob-${RUN}`,
      channel: 'Consultora Andina',
      agent: 'Beto Andina (beto-andina)',
      commissionPlan: 'Comercial de partner · estándar',
    });

    await invoiceAndCollect(page, 'BOB', /BOB\s5,900\.00/, `TRF-BO-${RUN}`);

    await page.goto('/commissions');
    await page.getByRole('searchbox').fill(tenantName);
    await expect(page.getByRole('row').filter({ hasText: tenantName }).first()).toContainText(/BOB\s354\.00/);

    const panel = await regionalPanel(page);
    await field(panel, 'Mercado').selectOption('BO');
    // Nativo: BOB y USD de Bolivia nunca se suman.
    await expect(kpi(panel, 'Cobrado')).toContainText(/BOB\s[\d,.]+\s?K?/);
    await expect(kpi(panel, 'Cobrado')).not.toContainText('Incompleto');

    // Consolidado con las tasas DEMO: completo, en USD, con la tasa rotulada DEMO.
    await panel.getByRole('tab', { name: 'Consolidado' }).click();
    await field(panel, 'Fecha de las tasas').fill(DEMO_FX_DATE);
    await expect(panel.getByTestId('fx-context')).toContainText('Moneda de reporte: USD');
    await expect(panel.getByTestId('fx-context')).toContainText(/1 BOB = 0[.,]142857 USD/);
    await expect(panel.getByTestId('fx-context')).toContainText('DEMO');
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(kpi(panel, 'Cobrado')).toContainText(/^.*USD\s[\d,]+\.\d{2}/);
    await expect(kpi(panel, 'Margen bruto')).not.toContainText('No calculable');
  });

  test('C · Ecuador USD: tarifa EC/USD → contrato → factura → cobro → dashboard', async ({ page }) => {
    const tenantName = `Guayas USD ${RUN}`;
    await sellRegional(page, {
      customer: 'Exportadora Guayas',
      expectedMarket: 'EC',
      currency: 'USD',
      plan: 'eSupplier Shared Standard',
      expectedPrice: /Tarifa EC\/USD: USD\s700\.00/,
      tenantName,
      slug: `guayas-usd-${RUN}`,
      agent: 'Equipo Comercial EBIM (equipo-ebim)',
      commissionPlan: 'Equipo EBIM · interno',
    });

    await invoiceAndCollect(page, 'USD', /USD\s700\.00/, `TRF-EC-${RUN}`);

    const panel = await regionalPanel(page);
    await field(panel, 'Mercado').selectOption('EC');
    await expect(kpi(panel, 'Cobrado')).toContainText(/USD\s[\d,.]+/);
    await expect(kpi(panel, 'Cobrado')).not.toContainText('PEN');
    await expect(kpi(panel, 'Cobrado')).not.toContainText('BOB');
  });

  test('D · PE/USD y EC/USD: misma moneda, distinto mercado, distinto precio', async ({ page }) => {
    await page.goto('/onboarding');
    await page.getByLabel('Organización cliente').selectOption({ label: 'Empresa Directa Alpha' });
    await page.getByLabel('Producto SaaS').selectOption({ label: 'eSupplier (esupplier)' });
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByLabel('Nombre del tenant').fill(`Dif ${RUN}`);
    await page.getByLabel('Slug').fill(`dif-${RUN}`);
    await page.getByLabel('Correo del administrador del cliente').fill(`dif-${RUN}@regional-e2e.com`);
    await page.getByRole('button', { name: 'Continuar' }).click();

    await field(page, 'Moneda').selectOption('USD');
    await field(page, 'Plan').selectOption({ label: 'eSupplier Shared Standard' });
    await expect(page.getByText(/Tarifa PE\/USD: USD\s850\.00/)).toBeVisible();

    // Mismo cliente, mismo plan, misma moneda: al cambiar el mercado a Ecuador cambia la tarifa.
    await page.getByRole('button', { name: /^1\./ }).click();
    await field(page, 'País / mercado de la venta').selectOption('EC');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(field(page, 'Moneda')).toHaveValue('USD');
    await expect(page.getByText(/Tarifa EC\/USD: USD\s700\.00/)).toBeVisible();

    // Y el catálogo lo muestra igual.
    await page.goto('/regional#prices');
    await page.getByRole('tab', { name: 'Tarifas por mercado' }).click();
    await page.getByRole('searchbox').fill('esupplier-shared-standard');
    const licenses = page.getByRole('row').filter({ hasText: 'LICENSE' }).filter({ hasText: 'MONTHLY' });
    const market = (code: string) => page.getByRole('cell', { name: code, exact: true });
    await expect(licenses.filter({ has: market('PE') }).filter({ hasText: /USD\s850\.00/ })).toHaveCount(1);
    await expect(licenses.filter({ has: market('EC') }).filter({ hasText: /USD\s700\.00/ })).toHaveCount(1);
  });

  test('E · FX faltante: el consolidado advierte y no presenta cifras incompletas como totales', async ({ page }) => {
    const panel = await regionalPanel(page);
    await panel.getByRole('tab', { name: 'Consolidado' }).click();

    // Con las tasas DEMO del seed, el consolidado está completo...
    await field(panel, 'Fecha de las tasas').fill(DEMO_FX_DATE);
    await expect(panel.getByRole('alert')).toHaveCount(0);

    // ...pero 60 días después ya no hay tasa dentro de la tolerancia de 31 días:
    // PEN y BOB quedan sin convertir y el tablero lo dice.
    await field(panel, 'Fecha de las tasas').fill('2026-10-31');
    const alert = panel.getByRole('alert');
    await expect(alert).toContainText('Consolidado incompleto');
    await expect(alert).toContainText('BOB');
    await expect(alert).toContainText('PEN');
    await expect(kpi(panel, 'Cobrado')).toContainText('Incompleto');
    await expect(kpi(panel, 'Margen bruto')).toContainText('No calculable');
    await expect(panel.getByRole('row').filter({ hasText: 'Bolivia' })).toContainText('FX faltante');
    // Ecuador opera solo en USD: no le falta nada.
    await expect(panel.getByRole('row').filter({ hasText: 'Ecuador' })).not.toContainText('FX faltante');
  });
});
