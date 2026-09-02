# FASE 3 - MODELO DE DATOS DEL CONTROL PLANE

Diseña e implementa el esquema PostgreSQL/Supabase del EBIM Control Plane mediante migrations versionadas.

Objetivo: representar el negocio sin confundir jerarquía comercial con infraestructura física.

## Invariantes

- Organization != database.
- Tenant != database.
- Tenant es específico de un SaaS.
- Organization puede participar en múltiples SaaS.
- Partner puede administrar múltiples clientes y tenants.
- Cliente puede tener tenants en distintos productos.
- Deployment mode define aislamiento físico.

## Entidades mínimas

Implementa, adapta o divide con criterio:

- `profiles`
- `saas_products`
- `organizations`
- `organization_relationships`
- `organization_memberships`
- `organization_product_agreements`
- `tenants`
- `tenant_memberships`
- `tenant_features`
- `tenant_settings`
- `plans`
- `plan_prices`
- `subscriptions`
- `subscription_items`
- `deployment_targets`
- `tenant_deployments`
- `audit_logs`

Asegura:

- UUIDs o estrategia coherente;
- timestamps;
- status explícitos;
- constraints e índices útiles;
- soft-delete sólo donde tenga sentido;
- no JSONB como sustituto de relaciones importantes;
- JSONB sí para configuración flexible y metadata no crítica;
- campos monetarios sin floats binarios;
- moneda explícita;
- unicidad apropiada para slugs/codes.

## Catálogo de productos

Debe soportar inicialmente:

- eSupplier
- EWM by EBIM
- TMS
- GMAO
- eChange

No crees columnas tipo `is_esupplier`, `is_wms`, etc.

## Entornos / deployment

Diseña soporte para:

- DEMO
- TRIAL
- PRODUCTION
- SANDBOX

Y deployment modes:

- SHARED
- PARTNER_DEDICATED
- TENANT_DEDICATED

## Verificación

- reconstrucción completa de DB local;
- constraints probadas;
- migraciones deterministas;
- seed aún puede ser mínimo en esta fase.

Documenta ERD textual o Mermaid en `docs/architecture/DATA_MODEL.md`.
Actualiza STATE y commit.
