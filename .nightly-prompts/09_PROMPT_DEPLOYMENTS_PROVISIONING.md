# FASE 8 - DEPLOYMENTS Y PROVISIONING

Implementa el modelo operativo que desacopla tenant lógico de infraestructura física.

## deployment_mode

- SHARED
- PARTNER_DEDICATED
- TENANT_DEDICATED

## Deployment targets

Un `deployment_target` debe representar metadata segura de un entorno/instancia, por ejemplo:

- provider = SUPABASE;
- environment;
- region;
- logical name;
- provider project reference no secreto;
- status;
- ownership = EBIM;
- cost center/ref;
- metadata no sensible.

Nunca guardar DB password, service_role o PAT en texto plano en la tabla.

## Tenant deployments

Debe relacionar tenants con deployment targets y permitir:

- múltiples tenants -> mismo Shared target;
- múltiples tenants del mismo partner -> Partner Dedicated target;
- un tenant -> Tenant Dedicated target.

## Provisioning workflow

Crear:

- `provisioning_requests`
- `provisioning_events`

Estados sugeridos:

- PENDING
- VALIDATING
- RUNNING
- SUCCEEDED
- FAILED
- CANCELLED

Características:

- idempotency key;
- retries controlados;
- actor/audit;
- error_message sanitizado;
- request payload sin secretos.

## Adapter Supabase

Implementa una capa server-side/Edge Function con interfaz de provider.

Por defecto:

```text
PROVISIONING_MODE=DRY_RUN
```

En DRY_RUN debe simular:

- creación de proyecto/target;
- configuración esperada;
- resultado;
- eventos;

No hagas llamadas de Management API reales durante la noche salvo autorización DEV explícita y segura.

La arquitectura debe dejar claro cómo integrar después un Supabase Management API token desde secrets del backend/Edge Function.

## UI

- deployments list;
- deployment detail;
- provisioning queue;
- create request;
- retry failed request;
- timeline/events;
- badges SHARED/PARTNER_DEDICATED/TENANT_DEDICATED.

Tests de máquina de estados e idempotencia.
Actualiza STATE y commit.
