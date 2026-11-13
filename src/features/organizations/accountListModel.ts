import { CELL, buildMatrix, type CellKind, type ProvisioningRow, type TenantRow } from '@/features/suite/suiteModel';
import { accountHealth, type AccountHealth } from './accountSeriesModel';
import { commercialOwner, type AttributionLike, type CommercialOwner } from './account360Model';

/**
 * Listado gerencial de Cuentas (V6 · F1, plan §3.2), lógica pura.
 *
 * Una fila por organización con lo que responde «¿cómo va esta cuenta?» sin
 * abrir la ficha: sus apps con el estado en cada una (el MISMO modelo del
 * Centro de la suite), MRR y saldo vencido por moneda (nunca sumados entre
 * monedas), salud de cobranza, canal y responsable comercial.
 *
 * Todo se calcula en el navegador a partir de lecturas que ya existen
 * (`v_tenant_overview`, `v_saas_provisioning`, `v_invoice_balances`,
 * `v_renewal_pipeline`, `sales_attributions`). Funciona con decenas o cientos
 * de cuentas; con miles hará falta una vista `v_account_summary` en la base
 * (plan V6 §5.1). RLS sigue decidiendo qué filas llegan.
 */

export type CurrencyAmounts = Record<string, number>;

export interface OrganizationLike {
  id: string;
  slug?: string | null;
  display_name: string;
  legal_name?: string | null;
  country_code?: string | null;
  tax_id?: string | null;
  status?: string | null;
  kind?: string | null;
  accent_color?: string | null;
  organization_capabilities?: unknown;
}

export interface OverdueInvoiceLike {
  customer_organization_id: string | null;
  currency: string | null;
  balance: number | string | null;
  days_overdue: number | null;
}

export interface RenewalLike {
  billed_organization_id: string | null;
  is_past_due?: boolean | null;
  suspension_pending?: boolean | null;
}

export interface AttributionRow extends AttributionLike {
  customer_organization_id?: string | null;
}

export interface AccountApp {
  productId: string;
  name: string;
  kind: CellKind;
  /** Tenants de la cuenta en esa app (la celda resume al que más atención pide). */
  tenants: number;
}

export interface AccountRow {
  id: string;
  name: string;
  legalName: string | null;
  country: string | null;
  taxId: string | null;
  slug: string | null;
  status: string;
  isPlatform: boolean;
  accent: string | null;
  capabilities: string[];
  /** Apps donde la cuenta es la CLIENTE, ordenadas: primero lo que pide atención. */
  apps: AccountApp[];
  ownTenants: number;
  /** Tenants de otros clientes que esta organización administra como canal. */
  managedTenants: number;
  mrr: CurrencyAmounts;
  overdue: CurrencyAmounts;
  overdueInvoices: number;
  /** Días de la factura vencida más antigua (o `null` sin deuda). */
  oldestOverdueDays: number | null;
  /** `null` = sin vista financiera o sin datos de renovación (no se afirma nada). */
  health: AccountHealth | null;
  /** Partners que administran sus tenants; vacío = venta directa. */
  partners: string[];
  owner: CommercialOwner | null;
}

/** Estados de app que piden una acción o aún no tienen el alta completa. */
export const APP_PENDING_KINDS: ReadonlySet<CellKind> = new Set(['FAILED', 'ACTIVE_NO_APP', 'NOT_REQUESTED', 'IN_PROGRESS']);

const KIND_ORDER: CellKind[] = [
  'FAILED', 'PENDING_CONFIRM', 'ACTIVE_NO_APP', 'SUSPENDED', 'IN_PROGRESS', 'NOT_REQUESTED', 'ACTIVE', 'CANCELLED', 'INACTIVE',
];

function capabilitiesOf(o: OrganizationLike): string[] {
  return ((o.organization_capabilities ?? []) as Array<{ capability: string }>).map((c) => c.capability);
}

function add(map: CurrencyAmounts, currency: string | null | undefined, value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  if (!currency || !Number.isFinite(n) || n === 0) return;
  map[currency] = Math.round(((map[currency] ?? 0) + n) * 100) / 100;
}

