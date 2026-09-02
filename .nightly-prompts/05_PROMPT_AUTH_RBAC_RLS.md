# FASE 4 - AUTH, RBAC Y RLS

Implementa seguridad real para EBIM Control Plane con Supabase Auth + PostgreSQL grants + RLS.

## Roles funcionales mínimos

- EBIM_SUPER_ADMIN
- EBIM_PRODUCT_ADMIN
- EBIM_FINANCE
- PARTNER_ADMIN
- PARTNER_SALES
- PARTNER_SUPPORT
- SALES_AGENT
- TENANT_ADMIN
- TENANT_USER

No es obligatorio modelarlos todos como un único enum si roles + permissions ofrece mejor flexibilidad.

## Matriz de acceso mínima

### EBIM_SUPER_ADMIN
- acceso completo de Control Plane.

### EBIM_PRODUCT_ADMIN
- administra productos/tenants/deployments según alcance.

### EBIM_FINANCE
- planes, subscriptions, payments, costs, commissions, reportes; sin permisos técnicos innecesarios.

### PARTNER_ADMIN
- su organización;
- acuerdos de productos asignados;
- clientes/tenants administrados por su organización;
- nunca otra organización.

### PARTNER_SALES
- vista comercial autorizada de su partner.

### PARTNER_SUPPORT
- metadata de tenants necesaria para soporte, sin datos comerciales/financieros innecesarios.

### SALES_AGENT
- sólo atribuciones/comisiones propias y metadata comercial mínima.
- no membresía operacional automática en tenants vendidos.

### TENANT_ADMIN / TENANT_USER
- únicamente su tenant/metadata permitida dentro del Control Plane.

## Reglas Supabase

- RLS en toda tabla expuesta.
- revisar grants de anon/authenticated.
- anon sin acceso privado.
- service_role sólo server-side.
- crear funciones helper para scopes si reducen duplicación.
- funciones security definer con `search_path` seguro.
- no confiar en `user_metadata` editable por usuario para autorización crítica.
- evitar listas enormes de tenant IDs en JWT; memberships dinámicos deben resolverse en DB cuando sea más seguro.

## Tests obligatorios

Crea pruebas que demuestren:

1. Partner A no lee Partner B.
2. Tenant Admin A no lee Tenant B.
3. SALES_AGENT no obtiene datos de otros comerciales.
4. SALES_AGENT no obtiene acceso operacional por haber vendido un tenant.
5. EBIM_SUPER_ADMIN sí puede administrar entidades globales.
6. usuario sin membership no obtiene filas privadas.
7. anon no puede consultar tablas privadas.

Usa `supabase test db`/pgTAP o pruebas SQL equivalentes disponibles.
Documenta matriz en `docs/security/RBAC_RLS_MATRIX.md`.
Actualiza STATE y commit.
