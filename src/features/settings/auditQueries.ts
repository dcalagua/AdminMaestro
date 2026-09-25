import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database.types';
import { cleanSearch, type Page, type SortDir } from '@/services/financeRead';

/**
 * Lectura paginada de la bitácora (P28). Sólo lectura: `authenticated` no tiene
 * UPDATE ni DELETE sobre `audit_logs` y RLS decide qué filas ve cada perfil.
 *
 * Reemplaza el `limit(200)` anterior: página, total exacto y orden estable
 * (`occurred_at` y desempate por `id`) para que una exportación «completa» no
 * repita ni pierda filas.
 */
export type AuditRow = Tables<{ schema: 'platform' }, 'audit_logs'>;
export type AuditFilter = 'ALL';
export type AuditSort = 'occurred_at' | 'action' | 'entity_type';

export interface AuditListParams {
  search: string;
  page: number;
  pageSize: number;
  sortBy: AuditSort;
  sortDir: SortDir;
}

const SEARCH_COLUMNS = ['action', 'actor_email', 'entity_type', 'entity_id'];

export async function fetchAuditPage(p: AuditListParams): Promise<Page<AuditRow>> {
  let q = supabase.from('audit_logs').select('*', { count: 'exact' });
  const term = cleanSearch(p.search);
  if (term) q = q.or(SEARCH_COLUMNS.map((c) => `${c}.ilike.*${term}*`).join(','));
  const from = p.page * p.pageSize;
  let ordered = q.order(p.sortBy, { ascending: p.sortDir === 'asc', nullsFirst: false });
  if (p.sortBy !== 'occurred_at') ordered = ordered.order('occurred_at', { ascending: false });
  const res = await ordered.order('id', { ascending: false }).range(from, from + p.pageSize - 1);
  if (res.error) throw new Error(res.error.message);
  return { rows: (res.data ?? []) as AuditRow[], total: res.count ?? 0 };
}

export function useAuditPage(p: AuditListParams) {
  return useQuery({
    queryKey: ['audit-logs', 'page', p],
    queryFn: () => fetchAuditPage(p),
    placeholderData: keepPreviousData,
  });
}
