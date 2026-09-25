import { OrganizationsPage } from './OrganizationsPage';

/**
 * Partners y canales (P24) = la misma vista del directorio filtrada por capacidad.
 * No hay una tabla distinta: es la misma organización con otra capacidad.
 *
 * No muestra agregados globales de EBIM: sólo las filas que RLS devuelve al
 * perfil. Cartera y acuerdos viven en la ficha 360 de cada partner.
 */
export function PartnersPage() {
  return (
    <OrganizationsPage
      capabilityFilter="PARTNER"
      title="Partners y canales"
      description="Organizaciones que comercializan o administran tenants. Sus condiciones pueden diferir por producto; los acuerdos y la cartera están en la ficha 360."
    />
  );
}
