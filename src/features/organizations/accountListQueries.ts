import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { OverdueInvoiceLike, RenewalLike } from './accountListModel';

/**
 * Lecturas propias del listado de Cuentas (V6 · F1). Las demás (organizaciones,
 * tenants, altas, renovaciones, atribuciones) se reutilizan de `services/*`
 * para compartir caché con el resto de la consola.
 *
 * RLS decide las filas; aquí solo se acota lo que hace falta para la columna
 * «Saldo vencido»: facturas emitidas con saldo y vencidas (mismo criterio que
 * Cobranza › Por cobrar, filtro «Vencida»), con las columnas mínimas.
 */

const OVERDUE_BUCKETS = ['D1_30', 'D31_60', 'D61_90', 'D90_MAS'];

/** Facturas vencidas con saldo de todas las cuentas visibles. Cuelga de `invoices`: un cobro la refresca. */
export function useAccountOverdueInvoices({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['invoices', 'account-overdue'],
    enabled,
    queryFn: async (): Promise<OverdueInvoiceLike[]> => {
      const { data, error } = await supabase
        .from('v_invoice_balances')
        .select('customer_organization_id, currency, balance, days_overdue')
        .in('status', ['ISSUED', 'PARTIALLY_PAID'])
        .in('aging_bucket', OVERDUE_BUCKETS);
      if (error) throw new Error(error.message);
      return (data ?? []) as OverdueInvoiceLike[];
    },
  });
}

/**
 * Banderas de cobranza por contrato (`v_renewal_pipeline`) para la salud de cada
 * cuenta. Solo con vista financiera (`enabled`); cuelga de `renewal-pipeline`.
 */
export function useAccountRenewalFlags({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['renewal-pipeline', 'account-flags'],
    enabled,
    queryFn: async (): Promise<RenewalLike[]> => {
      const { data, error } = await supabase
        .from('v_renewal_pipeline')
        .select('billed_organization_id, is_past_due, suspension_pending');
      if (error) throw new Error(error.message);
      return (data ?? []) as RenewalLike[];
    },
  });
}
