import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

/**
 * Datos del correo (migración 20261022000100).
 *
 * Lectura por la vista SECURITY INVOKER `v_mail_outbox` (la RLS decide; la
 * columna con el token del portal de pago no está en la vista ni concedida) y
 * escritura solo por RPC o por la Edge Function `mail-dispatch`.
 */
export type MailRow = Database['platform']['Views']['v_mail_outbox']['Row'];
export type MailSettingsRow = Database['platform']['Tables']['mail_settings']['Row'];

const KEYS = ['mail-outbox', 'mail-settings', 'mail-for'];

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw error;
  return (data ?? []) as T;
}

export function useMailOutbox(limit = 500) {
  return useQuery({
    queryKey: ['mail-outbox', limit],
    queryFn: async () =>
      unwrap(
        await supabase.from('v_mail_outbox').select('*').order('created_at', { ascending: false }).limit(limit),
      ) as MailRow[],
  });
}

/** Correos de una organización o de un tenant (fichas 360). */
export function useMailFor(filter: { organizationId?: string | null; tenantId?: string | null }, limit = 200) {
  const column = filter.organizationId ? 'organization_id' : 'tenant_id';
  const value = filter.organizationId ?? filter.tenantId ?? null;
  return useQuery({
    queryKey: ['mail-for', column, value, limit],
    enabled: Boolean(value),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('v_mail_outbox')
          .select('*')
          .eq(column, value!)
          .order('created_at', { ascending: false })
          .limit(limit),
      ) as MailRow[],
  });
}

export function useMailSettings() {
  return useQuery({
    queryKey: ['mail-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('mail_settings').select('*').maybeSingle();
      if (error) throw error;
      return data as MailSettingsRow | null;
    },
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  for (const key of [...KEYS, 'audit-logs']) void qc.invalidateQueries({ queryKey: [key] });
}

export interface DispatchResult {
  trigger?: string;
  mode?: string;
  claimed?: number;
  sent?: number;
  held?: number;
  skipped?: number;
  retried?: number;
  failed?: number;
  error?: string;
}

/** «Procesar ahora»: la Edge Function autoriza con `can_view_mail()`. */
export function useProcessMailNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<DispatchResult> => {
      const { data, error } = await supabase.functions.invoke<DispatchResult>('mail-dispatch', { body: {} });
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
    onSettled: () => invalidate(qc),
  });
}

export function useResendMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; reason: string }) =>
      unwrap(await supabase.rpc('mail_retry', { p_id: args.id, p_reason: args.reason })),
    onSuccess: () => invalidate(qc),
  });
}

export function useCancelMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; reason: string }) =>
      unwrap(await supabase.rpc('mail_cancel', { p_id: args.id, p_reason: args.reason })),
    onSuccess: () => invalidate(qc),
  });
}

export function useSendTestMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { templateKey: string; to: string }) =>
      unwrap(await supabase.rpc('mail_send_test', { p_template_key: args.templateKey, p_to: args.to })),
    onSuccess: () => invalidate(qc),
  });
}

export function useSaveMailSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { businessMailEnabled: boolean; opsRecipients: string[] }) =>
      unwrap(
        await supabase.rpc('set_mail_settings', {
          p_business_mail_enabled: args.businessMailEnabled,
          p_ops_recipients: args.opsRecipients,
        }),
      ),
    onSuccess: () => invalidate(qc),
  });
}
