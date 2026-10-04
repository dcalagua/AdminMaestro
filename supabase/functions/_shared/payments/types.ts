/**
 * Contrato de proveedor de pago.
 *
 * El dominio del Control Plane no sabe qué es Culqi: sabe que existe un
 * `PaymentProvider`. Añadir Niubiz, Izipay o Stripe mañana es implementar esta
 * interfaz — no tocar el motor de comisiones ni el modelo de cobranza.
 *
 * REGLAS QUE ESTE ARCHIVO IMPONE POR TIPOS:
 *   · el token de tarjeta ENTRA (`SetupInput.token`) pero no SALE de ningún sitio;
 *   · el resultado solo devuelve ids externos y `brand`/`last4`, jamás PAN ni CVV;
 *   · ninguna firma acepta una clave secreta por parámetro: el adapter la lee de
 *     `Deno.env`, y así no puede filtrarse por un log de argumentos.
 */

export type ProviderMode = 'MOCK' | 'TEST' | 'LIVE';

/** Configuración NO sensible que la base sí puede almacenar. */
export interface ProviderAccountConfig {
  id: string;
  code: string;
  providerKind: 'CULQI' | 'MANUAL' | 'BANK' | 'OTHER';
  environment: 'TEST' | 'LIVE';
  currency: string;
  /** Pública por diseño: el navegador la necesita para tokenizar. */
  publicKey: string | null;
  /** NOMBRE de la variable de entorno donde vive la clave secreta. Nunca su valor. */
  secretKeyRef: string | null;
}

export interface SetupInput {
  /** Token efímero de un solo uso emitido por el Checkout del proveedor. */
  token: string;
  customer: {
    organizationId: string;
    email: string;
    firstName: string;
    lastName: string;
    countryCode: string;
    /*
     * Datos de facturación que la pasarela exige para crear el Customer. Se
     * declaran obligatorios EN EL TIPO a propósito: la versión anterior no los
     * tenía y el adapter habría tenido que inventarlos o fallar en tiempo de
     * ejecución. Salen de `organizations` (migración 23), nunca de un literal.
     */
    address: string;
    addressCity: string;
    phoneNumber: string;
    /** Id externo previo, si esta organización ya era cliente del proveedor. */
    externalCustomerId?: string | null;
  };
  plan: {
    localPlanId: string;
    name: string;
    /**
     * V3.2 · Importe contractual en UNIDADES MÍNIMAS (céntimos), ya calculado
     * de forma exacta por `recurringCardAmount`. El adapter no convierte nada.
     */
    amountMinor: number;
    currency: string;
    interval: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONE_TIME';
    /**
     * Plan ya existente en el proveedor para ESTE contrato económico (cuenta,
     * plan, intervalo, moneda e importe). Si llega, no se crea otro.
     */
    externalPlanId?: string | null;
  };
  /** Aceptación explícita de términos: Culqi la exige como `tyc` en la suscripción. */
  acceptedTerms: boolean;
  metadata?: Record<string, string>;
}

export interface SetupResult {
  externalCustomerId: string;
  externalPaymentMethodId: string;
  externalPlanId: string;
  externalSubscriptionId: string;
  providerStatus: string;
  nextBillingAt: string | null;
  /** Datos NO sensibles, solo para que el usuario reconozca su medio de pago. */
  card: { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null };
}

export interface ChargeSummary {
  externalChargeId: string;
  externalSubscriptionId: string | null;
  amount: number;
  currency: string;
  paidAt: string;
  status: 'CONFIRMED' | 'FAILED' | 'PENDING';
  errorCode?: string | null;
  errorMessage?: string | null;
  /** M1/M2 · Factura que el cargo declara en sus metadatos (portal o cobro automático). */
  invoiceId?: string | null;
}

/** Evento de webhook ya NORMALIZADO y sanitizado por el adapter. */
export interface NormalizedWebhookEvent {
  /** Clave idempotente estable. Es la defensa principal: Culqi no firma. */
  eventKey: string;
  eventType: string;
  kind: 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED' | 'SUBSCRIPTION_UPDATED' | 'UNKNOWN';
  externalSubscriptionId: string | null;
  externalChargeId: string | null;
  /**
   * M1/M2 · `metadata.invoice_id` del cargo. Los cargos del portal y del cobro
   * automático no tienen suscripción del proveedor: se imputan a la factura.
   */
  externalInvoiceId: string | null;
  amount: number | null;
  currency: string | null;
  occurredAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  /** Payload recortado: solo campos conocidos, nunca el cuerpo crudo completo. */
  safePayload: Record<string, unknown>;
}

/** Datos del titular que la pasarela exige para crear el Customer (7 campos). */
export type CustomerInput = SetupInput['customer'];

/**
 * M1/M2 · Cargo único. `sourceId` es el token efímero del Checkout (`tkn_`,
 * portal) o la tarjeta guardada (`crd_`, cobro automático). El importe va en
 * UNIDADES MÍNIMAS, ya calculado de forma exacta por `toMinorUnits`.
 */
export interface ChargeInput {
  amountMinor: number;
  currency: string;
  email: string;
  sourceId: string;
  description?: string;
  /** invoice_id, link_id/attempt_id y origin: lo que el webhook usa para correlacionar. */
  metadata: Record<string, string>;
}

/** M2 · Alta de tarjeta guardada SIN suscripción del proveedor (Customer + Card). */
export interface SaveCardInput {
  /** Token efímero de un solo uso emitido por el Checkout. */
  token: string;
  customer: CustomerInput;
  metadata?: Record<string, string>;
}

export interface SaveCardResult {
  externalCustomerId: string;
  externalPaymentMethodId: string;
  card: { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null };
}

export interface PaymentProvider {
  readonly name: string;
  readonly mode: ProviderMode;

  /** Alta de método de pago + suscripción recurrente. */
  setupSubscription(input: SetupInput): Promise<SetupResult>;

  /**
   * M1/M2 · Cargo único verificado. Devuelve el cargo CONFIRMADO tal como lo
   * reporta el proveedor en una consulta directa; un rechazo se lanza como
   * `ProviderError` con TARJETA_RECHAZADA o TARJETA_REQUIERE_AUTENTICACION.
   */
  createCharge(input: ChargeInput): Promise<ChargeSummary>;

  /** M2 · Customer (reutilizado o recuperado por correo) + Card con el token. */
  saveCard(input: SaveCardInput): Promise<SaveCardResult>;

  /** Cancela la suscripción en el proveedor. No borra nada local. */
  cancelSubscription(externalSubscriptionId: string): Promise<{ providerStatus: string }>;

  /**
   * Verificación server-to-server de un cargo. Es lo que sustituye a la firma
   * de webhook que Culqi no ofrece: un tercero puede inventar un evento, pero no
   * puede hacer que el proveedor confirme un cargo que no existe.
   */
  verifyCharge(externalChargeId: string): Promise<ChargeSummary | null>;

  /** Cargos del periodo, para reconciliación. */
  listCharges(fromIso: string, toIso: string): Promise<ChargeSummary[]>;

  /** Normaliza y valida ESTRICTAMENTE un webhook. Devuelve null si no lo reconoce. */
  parseWebhook(rawBody: string, headers: Headers): NormalizedWebhookEvent | null;
}

/** Error de proveedor con mensaje ya sanitizado para mostrar al usuario. */
export class ProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
