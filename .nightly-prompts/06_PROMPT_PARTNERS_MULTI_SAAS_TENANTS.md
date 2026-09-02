# FASE 5 - PARTNERS, MULTI-SAAS Y TENANTS

Implementa el núcleo que permite que la misma plataforma administre partners y tenants de múltiples SaaS.

## Casos que deben funcionar

### Caso A - Cliente directo EBIM

EBIM -> eSupplier -> Tenant Cliente A

### Caso B - Partner Shared

EBIM -> Consultora Andina -> eSupplier Shared -> Tenant Cliente 1, Tenant Cliente 2, Tenant Cliente 3

La consultora puede administrar varios tenants aun cuando todos vivan en infraestructura compartida.

### Caso C - Partner multi-SaaS

EBIM -> Consultora Andina
- puede vender eSupplier;
- puede vender EWM by EBIM;
- sus condiciones/planes/comisiones pueden ser diferentes por producto.

### Caso D - Partner Dedicated

Un partner tiene deployment dedicado para un producto y N tenants debajo.

### Caso E - Tenant Dedicated

Un cliente Enterprise tiene una instalación dedicada para un SaaS.

## Requisitos de dominio

- `organization_product_agreements` o equivalente debe definir qué SaaS puede comercializar/administrar una organización.
- tenant debe tener `customer_organization_id` y, cuando aplique, `managing_organization_id`.
- no uses `parent_tenant_id` como mecanismo principal del modelo partner.
- poder consultar desde un Partner todos sus tenants por producto.
- poder consultar desde EBIM todos los partners autorizados para un SaaS.
- poder consultar desde un Customer sus tenants en distintos SaaS.

## UI de esta fase

Implementa pantallas funcionales:

- SaaS Products list/detail;
- Organizations list/detail;
- Partner list/detail;
- Customer list/detail;
- Tenant list/detail;
- asociación Partner <-> SaaS;
- creación/edición de tenant respetando permisos;
- filtros por producto, partner, customer, status, tenant type y deployment mode.

Evita mostrar datos operativos internos de eSupplier/EWM. Control Plane administra metadata y gobierno.

Crea unit/integration tests de los flows principales.
Actualiza STATE y commit.
