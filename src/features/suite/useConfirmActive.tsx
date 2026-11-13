import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { usePermissions } from '@/hooks/usePermissions';
import { useSetTenantStatus } from '@/services/mutations';
import { businessErrorMessage } from '@/lib/pgError';

export interface ConfirmTarget {
  tenantId: string;
  tenantName: string;
}

export const CONFIRM_ACTIVE_LABEL = 'Confirmar como activo';

/**
 * La acción y su diálogo. `allowed` espeja `can_manage_platform_entities`
 * (UX: la RPC `set_tenant_status` rechaza igual a quien no puede).
 */
export function useConfirmActive() {
  const perms = usePermissions();
  const toast = useToast();
  const setStatus = useSetTenantStatus();
  const [target, setTarget] = useState<ConfirmTarget | null>(null);

  async function confirm(t: ConfirmTarget) {
    try {
      await setStatus.mutateAsync({
        p_tenant_id: t.tenantId,
        p_status: 'ACTIVE',
        p_reason: 'La app confirmó el alta: se confirma el tenant como activo en MasterAdmin',
      });
      toast.success('Tenant confirmado como activo', t.tenantName);
    } catch (e) {
      toast.error('No se pudo confirmar el tenant', businessErrorMessage(e));
    } finally {
      setTarget(null);
    }
  }

  const dialog = (
    <ConfirmDialog
      open={target !== null}
      tone="primary"
      title="Confirmar el tenant como activo"
      message={
        target
          ? `${target.tenantName} ya está activo en su app. Pasará de «Pendiente» a «Activo» en MasterAdmin y el cambio queda en la auditoría.`
          : ''
      }
      confirmLabel={CONFIRM_ACTIVE_LABEL}
      busy={setStatus.isPending}
      onConfirm={() => (target ? confirm(target) : undefined)}
      onCancel={() => setTarget(null)}
    />
  );

  return {
    allowed: perms.canManagePlatform,
    open: (t: ConfirmTarget) => setTarget(t),
    dialog,
  };
}

