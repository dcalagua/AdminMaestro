/**
 * V3.2 · Identidad de un Plan del proveedor reutilizable.
 *
 * Módulo PURO (sin dependencias de Deno) para poder probarlo con vitest.
 *
 * Un Plan de Culqi es «importe + moneda + frecuencia» dentro de UNA cuenta de
 * comercio. Hasta la V3.2 el mapeo local se buscaba y se escribía sin importe:
 * el cliente B (USD 1250) se colgaba del Plan del cliente A (USD 1000), Culqi le
 * cobraba 1000, y la fila local pasaba a decir 1250 para un Plan que en Culqi
 * seguía siendo 1000.
 *
 *   mismo contrato económico  => mismo Plan del proveedor
 *   distinto importe          => distinto Plan del proveedor
 *
 * La base es la autoridad (`platform.find_reusable_provider_plan` y
 * `platform.register_provider_plan`, migración 37); este módulo construye sus
 * argumentos a partir de céntimos exactos (`money.ts`).
 */
import { formatMinorUnits } from './money.ts';

export type RecurringInterval = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface ProviderPlanIdentity {
  providerAccountId: string;
  planId: string;
  billingInterval: RecurringInterval;
  currency: string;
  /** Importe contractual en unidades mínimas (céntimos). */
  amountMinor: number;
}

/** Valida y fija la identidad. Lanza en vez de construir una identidad ambigua. */
export function providerPlanIdentity(input: {
  providerAccountId: string;
  planId: string;
  billingInterval: string;
  currency: string;
  amountMinor: number;
}): ProviderPlanIdentity {
  if (!input.providerAccountId || !input.planId) {
    throw new Error('PROVIDER_PLAN_IDENTIDAD_INCOMPLETA: faltan la cuenta de cobro o el plan local');
  }
  if (!['MONTHLY', 'QUARTERLY', 'YEARLY'].includes(input.billingInterval)) {
    throw new Error(`INTERVALO_NO_RECURRENTE: ${input.billingInterval} no es un Plan del proveedor`);
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new Error(`MONEDA_INVALIDA: ${input.currency}`);
  }
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error(`IMPORTE_INVALIDO: ${input.amountMinor}`);
  }
  return { ...input, billingInterval: input.billingInterval as RecurringInterval };
}

/** Argumentos de las RPC. `p_amount` va como texto decimal exacto hacia `numeric`. */
export function providerPlanRpcArgs(identity: ProviderPlanIdentity) {
  return {
    p_provider_account_id: identity.providerAccountId,
    p_plan_id: identity.planId,
    p_billing_interval: identity.billingInterval,
    p_currency: identity.currency,
    p_amount: formatMinorUnits(identity.amountMinor),
  };
}
