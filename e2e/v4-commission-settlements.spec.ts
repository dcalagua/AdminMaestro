import { expect, test, type Page } from '@playwright/test';
import { login, USERS } from './fixtures';

/**
 * Fase 13 · Ciclo de una liquidación de comisiones desde la UI, como finanzas,
 * contra el Supabase local real (sin mocks):
 *   registrar el pago de la aprobada → aprobar la abierta → anularla con motivo
 *   → volver a generarla con sus comisiones liberadas.
 *
 * Usa la demo `gerencia-v4` (una liquidación abierta de Lucía Paredes en USD y
 * una aprobada del trimestre anterior) y la MODIFICA: después de correrlo,
 * `bash scripts/demo/load-demo-data.sh` la deja como estaba. Sin demo, se omite.
 */

const RUN = Date.now().toString(36);

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Trimestre anterior al en curso: el período de la liquidación abierta de la demo. */
function previousQuarter(today = new Date()): { from: string; to: string } {
  const q = Math.floor(today.getMonth() / 3);
  const start = new Date(today.getFullYear(), (q - 1) * 3, 1);
  const end = new Date(today.getFullYear(), q * 3, 0);
  return { from: localIso(start), to: localIso(end) };
}

async function openSettlements(page: Page) {
  await page.goto('/commissions');
  await page.getByRole('tab', { name: /^Liquidaciones/ }).click();
  await expect(page.locator('tr[data-settlement]').first()).toBeVisible({ timeout: 15_000 });
}

test.describe('Fase 13 · liquidación y pago de comisiones', () => {
  test.setTimeout(120_000);

  test('finanzas paga, aprueba, anula y vuelve a generar una liquidación', async ({ page }) => {
    await login(page, USERS.finance);
    await openSettlements(page);

    const approved = page.locator('tr[data-settlement-status="APPROVED"]').first();
    const open = page.locator('tr[data-settlement-status="OPEN"][data-settlement^="STL-lucia-paredes-"]').first();
    test.skip((await approved.count()) === 0 || (await open.count()) === 0, 'Requiere la demo gerencia-v4 recién cargada');
    const approvedCode = (await approved.getAttribute('data-settlement'))!;
    const openCode = (await open.getAttribute('data-settlement'))!;

    // 1 · Registrar el pago de la aprobada.
    await page.getByRole('button', { name: `Acciones de ${approvedCode}` }).click();
    await page.getByRole('menuitem', { name: 'Registrar pago…' }).click();
    const pay = page.getByRole('dialog', { name: new RegExp(`Registrar pago · ${approvedCode}`) });
    await pay.getByLabel(/Medio/).selectOption('PAYROLL');
    await pay.getByLabel(/Referencia/).fill(`E2E-${RUN}`);
    await pay.getByRole('button', { name: 'Registrar pago' }).click();
    await expect(pay).toBeHidden();
    const paidRow = page.locator(`tr[data-settlement="${approvedCode}"]`);
    await expect(paidRow).toHaveAttribute('data-settlement-status', 'PAID');
    await expect(paidRow).toContainText(`E2E-${RUN}`);
    await expect(paidRow).toContainText('Planilla');

    // 2 · Aprobar la abierta desde su detalle.
    await page.getByRole('button', { name: openCode, exact: true }).click();
    const drawer = page.locator('[data-settlement-detail]');
    await expect(drawer).toBeVisible();
    await expect(page.getByRole('table', { name: `Comisiones de ${openCode}` })).toBeVisible();
    await page.getByRole('button', { name: 'Aprobar…' }).click();
    const approve = page.getByRole('dialog', { name: `Aprobar ${openCode}` });
    await approve.getByLabel(/Nota/).fill(`Revisada E2E ${RUN}`);
    await approve.getByRole('button', { name: 'Aprobar' }).click();
    await expect(approve).toBeHidden();
    await expect(page.locator(`tr[data-settlement="${openCode}"]`)).toHaveAttribute('data-settlement-status', 'APPROVED');

    // 3 · Anularla con motivo: sus comisiones vuelven a estar por liquidar.
    await page.getByRole('button', { name: `Acciones de ${openCode}` }).click();
    await page.getByRole('menuitem', { name: 'Anular…' }).click();
    const cancel = page.getByRole('dialog', { name: `Anular ${openCode}` });
    await cancel.getByRole('button', { name: 'Anular liquidación' }).click();
    await expect(cancel.getByRole('alert')).toContainText('obligatorio');
    await cancel.getByLabel(/Motivo/).fill(`Prueba E2E ${RUN}`);
    await cancel.getByRole('button', { name: 'Anular liquidación' }).click();
    await expect(cancel).toBeHidden();
    await expect(page.locator(`tr[data-settlement="${openCode}"][data-settlement-status="CANCELLED"]`)).toBeVisible();

    // 4 · Volver a generarla: mismo código, las comisiones liberadas entran de nuevo.
    const quarter = previousQuarter();
    await page.getByRole('button', { name: 'Generar liquidación' }).click();
    const gen = page.getByRole('dialog', { name: 'Generar liquidación' });
    await gen.getByLabel(/Comercial/).selectOption({ label: 'Lucía Paredes (lucia-paredes)' });
    await gen.getByLabel(/Moneda/).selectOption('USD');
    await gen.getByLabel('Desde').fill(quarter.from);
    await gen.getByLabel('Hasta').fill(quarter.to);
    await expect(gen.locator('[data-settle-preview]')).toContainText(/Entran \d+ comisión\(es\) elegibles/);
    await gen.getByRole('button', { name: 'Generar liquidación' }).click();
    await expect(gen).toBeHidden();
    await expect(page.locator(`[data-settlement-detail="${openCode}"]`)).toBeVisible();
    await expect(page.locator(`tr[data-settlement="${openCode}"]`)).toHaveCount(2);
    await expect(page.locator(`tr[data-settlement="${openCode}"][data-settlement-status="OPEN"]`)).toBeVisible();
  });
});
