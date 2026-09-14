/**
 * V3.2 · Importes exactos entre la base y el proveedor de pago.
 *
 * Módulo PURO (sin dependencias de Deno) para poder probarlo con vitest.
 *
 * `subscription_items.amount` y `provider_plans.amount` son `numeric(14,2)`.
 * PostgREST los entrega como número JSON o como texto. Aquí se pasan a
 * UNIDADES MÍNIMAS enteras (céntimos) sin aritmética de coma flotante, y solo
 * en céntimos se suma y se compara. Es la ÚNICA conversión importe → unidades
 * mínimas del proyecto: el adapter de Culqi y la identidad del Plan del
 * proveedor salen de aquí.
 *
 * Nada se redondea en silencio: un importe con más decimales que la escala se
 * rechaza con `IMPORTE_NO_REPRESENTABLE`.
 */

/** Escala de `numeric(14,2)`. PEN, USD y BOB tienen 2 decimales (ISO 4217). */
export const MONEY_SCALE = 2;

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Importe decimal → unidades mínimas enteras.
 *
 * Un `number` se lee por su representación decimal más corta (`String(n)`),
 * que es exactamente lo que PostgREST serializó: `1250.5` es "1250.5", no
 * 1250.4999…. Un resultado de aritmética flotante como `0.1 + 0.2` no es un
 * importe de la base y se rechaza en vez de "arreglarse".
 */
export function toMinorUnits(amount: number | string, scale: number = MONEY_SCALE): number {
  const text = typeof amount === 'number' ? String(amount) : amount.trim();
  const match = typeof amount === 'number' && !Number.isFinite(amount) ? null : DECIMAL.exec(text);
  if (!match) throw new Error(`IMPORTE_NO_REPRESENTABLE: ${String(amount)}`);

  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > scale && /[^0]/.test(fraction.slice(scale))) {
    throw new Error(`IMPORTE_NO_REPRESENTABLE: ${text} tiene más de ${scale} decimales`);
  }

  const minor = Number(whole + fraction.slice(0, scale).padEnd(scale, '0'));
  if (!Number.isSafeInteger(minor)) throw new Error(`IMPORTE_NO_REPRESENTABLE: ${text} fuera de rango`);
  return sign && minor !== 0 ? -minor : minor;
}

/** Unidades mínimas → texto decimal exacto (`125000` → `"1250.00"`), apto para `numeric`. */
export function formatMinorUnits(minor: number, scale: number = MONEY_SCALE): string {
  if (!Number.isSafeInteger(minor)) throw new Error(`IMPORTE_NO_REPRESENTABLE: ${minor}`);
  const digits = String(Math.abs(minor)).padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? `.${digits.slice(-scale)}` : '';
  return `${minor < 0 ? '-' : ''}${whole}${fraction}`;
}
