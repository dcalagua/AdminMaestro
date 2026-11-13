import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';
import type { FindingStatus } from './syncModel';

/**
 * Datos de la sincronización con las apps (migración 20261021000100).
 *
 * Lectura por las vistas SECURITY INVOKER (la RLS decide) y escritura solo por
 * RPC o por la Edge Function `tenant-sync`. El cliente nunca manda destinos,
 * rutas ni scopes: solo la intención («sincronizar ahora») o el hallazgo.
 */
type Fns = Database['platform']['Functions'];
export type RegisterArgs = Fns['register_tenant_sync_finding']['Args'];

const KEYS = ['tenant-sync-targets', 'tenant-sync-findings', 'tenant-sync-runs'];

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw error;
  return (data ?? []) as T;
}

export function useTenantSyncTargets() {
  return useQuery({
    queryKey: ['tenant-sync-targets'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('v_tenant_sync_targets')
          .select('*')
          .order('product_sort_order')
          .order('deployment_code'),
      ),
  });
}

export function useTenantSyncFindings(status: FindingStatus) {
  return useQuery({
    queryKey: ['tenant-sync-findings', status],
    queryFn: async () =>
      unwrap(await supabase.rpc('list_tenant_sync_findings', { p_status: status, p_limit: 500 })),
  });
}

export function useTenantSyncRuns() {
  return useQuery({
    queryKey: ['tenant-sync-runs'],
    queryFn: async () =>
      unwrap(await supabase.from('v_tenant_sync_runs').select('*').order('started_at', { ascending: false }).limit(30)),
  });
}

/** Tenants de la app SIN alta activa: candidatos a vincular con un cliente «solo en la app». */
export function useUnlinkedTenants(productId: string | null) {
  return useQuery({
    queryKey: ['tenant-sync-unlinked', productId],
    enabled: Boolean(productId),
    queryFn: async () => {
      const [tenants, links] = await Promise.all([
        supabase.from('tenants').select('id, name, slug').eq('saas_product_id', productId!).order('name'),
        supabase.from('tenant_product_mappings').select('tenant_id').eq('saas_product_id', productId!).eq('status', 'ACTIVE'),
      ]);
      const linked = new Set(unwrap(links).map((l) => l.tenant_id));
      return unwrap(tenants).filter((t) => !linked.has(t.id));
    },
  });
}

export interface SyncRunResult {
  run_id?: string;
  status?: string;
  findings_opened?: number;
  findings_closed?: number;
  targets?: Array<{ deployment_code: string; product_code: string; outcome: string }>;
  error?: string;
}

/** «Sincronizar ahora»: la Edge Function autoriza con `can_manage_tenant_sync()`. */
export function useRunTenantSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<SyncRunResult> => {
      const { data, error } = await supabase.functions.invoke<SyncRunResult>('tenant-sync', { body: {} });
      if (error) {
        // El cuerpo real trae el código (p. ej. SINCRONIZACION_EN_CURSO); sin esto
        // llegaría «Edge Function returned a non-2xx status code».
        const context = (error as { context?: Response }).context;
        if (context && typeof context.json === 'function') {
          const payload = (await context.json().catch(() => null)) as { error?: string; message?: string } | null;
          if (payload?.error) throw new Error(payload.message ? `${payload.error}: ${payload.message}` : payload.error);
        }
        throw error;
      }
      return data ?? {};
    },
    onSettled: () => {
      for (const key of KEYS) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export function useResolveFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; action: 'RESOLVE' | 'DISMISS'; reason: string }) =>
      unwrap(
        await supabase.rpc('resolve_tenant_sync_finding', {
          p_finding_id: args.id,
          p_action: args.action,
          p_reason: args.reason,
        }),
      ),
    onSuccess: () => {
      for (const key of [...KEYS, 'audit-logs']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

/** Cuenta + tenant + solicitud + alta manual, sin llamar a la app (una transacción). */
export function useRegisterFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: RegisterArgs) => unwrap(await supabase.rpc('register_tenant_sync_finding', args)),
    onSuccess: () => {
      for (const key of [
        ...KEYS, 'tenant-sync-unlinked', 'tenant-overview', 'organizations', 'saas-provisioning', 'tenant-lifecycle',
        'audit-logs', 'dashboard-summary',
      ]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
