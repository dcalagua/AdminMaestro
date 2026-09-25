import { Link } from 'react-router-dom';
import { CompassIcon } from '@phosphor-icons/react';
import { PageContainer, Card } from '@/components/ui/primitives';

/**
 * 404 (P29). Un único retorno a «/», que el guard de rutas resuelve a la
 * portada autorizada de cada perfil: sin redirecciones automáticas (no hay
 * bucle posible) y sin listar secciones que el perfil quizá no puede ver.
 */
export function NotFoundPage() {
  return (
    <PageContainer title="Página no encontrada">
      <Card>
        <div className="flex flex-col items-center px-4 py-14 text-center">
          <CompassIcon size={36} aria-hidden className="text-muted" />
          <p className="mt-3 text-sm font-semibold text-fg">404 · Esta ruta no existe en la consola</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Puede que el enlace esté desactualizado o que la sección haya cambiado de nombre. Usa el
            menú lateral o vuelve al inicio.
          </p>
          <Link className="ebim-btn-primary mt-5" to="/">
            Volver al inicio
          </Link>
        </div>
      </Card>
    </PageContainer>
  );
}
