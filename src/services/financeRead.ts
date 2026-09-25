import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database.types';

/**
 * Lecturas de la experiencia ejecutiva (spec §9): RESUMEN agregado en servidor +
 * DETALLE paginado del MISMO universo, con los mismos filtros.
 *
 * Igual que `queries.ts`, nada de esto es seguridad: RLS decide las filas. Los
 * filtros de aquí son de ALCANCE de la pantalla (buscador, tab, organización),
 * y cada uno tiene su gemelo exacto en la función SQL del resumen
 * (`invoice_summary`, `cost_summary`, `commission_summary`); la paridad la
 * prueba el pgTAP `25_executive_read_models`.
 */

export type SortDir = 'asc' | 'desc';

export interface ListParams<F extends string, S extends string> {
  search: string;
  filter: F;
  page: number;
  pageSize: number;
  sortBy: S;
  sortDir: SortDir;
}

export interface Page<Row> {
  rows: Row[];
  total: number;
}

export const PAGE_SIZES = [25, 50, 100] as const;
/** Límite técnico de «todos los resultados filtrados»; se muestra antes de exportar. */
export const EXPORT_LIMIT = 5000;
export const EXPORT_PAGE_SIZE = 500;

/**
 * Normaliza el término: fuera los caracteres que rompen la sintaxis `or=(…)` de
 * PostgREST o actúan como comodín. Se usa el MISMO término en la tabla y en el
 * resumen, así ambos filtran igual.
 */
