import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { CommissionLike } from './salesTeamModel';

/**
 * Comisiones por comercial para el listado del Equipo comercial (V6 · F2): solo
 * las columnas que suman (comercial, estado, monto, moneda). Solo con vista
 * financiera (`enabled`); RLS decide las filas (un comercial ve las suyas).
 */
export function useSalesTeamCommissions({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['commission-detail', 'sales-team'],
    enabled,
    queryFn: async (): Promise<CommissionLike[]> => {
      const { data, error } = await supabase
        .from('v_commission_detail')
        .select('sales_agent_id, status, amount, currency')
        .in('status', ['ELIGIBLE', 'ACCRUED', 'PAID'])
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as CommissionLike[];
    },
  });
}
