import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { LeadRow } from './leadsModel';

/**
 * Datos de las solicitudes de la web. Lectura por RLS (`can_manage_commercial`)
 * y escritura solo por RPC auditada o por la Edge Function `lead-sync`.
 */
const KEYS = ['commercial-leads', 'lead-sync-state', 'audit-logs'];

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw error;
  return (data ?? []) as T;
}

export type LeadWithRefs = LeadRow & {
  saas_products: { code: string; short_name: string } | null;
  organizations: { display_name: string } | null;
};

export function useCommercialLeads({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['commercial-leads'],
    enabled,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('commercial_leads')
          .select('*, saas_products(code, short_name), organizations(display_name)')
          .order('received_at', { ascending: false })
          .limit(1000),
      ) as unknown as LeadWithRefs[],
  });
}

export function useCommercialLead(id: string | null) {
  return useQuery({
    queryKey: ['commercial-leads', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('commercial_leads').select('*').eq('id', id!).maybeSingle();
      if (error) throw error;
      return data as LeadRow | null;
    },
  });
}

export function useLeadSyncState() {
  return useQuery({
    queryKey: ['lead-sync-state'],
    queryFn: async () => unwrap(await supabase.from('lead_sync_state').select('*')),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    for (const key of KEYS) void qc.invalidateQueries({ queryKey: [key] });
  };
}

export function useSetLeadStatus() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (args: { id: string; status: 'NEW' | 'CONTACTED' | 'DISCARDED'; note?: string }) =>
      unwrap(await supabase.rpc('set_commercial_lead_status', { p_lead_id: args.id, p_status: args.status, p_note: args.note })),
    onSuccess: invalidate,
  });
}

export function useLinkLeadOrganization() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (args: { id: string; organizationId: string }) =>
      unwrap(await supabase.rpc('link_commercial_lead_organization', { p_lead_id: args.id, p_organization_id: args.organizationId })),
    onSuccess: invalidate,
  });
}

export interface LeadSyncResult {
  targets?: Array<{ target: string; product: string; received: number; new: number; errorCode: string | null }>;
  error?: string;
}

/** «Traer ahora»: la Edge Function autoriza con `can_manage_commercial()`. */
export function useRunLeadSync() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (): Promise<LeadSyncResult> => {
      const { data, error } = await supabase.functions.invoke<LeadSyncResult>('lead-sync', { body: {} });
      if (error) {
        const context = (error as { context?: Response }).context;
        if (context && typeof context.json === 'function') {
          const payload = (await context.json().catch(() => null)) as { error?: string; message?: string } | null;
          if (payload?.error) throw new Error(payload.message ? `${payload.error}: ${payload.message}` : payload.error);
        }
        throw error;
      }
      return data ?? {};
    },
    onSettled: invalidate,
  });
}
