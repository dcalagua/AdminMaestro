import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { LeadRow, SalesReminder, TrialRequestBase } from './leadsModel';

/**
 * Datos de las solicitudes de la web y de las pruebas que piden los comerciales.
 * Lectura por RLS (`can_manage_commercial` o comercial activo) y escritura solo
 * por RPC auditada o por la Edge Function `lead-sync`.
 */
const KEYS = ['commercial-leads', 'lead-sync-state', 'audit-logs', 'trial-requests', 'sales-reminders'];

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw error;
  return (data ?? []) as T;
}

export type LeadWithRefs = LeadRow & {
  saas_products: { code: string; short_name: string } | null;
  organizations: { display_name: string } | null;
  /** Comercial que la tomó. RLS solo deja ver el nombre propio: el de otro llega nulo. */
  owner: { full_name: string } | null;
};

export function useCommercialLeads({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['commercial-leads'],
    enabled,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('commercial_leads')
          .select('*, saas_products(code, short_name), organizations(display_name), owner:sales_agents!commercial_leads_owner_sales_agent_id_fkey(full_name)')
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

export function useLeadSyncState({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['lead-sync-state'],
    enabled,
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

// ---------------------------------------------------------------------------
// Pruebas pedidas por un comercial (EBIM las aprueba creando el tenant)
// ---------------------------------------------------------------------------

export type TrialRequestRow = TrialRequestBase & {
  saas_products: { code: string; short_name: string } | null;
  plans: { code: string; name: string } | null;
  /** Nulo para un comercial que mira el pedido de otro (no ocurre: RLS no se lo muestra). */
  sales_agents: { full_name: string } | null;
};

export function useTrialRequests({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['trial-requests'],
    enabled,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('trial_requests')
          .select('*, saas_products(code, short_name), plans(code, name), sales_agents(full_name)')
          .order('created_at', { ascending: false })
          .limit(500),
      ) as unknown as TrialRequestRow[],
  });
}

export function useTrialRequest(id: string | null) {
  return useQuery({
    queryKey: ['trial-requests', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('trial_requests').select('*').eq('id', id!).maybeSingle();
      if (error) throw error;
      return data as TrialRequestBase | null;
    },
  });
}

export interface RequestTrialInput {
  productId: string;
  planId?: string | null;
  companyName: string;
  contactName: string;
  adminEmail: string;
  countryCode?: string | null;
  notes?: string | null;
  leadId?: string | null;
}

export function useRequestTrial() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (a: RequestTrialInput) =>
      unwrap(
        await supabase.rpc('request_trial', {
          p_saas_product_id: a.productId,
          p_company_name: a.companyName,
          p_contact_name: a.contactName,
          p_admin_email: a.adminEmail,
          p_plan_id: a.planId || undefined,
          p_country_code: a.countryCode || undefined,
          p_notes: a.notes || undefined,
          p_lead_id: a.leadId || undefined,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useCancelTrialRequest() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('cancel_trial_request', { p_request_id: id })),
    onSuccess: invalidate,
  });
}

export function useRejectTrialRequest() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (a: { id: string; note: string }) =>
      unwrap(await supabase.rpc('reject_trial_request', { p_request_id: a.id, p_note: a.note })),
    onSuccess: invalidate,
  });
}

/** Cierra el pedido con el tenant que creó «Nueva venta» y deja la atribución al comercial. */
export function useCompleteTrialRequest() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (a: { id: string; tenantId: string }) =>
      unwrap(await supabase.rpc('complete_trial_request', { p_request_id: a.id, p_tenant_id: a.tenantId })),
    onSuccess: invalidate,
  });
}

/** Recordatorios del comercial de la sesión (`my_sales_reminders`). */
export function useSalesReminders({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['sales-reminders'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_sales_reminders');
      if (error) throw error;
      return (data ?? []) as unknown as SalesReminder[];
    },
  });
}
