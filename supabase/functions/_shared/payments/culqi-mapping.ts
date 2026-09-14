import { toMinorUnits } from './money.ts';

/**
 * Traducciones entre el dominio EBIM y el contrato de Culqi.
 *
 * Todo lo de este archivo está VERIFICADO contra la API TEST de Culqi el
 * 2026-09-07, no deducido de la documentación. Cada constante lleva al lado la
 * medición que la respalda, porque son exactamente los valores que, si se
 * asumen mal, producen un error silencioso y caro.
 */

/* ==========================================================================
   1. Cadencia de facturación
   ========================================================================== */

/**
 * `interval_unit_time` de Culqi. **El orden NO es intuitivo.**
 *
 * Medido creando un plan y una suscripción TEST por cada valor y observando la
 * distancia real entre `creation_date` y `next_billing_date`:
 *
 *   | valor | delta medido | significado |
 *   |-------|--------------|-------------|
 *   |   1   |    1 día     | diario      |
 *   |   2   |    7 días    | semanal     |
 *   |   3   |   30 días    | MENSUAL     |
 *   |   4   |  365 días    | ANUAL       |
 *   |   5   |   91 días    | TRIMESTRAL  |
 *   |   6   |  181 días    | semestral   |
 *
 * Nótese que 4 es ANUAL y 5 es TRIMESTRAL. Quien asuma una progresión
 * (4=trimestral, 5=semestral, 6=anual) se equivoca en los tres y factura a
 * cadencias que nadie contrató. De ahí que esto sea una tabla explícita y no
 * una fórmula.
 */
export const CULQI_INTERVAL_UNIT = {
  DAILY: 1,
  WEEKLY: 2,
  MONTHLY: 3,
  YEARLY: 4,
  QUARTERLY: 5,
  BIANNUAL: 6,
} as const;

/** Días observados por unidad. Solo para tests y documentación. */
export const CULQI_INTERVAL_DAYS: Record<number, number> = {
  1: 1,
  2: 7,
  3: 30,
  4: 365,
  5: 91,
  6: 181,
};

export type EbimInterval = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONE_TIME';

export interface CulqiIntervalSpec {
  interval_unit_time: number;
  /**
   * Culqi lo EXIGE, pero medimos que NO multiplica la cadencia: un plan con
   * `unit_time = 3` (30 días) e `interval_count = 3` sigue facturando cada 30
   * días, no cada 90. Por eso el trimestral se expresa con `unit_time = 5` y
   * NO con `unit_time = 3, count = 3`.
   *
   * Se envía 1 porque es el valor neutro comprobado; su semántica exacta
   * (número de ciclos) no está documentada de forma que podamos afirmarla.
   */
  interval_count: number;
}

/**
 * Traduce nuestra periodicidad a la de Culqi.
 *
 * `ONE_TIME` no es domiciliable: un cargo único no es una suscripción. Se
 * rechaza en vez de aproximarlo a mensual.
 */
export function toCulqiInterval(interval: EbimInterval): CulqiIntervalSpec {
  switch (interval) {
    case 'MONTHLY':
      return { interval_unit_time: CULQI_INTERVAL_UNIT.MONTHLY, interval_count: 1 };
    case 'QUARTERLY':
      return { interval_unit_time: CULQI_INTERVAL_UNIT.QUARTERLY, interval_count: 1 };
    case 'YEARLY':
      return { interval_unit_time: CULQI_INTERVAL_UNIT.YEARLY, interval_count: 1 };
    case 'ONE_TIME':
      throw new Error(
        'INTERVALO_NO_RECURRENTE: un cargo único no se domicilia como suscripción recurrente',
      );
    default: {
      // Si mañana el dominio añade una periodicidad, esto no compila.
      const nunca: never = interval;
      throw new Error(`INTERVALO_DESCONOCIDO: ${String(nunca)}`);
    }
  }
}

/* ==========================================================================
   2. Importes
   ========================================================================== */

