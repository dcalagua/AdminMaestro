import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { FeeStatementLike, PartnerFinanceLike } from './partnerListModel';

/**
 * Lecturas propias del listado de Partners (V6 · F2). Solo con vista financiera
 * (`enabled`): sin ella no se piden. RLS decide las filas (un admin de partner
 * solo ve las suyas). Comparten la clave de caché con Costos y Tarifas.
 */

export function usePartnerListFinance({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['partner-finance', 'partner-list'],
    enabled,
    queryFn: async (): Promise<PartnerFinanceLike[]> => {
      const { data, error } = await supabase
        .from('v_partner_finance')
        .select('organization_id, weighted_channel_margin_rate, active_agreements');
      if (error) throw new Error(error.message);
      return (data ?? []) as PartnerFinanceLike[];
    },
  });
}

/** Estados de cuenta de la tarifa de plataforma (todos los períodos visibles; el modelo toma el último). */
export function usePartnerListFees({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['partner-fee-statements', 'partner-list'],
    enabled,
    queryFn: async (): Promise<FeeStatementLike[]> => {
      const { data, error } = await supabase
        .from('v_partner_fee_statements')
        .select('partner_organization_id, period_start, currency, fee_total, status')
        .order('period_start', { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as FeeStatementLike[];
    },
  });
}
