# Destinos de provisioning y su resolución

## 1. Un destino, dos ejes

`platform.deployment_targets` ya existía y describía la infraestructura física.
Esta fase la **extiende** en vez de duplicarla:

| Eje | Columnas | Pregunta |
| --- | --- | --- |
| Infraestructura (baseline) | `provider`, `region`, `provider_project_ref`, `status` | ¿Dónde vive físicamente? |
| Provisioning (V4) | `provisioning_environment`, `base_url`, `product_integration_id`, `credential_profile_id`, `timeout_ms`, `retry_count`, `provisioning_status`, `provisioning_enabled`, `health_status` | ¿A qué se llama y con qué? |

Los nombres llevan prefijo a propósito: `status` y `provisioning_status` son ejes
distintos y confundirlos sería el primer error de quien lea el schema mañana.

`provisioning_environment` (DEV/QAS/DEMO/PRD) tampoco sustituye a `environment`
(DEMO/TRIAL/PRODUCTION/SANDBOX): uno es **técnico** y el otro **comercial**. Un
tenant TRIAL puede vivir perfectamente en QAS.

Los seis destinos del baseline quedaron intactos, sin
`provisioning_environment`, así que el resolutor no los considera y ninguna
prueba existente cambió de comportamiento.

## 2. Estados

| `provisioning_status` | Significado |
| --- | --- |
| `DRAFT` | En configuración. No provisiona |
| `READY` | Completo y validado |
| `MAINTENANCE` | Temporalmente fuera |
| `DISABLED` | Apagado; deja de ser candidato en la resolución |

`provisioning_enabled` sólo puede ser `true` si el estado es `READY` (CHECK).
Un destino «encendido» al que le falta media configuración no existe.

Declararse `READY` exige (trigger `enforce_deployment_provisioning_coherence`):
integración, ambiente y —para HTTP_M2M/EDGE_FUNCTION— `base_url`, perfil de
credencial de tipo `M2M_ASYMMETRIC_JWT` y **habilitado**. Un destino READY con
la credencial apagada sería una mentira.

## 3. Salud

`UNKNOWN` · `HEALTHY` · `DEGRADED` · `UNHEALTHY`.

**`UNKNOWN` es el default honesto.** Si el producto no expone ruta de salud o
nadie ha verificado la conexión, el estado es «sin verificar» — no `HEALTHY`.
Un estado de salud que nadie ha comprobado es peor que no tener estado, porque
invita a confiar en él.

Por eso `UNKNOWN` **no bloquea** el provisioning (hay productos sin `/health`),
pero `UNHEALTHY` sí. La acción «Verificar conexión» de la consola llama al
orquestador, que valida el permiso, compone la URL con el mismo guard SSRF, y
escribe el resultado con `set_deployment_health()`.

## 4. Resolución (`resolve_deployment_target`)

Entrada: tenant + producto + ambiente. Salida: un resultado **explícito**.

| Modo del tenant | Destino que se busca |
| --- | --- |
| `SHARED` | `deployment_mode = 'SHARED'` y **sin** organización dueña |
| `PARTNER_DEDICATED` | Dueño = organización que **administra** el tenant |
| `TENANT_DEDICATED` | Dueño = organización **cliente** |

Filtrado siempre por producto, ambiente, `status = 'ACTIVE'` y
`provisioning_status <> 'DISABLED'`.

| Resultado | Cuándo |
| --- | --- |
| `RESOLVED` | Exactamente un candidato |
| `DEPLOYMENT_NOT_CONFIGURED` | Ninguno |
| `DEPLOYMENT_AMBIGUOUS` | Dos o más |
| `PRODUCT_MISMATCH` | El tenant no es de ese producto |
| `TENANT_NOT_FOUND` | El tenant no existe |

**Con dos candidatos NO se elige uno.** Un desempate arbitrario provisiona el
tenant en el sitio equivocado y nadie se entera hasta que el cliente llama. La
variante estricta `require_deployment_target()` lanza el mismo código.

La función devuelve un resultado en vez de lanzar porque el llamador decide:
para un `SHARED`, 0 candidatos es un error de configuración; para un
`TENANT_DEDICATED`, es `WAITING_INFRA` — un estado del negocio, no un fallo.

## 5. Los tres modos en la práctica

**SHARED.** Un destino sirve a muchos tenants. En el seed: `ewm-shared-dev`
(MOCK, listo) y `ewm-shared-qas` (HTTP_M2M, borrador hasta que el secreto esté
cargado).

**PARTNER_DEDICATED.** Varios tenants del mismo partner comparten el destino del
partner. La resolución usa `managing_organization_id`, sin una sola referencia
codificada: `pacifico-ewm-dev` sirve a todos los tenants de Reseller Pacífico.

**TENANT_DEDICATED.** Un destino por cliente. Si todavía no existe, la solicitud
espera. Ver [DEDICATED_FLOW.md](./DEDICATED_FLOW.md).

## 6. `base_url`

Configurable desde la consola, validada en la base y **otra vez** en la Edge
Function antes de cada llamada. Reglas completas en
[SECURITY.md §3](./SECURITY.md).

Sin barra final, por una razón práctica: componer `base + path` tiene que ser
determinista y no producir `//`, que en algunos clientes cambia el host.

## 7. Timeout y reintentos

`timeout_ms` entre 1000 y 60000; `retry_count` entre 0 y 5. El techo importa: la
Edge Function tiene presupuesto de tiempo y un timeout de diez minutos la
bloquea sin avanzar. Tres reintentos con backoff acotado caben en menos de dos
segundos de espera total.
