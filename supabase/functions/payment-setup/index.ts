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
import {
  recurringCardAmount, RECURRING_ERROR_MESSAGES, type RecurringItem,
} from '../_shared/payments/recurring-amount.ts';
import { providerPlanIdentity, providerPlanRpcArgs } from '../_shared/payments/provider-plan.ts';

interface SetupBody {
  subscription_id: string;
  /**
   * `provider_account_id` NO forma parte del contrato: la cuenta de cobro la
   * resuelve el servidor desde la configuración de la suscripción. Ver §resolución
   * de cuenta más abajo.
   */
  /** Token efímero del Checkout. Un solo uso. */
  token: string;
  accepted_terms: boolean;
  /*
   * `customer` YA NO forma parte del contrato: los datos fiscales se leen de la
   * organización. Aceptarlos por petición permitía enviar a la pasarela un
   * nombre o un domicilio distintos de los del titular registrado.
   */
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
    /*
     * `Authorization` con A MAYÚSCULA, exactamente como la escribe supabase-js.
     *
     * Con `authorization` en minúscula —que es lo que había— la cabecera se
     * DUPLICA: la nuestra y la que el cliente añade por su cuenta. La puerta de
     * enlace responde entonces «Bad request» en texto plano, el cliente lo
     * reporta como AuthUnknownError y esta función lo traduce a NO_AUTENTICADO.
     *
     * Efecto medido sobre el runtime real: 401 para TODO el mundo, incluido
     * EBIM_FINANCE con un JWT válido. Falla cerrado, así que no abría ningún
     * hueco; simplemente dejaba la función inservible sin decir por qué.
     */
    global: { headers: { Authorization: authHeader } },
  });

  // El token se pasa EXPLÍCITAMENTE en vez de confiar en que el cliente lo
  // deduzca de la cabecera: en una Edge Function no hay sesión almacenada de
  // la que tirar, y así la identidad no depende del transporte.
  const bearerToken = authHeader.slice('bearer '.length).trim();
  const { data: userData, error: userError } = await asUser.auth.getUser(bearerToken);
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

  /*
   * RESOLUCIÓN DE LA CUENTA DE COBRO — SERVER-SIDE, SIN INPUT DEL CLIENTE.
   *
   * Antes esto era `body.provider_account_id ?? collection.provider_account_id`,
   * de modo que un valor enviado por el navegador GANABA sobre la configuración.
   * Un cliente podía apuntar el alta de su tarjeta a la cuenta de comercio de
   * OTRO partner: el Customer, la Card y la Subscription se habrían creado en la
   * pasarela ajena, y los cobros habrían entrado en la cuenta equivocada.
   *
   * Que los UUID sean difíciles de adivinar no es un control de acceso. La
   * cuenta se deriva ahora exclusivamente de:
   *
   *     subscription -> collection profile -> payment_provider_account
   *
   * Si el cliente envía `provider_account_id`, se IGNORA salvo que coincida
   * exactamente con la configurada; si difiere, se rechaza en vez de callar,
   * porque una discrepancia significa que alguien lo está intentando.
   */
  const accountId = collection.provider_account_id;
  if (!accountId) {
    return json({ error: 'PROVEEDOR_REQUERIDO: la suscripción no tiene cuenta de proveedor configurada' }, 409);
  }

  const cuentaSolicitada = (body as unknown as Record<string, unknown>).provider_account_id;
  if (typeof cuentaSolicitada === 'string' && cuentaSolicitada !== accountId) {
    return json(
      {
        error: 'CUENTA_PROVEEDOR_NO_COINCIDE',
        message:
          'La cuenta de cobro la determina la configuración de la suscripción, no la petición.',
      },
      403,
    );
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
    .select('*, plans(name, code), subscription_items(charge_kind, amount, billing_interval, valid_from, valid_to)')
    .eq('id', body.subscription_id)
    .maybeSingle();

  if (!subscription) return json({ error: 'SUSCRIPCION_NO_ENCONTRADA' }, 404);

  /*
   * El importe sale del CONTRATO (`subscription_items`), no de `plan_prices`:
   * un precio negociado se domicilia por lo negociado. Los ONE_TIME se cobran
   * aparte, y un plan del proveedor no admite mezclar cadencias (V3.1).
   *
   * V3.2 · Cuentan también las líneas que el contrato ya sabe que entrarán o
   * saldrán de vigencia: el Plan se crea hoy con un importe fijo y no se
   * reprovisiona solo. Si la cadencia o el importe van a cambiar, se rechaza.
   */
  let recurring;
  try {
    recurring = recurringCardAmount(
      (subscription.subscription_items ?? []) as RecurringItem[],
      subscription.billing_interval,
      new Date().toISOString().slice(0, 10),
      subscription.ends_on ?? null,
    );
  } catch {
    return json({ error: 'IMPORTE_NO_REPRESENTABLE', message: 'Un cargo del contrato no tiene un importe válido.' }, 409);
  }

  if (!recurring.ok) {
    return json(
      {
        error: recurring.error,
        message: RECURRING_ERROR_MESSAGES[recurring.error],
        ...(recurring.changesOn ? { changes_on: recurring.changesOn } : {}),
      },
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

  /*
   * V3.2 · Plan del proveedor reutilizable: EXACTAMENTE esta cuenta, plan,
   * intervalo, moneda e importe. Antes se buscaba sin importe y el cliente de
   * USD 1250 heredaba el Plan de USD 1000 de otro cliente.
   */
  const planIdentity = providerPlanIdentity({
    providerAccountId: account.id,
    planId: subscription.plan_id,
    billingInterval: subscription.billing_interval,
    currency: subscription.currency,
    amountMinor: recurring.amountMinor,
  });
  const planArgs = providerPlanRpcArgs(planIdentity);

  const { data: reusablePlanId, error: planLookupError } = await admin.rpc('find_reusable_provider_plan', planArgs);
  if (planLookupError) {
    return json({ error: 'PROVIDER_PLAN_NO_VERIFICABLE', message: 'No se pudo verificar el plan de cobro.' }, 500);
  }

  /*
   * Datos de facturación del titular.
   *
   * La pasarela exige siete campos para el Customer. Se leen de la vista de
   * preparación, que además dice cuáles faltan, en lugar de rellenarlos con
   * literales: un domicilio inventado viaja al proveedor y acaba en el recibo
   * del cliente. Si falta alguno, el alta se detiene aquí con la lista exacta.
   */
  const { data: readiness } = await admin
    .from('v_billing_contact_readiness')
    .select('*')
    .eq('organization_id', subscription.billed_organization_id)
    .maybeSingle();

  if (!readiness) return json({ error: 'ORGANIZACION_NO_ENCONTRADA' }, 404);

  if (readiness.ready_for_card_payment !== true) {
    return json(
      {
        error: 'DATOS_FACTURACION_INCOMPLETOS',
        message:
          'Faltan datos de facturación exigidos por la pasarela. Complétalos en la ficha ' +
          'de la organización antes de domiciliar el cobro.',
        missing_fields: readiness.missing_fields ?? [],
      },
      409,
    );
  }

  let result;
  try {
    result = await provider.setupSubscription({
      token: body.token,
      customer: {
        organizationId: subscription.billed_organization_id,
        // Todo sale de la ficha de la organización: el cuerpo de la petición no
        // puede reescribir los datos fiscales que van a la pasarela.
        email: String(readiness.billing_email),
        firstName: String(readiness.billing_first_name),
        lastName: String(readiness.billing_last_name),
        address: String(readiness.billing_address),
        addressCity: String(readiness.billing_city),
        phoneNumber: String(readiness.billing_phone),
        countryCode: String(readiness.country_code),
        externalCustomerId: existingCustomer?.external_customer_id ?? null,
      },
      plan: {
        localPlanId: subscription.plan_id,
        name: (subscription.plans as { name: string } | null)?.name ?? subscription.code,
        amountMinor: planIdentity.amountMinor,
        currency: planIdentity.currency,
        interval: planIdentity.billingInterval,
        externalPlanId: (reusablePlanId as string | null) ?? null,
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

  /*
   * V3.2 · El Plan se registra con la identidad con la que se creó o reutilizó
   * en el proveedor. `register_provider_plan` nunca reescribe una fila: si el
   * `external_plan_id` ya describe otro importe, falla en vez de fingir que el
   * Plan del proveedor cambió de precio. Va después de enlazar la suscripción,
   * que ya existe en el proveedor y tiene que quedar registrada igualmente.
   */
  const { error: planRegisterError } = await admin.rpc('register_provider_plan', {
    ...planArgs,
    p_external_plan_id: result.externalPlanId,
  });
  if (planRegisterError) {
    return json(
      {
        error: 'PROVIDER_PLAN_INCONSISTENTE',
        message: 'La domiciliación se creó, pero el plan de cobro no coincide con el contrato. Requiere revisión de finanzas.',
      },
      500,
    );
  }

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
