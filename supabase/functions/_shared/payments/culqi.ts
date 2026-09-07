import {
  ProviderError,
  type ChargeSummary, type NormalizedWebhookEvent, type PaymentProvider,
  type ProviderAccountConfig, type SetupInput, type SetupResult,
} from './types.ts';

/**
 * Adapter de Culqi.
 *
 * Documentación oficial consultada el 2026-09-07 y resumida en
 * `docs/payments/CULQI_ARCHITECTURE.md`. Los hechos verificados que este archivo
 * da por buenos:
 *
 *   · las llaves son `pk_(test|live)_…` (navegador) y `sk_(test|live)_…` (servidor);
 *   · "la API sigue siendo la misma para ambos casos": el ENTORNO lo decide la
 *     llave, no la URL. Por eso `environment` es un dato explícito de la cuenta
 *     y no se deduce del endpoint;
 *   · el orden de creación es Plan -> Customer -> Card -> Subscription;
 *   · crear una suscripción toma `{ card_id, plan_id, tyc, metadata }`;
 *   · los ids externos son `pln_`, `crd_`, `sxn_`, `chr_`.
 *
 * Y el hecho que NO se pudo verificar, tratado como tal:
 *
 *   · la URL base de la API. `apidocs.culqi.com` no devolvió contenido legible.
 *     NO se inventa: llega por `CULQI_API_BASE`. Sin esa variable el selector de
 *     `index.ts` ni siquiera construye este adapter, y el sistema opera en MOCK.
 */

interface CulqiConfig {
  apiBase: string;
  secretKey: string;
}

const TIMEOUT_MS = 20_000;

export class CulqiPaymentProvider implements PaymentProvider {
  readonly name = 'culqi';
  readonly mode: 'TEST' | 'LIVE';

  constructor(
    private readonly account: ProviderAccountConfig,
    private readonly config: CulqiConfig,
  ) {
    this.mode = account.environment;

    // Un desajuste aquí cobra de verdad creyendo que está en pruebas. Es barato
    // comprobarlo y catastrófico no hacerlo.
    const isLiveKey = config.secretKey.startsWith('sk_live_');
    if (account.environment === 'LIVE' && !isLiveKey) {
      throw new ProviderError(
        'LLAVE_NO_COINCIDE',
        'La cuenta está marcada como LIVE pero la clave configurada no es sk_live_',
        500,
      );
    }
    if (account.environment === 'TEST' && isLiveKey) {
      throw new ProviderError(
        'LLAVE_NO_COINCIDE',
        'La cuenta está marcada como TEST pero la clave configurada es sk_live_: se cobraría de verdad',
        500,
      );
    }
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  private async call<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.config.apiBase}${path}`, {
        method,
        headers: {
          // La clave secreta viaja SOLO en la cabecera, nunca en la URL: las URLs
          // acaban en logs de proxy y de servidor.
          authorization: `Bearer ${this.config.secretKey}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // El mensaje del error de red puede contener la URL; se descarta.
      throw new ProviderError(
        'PROVEEDOR_NO_DISPONIBLE',
        error instanceof Error && error.name === 'AbortError'
          ? 'El proveedor de pago no respondió a tiempo'
          : 'No se pudo contactar con el proveedor de pago',
        502,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      // Se propaga el mensaje del proveedor pero NO el cuerpo crudo: puede traer
      // datos del titular que no tenemos por qué registrar.
      throw new ProviderError(
        typeof parsed.merchant_message === 'string'
          ? 'PROVEEDOR_RECHAZO'
          : `PROVEEDOR_HTTP_${response.status}`,
        typeof parsed.user_message === 'string'
          ? parsed.user_message
          : typeof parsed.merchant_message === 'string'
            ? parsed.merchant_message
            : 'El proveedor de pago rechazó la operación',
        response.status,
      );
    }

