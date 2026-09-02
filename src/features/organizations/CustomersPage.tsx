import { OrganizationsPage } from './OrganizationsPage';

export function CustomersPage() {
  return (
    <OrganizationsPage
      capabilityFilter="CUSTOMER"
      title="Clientes"
      description="Empresas cliente. Un cliente puede tener tenants en varios SaaS y llegar por venta directa o por un partner."
    />
  );
}
