import { formatMoney, formatPercent } from '@/lib/format';
import type { LabelTone } from '@/features/usage/usageLabels';

/**
 * M3 · Etiquetas de la tarifa de plataforma de partners (spec §4). La tarifa es
 * lo que el PARTNER le paga a EBIM por usar la plataforma: no confundir con las
 * comisiones, que EBIM paga a sus vendedores.
 */

export type FeeModel = 'NONE' | 'PERCENT_OF_LIST' | 'FIXED_PER_TENANT' | 'PERCENT_PLUS_FIXED';

export const FEE_MODEL_LABEL: Record<FeeModel, string> = {
  NONE: 'Sin tarifa',
  PERCENT_OF_LIST: '% sobre la base mensual',
  FIXED_PER_TENANT: 'Fijo por tenant activo',
  PERCENT_PLUS_FIXED: '% + fijo por tenant',
};

export const STATEMENT_STATUS: Record<string, LabelTone> = {
  DRAFT: { label: 'Borrador', tone: 'warn' },
  ISSUED: { label: 'Emitida', tone: 'ok' },
  VOID: { label: 'Anulada', tone: 'neutral' },
};

export const BILLING_CHANNEL: Record<string, LabelTone> = {
  DIRECT: { label: 'EBIM factura al cliente', tone: 'neutral' },
  PARTNER_STATEMENT: { label: 'Factura el partner', tone: 'accent' },
};

export const LINE_KIND_LABEL: Record<string, string> = {
  TENANT: 'Tenant',
  FIXED_SEPARATE: 'Fijo en otra moneda',
};

export interface FeeTerms {
  platform_fee_model: string | null;
  platform_fee_rate: number | null;
  platform_fee_fixed_amount: number | null;
  platform_fee_currency: string | null;
}

/** «10,0 % + USD 5,00 por tenant», «Sin tarifa»… */
export function feeTermsText(t: FeeTerms | null | undefined): string {
  if (!t || !t.platform_fee_model || t.platform_fee_model === 'NONE') return FEE_MODEL_LABEL.NONE;
  const pct = t.platform_fee_rate !== null ? formatPercent(Number(t.platform_fee_rate)) : null;
  const fixed =
    t.platform_fee_fixed_amount !== null
      ? `${formatMoney(Number(t.platform_fee_fixed_amount), t.platform_fee_currency)} por tenant`
      : null;
  switch (t.platform_fee_model) {
    case 'PERCENT_OF_LIST':
      return `${pct} de la base`;
    case 'FIXED_PER_TENANT':
      return fixed ?? FEE_MODEL_LABEL.FIXED_PER_TENANT;
    case 'PERCENT_PLUS_FIXED':
      return `${pct} + ${fixed}`;
    default:
      return t.platform_fee_model;
  }
}