/**
 * Culqi trabaja en la unidad mínima de la moneda (céntimos).
 *
 * Se mide en TEST que el rango admitido para un plan es 300 a 500000, es decir
 * de 3,00 a 5.000,00. Se valida aquí para dar un mensaje del dominio en vez de
 * un `parameter_error` del proveedor.
 *
 * V3.2 · La conversión es la de `money.ts`, la única del proyecto: sin
 * `Math.round(amount * 100)`, que redondeaba en silencio un 12.345 a 1235.
 */
export function toCulqiAmount(amount: number | string): number {
  const centimos = toMinorUnits(amount);
  if (centimos <= 0) {
    throw new Error(`IMPORTE_INVALIDO: ${amount}`);
  }
  return centimos;
}

/**
 * Monedas que cobra la cuenta Culqi Perú (evidencia V2.1). Ambas con 2
 * decimales: ahí «unidad mínima» y céntimo son lo mismo.
 */
export const CULQI_CURRENCIES: readonly string[] = ['PEN', 'USD'];

/** Importe de un Plan ya en céntimos (`recurringCardAmount`), validado para Culqi. */
export function toCulqiPlanAmount(amountMinor: number, currency: string): number {
  if (!CULQI_CURRENCIES.includes(currency)) {
    throw new Error(`MONEDA_NO_SOPORTADA: Culqi no cobra ${currency}`);
  }
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error(`IMPORTE_INVALIDO: ${amountMinor}`);
  }
  return amountMinor;
}

export function fromCulqiAmount(centimos: number): number {
  return Number((centimos / 100).toFixed(2));
}

/* ==========================================================================
   2 bis. Texto admitido por la pasarela
   ========================================================================== */

/**
 * Sanea un texto libre (`name`, `short_name`, `description` de un plan).
 *
 * Culqi valida estos campos con una lista blanca de caracteres MUY estrecha, y
 * cuando algo no encaja responde «el campo es inválido o está vacío, debe ser
 * una cadena» — un mensaje que no dice cuál es el carácter culpable y manda a
 * buscar el problema en el sitio equivocado.
 *
 * Probado carácter a carácter contra la API TEST el 2026-09-07, con el resto
 * del cuerpo idéntico y válido:
 *
 *   ACEPTA   letras (con tildes y ñ), dígitos, espacio, `-`, `.`, `_`
 *   RECHAZA  `,`  `:`  `/`  `(`  `&`  `#`  `+`  `'`  `·`  `—`  `|`
 *
 * Sí: una COMA invalida el campo. Un plan llamado "Plan Básico, anual" —un
 * nombre perfectamente razonable que cualquiera puede teclear en el catálogo—
 * habría hecho fallar el alta del cobro con un error que apunta a otro sitio.
 * Por eso esto se sanea en vez de confiar en que nadie escriba puntuación.
 *
 * Se sustituye por espacio en lugar de eliminar, para no pegar palabras.
 */
