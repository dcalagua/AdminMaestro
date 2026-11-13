import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Saldo vencido de los tenants de una app (`v_tenant_lifecycle.overdue_*`).
 * Misma clave de caché que `useTenantLifecycle` (misma consulta), pero solo se
 * pide con vista financiera: un perfil técnico no la necesita. RLS decide.
 */
export function useAppLifecycleRows(enabled: boolean) {
  return useQuery({
    queryKey: ['tenant-lifecycle'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_tenant_lifecycle')
        .select('*')
        .order('organization_name')
        .order('product_sort_order');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
