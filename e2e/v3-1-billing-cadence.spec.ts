import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { DEMO_PASSWORD, login, USERS } from './fixtures';

/**
 * V3.1 · Billing cadence de punta a punta.
 *
 * Los contratos se crean con las MISMAS RPC que usa la consola
 * (`create_subscription`, `upsert_subscription_item`) como EBIM_FINANCE; la
 * emisión se hace en la pantalla, eligiendo el período; y el resultado se
 * verifica en la BASE (facturas y líneas vía PostgREST con la sesión de
 * finanzas, bajo RLS), no solo en el texto de la pantalla.
 *
 * Fechas relativas al mes en curso para no depender de la fecha del reset (las
 * tarifas regionales del seed tienen vigencia relativa). Códigos únicos por
 * ejecución: la suite se repite sin `db:reset`.
 */

const RUN = Date.now().toString(36).slice(-6);
const env = loadEnv('development', process.cwd(), 'VITE_');

const ESUPPLIER = '20000000-0000-4000-a000-000000000001';
const PLAN = '60000000-0000-4000-a000-000000000001';
const ORG = {
  arequipaPE: '30000000-0000-4000-a000-00000000000c',
  illimaniBO: '30000000-0000-4000-a000-00000000000d',
  guayasEC: '30000000-0000-4000-a000-00000000000f',
};

