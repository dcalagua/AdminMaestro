import { AccountsPage } from './AccountsPage';

/**
 * Directorio corporativo (P23). V6: sin filtro de capacidad («Todas las
 * organizaciones») y con `CUSTOMER` (Clientes) pinta el listado gerencial
 * `AccountsPage`. Partners (P24) tiene su propio listado de canal
 * (`PartnersPage`, V6 · F2).
 *
 * Una organización no tiene un "tipo": acumula CAPACIDADES. Consultora Andina
 * aparece como Partner + Consultora + Cliente en la misma fila, sin duplicar la
 * cuenta (D-006). Sólo se muestran las filas que RLS devuelve.
 */
export function OrganizationsPage(
  props: {
    capabilityFilter?: 'ALL' | 'CUSTOMER';
    title?: string;
    description?: string;
  } = {},
) {
  return (
    <AccountsPage
      scope={props.capabilityFilter === 'CUSTOMER' ? 'customers' : 'all'}
      title={props.title ?? 'Todas las organizaciones'}
      description={
        props.description ??
        'Cuentas de la plataforma con sus capacidades: una misma organización puede ser partner y cliente a la vez. Abre la ficha 360 para ver su cartera.'
      }
    />
  );
}
