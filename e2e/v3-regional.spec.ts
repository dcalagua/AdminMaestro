import { test, expect, type Locator, type Page } from '@playwright/test';
import { login, USERS } from './fixtures';

/**
 * Journeys V3 — Multicurrency regional (Perú / Bolivia / Ecuador).
 *
 * Contra la app real y el Supabase local con seed. Los datos creados llevan un
 * sufijo por ejecución para que la suite se pueda repetir sin `db:reset`.
 */

const RUN = Date.now().toString(36).slice(-6);

async function openSection(page: Page, label: string, path: string) {
  await page.getByRole('link', { name: label, exact: true }).click();
  await page.waitForURL(`**${path}`);
}

/**
 * Campo por su etiqueta EXACTA. Un campo obligatorio añade «*» a la etiqueta, y
 * «Plan» no debe confundirse con «Plan de comisión».
 */
function field(scope: Page | Locator, label: string) {
  return scope.getByLabel(new RegExp(`^${label}\\s*\\*?$`));
}

/** Textos visibles de las opciones de un <select>, sin el placeholder vacío. */
async function optionLabels(page: Page, label: string) {
  const texts = await field(page, label).locator('option').allTextContents();
  return texts.filter((t) => t && !t.endsWith('…') && !t.startsWith('Elige'));
}

/** Pasos 1 y 2 del wizard hasta llegar a «Plan y precio regional». */
async function wizardToPlanStep(page: Page, customer: string, market: string, suffix: string) {
  await login(page, USERS.superAdmin);
  await openSection(page, 'Nueva venta', '/onboarding');

  await page.getByLabel('Organización cliente').selectOption({ label: customer });
  await field(page, 'País / mercado de la venta').selectOption(market);
  await page.getByLabel('Producto SaaS').selectOption({ label: 'eSupplier (esupplier)' });
  await page.getByRole('button', { name: 'Continuar' }).click();

  await page.getByLabel('Nombre del tenant').fill(`Regional ${suffix} ${RUN}`);
  await page.getByLabel('Slug').fill(`regional-${suffix}-${RUN}`);
  await page.getByLabel('Correo del administrador del cliente').fill(`admin-${suffix}-${RUN}@regional-e2e.com`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(field(page, 'Plan')).toBeVisible();
}

test.describe('R1 · Selector regional de Nueva venta (fase 05)', () => {
  test('el mercado se sugiere por el país del cliente y propone su moneda', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await openSection(page, 'Nueva venta', '/onboarding');

    await page.getByLabel('Organización cliente').selectOption({ label: 'Empresa Directa Alpha' });
    // Alpha es peruana y Perú es el único mercado de PE.
    await expect(field(page, 'País / mercado de la venta')).toHaveValue('PE');
    await expect(page.getByText('Moneda sugerida: PEN. Admitidas: PEN, USD.')).toBeVisible();
  });

  test('Bolivia ofrece BOB (sugerida) y USD, nunca PEN ni un campo libre', async ({ page }) => {
    await wizardToPlanStep(page, 'Empresa Directa Alpha', 'BO', 'bo');

    const moneda = field(page, 'Moneda');
    await expect(moneda).toHaveValue('BOB');
    // Es un <select>: no existe forma de teclear una moneda.
    await expect(moneda).toHaveJSProperty('tagName', 'SELECT');
    expect(await optionLabels(page, 'Moneda')).toEqual(['BOB (sugerida)', 'USD']);
  });

  test('Ecuador solo admite USD', async ({ page }) => {
    await wizardToPlanStep(page, 'Empresa Directa Alpha', 'EC', 'ec');
    await expect(field(page, 'Moneda')).toHaveValue('USD');
    expect(await optionLabels(page, 'Moneda')).toEqual(['USD (sugerida)']);
  });

  test('sin tarifa regional el wizard no deja continuar y lo explica', async ({ page }) => {
    await wizardToPlanStep(page, 'Empresa Directa Alpha', 'BO', 'sin-tarifa');

    // Moneda BOB por defecto. El plan Demo solo tiene tarifa en PE: en Bolivia la
    // opción lo rotula y una venta PRODUCTION recurrente no puede continuar.
    const plan = field(page, 'Plan');
    await expect(plan.locator('option', { hasText: 'eSupplier Demo — sin tarifa BO/BOB' })).toHaveCount(1);
    await plan.selectOption({ label: 'eSupplier Demo — sin tarifa BO/BOB' });

    await expect(page.getByRole('alert').filter({ hasText: 'TARIFA_REGIONAL_NO_DEFINIDA' })).toBeVisible();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByText(/no tiene tarifa vigente en BO\/BOB/).first()).toBeVisible();
    // Sigue en el paso 3: el resumen no aparece.
    await expect(page.getByRole('button', { name: 'Crear cliente' })).toHaveCount(0);
  });

  test('una tarifa PE/USD se muestra con su mercado y el fee sale en la moneda del contrato', async ({ page }) => {
    await wizardToPlanStep(page, 'Empresa Directa Alpha', 'PE', 'pe-usd');

    await field(page, 'Moneda').selectOption('USD');
    await field(page, 'Plan').selectOption({ label: 'eSupplier Shared Standard' });
    await expect(page.getByText(/Tarifa PE\/USD: .*850\.00/)).toBeVisible();
    await page.getByRole('button', { name: 'Continuar' }).click();

    await expect(page.getByLabel('Fee de implementación (USD)')).toBeVisible();
    await expect(page.getByText(/Tarifa PE\/USD: .*3,500\.00/)).toBeVisible();
  });
});

