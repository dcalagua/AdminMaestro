import { formatMoney, formatPercent } from '@/lib/format';
import { chargeKindLabel } from '@/features/catalog/catalogLabels';

/**
 * Lectura en castellano de una regla de comisión EXISTENTE (P13).
 *
 * No introduce fórmulas: reproduce la que ya aplica la base
 * (`business_functions.sql`: base × rate × attribution_pct, o
 * fixed_amount × attribution_pct) sobre un cobro de ejemplo. Es ilustrativa y
 * no sustituye la liquidación real (topes acumulados, cobros parciales, etc.).
 */
export const BASIS_LABEL: Record<string, string> = {
  COLLECTED_LICENSE: 'licencia cobrada',
  COLLECTED_IMPLEMENTATION: 'implementación cobrada',
  COLLECTED_ANY: 'cualquier cobro',
  FIXED_AMOUNT: 'monto fijo por cobro',
};

export const EXAMPLE_BASE = 1000;

export interface RuleLike {
  basis?: unknown;
  rate?: unknown;
  fixed_amount?: unknown;
  currency?: unknown;
  charge_kind?: unknown;
  is_recurring?: unknown;
  max_months?: unknown;
  max_total_amount?: unknown;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** «10.0 % de licencia cobrada · cada cobro durante 12 meses · tope USD 500.00». */
export function describeRule(rule: RuleLike): string {
  const currency = (rule.currency as string | null) ?? null;
  const rate = num(rule.rate);
  const fixed = num(rule.fixed_amount);
  const basis = BASIS_LABEL[String(rule.basis)] ?? String(rule.basis ?? 'base no definida');

  const parts: string[] = [];
  if (rate !== null) parts.push(`${formatPercent(rate)} de ${basis}`);
  else if (fixed !== null) parts.push(`${formatMoney(fixed, currency)} fijo por cobro confirmado`);
  else parts.push('Tasa o monto no definido');

  if (rule.charge_kind) parts.push(`sólo cargos de ${chargeKindLabel(String(rule.charge_kind)).toLowerCase()}`);

  const months = num(rule.max_months);
  if (rule.is_recurring) {
    parts.push(months !== null ? `en cada cobro durante ${months} ${months === 1 ? 'mes' : 'meses'}` : 'en cada cobro, sin límite de meses');
  } else {
    parts.push('sólo en el primer cobro');
  }

  const cap = num(rule.max_total_amount);
  parts.push(cap !== null ? `tope ${formatMoney(cap, currency)}` : 'sin tope de monto');
  return parts.join(' · ');
}

/**
 * Ejemplo con la regla existente y un 100 % de atribución. Devuelve `null`
 * cuando la regla no tiene tasa ni monto (no se inventa un resultado).
 */
export function exampleForRule(rule: RuleLike): string | null {
  const currency = (rule.currency as string | null) ?? null;
  const rate = num(rule.rate);
  const fixed = num(rule.fixed_amount);
  let result: number;
  let base: string;
  if (rate !== null) {
    result = Math.round(EXAMPLE_BASE * rate * 100) / 100;
    base = `Por un cobro confirmado de ${formatMoney(EXAMPLE_BASE, currency)} que cumpla la base`;
  } else if (fixed !== null) {
    result = fixed;
    base = 'Por cada cobro confirmado que cumpla la base';
  } else {
    return null;
  }
  return `${base}, un comercial con 100 % de atribución devenga ${formatMoney(result, currency)} antes de topes acumulados. Con 50 % de atribución, la mitad.`;
}
