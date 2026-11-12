/**
 * Etiquetas de negocio y reparto de cargos de una suscripción (P06/P07).
 *
 * El estado es el CONTRACTUAL (`subscriptions.status`). La periodicidad separa
 * lo recurrente (MRR) de los cargos únicos, que nunca cuentan como recurrente.
 */

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activa',
  PAST_DUE: 'Pago atrasado',
  PAUSED: 'Pausada',
  CANCELLED: 'Cancelada',
};

export const SUBSCRIPTION_STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral' | 'info'> = {
  DRAFT: 'neutral',
  ACTIVE: 'ok',
  PAST_DUE: 'warn',
  PAUSED: 'info',
  CANCELLED: 'danger',
};

export const BILLING_INTERVAL_LABEL: Record<string, string> = {
  MONTHLY: 'Mensual',
  QUARTERLY: 'Trimestral',
  YEARLY: 'Anual',
  ONE_TIME: 'Cargo único',
};

export const CHARGE_KIND_LABEL: Record<string, string> = {
  LICENSE: 'Licencia',
  PARTNER_BASE_LICENSE: 'Licencia base de partner',
  TENANT_LICENSE: 'Licencia por tenant',
  IMPLEMENTATION_FEE: 'Implementación',
  INFRASTRUCTURE_FEE: 'Infraestructura',
  SUPPORT_FEE: 'Soporte',
  ADDON: 'Complemento',
  PROFESSIONAL_SERVICES: 'Servicios profesionales',
  DISCOUNT: 'Descuento',
  USAGE_OVERAGE: 'Exceso de uso',
};

const MONTH_FACTOR: Record<string, number> = { MONTHLY: 1, QUARTERLY: 1 / 3, YEARLY: 1 / 12 };

export interface ChargeSplit {
  /** Recurrente normalizado a mes, por moneda. */
  monthly: Record<string, number>;
  /** Cargos únicos, por moneda. */
  oneTime: Record<string, number>;
  recurringCount: number;
  oneTimeCount: number;
}

/**
 * Separa las líneas de un contrato en recurrente (normalizado a mes) y cargo
 * único, por moneda. No sustituye al MRR oficial (`v_subscription_mrr`), que
 * además aplica vigencia, estado y exclusión de DEMO.
 */
export function splitCharges(items: ReadonlyArray<Record<string, unknown>>, fallbackCurrency?: string | null): ChargeSplit {
  const out: ChargeSplit = { monthly: {}, oneTime: {}, recurringCount: 0, oneTimeCount: 0 };
  for (const item of items) {
    const currency = (item.currency as string | null) ?? fallbackCurrency ?? null;
    const amount = Number(item.amount ?? 0);
    if (!currency || Number.isNaN(amount)) continue;
    const interval = item.billing_interval as string | null;
    if (interval === 'ONE_TIME') {
      out.oneTime[currency] = Math.round(((out.oneTime[currency] ?? 0) + amount) * 100) / 100;
      out.oneTimeCount += 1;
    } else {
      const factor = MONTH_FACTOR[interval ?? 'MONTHLY'] ?? 1;
      out.monthly[currency] = Math.round(((out.monthly[currency] ?? 0) + amount * factor) * 100) / 100;
      out.recurringCount += 1;
    }
  }
  return out;
}
