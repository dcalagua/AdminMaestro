import { PageContainer } from '@/components/ui/primitives';
import { findNavItem } from '@/app/navigation';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { SuiteHealthStrip } from './SuiteHealthStrip';
import { SuiteMatrix } from './SuiteMatrix';
import { useHealthCheck, useSuiteData } from './useSuiteData';

/**
 * Centro de la suite (V5 · F2): en una pantalla, si cada app está bien y en qué
 * estado está cada cuenta en cada app.
 *
 * Sólo lee lo que el Admin Maestro ya guardó; «Verificar ahora» es la única
 * llamada a una app y es explícita. Las acciones (confirmar, reintentar,
 * suspender, reactivar) son las RPC de siempre, con su permiso y su motivo:
 * la base decide; esto es UX.
 */
export function SuiteCenterPage() {
  const item = findNavItem('/suite');
  const data = useSuiteData();
  const access = useProvisioningAccess();
  const health = useHealthCheck();

  return (
    <PageContainer title={item?.label ?? 'Centro de la suite'} description={item?.description}>
      <SuiteHealthStrip
        items={data.health}
        loading={data.loading.health}
        error={data.error.health}
        onRetry={data.refetch.health}
        canCheck={(productId) => access.canForProduct('platform.deployment.read', productId)}
        busy={health.isPending}
        checkingTargetId={health.pendingTargetId}
        onCheck={(h) => {
          if (h.primary?.deployment_target_id) void health.run(h.primary.deployment_target_id, h.app.name);
        }}
      />
      <SuiteMatrix
        apps={data.apps}
        rows={data.matrix}
        health={data.health}
        finance={data.finance}
        loading={data.loading.matrix}
        error={data.error.matrix}
        onRetry={data.refetch.matrix}
      />
    </PageContainer>
  );
}