export function toCulqiText(value: string, maxLen: number): string {
  const limpio = value
    .replace(/[^\p{L}\p{N} ._-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio.slice(0, maxLen).trim();
}

/* ==========================================================================
   3. Marcas de tiempo
   ========================================================================== */

/**
 * Culqi mezcla unidades **en la misma API y en la misma sesión**. Medido:
 *
 *   plan.creation_date         = 1788795734      -> 10 dígitos, SEGUNDOS
 *   token.creation_date        = 1788795802323   -> 13 dígitos, MILISEGUNDOS
 *   subscription.creation_date = 1788795847      -> SEGUNDOS
 *   subscription.next_billing_date = 1791387849  -> SEGUNDOS
 *
 * Tratar todo como milisegundos —que es lo que hacía la versión anterior—
 * convierte 1788795734 en el 20 de enero de 1970. Un `next_billing_date` en
 * 1970 no falla ruidosamente: se guarda tan tranquilo y rompe el cálculo de
 * renovaciones y las alertas de cobranza.
 *
 * El umbral: 10^12 corresponde a 2001-09-09 en milisegundos y al año 33658 en
 * segundos. Cualquier fecha real de este sistema queda inequívocamente a un
 * lado u otro.
 */
const UMBRAL_MS = 1e12;

export function normalizeCulqiTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value >= UMBRAL_MS ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Algunos campos llegan como cadena numérica; otros como fecha ISO.
  if (typeof value === 'string' && value.trim() !== '') {
    if (/^\d+$/.test(value.trim())) return normalizeCulqiTimestamp(Number(value.trim()));
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/* ==========================================================================
   3 bis. Estado de la suscripción
   ========================================================================== */

/**
 * Culqi devuelve el estado de una suscripción como un NÚMERO; el Control Plane
 * lo guarda como texto (`active`, `payment_failed`, `canceled`, `unknown`) y
 * sobre ese texto están construidas la vista de reconciliación
 * (`ps.provider_status = 'active'`) y la alerta de cobro fallido.
 *
 * Guardar el número tal cual —que es lo que ocurría— tiene una consecuencia
 * concreta: `provider_status` valdría "1", jamás igualaría a 'active', y TODA
 * suscripción con tarjeta aparecería para siempre como desviación en la
 * pantalla de reconciliación. Ruido permanente, que es la forma más segura de
 * que nadie mire esa pantalla.
 *
 * Medido contra la API TEST el 2026-09-07, consultando la misma suscripción
 * cada segundo desde su creación:
 *
 *   1 -> recién creada; aparece en la respuesta del POST
 *   3 -> vigente; sustituye a 1 al segundo siguiente, con `next_billing_date`
 *        ya asignado y sin ningún cargo de por medio. Es el valor que la
 *        documentación usa en su ejemplo de suscripción normal.
 *   4 -> cancelada; leído tras el DELETE
 *
 * 1 y 3 son dos momentos de lo mismo —una suscripción que va a cobrar— así que
 * ambos se traducen a `active`. Distinguirlos aquí solo produciría una falsa
 * desviación en la reconciliación durante el primer segundo de vida.
 *
 * 2 y 5 NO se han observado y la leyenda no está publicada, así que se
 * devuelven como `unknown` en vez de adivinarse: un estado inventado aquí se
 * convierte en una decisión de cobranza equivocada.
 */
export function fromCulqiSubscriptionStatus(value: unknown): string {
  // Algunas respuestas ya traen texto; se respeta.
  if (typeof value === 'string' && value.trim() !== '' && !/^\d+$/.test(value.trim())) {
    return value.trim().toLowerCase();
  }
  const n = Number(value);
  switch (n) {
    case 1:
    case 3:
      return 'active';
    case 4:
      return 'canceled';
    default:
      return 'unknown';
  }
}

/* ==========================================================================
   4. Eventos de webhook
   ========================================================================== */

export type CulqiEventKind =
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'SUBSCRIPTION_UPDATED'
  | 'UNKNOWN';

/**
 * Clasifica el `type` de un webhook.
 *
 * EL BUG QUE ESTO CORRIGE: la versión anterior evaluaba
 * `type.startsWith('subscription.')` **antes** de mirar si era un cobro, así
 * que `subscription.charge.succeeded` —el cobro recurrente, es decir el evento
 * que mueve dinero— caía en `SUBSCRIPTION_UPDATED` y se registraba «sin efecto
 * contable». Resultado: las renovaciones de tarjeta no generaban ni `payments`
 * ni comisión, en silencio.
 *
 * Ahora se comprueba primero lo específico (`*.charge.*`) y solo después lo
 * genérico. El orden de estas ramas ES la corrección.
 */
export function classifyCulqiEvent(type: string): CulqiEventKind {
  const t = type.toLowerCase();

  // 1) Cobro de suscripción: lo más específico primero.
  if (t.includes('charge') && (t.includes('succeed') || t.includes('success') || t.endsWith('.created'))) {
    if (t.includes('fail') || t.includes('denied') || t.includes('reject')) return 'PAYMENT_FAILED';
    return 'PAYMENT_SUCCEEDED';
  }
  if (t.includes('charge') && (t.includes('fail') || t.includes('denied') || t.includes('reject'))) {
    return 'PAYMENT_FAILED';
  }

  // 2) Cambios de estado de la suscripción, sin efecto contable.
  if (t.startsWith('subscription.') || t.startsWith('recurrent.')) return 'SUBSCRIPTION_UPDATED';

  return 'UNKNOWN';
}
