/**
 * Edge Function: alta del método de pago de una suscripción.
 *
 * Recibe el TOKEN efímero que el navegador obtuvo del Checkout del proveedor y
 * lo canjea, del lado servidor, por Customer + Card + Plan + Subscription.
 *
 * Por qué esto no puede vivir en React:
 *   · la clave `sk_` solo existe en `Deno.env` y jamás puede viajar al navegador;
 *   · escribir los mapeos exige `service_role`, que RLS niega a `authenticated`.
 *
 * Lo que NUNCA sale de aquí: el token, la clave secreta, ni el cuerpo crudo de
 * la respuesta del proveedor.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  json, resolvePaymentProvider, toAccountConfig, ProviderError,
} from '../_shared/payments/index.ts';

interface SetupBody {
  subscription_id: string;
  provider_account_id?: string;
  /** Token efímero del Checkout. Un solo uso. */
  token: string;
  accepted_terms: boolean;
  customer?: { email?: string; first_name?: string; last_name?: string };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'METODO_NO_PERMITIDO' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: 'CONFIGURACION_INCOMPLETA: faltan credenciales del servidor' }, 500);
  }

  // ---- Autenticación: se exige el JWT del usuario ---------------------------
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'NO_AUTENTICADO: falta el token de sesión' }, 401);
  }

  // Cliente con el JWT del usuario: sus consultas pasan por RLS igual que en la
  // UI. Es lo que garantiza que no pueda configurar el cobro de otro cliente.
  const asUser = createClient(supabaseUrl, anonKey, {
    db: { schema: 'platform' },
    global: { headers: { authorization: authHeader } },
  });

  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError || !userData?.user) {
    return json({ error: 'NO_AUTENTICADO: sesión inválida' }, 401);
  }

  let body: SetupBody;
  try {
    body = (await req.json()) as SetupBody;
  } catch {
    return json({ error: 'CUERPO_INVALIDO: se esperaba JSON' }, 400);
  }

  if (!body.subscription_id || !body.token) {
    return json({ error: 'DATOS_REQUERIDOS: subscription_id y token son obligatorios' }, 400);
  }
  if (!body.accepted_terms) {
    return json(
      { error: 'TERMINOS_NO_ACEPTADOS: el titular debe aceptar los términos para domiciliar el cobro' },
      400,
    );
  }

  // ---- Alcance: la suscripción tiene que ser visible PARA ESTE USUARIO ------
  // Si RLS no la devuelve, no existe para él. Esto es la autorización real, no
  // una comprobación cosmética.
  const { data: collection, error: collectionError } = await asUser
    .from('v_subscription_collection')
    .select('*')
    .eq('subscription_id', body.subscription_id)
    .maybeSingle();

  if (collectionError) return json({ error: collectionError.message }, 500);
  if (!collection) {
    return json({ error: 'SUSCRIPCION_NO_ENCONTRADA: no existe o no tienes acceso' }, 404);
  }
  if (collection.collection_method !== 'CULQI_CARD') {
    return json(
      {
        error:
          'METODO_NO_APLICA: esta suscripción no está configurada para cobro con tarjeta. ' +
          'Cambia primero su perfil de cobranza.',
      },
      409,
    );
  }

  const accountId = body.provider_account_id ?? collection.provider_account_id;
  if (!accountId) {
    return json({ error: 'PROVEEDOR_REQUERIDO: la suscripción no tiene cuenta de proveedor' }, 409);
  }

  // ---- A partir de aquí, servidor -------------------------------------------
  const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'platform' } });

  const { data: accountRow, error: accountError } = await admin
    .from('payment_provider_accounts')
    .select('*')
    .eq('id', accountId)
    .maybeSingle();

  if (accountError) return json({ error: accountError.message }, 500);
  if (!accountRow) return json({ error: 'CUENTA_PROVEEDOR_NO_ENCONTRADA' }, 404);

  const account = toAccountConfig(accountRow);

  let provider;
  try {
    provider = resolvePaymentProvider(account);
  } catch (error) {
    if (error instanceof ProviderError) {
      return json({ error: error.code, message: error.message }, error.httpStatus);
    }
    return json({ error: 'PROVEEDOR_NO_DISPONIBLE' }, 500);
  }

  // Datos del plan local para crear/reutilizar el Plan del proveedor.
  const { data: subscription } = await admin
    .from('subscriptions')
    .select('*, plans(name, code), subscription_items(charge_kind, amount, billing_interval)')
    .eq('id', body.subscription_id)
    .maybeSingle();

  if (!subscription) return json({ error: 'SUSCRIPCION_NO_ENCONTRADA' }, 404);

  const items = (subscription.subscription_items ?? []) as Array<Record<string, unknown>>;
  // El cargo recurrente es lo único domiciliable: los ONE_TIME se cobran aparte.
  const recurring = items.filter((i) => i.billing_interval !== 'ONE_TIME');
  const amount = recurring.reduce((sum, i) => sum + Number(i.amount ?? 0), 0);

  if (amount <= 0) {
    return json(
      { error: 'SIN_IMPORTE_RECURRENTE: la suscripción no tiene cargos recurrentes que domiciliar' },
      409,
    );
  }

  // Mapeos previos: reutilizarlos evita duplicar Customer y Plan en el proveedor.
  const { data: existingCustomer } = await admin
    .from('provider_customers')
    .select('external_customer_id')
    .eq('provider_account_id', account.id)
    .eq('organization_id', subscription.billed_organization_id)
    .maybeSingle();

  const { data: existingPlan } = await admin
    .from('provider_plans')
    .select('external_plan_id')
    .eq('provider_account_id', account.id)
    .eq('plan_id', subscription.plan_id)
    .eq('billing_interval', subscription.billing_interval)
    .eq('currency', subscription.currency)
    .maybeSingle();

  const { data: organization } = await admin
    .from('organizations')
    .select('display_name, billing_email, country_code')
    .eq('id', subscription.billed_organization_id)
    .maybeSingle();

  const email = body.customer?.email ?? organization?.billing_email ?? null;
  if (!email) {
    return json(
      { error: 'CORREO_REQUERIDO: el proveedor exige un correo de facturación para el cliente' },
      400,
    );
  }

  let result;
  try {
    result = await provider.setupSubscription({
      token: body.token,
      customer: {
        organizationId: subscription.billed_organization_id,
        email,
        firstName: body.customer?.first_name ?? (organization?.display_name ?? 'Cliente'),
        lastName: body.customer?.last_name ?? 'EBIM',
        countryCode: organization?.country_code ?? 'PE',
        externalCustomerId: existingCustomer?.external_customer_id ?? null,
      },
      plan: {
        localPlanId: subscription.plan_id,
        name: (subscription.plans as { name: string } | null)?.name ?? subscription.code,
        amount,
        currency: subscription.currency,
        interval: subscription.billing_interval,
        externalPlanId: existingPlan?.external_plan_id ?? null,
      },
      acceptedTerms: true,
      metadata: { subscription_code: subscription.code, subscription_id: subscription.id },
    });
  } catch (error) {
    if (error instanceof ProviderError) {
      return json({ error: error.code, message: error.message }, error.httpStatus);
    }
    // El mensaje crudo podría traer datos del titular: no se propaga.
    return json({ error: 'PROVEEDOR_ERROR', message: 'El proveedor rechazó la operación' }, 502);
  }

  // ---- Persistencia de los mapeos. Solo ids y datos no sensibles. -----------
  await admin.from('provider_customers').upsert(
    {
      provider_account_id: account.id,
      organization_id: subscription.billed_organization_id,
      external_customer_id: result.externalCustomerId,
      status: 'ACTIVE',
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'provider_account_id,organization_id' },
  );

  const { data: customerRow } = await admin
    .from('provider_customers')
    .select('id')
    .eq('provider_account_id', account.id)
    .eq('organization_id', subscription.billed_organization_id)
    .maybeSingle();

  await admin.from('provider_payment_methods').upsert(
    {
      provider_account_id: account.id,
      organization_id: subscription.billed_organization_id,
      provider_customer_id: customerRow?.id ?? null,
      external_payment_method_id: result.externalPaymentMethodId,
      brand: result.card.brand,
      last4: result.card.last4,
      exp_month: result.card.expMonth,
      exp_year: result.card.expYear,
      is_default: true,
      status: 'ACTIVE',
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'provider_account_id,external_payment_method_id' },
  );

  await admin.from('provider_plans').upsert(
    {
      provider_account_id: account.id,
      plan_id: subscription.plan_id,
      external_plan_id: result.externalPlanId,
      amount,
      currency: subscription.currency,
      billing_interval: subscription.billing_interval,
      status: 'ACTIVE',
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'provider_account_id,plan_id,billing_interval,currency' },
  );

  const { error: linkError } = await admin.rpc('upsert_provider_subscription', {
    p_provider_account_id: account.id,
    p_subscription_id: subscription.id,
    p_external_subscription_id: result.externalSubscriptionId,
    p_external_plan_id: result.externalPlanId,
    p_external_payment_method_id: result.externalPaymentMethodId,
    p_external_customer_id: result.externalCustomerId,
    p_provider_status: result.providerStatus,
    p_next_billing_at: result.nextBillingAt,
    p_metadata: { mode: provider.mode },
  });

  if (linkError) return json({ error: linkError.message }, 500);

  return json({
    ok: true,
    mode: provider.mode,
    provider: provider.name,
    // Solo lo que el usuario necesita ver. Ni token, ni ids internos del proveedor
    // más allá de la suscripción.
    card: { brand: result.card.brand, last4: result.card.last4 },
    external_subscription_id: result.externalSubscriptionId,
    provider_status: result.providerStatus,
    next_billing_at: result.nextBillingAt,
    simulated: provider.mode === 'MOCK',
  });
});
