import { splitCharges } from './subscriptionLabels';

/**
 * Listado de Contratos (V6 · F3, plan §3.4), lógica pura.
 *
 * Una fila por contrato con lo que responde «¿cuánto vale y qué toca ahora?»:
 * recurrente al mes y cargos únicos por moneda (nunca sumados entre monedas),
 * próxima renovación (`v_renewal_pipeline`) y cómo se cobra
 * (`v_subscription_collection`). El estado es el CONTRACTUAL, nunca el del tenant.
 *
 * El recurrente es la suma de líneas normalizada a mes: no sustituye al MRR
 * oficial (`v_subscription_mrr`), que además aplica vigencia, descuentos y
 * exclusión de DEMO.
 */

export type CurrencyAmounts = Record<string, number>;

export interface SubscriptionLike {
  id: string;
  code: string;
  status: string;
  started_on: string | null;
  ends_on?: string | null;
  tenant_id: string | null;
  billed_organization_id?: string | null;
  channel_margin_rate?: number | null;
  plans?: { name?: string | null } | null;
  saas_products?: { short_name?: string | null; code?: string | null } | null;
  organizations?: { display_name?: string | null } | null;
  tenants?: { name?: string | null; deployment_mode?: string | null } | null;
  subscription_items?: ReadonlyArray<Record<string, unknown>> | null;
}

export interface RenewalInfo {
  subscription_id: string | null;
  renewal_on: string | null;
  days_to_renewal: number | null;
}

export interface CollectionInfo {
  subscription_id: string | null;
  collection_method: string | null;
  profile_missing: boolean | null;
}

export interface ContractRow {
  id: string;
  code: string;
  status: string;
  plan: string;
  app: string | null;
  customer: string;
  customerId: string | null;
  tenant: string | null;
  deploymentMode: string | null;
  startedOn: string | null;
  monthly: CurrencyAmounts;
  oneTime: CurrencyAmounts;
  oneTimeCount: number;
  channelMargin: number | null;
  /** Próxima renovación (o fin de vigencia si no está en el pipeline). */
  renewalOn: string | null;
  daysToRenewal: number | null;
  method: string | null;
  /** Sin perfil de cobro: se cobra manualmente por omisión. */
  methodMissing: boolean;
}

export function buildContractRows(
  subscriptions: readonly SubscriptionLike[],
  renewals: readonly RenewalInfo[] = [],
  collections: readonly CollectionInfo[] = [],
  today: Date = new Date(),
): ContractRow[] {
  const renewalBy = new Map(renewals.filter((r) => r.subscription_id).map((r) => [r.subscription_id as string, r]));
  const collectionBy = new Map(collections.filter((c) => c.subscription_id).map((c) => [c.subscription_id as string, c]));
  return subscriptions.map((s) => {
    const charges = splitCharges(s.subscription_items ?? []);
    const renewal = renewalBy.get(s.id);
    const collection = collectionBy.get(s.id);
    const renewalOn = renewal?.renewal_on ?? s.ends_on ?? null;
    return {
      id: s.id,
      code: s.code,
      status: s.status,
      plan: s.plans?.name ?? s.saas_products?.short_name ?? s.code,
      app: s.saas_products?.short_name ?? null,
      customer: s.organizations?.display_name ?? '—',
      customerId: s.billed_organization_id ?? null,
      tenant: s.tenant_id ? (s.tenants?.name ?? null) : null,
      deploymentMode: s.tenant_id ? (s.tenants?.deployment_mode ?? null) : null,
      startedOn: s.started_on,
      monthly: charges.monthly,
      oneTime: charges.oneTime,
      oneTimeCount: charges.oneTimeCount,
      channelMargin: s.channel_margin_rate ?? null,
      renewalOn,
      daysToRenewal: renewal?.days_to_renewal ?? (renewalOn ? daysBetween(today, renewalOn) : null),
      method: collection?.collection_method ?? null,
      methodMissing: Boolean(collection?.profile_missing) || !collection?.collection_method,
    };
  });
}

function daysBetween(today: Date, iso: string): number {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

/** Contratos que cuentan como cartera viva (generan recurrente). */
const LIVE = new Set(['ACTIVE', 'PAST_DUE']);

export type ContractFilter = 'ALL' | 'ACTIVE' | 'PAST_DUE' | 'DRAFT' | 'PAUSED' | 'CANCELLED' | 'RENEWING';

/** Ventana de «Renuevan pronto» de la franja. */
export const RENEWAL_SOON_DAYS = 30;

export function matchesContract(row: ContractRow, filter: ContractFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'RENEWING') {
    return LIVE.has(row.status) && row.daysToRenewal !== null && row.daysToRenewal >= 0 && row.daysToRenewal <= RENEWAL_SOON_DAYS;
  }
  return row.status === filter;
}

export interface ContractSummary {
  total: number;
  active: number;
  pastDue: number;
  drafts: number;
  renewing: number;
  /** Recurrente al mes de los contratos vivos (activos y con pago atrasado), por moneda. */
  liveMonthly: CurrencyAmounts;
}

export function contractSummary(rows: readonly ContractRow[]): ContractSummary {
  const out: ContractSummary = { total: rows.length, active: 0, pastDue: 0, drafts: 0, renewing: 0, liveMonthly: {} };
  for (const r of rows) {
    if (r.status === 'ACTIVE') out.active += 1;
    if (r.status === 'PAST_DUE') out.pastDue += 1;
    if (r.status === 'DRAFT') out.drafts += 1;
    if (matchesContract(r, 'RENEWING')) out.renewing += 1;
    if (LIVE.has(r.status)) {
      for (const [currency, amount] of Object.entries(r.monthly)) {
        out.liveMonthly[currency] = Math.round(((out.liveMonthly[currency] ?? 0) + amount) * 100) / 100;
      }
    }
  }
  return out;
}

export type ContractSortKey = 'contract' | 'customer' | 'monthly' | 'renewal';

/** Peso de un mapa por moneda para ordenar: el mayor importe (no se suman monedas). */
function weight(map: CurrencyAmounts): number {
  return Math.max(0, ...Object.values(map));
}

export function sortContracts(rows: readonly ContractRow[], key: ContractSortKey, dir: 'asc' | 'desc'): ContractRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byCode = (a: ContractRow, b: ContractRow) => a.code.localeCompare(b.code, 'es');
  const cmp = (a: ContractRow, b: ContractRow): number => {
    switch (key) {
      case 'contract':
        return sign * a.plan.localeCompare(b.plan, 'es') || byCode(a, b);
      case 'customer':
        return sign * a.customer.localeCompare(b.customer, 'es') || byCode(a, b);
      case 'monthly':
        return sign * (weight(a.monthly) - weight(b.monthly)) || byCode(a, b);
      case 'renewal': {
        // Sin fecha, siempre al final.
        if (a.renewalOn === b.renewalOn) return byCode(a, b);
        if (!a.renewalOn) return 1;
        if (!b.renewalOn) return -1;
        return sign * a.renewalOn.localeCompare(b.renewalOn) || byCode(a, b);
      }
    }
  };
  return [...rows].sort(cmp);
}
