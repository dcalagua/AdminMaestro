import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import type { PersonaKind } from '@/features/auth/session';
import { hasFinanceView } from './navigation';
import { LoadingState, PageContainer, Card, EmptyState } from '@/components/ui/primitives';

/** Exige sesión activa. Recuerda la ruta pedida para volver tras el login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState label="Verificando sesión…" />;
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/**
 * Restringe una ruta a ciertos perfiles.
 *
 * IMPORTANTE: esto es UX, no autorización. La autorización real vive en las
 * políticas RLS: aunque alguien fuerce la URL, las consultas devuelven cero
 * filas. Este guard sólo evita mostrar una pantalla vacía y confusa.
 */
export function RequirePersona({
  personas,
  children,
}: {
  personas: PersonaKind[];
  children: ReactNode;
}) {
  const { persona, loading } = useAuth();

  if (loading) return <LoadingState />;

  if (!personas.includes(persona)) {
    return (
      <PageContainer title="Sin acceso a esta sección">
        <Card>
          <EmptyState
            title="Tu rol no tiene acceso a esta sección"
            description="Si crees que deberías verla, pídele al equipo de plataforma EBIM que revise tus permisos. El contenido está protegido en la base de datos, no sólo en el menú."
          />
        </Card>
      </PageContainer>
    );
  }

  return <>{children}</>;
}

/**
 * Pantallas financieras: personal EBIM con alcance sólo técnico (propietario de
 * producto, rol de provisioning) no las recibe por «ser EBIM» (spec §4). Igual
 * que `RequirePersona`, es UX: `can_read_finance` y RLS deciden los datos.
 */
export function RequireFinanceView({ children }: { children: ReactNode }) {
  const { persona, roles, loading } = useAuth();

  if (loading) return <LoadingState />;

  if (!hasFinanceView(persona, roles)) {
    return (
      <PageContainer title="Sin acceso a información financiera">
        <Card>
          <EmptyState
            title="Tu perfil técnico no incluye finanzas"
            description="Tu acceso a MasterAdmin es de operación SaaS. La información de cobros, costos y comisiones está protegida en la base de datos y no se muestra por pertenecer a EBIM."
          />
        </Card>
      </PageContainer>
    );
  }

  return <>{children}</>;
}
