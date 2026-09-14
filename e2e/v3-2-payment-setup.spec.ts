import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { DEMO_PASSWORD, USERS } from './fixtures';

/**
 * V3.2 · `payment-setup` de punta a punta, contra la Edge Function REAL del
 * stack local (`/functions/v1/payment-setup`).
 *
 * Sin credenciales `CULQI_*` en el runtime local, el adapter es el MOCK: no hay
 * una sola llamada a Culqi. Todo lo demás es real: JWT, RLS, `service_role`,
 * la base y los mapeos que la función escribe.
 *
 * Los contratos se crean con las RPC de la consola (`create_subscription`,
 * `upsert_subscription_item`, `set_subscription_collection_profile`) como
 * EBIM_FINANCE, y cada resultado se verifica en la BASE: `provider_plans` y
 * `provider_subscriptions`, no solo la respuesta HTTP.
 *
 * La suite se repite sin `db:reset`: los importes base cambian en cada
 * ejecución y ninguna aserción depende de que un Plan del proveedor no exista.
 */

const RUN = Date.now().toString(36).slice(-6);
const env = loadEnv('development', process.cwd(), 'VITE_');
const FUNCTION_URL = `${env.VITE_SUPABASE_URL}/functions/v1/payment-setup`;

const ESUPPLIER = '20000000-0000-4000-a000-000000000001';
const PLAN = '60000000-0000-4000-a000-000000000001';
/** Textiles Arequipa: Perú, datos de facturación completos para tarjeta. */
const ORG_AREQUIPA = '30000000-0000-4000-a000-00000000000c';
/** Importe base de la ejecución: 1000..1899, para no chocar con ejecuciones anteriores. */
const BASE = 1000 + (parseInt(RUN, 36) % 900);

type Interval = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONE_TIME';
interface Line { kind: string; amount: number; interval: Interval; from?: string; to?: string }

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Día 1 del mes en curso + n meses. */
function monthStart(offset: number): string {
  const now = new Date();
  return isoDate(new Date(now.getFullYear(), now.getMonth() + offset, 1));
}
/** Último día del mes en curso + n meses. */
function monthEnd(offset: number): string {
  const now = new Date();
  return isoDate(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0));
}

let db: SupabaseClient;
let financeJwt: string;
let seq = 0;

