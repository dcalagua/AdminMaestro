import { describe, it, expect } from 'vitest';
import {
  CULQI_INTERVAL_UNIT, CULQI_INTERVAL_DAYS,
  toCulqiInterval, toCulqiAmount, toCulqiPlanAmount, fromCulqiAmount, toCulqiText,
  normalizeCulqiTimestamp, fromCulqiSubscriptionStatus, classifyCulqiEvent,
} from './culqi-mapping.ts';

/**
 * Pruebas de regresión de los ocho fallos que la auditoría V2.1 encontró en la
 * traducción a Culqi.
 *
 * Cada bloque nombra el fallo concreto que evita, no la función que llama. Una
 * prueba que solo dice "toCulqiInterval devuelve 5" no protege de nada dentro
 * de seis meses; una que dice "trimestral no puede facturar cada 30 días" sí.
 */

describe('cadencia de facturación', () => {
  it('traduce trimestral a la unidad 5, que son 91 días medidos', () => {
    // El valor intuitivo sería 4. Con 4 se factura ANUAL: se cobraría una vez
    // al año a un cliente que contrató cuatro veces al año.
    expect(toCulqiInterval('QUARTERLY').interval_unit_time).toBe(5);
    expect(CULQI_INTERVAL_DAYS[5]).toBe(91);
  });

  it('traduce anual a la unidad 4, que son 365 días medidos', () => {
    expect(toCulqiInterval('YEARLY').interval_unit_time).toBe(4);
    expect(CULQI_INTERVAL_DAYS[4]).toBe(365);
  });

  it('traduce mensual a la unidad 3', () => {
    expect(toCulqiInterval('MONTHLY').interval_unit_time).toBe(CULQI_INTERVAL_UNIT.MONTHLY);
    expect(CULQI_INTERVAL_DAYS[3]).toBe(30);
  });

  it('no expresa el trimestral como "mensual por tres"', () => {
    // Medido: interval_count NO multiplica la cadencia. unit_time 3 con count 3
    // sigue cobrando a los 30 días. Si alguien "simplifica" el mapper así, el
    // cliente trimestral pasa a pagar todos los meses.
    const trimestral = toCulqiInterval('QUARTERLY');
    expect(trimestral).not.toEqual({ interval_unit_time: 3, interval_count: 3 });
  });

  it('rechaza el cargo único en vez de aproximarlo a mensual', () => {
    expect(() => toCulqiInterval('ONE_TIME')).toThrow(/NO_RECURRENTE/);
  });
});

describe('importes', () => {
  it('convierte a céntimos sin arrastrar el error del binario', () => {
    expect(toCulqiAmount(25)).toBe(2500);
    expect(toCulqiAmount(19.99)).toBe(1999);
    expect(toCulqiAmount('1250.00')).toBe(125000);
    // V3.2: 0.1 + 0.2 en coma flotante es 0.30000000000000004. Antes se
    // redondeaba a 30; ahora se rechaza, porque ningún importe de la base
    // tiene esa forma y redondearlo escondería aritmética flotante aguas
    // arriba. Las sumas se hacen en céntimos (`recurringCardAmount`).
    expect(() => toCulqiAmount(0.1 + 0.2)).toThrow(/IMPORTE_NO_REPRESENTABLE/);
    expect(() => toCulqiAmount(12.345)).toThrow(/IMPORTE_NO_REPRESENTABLE/);
  });

  it('el importe de un Plan ya viene en céntimos y solo en monedas que Culqi cobra', () => {
    expect(toCulqiPlanAmount(125000, 'USD')).toBe(125000);
    expect(toCulqiPlanAmount(125000, 'PEN')).toBe(125000);
    expect(() => toCulqiPlanAmount(125000, 'BOB')).toThrow(/MONEDA_NO_SOPORTADA/);
    expect(() => toCulqiPlanAmount(1250.5, 'USD')).toThrow(/IMPORTE_INVALIDO/);
    expect(() => toCulqiPlanAmount(0, 'USD')).toThrow(/IMPORTE_INVALIDO/);
  });

  it('rechaza importes que no cobran nada', () => {
    expect(() => toCulqiAmount(0)).toThrow(/IMPORTE_INVALIDO/);
    expect(() => toCulqiAmount(-5)).toThrow(/IMPORTE_INVALIDO/);
  });

  it('vuelve del céntimo al importe del dominio', () => {
    expect(fromCulqiAmount(2500)).toBe(25);
    expect(fromCulqiAmount(1999)).toBe(19.99);
  });
});

