import { z } from 'zod';

/**
 * BILLING_SHADOW (CCP fase 18, D-14): formas de datos de la comparación entre el
 * biller local de un SaaS y lo que MasterAdmin facturaría.
 *
 * La base es la autoridad (`record_billing_shadow_comparison` vuelve a validar
 * y calcula el diff); este módulo solo valida el JSON pegado ANTES de enviarlo,
 * para que el error se lea en la consola y no como un 22023 genérico, y da
 * tipos a los JSON que devuelve la base.
 */

const ISO_CURRENCY = /^[A-Z]{3}$/;

export const shadowLocalLineSchema = z.object({
  itemCode: z.string({ error: 'itemCode es obligatorio' }).trim().min(1, 'itemCode no puede estar vacío'),
  quantity: z.number({ error: 'quantity debe ser numérico' }),
  amount: z.number({ error: 'amount debe ser numérico' }),
  currency: z.string().regex(ISO_CURRENCY, 'currency de línea: código ISO de 3 letras').optional(),
});

export const shadowLocalSchema = z
  .object({
    source: z.string().trim().min(1).max(120).optional(),
    currency: z.string({ error: 'currency es obligatorio' }).regex(ISO_CURRENCY, 'currency: código ISO de 3 letras (p. ej. PEN)'),
    lines: z.array(shadowLocalLineSchema, { error: 'lines debe ser un arreglo' }),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.lines.forEach((line, index) => {
      if (seen.has(line.itemCode)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'itemCode'],
          message: `itemCode repetido: ${line.itemCode}`,
        });
      }
      seen.add(line.itemCode);
    });
  });

export type ShadowLocal = z.infer<typeof shadowLocalSchema>;

export type ParseResult = { ok: true; value: ShadowLocal } | { ok: false; error: string };

/** Valida el texto pegado: JSON bien formado y forma `{currency, lines[]}` con itemCode único. */
export function parseShadowLocal(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'El texto no es JSON válido.' };
  }
  const parsed = shadowLocalSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return { ok: false, error: `${path}${issue?.message ?? 'Forma inválida'}` };
  }
  return { ok: true, value: parsed.data };
}

export interface ShadowLine {
  itemCode: string;
  quantity: number;
  amount: number;
  currency?: string | null;
}

export interface ShadowExpected {
  subscriptionId?: string;
  periodStart: string;
  currency: string;
  lines: ShadowLine[];
  total: number;
}

export interface ShadowDiff {
  itemCode: string;
  type: string;
  /** `{quantity, amount}`, un código de moneda (CURRENCY_MISMATCH) o null. */
  masteradmin: { quantity: number; amount: number } | string | null;
  local: { quantity: number; amount: number } | string | null;
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function asLines(value: unknown): ShadowLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((l) => {
    const line = (l ?? {}) as Record<string, unknown>;
    return {
      itemCode: String(line.itemCode ?? ''),
      quantity: asNumber(line.quantity),
      amount: asNumber(line.amount),
      currency: typeof line.currency === 'string' ? line.currency : null,
    };
  });
}

/** JSON de `billing_shadow_expected_lines` (o la columna `expected`) → tipo. */
export function toShadowExpected(value: unknown): ShadowExpected | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return {
    subscriptionId: typeof v.subscriptionId === 'string' ? v.subscriptionId : undefined,
    periodStart: String(v.periodStart ?? ''),
    currency: String(v.currency ?? ''),
    lines: asLines(v.lines),
    total: asNumber(v.total),
  };
}

/** Columna `local` del reporte: `{currency, lines, total}`. */
export function toShadowLocal(value: unknown): { currency: string; lines: ShadowLine[]; total: number } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return { currency: String(v.currency ?? ''), lines: asLines(v.lines), total: asNumber(v.total) };
}

export function toShadowDiffs(value: unknown): ShadowDiff[] {
  if (!Array.isArray(value)) return [];
  return value.map((d) => {
    const diff = (d ?? {}) as Record<string, unknown>;
    const side = (s: unknown): ShadowDiff['masteradmin'] => {
      if (s === null || s === undefined) return null;
      if (typeof s === 'string') return s;
      const o = s as Record<string, unknown>;
      return { quantity: asNumber(o.quantity), amount: asNumber(o.amount) };
    };
    return {
      itemCode: String(diff.itemCode ?? ''),
      type: String(diff.type ?? ''),
      masteradmin: side(diff.masteradmin),
      local: side(diff.local),
    };
  });
}