export function cleanSearch(term: string): string {
  return term.replace(/[,()*%\\"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function orFilter(columns: string[], term: string): string {
  return columns.map((c) => `${c}.ilike.*${term}*`).join(',');
}

function range(page: number, pageSize: number): [number, number] {
  const from = page * pageSize;
  return [from, from + pageSize - 1];
}

function unwrapPage<Row>(res: { data: Row[] | null; error: { message: string } | null; count: number | null }): Page<Row> {
  if (res.error) throw new Error(res.error.message);
  return { rows: res.data ?? [], total: res.count ?? 0 };
}

async function rpcJson<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as (
    f: string,
    a: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/* ==========================================================================
   Facturas (P02, K03, K04, G03)
   ========================================================================== */

export type InvoiceRow = Tables<{ schema: 'platform' }, 'v_invoice_balances'>;
export type InvoiceFilter = 'ALL' | 'OPEN' | 'PAID' | 'EXCLUDED' | 'UNCOLLECTIBLE';
export type InvoiceSort = 'issue_date' | 'due_date' | 'number' | 'total' | 'balance' | 'organization_name';
export type AgingFilter = '' | 'VENCIDA' | 'VIGENTE' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_MAS' | 'SIN_FECHA';

export interface InvoiceListParams extends ListParams<InvoiceFilter, InvoiceSort> {
  organizationId?: string;
  aging?: AgingFilter;
}

const INVOICE_STATUS: Record<InvoiceFilter, string[] | null> = {
  ALL: null,
  OPEN: ['ISSUED', 'PARTIALLY_PAID'],
  PAID: ['PAID'],
  EXCLUDED: ['DRAFT', 'VOID'],
  UNCOLLECTIBLE: ['UNCOLLECTIBLE'],
};
const OVERDUE_BUCKETS = ['D1_30', 'D31_60', 'D61_90', 'D90_MAS'];

export async function fetchInvoicePage(p: InvoiceListParams): Promise<Page<InvoiceRow>> {
  let q = supabase.from('v_invoice_balances').select('*', { count: 'exact' });
  const term = cleanSearch(p.search);
  if (term) q = q.or(orFilter(['number', 'organization_name'], term));
  const statuses = INVOICE_STATUS[p.filter];
  if (statuses) q = q.in('status', statuses as never[]);
  if (p.organizationId) q = q.eq('customer_organization_id', p.organizationId);
  if (p.aging === 'VENCIDA') q = q.in('aging_bucket', OVERDUE_BUCKETS);
  else if (p.aging) q = q.eq('aging_bucket', p.aging);
  const [from, to] = range(p.page, p.pageSize);
  // Desempate por id: sin él, dos filas con la misma fecha pueden saltar de
  // página y una exportación «completa» repetiría o perdería filas.
  const res = await q
    .order(p.sortBy, { ascending: p.sortDir === 'asc', nullsFirst: false })
    .order('invoice_id', { ascending: true })
    .range(from, to);
  return unwrapPage(res as { data: InvoiceRow[] | null; error: { message: string } | null; count: number | null });
}

export interface InvoiceSummary {
  row_count: number;
  status_counts: Record<string, number>;
  invoiced: Record<string, number | string>;
  collected: Record<string, number | string>;
  receivable: Record<string, number | string>;
  overdue: Record<string, number | string>;
  observed_at: string;
}

export function useInvoicePage(p: InvoiceListParams) {
  return useQuery({
    queryKey: ['invoices', 'page', p],
    queryFn: () => fetchInvoicePage(p),
    placeholderData: keepPreviousData,
  });
}

export function useInvoiceSummary(p: Pick<InvoiceListParams, 'search' | 'filter' | 'organizationId' | 'aging'>) {
  return useQuery({
    queryKey: ['invoices', 'summary', { ...p, search: cleanSearch(p.search) }],
    queryFn: () =>
      rpcJson<InvoiceSummary>('invoice_summary', {
        p_search: cleanSearch(p.search) || null,
        p_status: p.filter,
        p_organization_id: p.organizationId ?? null,
        p_aging: p.aging || null,
      }),
  });
}

export interface AgingRowDb {
  currency: string;
  aging_bucket: string;
  invoice_count: number;
  balance: number;
}

export function useReceivablesAging(organizationId?: string) {
  return useQuery({
    queryKey: ['invoices', 'aging', organizationId ?? 'all'],
    queryFn: () => rpcJson<AgingRowDb[]>('receivables_aging', { p_organization_id: organizationId ?? null }),
  });
}

/* ==========================================================================
   Cobros (K02, G01)
   ========================================================================== */

export interface CollectionsMonthRow {
  month: string;
  currency: string;
  amount: number;
  payment_count: number;
}

export function useCollectionsByMonth(from: string, to: string, organizationId?: string) {
  return useQuery({
    queryKey: ['collections', 'by-month', from, to, organizationId ?? 'all'],
    queryFn: () =>
      rpcJson<CollectionsMonthRow[]>('collections_by_month', {
        p_from: from,
        p_to: to,
        p_organization_id: organizationId ?? null,
      }),
  });
}

export type CollectedPaymentRow = Tables<{ schema: 'platform' }, 'v_collected_payments'>;
export type PaymentSort = 'collected_on' | 'collected_amount' | 'organization_name' | 'invoice_number';

export interface PaymentListParams extends ListParams<'ALL', PaymentSort> {
  from?: string;
  to?: string;
  organizationId?: string;
}

export async function fetchCollectedPaymentPage(p: PaymentListParams): Promise<Page<CollectedPaymentRow>> {
  let q = supabase.from('v_collected_payments').select('*', { count: 'exact' });
  const term = cleanSearch(p.search);
  if (term) q = q.or(orFilter(['invoice_number', 'organization_name', 'reference'], term));
  if (p.from) q = q.gte('collected_on', p.from);
  if (p.to) q = q.lte('collected_on', p.to);
  if (p.organizationId) q = q.eq('customer_organization_id', p.organizationId);
  const [from, to] = range(p.page, p.pageSize);
  const res = await q
    .order(p.sortBy, { ascending: p.sortDir === 'asc', nullsFirst: false })
    .order('payment_id', { ascending: true })
    .range(from, to);
  return unwrapPage(res as { data: CollectedPaymentRow[] | null; error: { message: string } | null; count: number | null });
}

export function useCollectedPaymentPage(p: PaymentListParams) {
  return useQuery({
    queryKey: ['collections', 'page', p],
    queryFn: () => fetchCollectedPaymentPage(p),
    placeholderData: keepPreviousData,
  });
}

/* ==========================================================================
   Costos (P03)
   ========================================================================== */

export type CostRow = Tables<{ schema: 'platform' }, 'v_cost_entry_list'>;
export type CostFilter = 'ALL' | 'PLATFORM' | 'PRODUCT' | 'ORGANIZATION' | 'TENANT' | 'DEPLOYMENT_TARGET' | 'UNALLOCATED';
export type CostSort = 'period_start' | 'amount' | 'description' | 'category_text';

export async function fetchCostPage(p: ListParams<CostFilter, CostSort>): Promise<Page<CostRow>> {
  let q = supabase.from('v_cost_entry_list').select('*', { count: 'exact' });
  const term = cleanSearch(p.search);
  if (term) q = q.or(orFilter(['description', 'vendor', 'category_text'], term));
  if (p.filter === 'UNALLOCATED') q = q.eq('allocation_count', 0);
  else if (p.filter !== 'ALL') q = q.contains('scopes', [p.filter]);
  const [from, to] = range(p.page, p.pageSize);
  const res = await q
    .order(p.sortBy, { ascending: p.sortDir === 'asc', nullsFirst: false })
    .order('id', { ascending: true })
    .range(from, to);
  return unwrapPage(res as { data: CostRow[] | null; error: { message: string } | null; count: number | null });
}

export interface CostSummary {
  row_count: number;
  registered: Record<string, number | string>;
  allocated: Record<string, number | string>;
  platform: Record<string, number | string>;
  unallocated: Record<string, number | string>;
  by_category: Array<{ category: string; currency: string; amount: number | string }>;
  observed_at: string;
}

export function useCostPage(p: ListParams<CostFilter, CostSort>) {
  return useQuery({ queryKey: ['cost-entries', 'page', p], queryFn: () => fetchCostPage(p), placeholderData: keepPreviousData });
}

export function useCostSummary(p: Pick<ListParams<CostFilter, CostSort>, 'search' | 'filter'>) {
  return useQuery({
    queryKey: ['cost-entries', 'summary', { ...p, search: cleanSearch(p.search) }],
    queryFn: () => rpcJson<CostSummary>('cost_summary', { p_search: cleanSearch(p.search) || null, p_scope: p.filter }),
  });
}

/* ==========================================================================
   Comisiones (P14)
   ========================================================================== */

export type CommissionRow = Tables<{ schema: 'platform' }, 'v_commission_detail'>;
export type CommissionFilter = 'ALL' | 'PENDING' | 'PAID' | 'WAITING' | 'VOID';
export type CommissionSort = 'earned_on' | 'amount' | 'agent_name' | 'product_short_name';

const COMMISSION_STATUS: Record<CommissionFilter, string[] | null> = {
  ALL: null,
  PENDING: ['ELIGIBLE', 'ACCRUED'],
  PAID: ['PAID'],
  WAITING: ['PENDING'],
  VOID: ['VOID'],
};

export async function fetchCommissionPage(p: ListParams<CommissionFilter, CommissionSort>): Promise<Page<CommissionRow>> {
  let q = supabase.from('v_commission_detail').select('*', { count: 'exact' });
  const term = cleanSearch(p.search);
  if (term) q = q.or(orFilter(['agent_name', 'product_short_name', 'tenant_name', 'invoice_number'], term));
  const statuses = COMMISSION_STATUS[p.filter];
  if (statuses) q = q.in('status', statuses as never[]);
  const [from, to] = range(p.page, p.pageSize);
  const res = await q
    .order(p.sortBy, { ascending: p.sortDir === 'asc', nullsFirst: false })
    .order('commission_event_id', { ascending: true })
    .range(from, to);
  return unwrapPage(res as { data: CommissionRow[] | null; error: { message: string } | null; count: number | null });
}

export interface CommissionSummary {
  row_count: number;
  by_status: Record<string, Record<string, number | string>>;
  pending: Record<string, number | string>;
  paid: Record<string, number | string>;
  observed_at: string;
}

export function useCommissionPage(p: ListParams<CommissionFilter, CommissionSort>) {
  return useQuery({ queryKey: ['commission-events', 'page', p], queryFn: () => fetchCommissionPage(p), placeholderData: keepPreviousData });
}

export function useCommissionSummary(p: Pick<ListParams<CommissionFilter, CommissionSort>, 'search' | 'filter'>) {
  return useQuery({
    queryKey: ['commission-events', 'summary', { ...p, search: cleanSearch(p.search) }],
    queryFn: () =>
      rpcJson<CommissionSummary>('commission_summary', { p_search: cleanSearch(p.search) || null, p_status: p.filter }),
  });
}

/* ==========================================================================
   Renovaciones (K06, G06)
   ========================================================================== */

export type RenewalRow = Tables<{ schema: 'platform' }, 'v_renewal_pipeline'>;

export function useRenewalPipeline(organizationId?: string) {
  return useQuery({
    queryKey: ['renewal-pipeline', organizationId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('v_renewal_pipeline').select('*').order('renewal_on', { nullsFirst: false });
      if (organizationId) q = q.eq('billed_organization_id', organizationId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as RenewalRow[];
    },
  });
}
