import { OrganizationsPage } from './OrganizationsPage';

/**
 * Partners / Resellers = la misma vista filtrada por capacidad.
 * No hay una tabla distinta: es la misma organización con otra capacidad.
 */
export function PartnersPage() {
  return (
    <OrganizationsPage
      capabilityFilter="PARTNER"
      title="Partners / Resellers"
      description="Organizaciones con capacidad de comercializar o administrar tenants. Sus condiciones pueden diferir por producto."
    />
  );
}