describe('marcas de tiempo', () => {
  it('lee segundos como segundos', () => {
    // Valor real de una respuesta de plan. Tratado como milisegundos daba 1970.
    const iso = normalizeCulqiTimestamp(1788795734)!;
    expect(new Date(iso).getUTCFullYear()).toBe(2026);
  });

  it('lee milisegundos como milisegundos', () => {
    // Valor real de una respuesta de token, en la MISMA sesión que el anterior.
    const iso = normalizeCulqiTimestamp(1788795802323)!;
    expect(new Date(iso).getUTCFullYear()).toBe(2026);
  });

  it('no manda ninguna fecha real a 1970', () => {
    // El síntoma exacto del fallo: un next_billing_date en enero de 1970 no
    // rompe nada ruidosamente, solo vacía la pantalla de Renovaciones.
    for (const v of [1656201600, 1788795734, 1791387849]) {
      expect(new Date(normalizeCulqiTimestamp(v)!).getUTCFullYear()).toBeGreaterThan(2000);
    }
  });

  it('acepta cadenas numéricas y descarta lo que no es fecha', () => {
    expect(normalizeCulqiTimestamp('1788795734')).not.toBeNull();
    expect(normalizeCulqiTimestamp(null)).toBeNull();
    expect(normalizeCulqiTimestamp('')).toBeNull();
    expect(normalizeCulqiTimestamp('no es una fecha')).toBeNull();
    expect(normalizeCulqiTimestamp(0)).toBeNull();
  });
});

describe('estado de la suscripción', () => {
  it('traduce el número a la palabra que usa la reconciliación', () => {
    // Guardar "1" en provider_status hace que ps.provider_status = 'active'
    // sea falso para siempre: toda suscripción con tarjeta quedaría marcada
    // como desviación en la pantalla de reconciliación.
    expect(fromCulqiSubscriptionStatus(1)).toBe('active');
    expect(fromCulqiSubscriptionStatus(3)).toBe('active');
    expect(fromCulqiSubscriptionStatus(4)).toBe('canceled');
  });

  it('no inventa significado para los códigos no observados', () => {
    expect(fromCulqiSubscriptionStatus(2)).toBe('unknown');
    expect(fromCulqiSubscriptionStatus(5)).toBe('unknown');
    expect(fromCulqiSubscriptionStatus(undefined)).toBe('unknown');
  });

  it('respeta el estado si ya viene como texto', () => {
    expect(fromCulqiSubscriptionStatus('payment_failed')).toBe('payment_failed');
  });
});

describe('clasificación de eventos de webhook', () => {
  it('trata el cobro recurrente como un COBRO, no como un cambio de estado', () => {
    // EL FALLO: `subscription.` se evaluaba antes que `charge`, así que la
    // renovación de tarjeta se archivaba "sin efecto contable" y no generaba
    // ni pago ni comisión. En silencio, en cada renovación, de cada cliente.
    expect(classifyCulqiEvent('subscription.charge.succeeded')).toBe('PAYMENT_SUCCEEDED');
    expect(classifyCulqiEvent('subscription.charge.failed')).toBe('PAYMENT_FAILED');
  });

  it('sigue reconociendo el cobro suelto', () => {
    expect(classifyCulqiEvent('charge.succeeded')).toBe('PAYMENT_SUCCEEDED');
    expect(classifyCulqiEvent('charge.creation.succeeded')).toBe('PAYMENT_SUCCEEDED');
    expect(classifyCulqiEvent('charge.failed')).toBe('PAYMENT_FAILED');
  });

  it('deja en cambio de estado lo que de verdad lo es', () => {
    expect(classifyCulqiEvent('subscription.created')).toBe('SUBSCRIPTION_UPDATED');
    expect(classifyCulqiEvent('subscription.canceled')).toBe('SUBSCRIPTION_UPDATED');
  });

  it('no adivina lo que no reconoce', () => {
    expect(classifyCulqiEvent('order.status.changed')).toBe('UNKNOWN');
    expect(classifyCulqiEvent('')).toBe('UNKNOWN');
  });
});

describe('texto admitido por la pasarela', () => {
  it('quita la puntuación que invalida el campo', () => {
    // Medido: una coma hace que Culqi responda "el campo es inválido o está
    // vacío". Un plan llamado "Plan Básico, anual" habría roto el alta.
    expect(toCulqiText('Plan Básico, anual', 50)).toBe('Plan Básico anual');
    expect(toCulqiText('EBIM · WMS (Pro)', 50)).toBe('EBIM WMS Pro');
  });

  it('conserva tildes, dígitos y la puntuación que sí acepta', () => {
    expect(toCulqiText('Plan Gestión 2026 v1.2-beta_x', 60)).toBe('Plan Gestión 2026 v1.2-beta_x');
  });

  it('respeta el límite de longitud sin dejar espacios colgando', () => {
    expect(toCulqiText('abcdefghij klmnop', 11)).toBe('abcdefghij');
    expect(toCulqiText('   varios    espacios   ', 50)).toBe('varios espacios');
  });
});