test.beforeAll(async () => {
  expect(env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL en .env.local').toBeTruthy();
  db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    db: { schema: 'platform' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.signInWithPassword({ email: USERS.finance, password: DEMO_PASSWORD });
  expect(error).toBeNull();
  financeJwt = data.session!.access_token;
});

async function jwtOf(email: string): Promise<string> {
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  expect(error).toBeNull();
  return data.session!.access_token;
}

/** Contrato con tarjeta Culqi (cuenta elegida por el servidor) y sus líneas. */
async function cardContract(currency: 'USD' | 'PEN', interval: Interval, lines: Line[]): Promise<string> {
  seq += 1;
  const { data: id, error } = await db.rpc('create_subscription', {
    p_billed_organization_id: ORG_AREQUIPA,
    p_saas_product_id: ESUPPLIER,
    p_plan_id: PLAN,
    p_billing_interval: interval,
    p_market_code: 'PE',
    p_currency: currency,
    p_code: `SUB-V32-${RUN}-${seq}`,
    p_status: 'ACTIVE',
  });
  expect(error).toBeNull();
  for (const l of lines) {
    const { error: itemError } = await db.rpc('upsert_subscription_item', {
      p_subscription_id: id,
      p_charge_kind: l.kind,
      p_description: `${l.kind} ${l.interval} V3.2 E2E`,
      p_quantity: 1,
      p_unit_amount: l.amount,
      p_billing_interval: l.interval,
      p_valid_from: l.from ?? monthStart(0),
      p_valid_to: l.to ?? null,
    });
    expect(itemError).toBeNull();
  }
  const { error: profileError } = await db.rpc('set_subscription_collection_profile', {
    p_subscription_id: id,
    p_collection_method: 'CULQI_CARD',
    p_currency: currency,
    p_notes: 'V3.2 E2E payment-setup',
    p_route_provider: true,
  });
  expect(profileError).toBeNull();
  return id as string;
}

async function setup(subscriptionId: string, opts: { jwt?: string | null; extra?: Record<string, unknown> } = {}) {
  const jwt = opts.jwt === undefined ? financeJwt : opts.jwt;
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    // Token de Checkout ficticio: el adapter MOCK no lo envía a ningún sitio.
    body: JSON.stringify({ subscription_id: subscriptionId, token: 'checkout_e2e_v32', accepted_terms: true, ...opts.extra }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

/** Plan del proveedor al que quedó colgada la suscripción, leído de la base. */
async function providerPlanOf(subscriptionId: string) {
  const { data: link, error } = await db
    .from('provider_subscriptions')
    .select('external_plan_id, provider_account_id')
    .eq('subscription_id', subscriptionId)
    .eq('status', 'ACTIVE')
    .maybeSingle();
  expect(error).toBeNull();
  expect(link, `provider_subscriptions de ${subscriptionId}`).not.toBeNull();
  const { data: plans, error: planError } = await db
    .from('provider_plans')
    .select('external_plan_id, amount, currency, billing_interval, plan_id, provider_account_id, status')
    .eq('provider_account_id', link!.provider_account_id)
    .eq('external_plan_id', link!.external_plan_id);
  expect(planError).toBeNull();
  expect(plans, `provider_plans de ${link!.external_plan_id}`).toHaveLength(1);
  return { externalPlanId: link!.external_plan_id as string, ...plans![0], amount: Number(plans![0].amount) };
}

async function noProviderLink(subscriptionId: string) {
  const { count, error } = await db
    .from('provider_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('subscription_id', subscriptionId);
  expect(error).toBeNull();
  expect(count).toBe(0);
}

test.describe('V3.2 · payment-setup · identidad del Plan del proveedor', () => {
  test('mismo importe reutiliza el Plan; distinto importe crea otro y no reescribe el original', async () => {
    const a = await cardContract('USD', 'MONTHLY', [{ kind: 'LICENSE', amount: BASE, interval: 'MONTHLY' }]);
    const b = await cardContract('USD', 'MONTHLY', [{ kind: 'LICENSE', amount: BASE + 250, interval: 'MONTHLY' }]);
    const a2 = await cardContract('USD', 'MONTHLY', [{ kind: 'LICENSE', amount: BASE, interval: 'MONTHLY' }]);

    expect((await setup(a)).status).toBe(200);
    const planA = await providerPlanOf(a);
    expect(planA.amount).toBe(BASE);

    expect((await setup(b)).status).toBe(200);
    const planB = await providerPlanOf(b);
    expect(planB.amount, 'el Plan de B cobra el importe de B').toBe(BASE + 250);
    expect(planB.externalPlanId, 'B no puede colgarse del Plan de A').not.toBe(planA.externalPlanId);

    // El mapeo de A sigue diciendo lo que Culqi tiene: importe de A.
    expect((await providerPlanOf(a)).amount).toBe(BASE);

    expect((await setup(a2)).status).toBe(200);
    expect((await providerPlanOf(a2)).externalPlanId, 'mismo contrato económico, mismo Plan').toBe(planA.externalPlanId);

    // Repetir el alta de A no crea planes nuevos.
    expect((await setup(a)).status).toBe(200);
    expect((await providerPlanOf(a)).externalPlanId).toBe(planA.externalPlanId);
    const { count } = await db
      .from('provider_plans')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', PLAN).eq('currency', 'USD').eq('billing_interval', 'MONTHLY').eq('amount', BASE);
    expect(count, 'un solo Plan activo por contrato económico').toBe(1);
  });

  test('precio negociado: el Plan usa el importe del contrato, no la tarifa pública', async () => {
    // Tarifa pública regional de Perú para el plan (seed: USD 850 MONTHLY).
    const { data: tariffs, error } = await db
      .from('plan_prices').select('amount, markets!inner(code)')
      .eq('plan_id', PLAN).eq('currency', 'USD').eq('billing_interval', 'MONTHLY').eq('markets.code', 'PE');
    expect(error).toBeNull();
    const publicPrice = Number(tariffs![0].amount);
    const negotiated = BASE - 124.5;
    expect(negotiated).not.toBe(publicPrice);

    const atTariff = await cardContract('USD', 'MONTHLY', [{ kind: 'LICENSE', amount: publicPrice, interval: 'MONTHLY' }]);
    const discounted = await cardContract('USD', 'MONTHLY', [{ kind: 'LICENSE', amount: negotiated, interval: 'MONTHLY' }]);
    expect((await setup(atTariff)).status).toBe(200);
    expect((await setup(discounted)).status).toBe(200);

    const [planTariff, planNegotiated] = [await providerPlanOf(atTariff), await providerPlanOf(discounted)];
    expect(planTariff.amount).toBe(publicPrice);
    expect(planNegotiated.amount, 'se domicilia lo negociado').toBe(negotiated);
    expect(planNegotiated.externalPlanId, 'nunca comparten Plan').not.toBe(planTariff.externalPlanId);
  });

  test('aislamiento por moneda y por intervalo con el mismo importe numérico', async () => {
    const usd = await cardContract('USD', 'MONTHLY', [{ kind: 'LICENSE', amount: BASE + 7, interval: 'MONTHLY' }]);
    const pen = await cardContract('PEN', 'MONTHLY', [{ kind: 'LICENSE', amount: BASE + 7, interval: 'MONTHLY' }]);
    const yearly = await cardContract('USD', 'YEARLY', [{ kind: 'LICENSE', amount: BASE + 7, interval: 'YEARLY' }]);
    for (const s of [usd, pen, yearly]) expect((await setup(s)).status).toBe(200);

    const [pUsd, pPen, pYear] = [await providerPlanOf(usd), await providerPlanOf(pen), await providerPlanOf(yearly)];
    expect(pPen.currency).toBe('PEN');
    expect(pYear.billing_interval).toBe('YEARLY');
    expect(new Set([pUsd.externalPlanId, pPen.externalPlanId, pYear.externalPlanId]).size).toBe(3);
  });
});

test.describe('V3.2 · payment-setup · contrato recurrente futuro', () => {
  test('MONTHLY vigente + YEARLY futuro: cadencia mixta, no se domicilia', async () => {
    const sub = await cardContract('USD', 'MONTHLY', [
      { kind: 'LICENSE', amount: BASE, interval: 'MONTHLY' },
      { kind: 'SUPPORT_FEE', amount: 2400, interval: 'YEARLY', from: monthStart(3) },
    ]);
    const res = await setup(sub);
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toBe('CADENCIA_MIXTA_NO_DOMICILIABLE');
    expect(String(res.body.message)).toContain('distintas periodicidades');
    await noProviderLink(sub);
  });

  test('MONTHLY + addon MONTHLY que empieza en 3 meses: importe variable, no se domicilia', async () => {
    const sub = await cardContract('USD', 'MONTHLY', [
      { kind: 'LICENSE', amount: BASE, interval: 'MONTHLY' },
      { kind: 'ADDON', amount: 150, interval: 'MONTHLY', from: monthStart(3) },
    ]);
    const res = await setup(sub);
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toBe('MONTO_RECURRENTE_FUTURO_VARIABLE');
    expect(String(res.body.message)).toContain('cambiará durante la vigencia');
    await noProviderLink(sub);
  });

  test('MONTHLY y YEARLY que empiezan ambos en el futuro: cadencia mixta', async () => {
    const sub = await cardContract('USD', 'MONTHLY', [
      { kind: 'LICENSE', amount: BASE, interval: 'MONTHLY', from: monthStart(1) },
      { kind: 'SUPPORT_FEE', amount: 2400, interval: 'YEARLY', from: monthStart(2) },
    ]);
    const res = await setup(sub);
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toBe('CADENCIA_MIXTA_NO_DOMICILIABLE');
    await noProviderLink(sub);
  });

  test('QUARTERLY y YEARLY puros: el ONE_TIME no entra en el Plan', async () => {
    const quarterly = await cardContract('PEN', 'QUARTERLY', [
      { kind: 'LICENSE', amount: BASE + 3, interval: 'QUARTERLY' },
      { kind: 'IMPLEMENTATION_FEE', amount: 5000, interval: 'ONE_TIME' },
    ]);
    const yearly = await cardContract('USD', 'YEARLY', [
      { kind: 'LICENSE', amount: BASE + 5, interval: 'YEARLY' },
      { kind: 'IMPLEMENTATION_FEE', amount: 12000, interval: 'ONE_TIME', from: monthStart(1) },
    ]);
    expect((await setup(quarterly)).status).toBe(200);
    expect((await setup(yearly)).status).toBe(200);
    expect(await providerPlanOf(quarterly)).toMatchObject({ amount: BASE + 3, billing_interval: 'QUARTERLY', currency: 'PEN' });
    expect(await providerPlanOf(yearly)).toMatchObject({ amount: BASE + 5, billing_interval: 'YEARLY', currency: 'USD' });
  });

  test('sustitución MONTHLY por otra del mismo importe: estable, se domicilia', async () => {
    const sub = await cardContract('USD', 'MONTHLY', [
      { kind: 'LICENSE', amount: BASE + 11, interval: 'MONTHLY', to: monthEnd(2) },
      { kind: 'LICENSE', amount: BASE + 11, interval: 'MONTHLY', from: monthStart(3) },
      { kind: 'IMPLEMENTATION_FEE', amount: 3500, interval: 'ONE_TIME' },
      { kind: 'SUPPORT_FEE', amount: 99, interval: 'YEARLY', from: monthStart(-14), to: monthEnd(-2) },
    ]);
    const res = await setup(sub);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // ONE_TIME fuera del plan y la línea YEARLY vencida ignorada.
    expect((await providerPlanOf(sub)).amount).toBe(BASE + 11);
  });
});

test.describe('V3.2 · payment-setup · seguridad', () => {
  test('sin JWT, con un rol sin acceso o con otra cuenta de proveedor, no se domicilia', async () => {
    const sub = await cardContract('USD', 'MONTHLY', [{ kind: 'LICENSE', amount: BASE + 13, interval: 'MONTHLY' }]);

    expect((await setup(sub, { jwt: null })).status).toBe(401);
    expect((await setup(sub, { jwt: 'no-es-un-jwt' })).status).toBe(401);

    // TENANT_ADMIN de otra organización: RLS no le muestra el contrato.
    expect((await setup(sub, { jwt: await jwtOf(USERS.tenantAdmin) })).status).toBe(404);

    // La cuenta la decide el servidor, no el cuerpo de la petición.
    const wrong = await setup(sub, { extra: { provider_account_id: '00000000-0000-4000-a000-0000000000ff' } });
    expect(wrong.status).toBe(403);
    expect(String(wrong.body.error)).toBe('CUENTA_PROVEEDOR_NO_COINCIDE');

    await noProviderLink(sub);
    const { count } = await db
      .from('provider_plans')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', PLAN).eq('amount', BASE + 13);
    expect(count, 'ningún intento rechazado deja un Plan registrado').toBe(0);
  });
});
