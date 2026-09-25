import { OrganizationsPage } from './OrganizationsPage';

/**
 * Clientes (P21) = vista del directorio corporativo filtrada por capacidad.
 * Mismo componente, CRUD y permisos: no hay una tabla ni un formulario aparte.
 */
export function CustomersPage() {
  return (
    <OrganizationsPage
      capabilityFilter="CUSTOMER"
      title="Clientes"
      description="Empresas cliente. Un cliente puede tener tenants en varios SaaS y llegar por venta directa o por un partner. Abre su ficha 360 para ver contratos, cobros y tenants."
    />
  );
}
