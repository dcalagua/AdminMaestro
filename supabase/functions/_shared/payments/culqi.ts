import {
  toCulqiInterval, toCulqiPlanAmount, fromCulqiAmount, toCulqiText,
  fromCulqiSubscriptionStatus,
  normalizeCulqiTimestamp, classifyCulqiEvent,
} from './culqi-mapping.ts';
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
 * ACTUALIZACIÓN V2.1 — verificado contra la API TEST real el 2026-09-07:
 *
 *   · la base es `https://api.culqi.com/v2`;
 *   · Customers, Cards, Tokens y Charges cuelgan de la raíz;
 *   · **la recurrencia NO**: `/plans` responde 400 y `/subscriptions` 401. Los
 *     endpoints correctos son `/recurrent/plans/*` y `/recurrent/subscriptions/*`,
 *     y la creación va a `.../create`. La versión anterior de este archivo usaba
 *     los equivocados, así que la domiciliación NUNCA habría funcionado;
 *   · el Customer exige SIETE campos (first_name, last_name, email, address,
 *     address_city, country_code, phone_number). No se inventan: si el Control
 *     Plane no los tiene, el alta se detiene (ver migración 23);
 *   · los timestamps mezclan segundos y milisegundos EN LA MISMA API. Ver
 *     `normalizeCulqiTimestamp` en `culqi-mapping.ts`.
 *
 * La URL base sigue llegando por `CULQI_API_BASE`: es configuración, no una
 * constante escondida en el código.
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

    // (1) Plan recurrente. Endpoint verificado: POST /recurrent/plans/create.
    let externalPlanId = input.plan.externalPlanId ?? null;
    if (!externalPlanId) {
      const cadencia = toCulqiInterval(input.plan.interval);
      let importe: number;
      try {
        importe = toCulqiPlanAmount(input.plan.amountMinor, input.plan.currency);
      } catch (error) {
        throw new ProviderError(
          'IMPORTE_PLAN_INVALIDO',
          error instanceof Error ? error.message : 'Importe o moneda no válidos para el plan',
          409,
        );
      }
      // Nombre único por reintento: Culqi rechaza nombres repetidos.
      const sufijo = Date.now().toString(36).slice(-6);
      const plan = await this.call<{ id?: string; data?: { id?: string } }>(
        'POST',
        '/recurrent/plans/create',
        {
          // Todo texto pasa por el saneador: la pasarela rechaza puntuación
          // tan corriente como una coma. Ver `toCulqiText`.
          name: toCulqiText(`${input.plan.name} ${input.plan.currency} ${sufijo}`, 50),
          short_name: toCulqiText(`ebim${sufijo}`, 20),
          description: toCulqiText(`Plan EBIM ${input.plan.name}`, 100),
          amount: importe,
          currency: input.plan.currency,
          ...cadencia,
          // Culqi lo exige. Sin ciclos iniciales ni cargo de entrada: el
          // importe de alta ya se factura por nuestro propio circuito.
          initial_cycles: {
            count: 0,
            has_initial_charge: false,
            amount: 0,
            interval_unit_time: cadencia.interval_unit_time,
          },
          metadata: input.metadata ?? {},
        },
      );
      externalPlanId = plan.id ?? plan.data?.id ?? null;
      if (!externalPlanId) {
        throw new ProviderError('PLAN_SIN_ID', 'El proveedor no devolvió el identificador del plan', 502);
      }
    }

    // (2) Customer. Culqi exige SIETE campos; ninguno se inventa.
    let externalCustomerId = input.customer.externalCustomerId ?? null;
    if (!externalCustomerId) {
      const faltantes = (
        [
          ['first_name', input.customer.firstName],
          ['last_name', input.customer.lastName],
          ['email', input.customer.email],
          ['address', input.customer.address],
          ['address_city', input.customer.addressCity],
          ['country_code', input.customer.countryCode],
          ['phone_number', input.customer.phoneNumber],
        ] as const
      )
        .filter(([, v]) => !v || String(v).trim() === '')
        .map(([k]) => k);

      if (faltantes.length > 0) {
        // Se detiene con la lista exacta en vez de rellenar con literales: un
        // domicilio inventado viaja a la pasarela y acaba en el recibo del
        // cliente. Los datos se completan desde la consola (migración 23).
        throw new ProviderError(
          'DATOS_FACTURACION_INCOMPLETOS',
          `Faltan datos de facturación exigidos por la pasarela: ${faltantes.join(', ')}. ` +
            'Complétalos en la ficha de la organización antes de domiciliar el cobro.',
          409,
        );
      }

      try {
        const customer = await this.call<{ id?: string; data?: { id?: string } }>('POST', '/customers', {
          first_name: input.customer.firstName,
          last_name: input.customer.lastName,
          email: input.customer.email,
          address: input.customer.address,
          address_city: input.customer.addressCity,
          country_code: input.customer.countryCode,
          phone_number: input.customer.phoneNumber,
          metadata: { organization_id: input.customer.organizationId },
        });
        externalCustomerId = customer.id ?? customer.data?.id ?? null;
      } catch (error) {
        /*
         * El proveedor impone UN cliente por correo, y responde «Un cliente está
         * registrado actualmente con este email».
         *
         * Esto no es hipotético: ocurre en cuanto un primer intento crea el
         * Customer y luego falla en la tarjeta (rechazo del emisor, 3-D Secure).
         * El mapeo local se persiste al final, así que en ese escenario el
         * cliente existe en la pasarela y NO en nuestra base — y todos los
         * reintentos posteriores fallarían para siempre con un mensaje que
         * habla de un cliente que el operador no ve por ninguna parte.
         *
         * Se recupera el existente por correo. Es reconciliar, no ignorar: si
         * la búsqueda tampoco lo encuentra, el error original se propaga.
         */
        if (!esCorreoDuplicado(error)) throw error;
        externalCustomerId = await this.buscarClientePorCorreo(input.customer.email);
        if (!externalCustomerId) throw error;
      }

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

    /*
     * 3-D Secure / acción adicional.
     *
     * En TEST con la tarjeta de prueba, la respuesta trae `active: true` y la
     * tarjeta queda operativa. Pero si el emisor exige autenticación, Culqi
     * puede devolver la tarjeta NO activa o con un bloque de autenticación
     * pendiente. En ese caso NO se puede dar por buena la domiciliación: se
     * marcaría como activa una tarjeta que todavía no puede cobrar.
     */
    const cardRecord = card as unknown as Record<string, unknown>;
    const requiere3ds =
      cardRecord.active === false ||
      Boolean(cardRecord.three_ds) ||
      Boolean(cardRecord.authentication_required) ||
      (typeof cardRecord.action_code === 'string' && cardRecord.action_code !== '');

    if (requiere3ds) {
      throw new ProviderError(
        'TARJETA_REQUIERE_AUTENTICACION',
        'El emisor exige autenticación adicional (3-D Secure) para esta tarjeta. ' +
          'La domiciliación queda pendiente: no se activa hasta completarla.',
        409,
      );
    }

    // (4) Subscription. Campos verbatim de la documentación oficial.
    // Endpoint verificado: POST /recurrent/subscriptions/create.
    const subscription = await this.call<{
      id?: string; status?: string | number; next_billing_date?: number | string;
    }>('POST', '/recurrent/subscriptions/create', {
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

    /*
     * Consulta explícita de la suscripción recién creada.
     *
     * La documentación muestra `next_billing_date` en la respuesta de creación.
     * La API TEST real NO lo devuelve: el cuerpo de POST /create trae solo
     * `{id, customer_id, plan_id, status, created_at, metadata}`. Solo el GET
     * incluye `next_billing_date`.
     *
     * Sin este segundo viaje, `next_billing_at` se guardaba SIEMPRE null y la
     * pantalla de Renovaciones —cuyo propósito entero es avisar del próximo
     * cobro— no habría mostrado nunca una suscripción con tarjeta. Es un fallo
     * silencioso: ninguna excepción, ningún log, solo una lista vacía que
     * parece tranquilizadora.
     *
     * Si la consulta falla no se aborta el alta: la suscripción YA existe en el
     * proveedor y tirarla aquí dejaría un cobro domiciliado sin registrar. Se
     * continúa con la fecha desconocida, que la reconciliación detectará.
     */
    let nextBillingAt: string | null = null;
    let providerStatus = fromCulqiSubscriptionStatus(subscription.status);

    // Dos intentos: la consulta inmediatamente posterior a la creación falla de
    // vez en cuando (medido). Un segundo intento tras una pausa breve la
    // resuelve, y no se insiste más para no dejar colgada la petición del
    // usuario por un dato que la reconciliación puede recuperar después.
    for (let intento = 0; intento < 2; intento++) {
      if (intento > 0) await new Promise((r) => setTimeout(r, 700));
      try {
        const detalle = await this.call<{
          status?: string | number; next_billing_date?: number | string;
        }>('GET', `/recurrent/subscriptions/${encodeURIComponent(externalSubscriptionId)}`);
        if (detalle.status !== undefined) {
          providerStatus = fromCulqiSubscriptionStatus(detalle.status);
        }
        nextBillingAt = normalizeCulqiTimestamp(detalle.next_billing_date);
        if (nextBillingAt) break;
      } catch {
        // Fecha desconocida, no alta fallida. Ver comentario anterior.
      }
    }

    return {
      externalCustomerId,
      externalPaymentMethodId,
      externalPlanId,
      externalSubscriptionId,
      providerStatus,
      nextBillingAt,
      /*
       * Solo lo no sensible. El PAN nunca llegó a este servidor.
       *
       * La caducidad va a null porque el objeto Card del proveedor NO la
       * devuelve: comprobado sobre GET /cards/{id}, cuyo `source` trae
       * `last_four` e `iin` pero ningún `expiration_month`/`expiration_year`
       * (esos datos solo viajan en el token, que es de un solo uso y no se
       * conserva). Es un null medido, no un campo olvidado.
       */
      card: {
        brand: card.source?.iin?.card_brand ?? null,
        last4: card.source?.last_four ?? null,
        expMonth: null,
        expYear: null,
      },
    };
  }

  async cancelSubscription(externalSubscriptionId: string): Promise<{ providerStatus: string }> {
    await this.call('DELETE', `/recurrent/subscriptions/${encodeURIComponent(externalSubscriptionId)}`);
    return { providerStatus: 'canceled' };
  }

  /** Cliente ya existente con ese correo, o null. Verificado: GET /customers?email= */
  private async buscarClientePorCorreo(email: string): Promise<string | null> {
    try {
      const page = await this.call<{ data?: Array<{ id?: string; email?: string }> }>(
        'GET',
        `/customers?email=${encodeURIComponent(email)}&limit=5`,
      );
      const match = (page.data ?? []).find(
        (c) => typeof c.id === 'string' && c.email?.toLowerCase() === email.toLowerCase(),
      );
      return match?.id ?? null;
    } catch {
      return null;
    }
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
        amount: fromCulqiAmount(charge.amount ?? 0),
        currency: charge.currency_code ?? this.account.currency,
        paidAt: normalizeCulqiTimestamp(charge.creation_date) ?? new Date().toISOString(),
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
      amount: fromCulqiAmount(Number(c.amount ?? 0)),
      currency: String(c.currency_code ?? this.account.currency),
      paidAt: normalizeCulqiTimestamp(c.creation_date) ?? new Date().toISOString(),
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

    /*
     * Clasificación delegada a `classifyCulqiEvent`.
     *
     * Lo que había aquí evaluaba `type.startsWith('subscription.')` ANTES de
     * mirar si el evento era un cobro, así que `subscription.charge.succeeded`
     * —el cobro recurrente, el evento que de verdad mueve dinero— caía en
     * SUBSCRIPTION_UPDATED y se archivaba «sin efecto contable». En una
     * plataforma cuya facturación es domiciliada, eso significa que NINGUNA
     * renovación habría generado `payments` ni comisión: en silencio, sin un
     * solo error en el log.
     */
    const kind = classifyCulqiEvent(type);

    if (kind === 'UNKNOWN') return null;

    const metadata = (data.metadata ?? {}) as Record<string, unknown>;

    return {
      eventKey,
      eventType: type,
      kind,
      // En los eventos de suscripción el id puede llegar en `data.subscription_id`,
      // en el objeto anidado `data.subscription.id` o en los metadatos que
      // nosotros mismos adjuntamos al crear la suscripción. Se aceptan los tres.
      externalSubscriptionId: primerTexto(
        data.subscription_id,
        (data.subscription as Record<string, unknown> | undefined)?.id,
        metadata.subscription_id,
      ),
      externalChargeId: primerTexto(
        data.id,
        (data.charge as Record<string, unknown> | undefined)?.id,
      ),
      amount: typeof data.amount === 'number' ? fromCulqiAmount(data.amount) : null,
      currency: typeof data.currency_code === 'string' ? data.currency_code : null,
      occurredAt: normalizeCulqiTimestamp(body.creation_date) ?? new Date().toISOString(),
      errorCode: typeof data.error_code === 'string' ? data.error_code : null,
      errorMessage: typeof data.user_message === 'string' ? data.user_message : null,
      // Se guarda un subconjunto CONOCIDO, nunca el cuerpo crudo: puede traer
      // datos del titular que no necesitamos y no queremos conservar.
      safePayload: {
        type,
        subscription_id: primerTexto(
          data.subscription_id,
          (data.subscription as Record<string, unknown> | undefined)?.id,
          metadata.subscription_id,
        ),
        charge_id: data.id ?? null,
        amount: data.amount ?? null,
        currency_code: data.currency_code ?? null,
        outcome_type: (data.outcome as { type?: string } | undefined)?.type ?? null,
      },
    };
  }
}

/** ¿El proveedor rechazó por correo ya registrado? */
function esCorreoDuplicado(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    /registrado actualmente con este email/i.test(error.message)
  );
}

/**
 * Primer valor que sea una cadena no vacía.
 *
 * Culqi coloca el mismo dato en sitios distintos según el evento; esto evita
 * repetir la cascada de ternarios en cada campo.
 */
function primerTexto(...valores: unknown[]): string | null {
  for (const v of valores) {
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}