test.describe('R1b · Tarifa regional en el catálogo (fase 04)', () => {
  test('el diálogo de tarifa exige mercado y solo ofrece sus monedas', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await page.goto('/plans');
    await expect(page.getByRole('heading', { name: 'Planes y licencias' })).toBeVisible();

    await page.getByRole('button', { name: 'Fijar precio' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(field(dialog, 'Moneda')).toBeDisabled();

    await field(dialog, 'Mercado').selectOption('EC');
    await expect(field(dialog, 'Moneda')).toHaveValue('USD');
    expect(
      (await field(dialog, 'Moneda').locator('option').allTextContents()),
    ).toEqual(['USD (sugerida)']);

    // Perú admite USD: la moneda elegida se conserva, y ahora se ofrece también PEN.
    await field(dialog, 'Mercado').selectOption('PE');
    await expect(field(dialog, 'Moneda')).toHaveValue('USD');
    expect(
      (await field(dialog, 'Moneda').locator('option').allTextContents()),
    ).toEqual(['PEN (sugerida)', 'USD']);

    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    // Las tarifas listadas llevan su mercado.
    await expect(page.getByTitle('Mercado PE').first()).toBeVisible();
  });
});

test.describe('R3 · Routing regional de cobro (fase 07)', () => {
  test('la cuenta de tarjeta la asigna el servidor por mercado y moneda, sin selector', async ({ page }) => {
    await login(page, USERS.finance);
    await page.goto('/subscriptions');
    await page.getByRole('link', { name: 'SUB-TITAN-EWM' }).click();
    await page.getByRole('tab', { name: 'Cobranza' }).click();
    await page.getByRole('button', { name: /Configurar cobranza|Cambiar método/ }).click();

    const dialog = page.getByRole('dialog');
    await field(dialog, 'Método de cobro').selectOption('CULQI_CARD');

    // No existe un <select> de cuenta: la ruta es informativa y la calcula la base.
    await expect(dialog.getByLabel(/Cuenta de proveedor/)).toHaveCount(0);
    await expect(dialog.getByTestId('collection-route')).toHaveText(/culqi-pe-test · PE · PEN\/USD \(TEST\)/);

    // Un método sin pasarela no usa cuenta.
    await field(dialog, 'Método de cobro').selectOption('SERVICE_ORDER');
    await expect(dialog.getByTestId('collection-route')).toHaveText('No aplica: este método no usa pasarela');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
  });
});

test.describe('R4 · Moneda de reporte (fase 09)', () => {
  test('finanzas cambia la moneda de reporte entre monedas activas y la restaura', async ({ page }) => {
    await login(page, USERS.finance);
    await page.getByRole('link', { name: 'Monedas y FX', exact: true }).click();
    await page.waitForURL('**/regional');

    // El panel de la pestaña también se rotula «Moneda de reporte»: se busca el <select>.
    const select = page.getByRole('combobox', { name: 'Moneda de reporte' });
    await expect(select).toHaveValue('USD');
    // Solo monedas ACTIVAS: las inactivas del catálogo (COP, CLP) no se ofrecen.
    const options = await select.locator('option').allTextContents();
    expect(options.some((o) => o.startsWith('COP'))).toBe(false);
    expect(options.some((o) => o.startsWith('PEN'))).toBe(true);

    await select.selectOption('PEN');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Moneda de reporte actualizada')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Actual: PEN')).toBeVisible();

    // Restaura el estado del seed para que la suite sea repetible.
    await select.selectOption('USD');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Actual: USD')).toBeVisible({ timeout: 15_000 });
  });

  test('un partner no tiene acceso a la administración de monedas', async ({ page }) => {
    await login(page, USERS.partnerAdmin);
    await expect(page.getByRole('link', { name: 'Monedas y FX', exact: true })).toHaveCount(0);
    await page.goto('/regional');
    await expect(page.getByRole('heading', { name: 'Monedas y FX' })).toHaveCount(0);
  });
});
