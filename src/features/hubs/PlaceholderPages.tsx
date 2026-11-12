import { Link } from 'react-router-dom';
import { Card, EmptyState, PageContainer } from '@/components/ui/primitives';
import { findNavItem } from '@/app/navigation';

/**
 * Entradas nuevas de la V5 cuya pantalla llega en una fase posterior (plan §5:
 * Bandeja en F5, Centro de la suite en F2). Ya ocupan su lugar en el menú, pero
 * dicen la verdad: todavía no hay contenido, y llevan a dónde está hoy.
 */
function Placeholder({ to, what, links }: { to: string; what: string; links: Array<{ to: string; label: string }> }) {
  const item = findNavItem(to);
  return (
    <PageContainer title={item?.label ?? ''} description={item?.description}>
      <Card>
        <EmptyState
          title="En construcción en esta versión"
          description={what}
          action={links.map((l, index) => (
            <Link key={l.to} to={l.to} className={index === 0 ? 'ebim-btn-primary' : 'ebim-btn-secondary'}>
              {l.label}
            </Link>
          ))}
        />
      </Card>
    </PageContainer>
  );
}

export function InboxPage() {
  return (
    <Placeholder
      to="/bandeja"
      what="Aquí verás, en una sola lista, las alertas, cobros vencidos, altas pendientes y aprobaciones que esperan una acción tuya. Mientras tanto, el panel «Requiere atención» del resumen reúne lo más urgente."
      links={[{ to: '/', label: 'Ir al resumen' }]}
    />
  );
}

export function SuiteCenterPage() {
  return (
    <Placeholder
      to="/suite"
      what="Aquí verás la salud de las 8 apps por ambiente y, para cada cuenta, su estado en cada app: alta, contrato, módulos habilitados, suspensión y uso. Mientras tanto, esa información está en Apps y en Tenants."
      links={[
        { to: '/apps', label: 'Ir a Apps' },
        { to: '/tenants', label: 'Ir a Tenants' },
      ]}
    />
  );
}
