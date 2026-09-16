# MasterAdmin como Control Plane de provisioning de la suite EBIM

## 1. El problema que resuelve

Hasta V3.2, MasterAdmin sabía **que** un cliente había contratado EWM. No sabía
**si ese cliente existía dentro de EWM**, ni tenía forma de crearlo. El alta en
el producto se hacía a mano, sin registro, sin identificadores cruzados y sin
nadie que pudiera responder «¿está dado de alta o no?» sin abrir el producto.

Esta fase convierte a MasterAdmin en el **orquestador** de ese alta, sin
convertirlo en dueño de los productos.

## 2. La frontera, que es lo primero

```
Usuario autorizado (Tech Lead / Provisioning Admin / Product Owner)
        │  Supabase Auth
        ▼
MasterAdmin React                 ← nunca llama a un SaaS
        │  invoke()
        ▼
provisioning-orchestrator         ← Edge Function; comprueba el permiso
        │                            ANTES de asumir service_role
        │  JWT M2M asimétrico, TTL ≤ 300 s
        ▼
API interna de provisioning del SaaS
        │
        ▼
Capa de negocio del SaaS
        │
        ▼
Base de datos del SaaS            ← MasterAdmin NUNCA llega aquí
```

Cuatro reglas que el schema hace cumplir, no sólo la documentación:

| Regla | Cómo se garantiza |
| --- | --- |
| MasterAdmin no se conecta a la BD de un SaaS | `DB_DIRECT` no existe en `platform.integration_type` (test 21) |
| MasterAdmin no guarda credenciales de SaaS | CHECK de forma sobre `secret_ref`: un PEM o un JWT no pasan |
| MasterAdmin no usa el `service_role` de un producto | No hay columna donde ponerlo; la única credencial es un JWT M2M firmado |
| El navegador no elige el destino | `provisioning_execution_context()` exige `service_role`; React sólo manda un id |

## 3. Un contrato, no una tecnología

MasterAdmin no habla «EWM», «Java» ni «Supabase». Habla un contrato estándar
descrito en [ADAPTERS.md](./ADAPTERS.md). Un producto se integra implementando
ese contrato del otro lado y rellenando **una fila de configuración** desde la
consola. Ni una línea de código de MasterAdmin menciona un producto concreto.

Eso es lo que permite que EWM, eSupplier, TMS, GMAO y eChange convivan aunque
uno sea Java + PostgreSQL, otro Edge Functions y otro FastAPI.

## 4. Los dos ejes de provisioning, que no son el mismo

El baseline ya tenía `platform.provisioning_requests`: la cola de
**infraestructura** (crear un proyecto Supabase, adjuntar un tenant, suspender).
Esta fase añade `platform.saas_provisioning_requests`: el alta de un tenant
**dentro de una aplicación**.

Se mantuvieron separadas a propósito. Sus ciclos de vida difieren —
`WAITING_INFRA` no significa nada para la infraestructura, que *es* la
infraestructura — y fusionarlos habría roto la máquina de estados existente y
sus pruebas. La consola los muestra como dos entradas distinguibles:
«Provisioning de infraestructura» y «Provisioning SaaS».

## 5. Piezas del modelo

| Tabla | Responde a |
| --- | --- |
| `product_integrations` | ¿Cómo se habla con este producto? Tipo, contrato, issuer, audience, algoritmo, TTL, scopes, rutas, política |
| `credential_profiles` | ¿Dónde está la clave de firma? Sólo su **nombre**, nunca su valor |
| `deployment_targets` (extendida) | ¿A qué URL, en qué ambiente, con qué timeout y en qué estado de salud? |
| `product_owners` | ¿Quién responde por este producto, y sólo por este? |
| `platform_permissions` + `provisioning_role_permissions` + `provisioning_role_members` | ¿Quién puede qué? |
| `saas_provisioning_requests` | ¿En qué estado está el alta de este tenant en este producto? |
| `tenant_product_mappings` | ¿Qué identificadores le dio el producto? |
| `saas_provisioning_events` | ¿Qué pasó exactamente, cuándo y por orden de quién? |

## 6. Ciclo de vida

```
            ┌──────────────── WAITING_INFRA ───────────┐
            │  (dedicado sin infraestructura todavía)  │
            ▼                                          ▼
PENDING ────────────────► READY_TO_PROVISION ────► PROVISIONING ────► ACTIVE
   │  (política sin       ▲          │                   │
   │   cumplir)           │          │                   ▼
   │                      │          ▼                 FAILED
   └──────────────────► CANCELLED ◄──┘                   │
                                      reintento (misma clave) ◄┘
```

`ACTIVE` y `CANCELLED` son terminales. Desde `PROVISIONING` **no** se puede
cancelar: hay una llamada en vuelo y no sabemos si el alta se completó al otro
lado. No hay DELETE físico en ninguna de las tablas del eje.

## 7. Qué sigue para EWM

Nada de código. Cuando el contrato de EWM esté confirmado:

1. completar la integración `ewm-provisioning-v1` desde la consola (audiencia,
   rutas, scopes ya están propuestos como borrador);
2. cargar `EWM_QAS_M2M_PRIVATE_KEY` en los secrets del servidor;
3. habilitar el perfil de credencial y marcar el destino QAS como READY.

Ver [ADAPTERS.md §5](./ADAPTERS.md) y [DEDICATED_FLOW.md](./DEDICATED_FLOW.md).
