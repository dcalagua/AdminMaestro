/**
 * Edge Function: webhook del proveedor de pago.
 *
 * Este endpoint es PÚBLICO por necesidad: Culqi no puede enviar un JWT de
 * Supabase. Y, como se documenta en `docs/payments/CULQI_ARCHITECTURE.md` §5.1,
 * **Culqi tampoco firma criptográficamente sus webhooks**.
 *
 * No se inventa una firma. Se aplican cuatro defensas reales:
 *
 *   1. IDEMPOTENCIA DURA. `provider_webhook_events` tiene índice único sobre
 *      (cuenta, clave de evento). El mismo evento entregado cinco veces entra
 *      una sola vez; las otras cuatro devuelven 200 sin tocar nada.
 *   2. VALIDACIÓN ESTRICTA. Si el cuerpo no tiene la forma conocida, se rechaza
 *      en vez de interpretarse "lo mejor posible".
 *   3. VERIFICACIÓN SERVER-TO-SERVER. Antes de confirmar un cobro se consulta el
 *      cargo al proveedor con la clave secreta. Un tercero puede inventar un
 *      evento; no puede hacer que Culqi confirme un `chr_` inexistente.
 *   4. CORRELACIÓN OBLIGATORIA. El evento debe referirse a una suscripción que YA
 *      exista en nuestra base. Lo comprueba `register_provider_payment()`.
 *
 * Este archivo NO escribe en `payments`. Llama a la RPC, que es quien decide.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  json, resolvePaymentProvider, toAccountConfig, ProviderError,
} from '../_shared/payments/index.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'METODO_NO_PERMITIDO' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'CONFIGURACION_INCOMPLETA' }, 500);
  }

  // La cuenta se identifica por query string (?account=culqi-pe-test), que es lo
  // que se registra como URL en el panel del proveedor. No es un secreto: la
  // seguridad no depende de que esta URL sea desconocida.
  const url = new URL(req.url);
  const accountCode = url.searchParams.get('account') ?? 'culqi-pe-test';

  const rawBody = await req.text();
  // Un cuerpo desmesurado es abuso, no un evento. Se corta antes de parsear.
  if (rawBody.length > 256_000) {
    return json({ error: 'CUERPO_DEMASIADO_GRANDE' }, 413);
  }

  const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'platform' } });

  const { data: accountRow, error: accountError } = await admin
    .from('payment_provider_accounts')
    .select('*')
    .eq('code', accountCode)
    .maybeSingle();

  if (accountError) return json({ error: accountError.message }, 500);
  if (!accountRow) return json({ error: 'CUENTA_PROVEEDOR_NO_ENCONTRADA' }, 404);
  if (accountRow.status !== 'ACTIVE') {
    return json({ error: 'CUENTA_PROVEEDOR_INACTIVA' }, 409);
  }

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

  // ---- Defensa 2: validación estricta --------------------------------------
  const event = provider.parseWebhook(rawBody, req.headers);
  if (!event) {
    // Se deja constancia del rechazo para poder vigilarlo, pero con una clave
    // derivada del contenido: no se confía en nada del cuerpo para identificarlo.
    const fallbackKey = `rejected:${await sha256Hex(rawBody)}`;
    await admin.from('provider_webhook_events').insert({
      provider_account_id: account.id,
      external_event_key: fallbackKey,
      event_type: 'unrecognized',
      payload: { length: rawBody.length },
      status: 'REJECTED',
      error_code: 'PAYLOAD_NO_RECONOCIDO',
      error_message: 'El cuerpo del webhook no tiene la forma esperada',
      processed_at: new Date().toISOString(),
    });
    // 200 a propósito: un 4xx haría que el proveedor reintentara indefinidamente
    // un evento que nunca vamos a poder procesar.
    return json({ accepted: false, error: 'PAYLOAD_NO_RECONOCIDO' }, 200);
  }

  // ---- Cobro fallido: NO es un cobro ---------------------------------------
  if (event.kind === 'PAYMENT_FAILED') {
    const { data, error } = await admin.rpc('register_provider_payment_failure', {
      p_provider_account_id: account.id,
      p_external_event_key: event.eventKey,
      p_event_type: event.eventType,
      p_external_subscription_id: event.externalSubscriptionId ?? '',
      p_error_code: event.errorCode,
      p_error_message: event.errorMessage,
      p_payload: event.safePayload,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ accepted: true, kind: event.kind, result: data });
  }

  if (event.kind !== 'PAYMENT_SUCCEEDED') {
    // Eventos de suscripción: se registran para trazabilidad, sin mover dinero.
    await admin.from('provider_webhook_events').insert({
      provider_account_id: account.id,
      external_event_key: event.eventKey,
      event_type: event.eventType,
      payload: event.safePayload,
      status: 'IGNORED',
      processed_at: new Date().toISOString(),
    });
    return json({ accepted: true, kind: event.kind, note: 'Registrado sin efecto contable' });
  }

  // Sin id de cargo no hay nada que verificar contra el proveedor.
  if (!event.externalChargeId) {
    return json({ accepted: false, error: 'EVENTO_INCOMPLETO' }, 200);
  }

  // ---- Defensa 3: verificación server-to-server ----------------------------
  // En MOCK devuelve null y se acepta el evento simulado. Contra un proveedor
  // real, `null` significa "ese cargo no existe": se rechaza.
  let amount = event.amount;
  let currency = event.currency;
  let paidAt = event.occurredAt;
  /*
   * El cobro RECURRENTE (`subscription.charge.succeeded`) no siempre trae el id
   * de la suscripción en el mismo sitio que un cargo suelto. Se admite que lo
   * aporte la consulta directa al proveedor, que es la fuente fiable; lo que no
   * se admite es continuar sin él, porque sin suscripción no hay contrato al que
   * imputar el pago ni comisión que devengar.
   */
  let subscriptionId = event.externalSubscriptionId;

  if (provider.mode !== 'MOCK') {
    const verified = await provider.verifyCharge(event.externalChargeId);
    if (!verified || verified.status !== 'CONFIRMED') {
      await admin.from('provider_webhook_events').insert({
        provider_account_id: account.id,
        external_event_key: event.eventKey,
        event_type: event.eventType,
        payload: event.safePayload,
        status: 'REJECTED',
        error_code: 'CARGO_NO_VERIFICADO',
        error_message: 'El proveedor no confirma este cargo en una consulta directa',
        processed_at: new Date().toISOString(),
      });
      return json({ accepted: false, error: 'CARGO_NO_VERIFICADO' }, 200);
    }
    // Se usan los importes del PROVEEDOR, no los del evento: el evento pudo
    // llegar manipulado; la consulta directa no.
    amount = verified.amount;
    currency = verified.currency;
    paidAt = verified.paidAt;
    subscriptionId = subscriptionId ?? verified.externalSubscriptionId;
  }

  if (!amount || !currency) {
    return json({ accepted: false, error: 'IMPORTE_O_MONEDA_AUSENTE' }, 200);
  }

  if (!subscriptionId) {
    // Se deja rastro: un cobro confirmado que no sabemos a quién imputar es
    // justo el caso que la reconciliación tiene que ver.
    await admin.from('provider_webhook_events').insert({
      provider_account_id: account.id,
      external_event_key: event.eventKey,
      event_type: event.eventType,
      payload: event.safePayload,
      status: 'REJECTED',
      error_code: 'SUSCRIPCION_NO_IDENTIFICADA',
      error_message: 'El cargo está confirmado pero no se pudo asociar a una suscripción',
      processed_at: new Date().toISOString(),
    });
    return json({ accepted: false, error: 'SUSCRIPCION_NO_IDENTIFICADA' }, 200);
  }

  // ---- Defensas 1 y 4 viven dentro de la RPC -------------------------------
  const { data, error } = await admin.rpc('register_provider_payment', {
    p_provider_account_id: account.id,
    p_external_event_key: event.eventKey,
    p_event_type: event.eventType,
    p_external_charge_id: event.externalChargeId,
    p_external_subscription_id: subscriptionId,
    p_amount: amount,
    p_currency: currency,
    p_paid_at: paidAt,
    p_payload: event.safePayload,
  });

  if (error) return json({ error: error.message }, 500);

  return json({ accepted: true, kind: event.kind, mode: provider.mode, result: data });
});

/** Hash del cuerpo para identificar un rechazo sin confiar en su contenido. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
