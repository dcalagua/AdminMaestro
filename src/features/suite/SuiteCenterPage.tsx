import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageContainer } from '@/components/ui/primitives';
import { CHECK_HEALTH_PARAM } from '@/app/paletteActions';
import { findNavItem } from '@/app/navigation';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { usePermissions } from '@/hooks/usePermissions';
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
  const perms = usePermissions();
  const [params, setParams] = useSearchParams();
  const launched = useRef(false);

  // ⌘K «Verificar salud de las apps» (V5 · F5) llega con `?accion=verificar-salud`:
  // una verificación por app que este perfil puede verificar, cada una visible en
  // la cola de tareas. Es la misma acción explícita que «Verificar ahora».
  const requested = params.get('accion') === CHECK_HEALTH_PARAM;
  useEffect(() => {
    if (!requested || launched.current || data.loading.health || access.loading) return;
    launched.current = true;
    for (const h of data.health) {
      const targetId = h.primary?.deployment_target_id;
      if (targetId && access.canForProduct('platform.deployment.read', h.app.id)) void health.run(targetId, h.app.name, h.app.code);
    }
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('accion');
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [requested, data.loading.health, data.health, access, health, setParams]);

  return (
    <PageContainer
      title={item?.label ?? 'Centro de la suite'}
      description={item?.description}
      actions={
        perms.canManagePlatform ? (
          <Link to="/suite/ciclo-de-vida" className="ebim-btn-secondary ebim-btn-sm">
            Ciclo de vida y cortes
          </Link>
        ) : null
      }
    >
      <SuiteHealthStrip
        items={data.health}
        loading={data.loading.health}
        error={data.error.health}
        onRetry={data.refetch.health}
        canCheck={(productId) => access.canForProduct('platform.deployment.read', productId)}
        isChecking={health.isRunning}
        onCheck={(h) => {
          if (h.primary?.deployment_target_id) void health.run(h.primary.deployment_target_id, h.app.name, h.app.code);
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
