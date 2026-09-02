import { Link } from 'react-router-dom';
import { PageContainer, Card, EmptyState } from '@/components/ui/primitives';

export function NotFoundPage() {
  return (
    <PageContainer title="Página no encontrada">
      <Card>
        <EmptyState
          title="404 · Esta ruta no existe en la consola"
          description="Puede que el enlace esté desactualizado o que la sección haya cambiado de nombre."
          action={
            <Link className="ebim-btn-primary" to="/">
              Volver al dashboard
            </Link>
          }
        />
      </Card>
    </PageContainer>
  );
}