export function buildAccountRows(input: {
  organizations: readonly OrganizationLike[];
  tenants?: readonly TenantRow[];
  requests?: readonly ProvisioningRow[];
  /** Facturas emitidas VENCIDAS con saldo (`aging_bucket` vencido). `undefined` = sin vista financiera. */
  overdueInvoices?: readonly OverdueInvoiceLike[];
  /** Contratos con sus banderas de cobranza. `undefined` = sin vista financiera. */
  renewals?: readonly RenewalLike[];
  attributions?: readonly AttributionRow[];
  today?: string;
}): AccountRow[] {
  const tenants = input.tenants ?? [];
  const matrix = new Map(
    buildMatrix({ apps: [], tenants, requests: input.requests ?? [] }).map((r) => [r.organizationId, r]),
  );
  const productName = new Map(tenants.map((t) => [t.saas_product_id ?? '', t.product_short_name ?? '—']));

  const own = new Map<string, TenantRow[]>();
  const managed = new Map<string, number>();
  for (const t of tenants) {
    if (t.customer_organization_id) own.set(t.customer_organization_id, [...(own.get(t.customer_organization_id) ?? []), t]);
    if (t.managing_organization_id && t.managing_organization_id !== t.customer_organization_id) {
      managed.set(t.managing_organization_id, (managed.get(t.managing_organization_id) ?? 0) + 1);
    }
  }

  const overdue = new Map<string, { amounts: CurrencyAmounts; count: number; oldest: number | null }>();
  for (const i of input.overdueInvoices ?? []) {
    if (!i.customer_organization_id) continue;
    const entry = overdue.get(i.customer_organization_id) ?? { amounts: {}, count: 0, oldest: null };
    add(entry.amounts, i.currency, i.balance);
    entry.count += 1;
    if (i.days_overdue !== null && i.days_overdue !== undefined) entry.oldest = Math.max(entry.oldest ?? 0, i.days_overdue);
    overdue.set(i.customer_organization_id, entry);
  }

  const renewals = new Map<string, RenewalLike[]>();
  for (const r of input.renewals ?? []) {
    if (r.billed_organization_id) renewals.set(r.billed_organization_id, [...(renewals.get(r.billed_organization_id) ?? []), r]);
  }

  const attributions = new Map<string, AttributionRow[]>();
  for (const a of input.attributions ?? []) {
    if (a.customer_organization_id) {
      attributions.set(a.customer_organization_id, [...(attributions.get(a.customer_organization_id) ?? []), a]);
    }
  }

  return input.organizations.map((o) => {
    const mine = own.get(o.id) ?? [];
    const row = matrix.get(o.id);
    const apps: AccountApp[] = row
      ? Object.values(row.cells)
          .filter((c) => c.primary)
          .map((c) => ({ productId: c.productId, name: productName.get(c.productId) ?? '—', kind: c.primary!.kind, tenants: c.tenants.length }))
          .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, 'es'))
      : [];
    const mrr: CurrencyAmounts = {};
    for (const t of mine) add(mrr, t.currency, t.mrr);
    const debt = overdue.get(o.id);
    const partners = [
      ...new Set(
        mine
          .filter((t) => t.managing_organization_id && t.managing_organization_id !== o.id && t.managing_name)
          .map((t) => t.managing_name as string),
      ),
    ].sort((a, b) => a.localeCompare(b, 'es'));
    const finance = input.renewals !== undefined || input.overdueInvoices !== undefined;
    return {
      id: o.id,
      name: o.display_name,
      legalName: o.legal_name ?? null,
      country: o.country_code ?? null,
      taxId: o.tax_id ?? null,
      slug: o.slug ?? null,
      status: o.status ?? 'ACTIVE',
      isPlatform: o.kind === 'PLATFORM',
      accent: o.accent_color ?? null,
      capabilities: capabilitiesOf(o),
      apps,
      ownTenants: mine.length,
      managedTenants: managed.get(o.id) ?? 0,
      mrr,
      overdue: debt?.amounts ?? {},
      overdueInvoices: debt?.count ?? 0,
      oldestOverdueDays: debt?.oldest ?? null,
      health: finance ? healthOf(renewals.get(o.id) ?? [], debt?.count ?? 0, mrr) : null,
      partners,
      owner: commercialOwner(attributions.get(o.id), input.today),
    };
  });
}

/**
 * Salud de cobranza de la cuenta: la de la ficha 360 (`accountHealth`). Si la
 * cuenta no tiene contratos en el pipeline de renovaciones pero sí recurrente
 * vigente y nada vencido, está «Al día» (no «Sin contratos»).
 */
function healthOf(renewals: readonly RenewalLike[], overdueCount: number, mrr: CurrencyAmounts): AccountHealth {
  const h = accountHealth(renewals, overdueCount > 0);
  return h === 'NO_CONTRACTS' && Object.keys(mrr).length > 0 ? 'OK' : h;
}

/* ---- Filtros (pestañas de estado y celdas de la franja) ------------------------- */

export type AccountFilter = 'ALL' | 'ACTIVE' | 'DEBT' | 'SUSPENSION' | 'APPS_PENDING' | 'NO_ACTIVE_APPS' | 'INACTIVE';

