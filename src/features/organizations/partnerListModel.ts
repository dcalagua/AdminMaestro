/* ==========================================================================
   Partners (V6 · F2, plan §3.2): modelo puro del listado de canales.

   Una organización es partner si tiene una capacidad de canal (Partner,
   Reseller, Consultora). Por partner se resume su cartera ADMINISTRADA a
   partir de los tenants visibles (`v_tenant_overview.managing_organization_id`):
   clientes distintos, tenants, apps y MRR por moneda. El margen del canal y
   la tarifa de plataforma vienen de sus vistas financieras (solo con vista
   financiera). Nunca se suman monedas distintas.
   ========================================================================== */

export const CHANNEL_CAPABILITIES = ['PARTNER', 'RESELLER', 'CONSULTING'];

export const CAPABILITY_LABEL: Record<string, string> = {
  PARTNER: 'Partner',
  RESELLER: 'Reseller',
  CONSULTING: 'Consultora',
  CUSTOMER: 'Cliente',
};

export interface PartnerOrgLike {
  id: string;
  display_name: string;
  legal_name?: string | null;
  country_code?: string | null;
  tax_id?: string | null;
  status: string;
  accent_color?: string | null;
  organization_capabilities?: unknown;
}

export interface ManagedTenantLike {
  tenant_id?: string | null;
  managing_organization_id?: string | null;
  customer_organization_id?: string | null;
  saas_product_id?: string | null;
  product_short_name?: string | null;
  status?: string | null;
  mrr?: number | string | null;
  currency?: string | null;
}

export interface PartnerFinanceLike {
  organization_id?: string | null;
  weighted_channel_margin_rate?: number | string | null;
  active_agreements?: number | null;
}

export interface FeeStatementLike {
  partner_organization_id?: string | null;
  period_start?: string | null;
  currency?: string | null;
  fee_total?: number | string | null;
  status?: string | null;
}

export interface PartnerRow {
  id: string;
  name: string;
  legalName: string | null;
  country: string | null;
  taxId: string | null;
  status: string;
  accent: string | null;
  capabilities: string[];
  /** Clientes distintos que administra (por sus tenants visibles). */
  customers: number;
  /** Tenants que administra como canal. */
  tenants: number;
  activeTenants: number;
  /** Apps de los tenants administrados (nombre y n.º de tenants). */
  apps: Array<{ productId: string; name: string; tenants: number }>;
  /** MRR administrado por moneda (solo tenants activos). */
  mrr: Record<string, number>;
  /** Margen ponderado del canal (0..1); `null` sin dato o sin vista financiera. */
  marginRate: number | null;
  activeAgreements: number | null;
  /** Tarifa de plataforma del último período, por moneda. */
  fee: Record<string, number>;
}

export function capabilitiesOf(o: { organization_capabilities?: unknown }): string[] {
  return ((o.organization_capabilities ?? []) as Array<{ capability: string }>).map((c) => c.capability);
}

export function isChannel(caps: string[]): boolean {
  return caps.some((c) => CHANNEL_CAPABILITIES.includes(c));
}

/** Último período con estado de cuenta (el más reciente `period_start`). */
export function latestFeePeriod(statements: readonly FeeStatementLike[]): string | null {
  return statements.reduce<string | null>(
    (latest, s) => (s.period_start && (!latest || s.period_start > latest) ? s.period_start : latest),
    null,
  );
}

function add(map: Record<string, number>, currency: string | null | undefined, amount: number | string | null | undefined) {
  const value = Number(amount ?? 0);
  if (!currency || !Number.isFinite(value) || value === 0) return;
  map[currency] = (map[currency] ?? 0) + value;
}

export function buildPartnerRows(input: {
  organizations: readonly PartnerOrgLike[];
  tenants: readonly ManagedTenantLike[];
  finance?: readonly PartnerFinanceLike[];
  statements?: readonly FeeStatementLike[];
}): PartnerRow[] {
  const period = latestFeePeriod(input.statements ?? []);
  return input.organizations
    .map((o) => ({ o, caps: capabilitiesOf(o) }))
    .filter(({ caps }) => isChannel(caps))
    .map(({ o, caps }) => {
      const managed = input.tenants.filter((t) => t.managing_organization_id === o.id);
      const apps = new Map<string, { productId: string; name: string; tenants: number }>();
      const mrr: Record<string, number> = {};
      for (const t of managed) {
        const key = t.saas_product_id ?? t.product_short_name ?? '—';
        const app = apps.get(key) ?? { productId: key, name: t.product_short_name ?? 'App', tenants: 0 };
        app.tenants += 1;
        apps.set(key, app);
        if (t.status === 'ACTIVE') add(mrr, t.currency, t.mrr);
      }
      const fin = input.finance?.find((f) => f.organization_id === o.id);
      const rate = fin?.weighted_channel_margin_rate;
      const fee: Record<string, number> = {};
      for (const s of input.statements ?? []) {
        if (s.partner_organization_id === o.id && s.period_start === period && s.status !== 'VOID') {
          add(fee, s.currency, s.fee_total);
        }
      }
      return {
        id: o.id,
        name: o.display_name,
        legalName: o.legal_name ?? null,
        country: o.country_code ?? null,
        taxId: o.tax_id ?? null,
        status: o.status,
        accent: o.accent_color ?? null,
        capabilities: caps,
        customers: new Set(managed.map((t) => t.customer_organization_id).filter(Boolean)).size,
        tenants: managed.length,
        activeTenants: managed.filter((t) => t.status === 'ACTIVE').length,
        apps: [...apps.values()].sort((a, b) => b.tenants - a.tenants || a.name.localeCompare(b.name, 'es')),
        mrr,
        marginRate: rate === null || rate === undefined || rate === '' ? null : Number(rate),
        activeAgreements: fin?.active_agreements ?? null,
        fee,
      };
    });
}

export interface PartnerSummary {
  total: number;
  active: number;
  customers: number;
  tenants: number;
  mrr: Record<string, number>;
  fee: Record<string, number>;
  /** Margen medio de los partners con dato (simple, no ponderado). */
  averageMargin: number | null;
}

export function partnerSummary(rows: readonly PartnerRow[]): PartnerSummary {
  const mrr: Record<string, number> = {};
  const fee: Record<string, number> = {};
  for (const r of rows) {
    for (const [c, v] of Object.entries(r.mrr)) add(mrr, c, v);
    for (const [c, v] of Object.entries(r.fee)) add(fee, c, v);
  }
  const margins = rows.map((r) => r.marginRate).filter((m): m is number => m !== null && Number.isFinite(m));
  return {
    total: rows.length,
    active: rows.filter((r) => r.status === 'ACTIVE').length,
    customers: rows.reduce((n, r) => n + r.customers, 0),
    tenants: rows.reduce((n, r) => n + r.tenants, 0),
    mrr,
    fee,
    averageMargin: margins.length > 0 ? margins.reduce((a, b) => a + b, 0) / margins.length : null,
  };
}
