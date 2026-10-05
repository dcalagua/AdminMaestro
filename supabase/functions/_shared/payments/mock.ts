import { invoiceIdFrom } from './culqi.ts';
import {
  ProviderError,
  type ChargeInput, type ChargeSummary, type NormalizedWebhookEvent, type PaymentProvider,
  type ProviderAccountConfig, type SaveCardInput, type SaveCardResult, type SetupInput, type SetupResult,
} from './types.ts';

/**
 * Proveedor simulado.
 *
 * Es el modo por defecto mientras no haya credenciales Culqi, y el que usan los
 * tests. Tres decisiones deliberadas:
 *
 * 1. **Determinista.** Los ids salen de un hash del input, no de `Math.random()`.
 *    Así el mismo alta produce siempre el mismo `crd_mock_…` y un test puede
 *    afirmar igualdad en vez de "algo con forma de id".
 *
 * 2. **Inconfundible.** Todo id lleva `mock_`. Si un id simulado acabara en la
 *    base de producción, se ve a simple vista en cualquier consulta.
 *
 * 3. **Sin red.** No hace una sola llamada saliente. Un test no depende de que
 *    Culqi esté en pie ni de que haya conectividad.
 */

/** FNV-1a de 32 bits: estable entre ejecuciones y sin dependencias. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function mockId(prefix: string, seed: string): string {
  return `${prefix}_mock_${hash(seed)}`;
}

const INTERVAL_DAYS: Record<string, number> = {
  MONTHLY: 30,
  QUARTERLY: 90,
  YEARLY: 365,
  ONE_TIME: 0,
};

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly mode = 'MOCK' as const;

  constructor(private readonly account: ProviderAccountConfig) {}

  setupSubscription(input: SetupInput): Promise<SetupResult> {
    if (!input.acceptedTerms) {
      // Misma exigencia que en real: Culqi pide `tyc` para crear la suscripción.
      return Promise.reject(new Error('TERMINOS_NO_ACEPTADOS'));
    }

    const seed = `${this.account.code}:${input.customer.organizationId}:${input.plan.localPlanId}`;
    const days = INTERVAL_DAYS[input.plan.interval] ?? 30;
    const next = days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
    /*
     * V3.2 · Plan y Subscription se derivan también de la suscripción LOCAL.
     * Un PSP real crea un objeto nuevo en cada alta; si el mock devolviera el
     * mismo `pln_`/`sxn_` para dos contratos de la misma organización, un Plan
     * reutilizado por error sería indistinguible de uno creado.
     */
    const contract = `${seed}:${input.metadata?.subscription_id ?? ''}`;

    return Promise.resolve({
      externalCustomerId: input.customer.externalCustomerId ?? mockId('cus', seed),
      externalPaymentMethodId: mockId('crd', `${seed}:${input.token}`),
      externalPlanId: input.plan.externalPlanId ??
        mockId('pln', `${contract}:${input.plan.interval}:${input.plan.currency}:${input.plan.amountMinor}`),
      externalSubscriptionId: mockId('sxn', `${contract}:sub`),
      providerStatus: 'active',
      nextBillingAt: next,
      // Valores obviamente de prueba: nadie los confunde con una tarjeta real.
      card: { brand: 'VISA', last4: '4242', expMonth: 12, expYear: 2030 },
    });
  }

  /**
   * M1/M2 · Cargo simulado y determinista: el mismo cargo (cuenta, origen,
   * factura, intento, importe) produce siempre el mismo `chr_mock_…`, así que
   * un reintento del navegador o del job se registra como duplicado.
   *
   * Para ejercitar los rechazos sin red: un origen que contiene `decline` se
   * rechaza (TARJETA_RECHAZADA) y uno que contiene `3ds` pide autenticación.
   */
  createCharge(input: ChargeInput): Promise<ChargeSummary> {
    const source = input.sourceId.toLowerCase();
    if (!/^(tkn|crd)_/.test(source)) {
      return Promise.reject(
        new ProviderError('ORIGEN_INVALIDO', 'El origen del cargo debe ser un token o una tarjeta guardada', 400),
      );
    }
    if (source.includes('decline')) {
      return Promise.reject(
        new ProviderError('TARJETA_RECHAZADA', 'La tarjeta fue rechazada por el emisor (simulado).', 402),
      );
    }
    if (source.includes('3ds')) {
      return Promise.reject(
        new ProviderError(
          'TARJETA_REQUIERE_AUTENTICACION',
          'Tu banco pide una verificación adicional (3-D Secure) (simulado).',
          409,
        ),
      );
    }
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      return Promise.reject(new ProviderError('IMPORTE_INVALIDO', 'Importe no válido para el cargo', 409));
    }

    const seed = [
      this.account.code,
      input.sourceId,
      input.metadata.invoice_id ?? '',
      input.metadata.attempt_id ?? input.metadata.link_id ?? '',
      input.amountMinor,
      input.currency,
    ].join(':');

    return Promise.resolve({
      externalChargeId: mockId('chr', seed),
      externalSubscriptionId: null,
      amount: input.amountMinor / 100,
      currency: input.currency,
      paidAt: new Date().toISOString(),
      status: 'CONFIRMED',
    });
  }

  /** M2 · Customer + Card simulados. Un token con `decline` se rechaza. */
  saveCard(input: SaveCardInput): Promise<SaveCardResult> {
    if (input.token.toLowerCase().includes('decline')) {
      return Promise.reject(
        new ProviderError('TARJETA_RECHAZADA', 'La tarjeta fue rechazada por el emisor (simulado).', 402),
      );
    }
    const seed = `${this.account.code}:${input.customer.organizationId}`;
    return Promise.resolve({
      externalCustomerId: input.customer.externalCustomerId ?? mockId('cus', seed),
      externalPaymentMethodId: mockId('crd', `${seed}:${input.token}`),
      card: { brand: 'VISA', last4: '4242', expMonth: 12, expYear: 2030 },
    });
  }

  cancelSubscription(_externalSubscriptionId: string): Promise<{ providerStatus: string }> {
    return Promise.resolve({ providerStatus: 'canceled' });
  }

  /**
   * En MOCK, verificar un cargo devuelve null: no hay nada que verificar contra
   * un proveedor que no existe. Quien llama debe tratar `null` como "no
   * verificable", no como "inválido" — y en MOCK se acepta el evento igualmente
   * porque el propio evento es simulado.
   */
  verifyCharge(_externalChargeId: string): Promise<ChargeSummary | null> {
    return Promise.resolve(null);
  }

  listCharges(_fromIso: string, _toIso: string): Promise<ChargeSummary[]> {
    return Promise.resolve([]);
  }

  /**
   * Acepta un evento con la MISMA forma normalizada que produciría el adapter
   * real, para que los tests de idempotencia ejerciten el camino de verdad.
   */
  parseWebhook(rawBody: string): NormalizedWebhookEvent | null {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }

    const type = typeof body.type === 'string' ? body.type : '';
    const data = (body.data ?? {}) as Record<string, unknown>;

    const eventKey =
      typeof body.id === 'string' && body.id.length > 0
        ? body.id
        : mockId('evt', `${type}:${JSON.stringify(data)}`);

    const kind =
      type === 'charge.succeeded' ? 'PAYMENT_SUCCEEDED'
      : type === 'charge.failed' ? 'PAYMENT_FAILED'
      : type.startsWith('subscription.') ? 'SUBSCRIPTION_UPDATED'
      : 'UNKNOWN';

    if (kind === 'UNKNOWN') return null;

    return {
      eventKey,
      eventType: type,
      kind,
      externalSubscriptionId: typeof data.subscription_id === 'string' ? data.subscription_id : null,
      externalChargeId: typeof data.id === 'string' ? data.id : null,
      externalInvoiceId: invoiceIdFrom(data.metadata as Record<string, unknown> | undefined),
      amount: typeof data.amount === 'number' ? data.amount / 100 : null,
      currency: typeof data.currency_code === 'string' ? data.currency_code : null,
      occurredAt: typeof body.creation_date === 'string' ? body.creation_date : new Date().toISOString(),
      errorCode: typeof data.error_code === 'string' ? data.error_code : null,
      errorMessage: typeof data.error_message === 'string' ? data.error_message : null,
      safePayload: {
        type,
        subscription_id: data.subscription_id ?? null,
        charge_id: data.id ?? null,
        invoice_id: invoiceIdFrom(data.metadata as Record<string, unknown> | undefined),
        amount: data.amount ?? null,
        currency_code: data.currency_code ?? null,
        simulated: true,
      },
    };
  }
}