export const ACCOUNT_FILTER_LABEL: Record<AccountFilter, string> = {
  ALL: 'Todas',
  ACTIVE: 'Activas',
  DEBT: 'Con deuda',
  SUSPENSION: 'Por suspender',
  APPS_PENDING: 'Apps sin alta',
  NO_ACTIVE_APPS: 'Sin apps activas',
  INACTIVE: 'Inactivas',
};

export function hasDebt(row: AccountRow): boolean {
  return row.overdueInvoices > 0 || row.health === 'PAST_DUE' || row.health === 'SUSPENSION';
}

export function matchesAccountFilter(row: AccountRow, filter: AccountFilter): boolean {
  switch (filter) {
    case 'ALL':
      return true;
    case 'ACTIVE':
      return row.status === 'ACTIVE';
    case 'DEBT':
      return hasDebt(row);
    case 'SUSPENSION':
      return row.health === 'SUSPENSION';
    case 'APPS_PENDING':
      return row.apps.some((a) => APP_PENDING_KINDS.has(a.kind));
    case 'NO_ACTIVE_APPS':
      return row.status === 'ACTIVE' && !row.apps.some((a) => a.kind === 'ACTIVE' || a.kind === 'PENDING_CONFIRM');
    case 'INACTIVE':
      return row.status !== 'ACTIVE';
  }
}

/* ---- Resumen de la franja ------------------------------------------------------ */

export interface AccountSummary {
  total: number;
  active: number;
  mrr: CurrencyAmounts;
  overdue: CurrencyAmounts;
  overdueInvoices: number;
  withDebt: number;
  suspension: number;
  appsPending: number;
  noActiveApps: number;
  inactive: number;
}

export function accountSummary(rows: readonly AccountRow[]): AccountSummary {
  const mrr: CurrencyAmounts = {};
  const overdue: CurrencyAmounts = {};
  let overdueInvoices = 0;
  for (const r of rows) {
    for (const [c, v] of Object.entries(r.mrr)) add(mrr, c, v);
    for (const [c, v] of Object.entries(r.overdue)) add(overdue, c, v);
    overdueInvoices += r.overdueInvoices;
  }
  const count = (f: AccountFilter) => rows.filter((r) => matchesAccountFilter(r, f)).length;
  return {
    total: rows.length,
    active: count('ACTIVE'),
    mrr,
    overdue,
    overdueInvoices,
    withDebt: count('DEBT'),
    suspension: count('SUSPENSION'),
    appsPending: count('APPS_PENDING'),
    noActiveApps: count('NO_ACTIVE_APPS'),
    inactive: count('INACTIVE'),
  };
}

/* ---- Orden ---------------------------------------------------------------------- */

export type AccountSortKey = 'name' | 'mrr' | 'overdue' | 'apps';

/**
 * Peso de un mapa por moneda para ORDENAR (nunca para mostrar): el mayor
 * importe nativo. Sin tipo de cambio no hay un total honesto entre monedas;
 * para ordenar una cartera que suele operar en una sola moneda basta.
 */
function weight(map: CurrencyAmounts): number {
  return Math.max(0, ...Object.values(map));
}

export function sortAccounts(rows: readonly AccountRow[], key: AccountSortKey, dir: 'asc' | 'desc'): AccountRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byName = (a: AccountRow, b: AccountRow) => a.name.localeCompare(b.name, 'es');
  const value = (r: AccountRow) =>
    key === 'mrr' ? weight(r.mrr) : key === 'overdue' ? weight(r.overdue) : key === 'apps' ? r.apps.length : 0;
  return [...rows].sort((a, b) => (key === 'name' ? sign * byName(a, b) : sign * (value(a) - value(b)) || byName(a, b)));
}

/* ---- Textos --------------------------------------------------------------------- */

/** Etiqueta corta del estado de una app para la píldora y su ayuda. */
export function appStatus(kind: CellKind): { short: string; help: string; tone: (typeof CELL)[CellKind]['tone'] } {
  const meta = CELL[kind];
  return { short: meta.short, help: meta.help, tone: meta.tone };
}

/** «Directo» o «Vía Consultora Andina» (+N). */
export function channelLabel(row: Pick<AccountRow, 'partners'>): { label: string; title?: string } {
  if (row.partners.length === 0) return { label: 'Directo' };
  const [first, ...rest] = row.partners;
  return {
    label: rest.length > 0 ? `Vía ${first} +${rest.length}` : `Vía ${first}`,
    title: row.partners.length > 1 ? row.partners.join(', ') : undefined,
  };
}