/** Primer día del mes en curso + n meses, como `YYYY-MM-DD` (fecha de calendario local). */
function monthStart(offset: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
const month = (offset: number) => monthStart(offset).slice(0, 7);
/** Ancla a mitad de mes: la cadence trabaja por período, no por día exacto. */
const anchor = monthStart(0).slice(0, 8) + '10';

let db: SupabaseClient;

test.beforeAll(async () => {
  expect(env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL en .env.local').toBeTruthy();
  db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    db: { schema: 'platform' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await db.auth.signInWithPassword({ email: USERS.finance, password: DEMO_PASSWORD });
  expect(error).toBeNull();
});

interface Line { kind: string; amount: number; interval: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONE_TIME' }

async function createContract(code: string, org: string, market: string, currency: string, lines: Line[]) {
  const { data: id, error } = await db.rpc('create_subscription', {
    p_billed_organization_id: org,
    p_saas_product_id: ESUPPLIER,
    p_plan_id: PLAN,
    p_billing_interval: lines[0].interval,
    p_market_code: market,
    p_currency: currency,
    p_code: code,
    p_status: 'ACTIVE',
  });
  expect(error).toBeNull();
  for (const l of lines) {
    const { error: itemError } = await db.rpc('upsert_subscription_item', {
      p_subscription_id: id,
      p_charge_kind: l.kind,
      p_description: `${l.kind} ${l.interval} E2E`,
      p_quantity: 1,
      p_unit_amount: l.amount,
      p_billing_interval: l.interval,
      p_valid_from: anchor,
    });
    expect(itemError).toBeNull();
  }
  return id as string;
}

/** Facturas vigentes de la suscripción, leídas de la base. */
async function invoicesOf(subscriptionId: string) {
  const { data, error } = await db
    .from('invoices')
    .select('number, status, currency, total, period_start, invoice_lines(charge_kind, currency, amount)')
    .eq('subscription_id', subscriptionId)
    .neq('status', 'VOID')
    .order('period_start');
  expect(error).toBeNull();
  return (data ?? []).map((i) => ({
    period: String(i.period_start).slice(0, 7),
    currency: i.currency as string,
    total: Number(i.total),
    kinds: (i.invoice_lines as Array<{ charge_kind: string; currency: string }>)
      .map((l) => l.charge_kind).sort().join(','),
    lineCurrencies: [...new Set((i.invoice_lines as Array<{ currency: string }>).map((l) => l.currency))].join(','),
  }));
}

async function openBilling(page: Page, subscriptionId: string) {
  await page.goto(`/subscriptions/${subscriptionId}`);
  await page.getByRole('tab', { name: 'Facturación y cobros' }).click();
}

async function choosePeriod(page: Page, value: string) {
  await page.getByLabel('Período de facturación').fill(value);
  await expect(page.getByTestId('billing-status')).not.toContainText('Calculando', { timeout: 15_000 });
}

function issueButton(page: Page, currency: string) {
  return page.getByRole('button', { name: `Emitir factura del período (${currency})` });
}

/** Emite el período elegido y espera a que la base tenga su factura. */
async function issuePeriod(page: Page, subscriptionId: string, currency: string, value: string) {
  await choosePeriod(page, value);
  await expect(issueButton(page, currency)).toBeEnabled();
  await issueButton(page, currency).click();
  await expect.poll(async () => (await invoicesOf(subscriptionId)).some((i) => i.period === value), { timeout: 15_000 })
    .toBe(true);
  await expect(page.getByTestId('billing-status')).toContainText('ya emitida', { timeout: 15_000 });
}

/** Período sin cargos: la pantalla lo dice, no deja emitir, y la base no tiene factura. */
async function expectNotDue(page: Page, subscriptionId: string, currency: string, value: string) {
  await choosePeriod(page, value);
  await expect(page.getByTestId('billing-status')).toContainText('No existen cargos facturables en este período.');
  await expect(issueButton(page, currency)).toBeDisabled();
  // El botón deshabilitado es UX; la autoridad es la RPC. Un intento directo también se rechaza.
  const { error } = await db.rpc('issue_subscription_invoice', {
    p_subscription_id: subscriptionId, p_period_start: `${value}-01`,
  });
  expect(error?.message ?? 'sin error: la RPC facturó un período sin cargos').toMatch(/^SIN_LINEAS_FACTURABLES/);
  expect((await invoicesOf(subscriptionId)).some((i) => i.period === value)).toBe(false);
}

test.describe('V3.1 · Billing cadence', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.finance);
  });

  test('MONTHLY · PEN: el período y el siguiente facturan, en PEN', async ({ page }) => {
    const id = await createContract(`SUB-E2E-CAD-MON-${RUN}`, ORG.arequipaPE, 'PE', 'PEN',
      [{ kind: 'LICENSE', amount: 3150, interval: 'MONTHLY' }]);
    await openBilling(page, id);

    await choosePeriod(page, month(0));
    await expect(page.getByTestId('billing-status')).toContainText('1 cargo facturable');
    await expect(page.getByTestId('billing-status')).toContainText(/PEN\s3,150\.00/);
    await issuePeriod(page, id, 'PEN', month(0));
    await issuePeriod(page, id, 'PEN', month(1));

    expect(await invoicesOf(id)).toEqual([
      { period: month(0), currency: 'PEN', total: 3150, kinds: 'LICENSE', lineCurrencies: 'PEN' },
      { period: month(1), currency: 'PEN', total: 3150, kinds: 'LICENSE', lineCurrencies: 'PEN' },
    ]);
    await expect(page.getByRole('row').filter({ hasText: `INV-${month(1).replace('-', '')}` })).toContainText('PEN');
  });

  test('YEARLY · USD: factura el período ancla y NO vuelve a facturar el mes siguiente', async ({ page }) => {
    const id = await createContract(`SUB-E2E-CAD-YR-${RUN}`, ORG.guayasEC, 'EC', 'USD',
      [{ kind: 'LICENSE', amount: 24000, interval: 'YEARLY' }]);
    await openBilling(page, id);

    await issuePeriod(page, id, 'USD', month(0));
    await expect(page.getByTestId('billing-status')).toContainText(`Próxima facturación: 01/${month(12).slice(5, 7)}/${month(12).slice(0, 4)}`);

    await expectNotDue(page, id, 'USD', month(1));
    await expectNotDue(page, id, 'USD', month(6));
    await expectNotDue(page, id, 'USD', month(11));

    await issuePeriod(page, id, 'USD', month(12));
    expect(await invoicesOf(id)).toEqual([
      { period: month(0), currency: 'USD', total: 24000, kinds: 'LICENSE', lineCurrencies: 'USD' },
      { period: month(12), currency: 'USD', total: 24000, kinds: 'LICENSE', lineCurrencies: 'USD' },
    ]);
  });

  test('QUARTERLY · BOB: período ancla, sin cargo en +1 y +2, cargo en el trimestre siguiente', async ({ page }) => {
    const id = await createContract(`SUB-E2E-CAD-QTR-${RUN}`, ORG.illimaniBO, 'BO', 'BOB',
      [{ kind: 'LICENSE', amount: 3000, interval: 'QUARTERLY' }]);
    await openBilling(page, id);

    await issuePeriod(page, id, 'BOB', month(0));
    await expectNotDue(page, id, 'BOB', month(1));
    await expect(page.getByTestId('billing-status')).toContainText(`Próxima facturación: 01/${month(3).slice(5, 7)}/${month(3).slice(0, 4)}`);
    await expectNotDue(page, id, 'BOB', month(2));
    await issuePeriod(page, id, 'BOB', month(3));

    expect(await invoicesOf(id)).toEqual([
      { period: month(0), currency: 'BOB', total: 3000, kinds: 'LICENSE', lineCurrencies: 'BOB' },
      { period: month(3), currency: 'BOB', total: 3000, kinds: 'LICENSE', lineCurrencies: 'BOB' },
    ]);
  });

  test('MIXED · MONTHLY + YEARLY + ONE_TIME: cada factura lleva solo lo que toca', async ({ page }) => {
    const id = await createContract(`SUB-E2E-CAD-MIX-${RUN}`, ORG.guayasEC, 'EC', 'USD', [
      { kind: 'LICENSE', amount: 700, interval: 'MONTHLY' },
      { kind: 'SUPPORT_FEE', amount: 1200, interval: 'YEARLY' },
      { kind: 'IMPLEMENTATION_FEE', amount: 2800, interval: 'ONE_TIME' },
    ]);
    await openBilling(page, id);

    await choosePeriod(page, month(0));
    await expect(page.getByTestId('billing-status')).toContainText('3 cargos facturables');
    await expect(page.getByTestId('billing-status')).toContainText(/USD\s4,700\.00/);
    await issuePeriod(page, id, 'USD', month(0));

    await choosePeriod(page, month(1));
    await expect(page.getByTestId('billing-status')).toContainText('1 cargo facturable');
    await issuePeriod(page, id, 'USD', month(1));
    await issuePeriod(page, id, 'USD', month(12));

    expect(await invoicesOf(id)).toEqual([
      { period: month(0), currency: 'USD', total: 4700, kinds: 'IMPLEMENTATION_FEE,LICENSE,SUPPORT_FEE', lineCurrencies: 'USD' },
      { period: month(1), currency: 'USD', total: 700, kinds: 'LICENSE', lineCurrencies: 'USD' },
      { period: month(12), currency: 'USD', total: 1900, kinds: 'LICENSE,SUPPORT_FEE', lineCurrencies: 'USD' },
    ]);
  });

  test('IDEMPOTENCIA · reintentar la emisión del mismo período devuelve la misma factura', async ({ page }) => {
    const id = await createContract(`SUB-E2E-CAD-IDEM-${RUN}`, ORG.arequipaPE, 'PE', 'PEN',
      [{ kind: 'LICENSE', amount: 3150, interval: 'MONTHLY' }]);
    await openBilling(page, id);
    await issuePeriod(page, id, 'PEN', month(0));
    // La pantalla ya no ofrece duplicar; un reintento directo (doble envío, otra pestaña) tampoco duplica.
    await expect(issueButton(page, 'PEN')).toBeDisabled();
    const { data, error } = await db.rpc('issue_subscription_invoice', { p_subscription_id: id, p_period_start: monthStart(0) });
    expect(error).toBeNull();
    expect((data as { created: boolean }).created).toBe(false);
    expect((await invoicesOf(id)).filter((i) => i.period === month(0))).toHaveLength(1);
  });
});