    return parsed as T;
  }

  // -------------------------------------------------------------------------
  // Alta de suscripción: Plan -> Customer -> Card -> Subscription
  // -------------------------------------------------------------------------

  async setupSubscription(input: SetupInput): Promise<SetupResult> {
    if (!input.acceptedTerms) {
      throw new ProviderError(
        'TERMINOS_NO_ACEPTADOS',
        'El titular debe aceptar los términos y condiciones para domiciliar el cobro',
      );
    }
    if (input.plan.interval === 'ONE_TIME') {
      throw new ProviderError(
        'INTERVALO_NO_RECURRENTE',
        'Un cargo único no se domicilia como suscripción recurrente',
      );
    }

    // (1) Plan. Se reutiliza si la suscripción local ya tenía uno mapeado.
    let externalPlanId = input.plan.externalPlanId ?? null;
    if (!externalPlanId) {
      const plan = await this.call<{ id?: string; data?: { id?: string } }>('POST', '/plans', {
        name: `${input.plan.name} · ${input.plan.currency}`,
        // Culqi trabaja en la unidad mínima de la moneda (céntimos).
        amount: Math.round(input.plan.amount * 100),
        currency: input.plan.currency,
        interval: input.plan.interval.toLowerCase(),
        metadata: input.metadata ?? {},
      });
      externalPlanId = plan.id ?? plan.data?.id ?? null;
      if (!externalPlanId) {
        throw new ProviderError('PLAN_SIN_ID', 'El proveedor no devolvió el identificador del plan', 502);
      }
    }

    // (2) Customer.
    let externalCustomerId = input.customer.externalCustomerId ?? null;
    if (!externalCustomerId) {
      const customer = await this.call<{ id?: string; data?: { id?: string } }>('POST', '/customers', {
        first_name: input.customer.firstName,
        last_name: input.customer.lastName,
        email: input.customer.email,
        country_code: input.customer.countryCode,
        metadata: { organization_id: input.customer.organizationId },
      });
      externalCustomerId = customer.id ?? customer.data?.id ?? null;
      if (!externalCustomerId) {
        throw new ProviderError('CLIENTE_SIN_ID', 'El proveedor no devolvió el identificador del cliente', 502);
      }
    }

    // (3) Card. Aquí se consume el token efímero. No se registra en ningún sitio.
    const card = await this.call<{
      id?: string;
      source?: { iin?: { card_brand?: string }; last_four?: string };
    }>('POST', '/cards', {
      customer_id: externalCustomerId,
      token_id: input.token,
      metadata: input.metadata ?? {},
    });

    const externalPaymentMethodId = card.id ?? null;
    if (!externalPaymentMethodId) {
      throw new ProviderError('TARJETA_SIN_ID', 'El proveedor no devolvió el identificador de la tarjeta', 502);
    }

    // (4) Subscription. Campos verbatim de la documentación oficial.
    const subscription = await this.call<{
      id?: string; status?: string | number; next_billing_date?: number | string;
    }>('POST', '/subscriptions', {
      card_id: externalPaymentMethodId,
      plan_id: externalPlanId,
      tyc: true,
      metadata: input.metadata ?? {},
    });

    const externalSubscriptionId = subscription.id ?? null;
    if (!externalSubscriptionId) {
      throw new ProviderError(
        'SUSCRIPCION_SIN_ID',
        'El proveedor no devolvió el identificador de la suscripción',
        502,
      );
    }

    return {
      externalCustomerId,
      externalPaymentMethodId,
      externalPlanId,
      externalSubscriptionId,
      providerStatus: String(subscription.status ?? 'active'),
      nextBillingAt: toIso(subscription.next_billing_date),
      // Solo lo no sensible. El PAN nunca llegó a este servidor.
      card: {
        brand: card.source?.iin?.card_brand ?? null,
        last4: card.source?.last_four ?? null,
        expMonth: null,
        expYear: null,
      },
    };
  }

  async cancelSubscription(externalSubscriptionId: string): Promise<{ providerStatus: string }> {
    await this.call('DELETE', `/subscriptions/${encodeURIComponent(externalSubscriptionId)}`);
    return { providerStatus: 'canceled' };
  }

  // -------------------------------------------------------------------------
  // Verificación server-to-server: lo que sustituye a la firma que Culqi no da.
  // -------------------------------------------------------------------------

  async verifyCharge(externalChargeId: string): Promise<ChargeSummary | null> {
    try {
      const charge = await this.call<{
        id?: string; amount?: number; currency_code?: string;
        creation_date?: number | string; outcome?: { type?: string };
        metadata?: Record<string, unknown>;
      }>('GET', `/charges/${encodeURIComponent(externalChargeId)}`);

      if (!charge.id) return null;

      return {
        externalChargeId: charge.id,
        externalSubscriptionId:
          typeof charge.metadata?.subscription_id === 'string'
            ? charge.metadata.subscription_id
            : null,
        amount: (charge.amount ?? 0) / 100,
        currency: charge.currency_code ?? this.account.currency,
        paidAt: toIso(charge.creation_date) ?? new Date().toISOString(),
        status: charge.outcome?.type === 'venta_exitosa' ? 'CONFIRMED' : 'FAILED',
      };
    } catch {
      // Un cargo que el proveedor no reconoce NO es un error nuestro: es la
      // respuesta correcta a "¿existe este cargo?". La respuesta es no.
      return null;
    }
  }

  async listCharges(fromIso: string, toIso: string): Promise<ChargeSummary[]> {
    const from = Math.floor(new Date(fromIso).getTime() / 1000);
    const to = Math.floor(new Date(toIso).getTime() / 1000);

    const page = await this.call<{ data?: Array<Record<string, unknown>> }>(
      'GET',
      `/charges?creation_date_from=${from}&creation_date_to=${to}&limit=100`,
    );

    return (page.data ?? []).map((c) => ({
      externalChargeId: String(c.id ?? ''),
      externalSubscriptionId:
        typeof (c.metadata as Record<string, unknown> | undefined)?.subscription_id === 'string'
          ? ((c.metadata as Record<string, unknown>).subscription_id as string)
          : null,
      amount: Number(c.amount ?? 0) / 100,
      currency: String(c.currency_code ?? this.account.currency),
      paidAt: toIso2(c.creation_date) ?? new Date().toISOString(),
      status: (c.outcome as { type?: string } | undefined)?.type === 'venta_exitosa'
        ? 'CONFIRMED'
        : 'FAILED',
    }));
  }

  // -------------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------------

  /**
   * Culqi NO documenta firma criptográfica de webhooks (verificado el 2026-09-07).
   * Aquí NO se inventa una. Lo que sí se hace es VALIDAR ESTRICTAMENTE: si el
   * cuerpo no tiene la forma que conocemos, se devuelve `null` y la Edge Function
   * lo registra como REJECTED en vez de intentar interpretarlo.
   */
  parseWebhook(rawBody: string, _headers: Headers): NormalizedWebhookEvent | null {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }

    const type = typeof body.type === 'string' ? body.type : null;
    if (!type) return null;

    const data = (body.data ?? {}) as Record<string, unknown>;

    // Sin clave de evento estable no hay idempotencia posible, y sin idempotencia
    // este endpoint es un duplicador de cobros. Se rechaza.
    const eventKey = typeof body.id === 'string' && body.id.length > 0 ? body.id : null;
    if (!eventKey) return null;

    const kind =
      type.startsWith('charge.succeeded') || type === 'charge.creation.succeeded'
        ? 'PAYMENT_SUCCEEDED'
        : type.startsWith('charge.failed') || type === 'charge.creation.failed'
          ? 'PAYMENT_FAILED'
          : type.startsWith('subscription.')
            ? 'SUBSCRIPTION_UPDATED'
            : 'UNKNOWN';

    if (kind === 'UNKNOWN') return null;

    const metadata = (data.metadata ?? {}) as Record<string, unknown>;

    return {
      eventKey,
      eventType: type,
      kind,
      externalSubscriptionId:
        typeof data.subscription_id === 'string' ? data.subscription_id
        : typeof metadata.subscription_id === 'string' ? metadata.subscription_id
        : null,
      externalChargeId: typeof data.id === 'string' ? data.id : null,
      amount: typeof data.amount === 'number' ? data.amount / 100 : null,
      currency: typeof data.currency_code === 'string' ? data.currency_code : null,
      occurredAt: toIso2(body.creation_date) ?? new Date().toISOString(),
      errorCode: typeof data.error_code === 'string' ? data.error_code : null,
      errorMessage: typeof data.user_message === 'string' ? data.user_message : null,
      // Se guarda un subconjunto CONOCIDO, nunca el cuerpo crudo: puede traer
      // datos del titular que no necesitamos y no queremos conservar.
      safePayload: {
        type,
        subscription_id: data.subscription_id ?? metadata.subscription_id ?? null,
        charge_id: data.id ?? null,
        amount: data.amount ?? null,
        currency_code: data.currency_code ?? null,
        outcome_type: (data.outcome as { type?: string } | undefined)?.type ?? null,
      },
    };
  }
}

/** Culqi devuelve fechas como epoch en milisegundos. */
function toIso(value: unknown): string | null {
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'string' && value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

const toIso2 = toIso;
