/* ==========================================================================
   Equipo comercial (V6 · F2, plan §3.2): modelo puro de la cartera de cada
   comercial a partir de sus atribuciones VIGENTES.

   - Cartera: clientes y productos distintos.
   - MRR atribuido: MRR de los tenants activos cubiertos por cada atribución
     (el tenant concreto, o todos los del cliente en ese producto) por su
     participación. Por moneda: nunca se suman monedas distintas.
   - Comisión por liquidar (devengada o elegible) y pagada, por moneda,
     desde `v_commission_detail` (solo cobros confirmados generan comisión).
   ========================================================================== */

export interface AttributionLike {
  sales_agent_id?: string | null;
  status?: string | null;
  customer_organization_id?: string | null;
  saas_product_id?: string | null;
  tenant_id?: string | null;
  attribution_pct?: number | string | null;
  saas_products?: unknown;
}

export interface TenantMrrLike {
  tenant_id?: string | null;
  customer_organization_id?: string | null;
  saas_product_id?: string | null;
  status?: string | null;
  mrr?: number | string | null;
  currency?: string | null;
}

export interface CommissionLike {
  sales_agent_id?: string | null;
  status?: string | null;
  amount?: number | string | null;
  currency?: string | null;
}

export interface AgentPortfolio {
  attributions: number;
  customers: number;
  products: string[];
  mrr: Record<string, number>;
}

export interface AgentCommissions {
  pending: Record<string, number>;
  paid: Record<string, number>;
}

/** Comisión ya ganada que falta liquidar (los cobros PENDING aún no están confirmados). */
const TO_SETTLE = new Set(['ELIGIBLE', 'ACCRUED']);

function add(map: Record<string, number>, currency: string | null | undefined, amount: number) {
  if (!currency || !Number.isFinite(amount) || amount === 0) return;
  map[currency] = Math.round(((map[currency] ?? 0) + amount) * 100) / 100;
}

export function agentPortfolios(
  attributions: readonly AttributionLike[],
  tenants: readonly TenantMrrLike[] | undefined,
): Map<string, AgentPortfolio> {
  const acc = new Map<string, { attributions: number; customers: Set<string>; products: Set<string>; mrr: Record<string, number> }>();
  for (const a of attributions) {
    if (a.status !== 'ACTIVE' || !a.sales_agent_id) continue;
    const entry = acc.get(a.sales_agent_id) ?? { attributions: 0, customers: new Set(), products: new Set(), mrr: {} };
    entry.attributions += 1;
    if (a.customer_organization_id) entry.customers.add(a.customer_organization_id);
    const product = (a.saas_products as { short_name?: string } | null)?.short_name;
    if (product) entry.products.add(product);
    const pct = Number(a.attribution_pct ?? 0);
    for (const t of tenants ?? []) {
      if (t.status !== 'ACTIVE') continue;
      const covered = a.tenant_id
        ? t.tenant_id === a.tenant_id
        : t.customer_organization_id === a.customer_organization_id && t.saas_product_id === a.saas_product_id;
      if (covered) add(entry.mrr, t.currency, Number(t.mrr ?? 0) * pct);
    }
    acc.set(a.sales_agent_id, entry);
  }
  return new Map(
    [...acc.entries()].map(([id, e]) => [
      id,
      {
        attributions: e.attributions,
        customers: e.customers.size,
        products: [...e.products].sort((x, y) => x.localeCompare(y, 'es')),
        mrr: e.mrr,
      },
    ]),
  );
}

export function agentCommissions(rows: readonly CommissionLike[]): Map<string, AgentCommissions> {
  const map = new Map<string, AgentCommissions>();
  for (const r of rows) {
    if (!r.sales_agent_id) continue;
    const entry = map.get(r.sales_agent_id) ?? { pending: {}, paid: {} };
    const amount = Number(r.amount ?? 0);
    if (r.status === 'PAID') add(entry.paid, r.currency, amount);
    else if (TO_SETTLE.has(r.status ?? '')) add(entry.pending, r.currency, amount);
    map.set(r.sales_agent_id, entry);
  }
  return map;
}
