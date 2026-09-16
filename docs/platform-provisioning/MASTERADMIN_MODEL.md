# Modelo de datos del plano de provisioning

Nueve tablas, dos vistas y una capa de permisos **aditiva** sobre los roles del
baseline. Ninguna migración histórica se modificó.

## 1. Permisos

El baseline autoriza por rol enumerado (`EBIM_SUPER_ADMIN`,
`EBIM_PRODUCT_ADMIN`, `EBIM_FINANCE`), no por permisos dinámicos. Reescribirlo
habría roto 37 migraciones y 537 pruebas. En su lugar se añadió una capa que
**sólo** gobierna este subsistema.

### `platform_permissions`

Catálogo cerrado de 11 permisos. Una FK desde `provisioning_role_permissions`
impide conceder uno que no existe: un typo es un error, no un permiso que no
hace nada en silencio.

```
platform.integration.read / .manage
platform.deployment.read  / .manage
platform.provisioning.read / .execute / .retry / .cancel
platform.credentials.read / .manage
platform.product_owner.manage
```

### `provisioning_role_permissions`

Qué puede cada rol. Es **dato**, no código: ampliar un rol es un INSERT en una
migración, no un `if` repartido por la aplicación.

| Rol | Alcance |
| --- | --- |
| `TECH_LEAD` | Los 11 permisos, transversal |
| `PROVISIONING_ADMIN` | Todo salvo repartir la propiedad de los productos |
| `PRODUCT_OWNER` | Su producto: leer, ejecutar, reintentar, cancelar. **No** configura |
| `PROVISIONING_VIEWER` | Sólo lectura |

`PROVISIONING_ADMIN` no reparte propiedad a propósito: si pudiera, el
aislamiento entre productos duraría lo que tarde alguien en auto-nombrarse en el
producto del vecino. Eso es `TECH_LEAD` o super admin.

### `provisioning_role_members`

Membresías **globales**. Un CHECK impide conceder `PROVIDER_OWNER` aquí: es un
rol por producto y exige decir de cuál.

### `product_owners`

Propiedad **técnica** por producto: `(saas_product_id, user_id, role,
environment_scope, is_active)`.

Un `TECHNICAL_OWNER` de EWM ve la integración, los deployments y el provisioning
de EWM, y de ningún otro producto. No es un rol de plataforma.

### Resolución

```sql
has_platform_permission(code)          -- transversal; super admin siempre true
has_product_permission(code, product)  -- transversal, o por propiedad técnica
```

Ambas `SECURITY DEFINER` con `search_path` fijo, devolviendo un **booleano
explícito**. Nunca se infiere autorización de «la consulta no dio error».

## 2. `product_integrations`

El contrato con un producto. Guarda **configuración**, nunca secretos ni lógica
interna del producto.

Campos relevantes: `integration_type`, `contract_version`, `issuer`, `audience`,
`subject`, `algorithm`, `token_ttl_seconds`, `create_scope`, `read_scope`,
`additional_scopes`, `create_path_template`, `status_path_template`,
`health_path_template`, `allowed_hosts`, `provisioning_policy`, `enabled`,
`status`.

CHECK que merecen mención:

- `product_integrations_http_ready_ck` — una HTTP_M2M no puede declararse READY
  sin audience, algoritmo, TTL, ruta de alta y scope. A medias no es READY.
- `product_integrations_no_crypto_ck` — MANUAL y MOCK no arrastran configuración
  criptográfica muerta que mañana alguien crea activa.
- `product_integrations_subject_ck` — el `sub` identifica al sistema; un correo
  no es un sujeto válido.
- `product_integrations_ttl_ck` — entre 30 y 300 segundos.

Índice único `(saas_product_id, integration_type, contract_version) where
enabled`: un producto **sí** necesita varias habilitadas (MOCK en DEV y HTTP_M2M
en QAS es la topología normal), pero no dos del mismo tipo y versión. Quién usa
cuál lo decide cada destino.

## 3. `credential_profiles`

Metadata de credencial. `secret_ref` es el **nombre** del secreto; el CHECK de
forma lo garantiza. Ver [SECURITY.md §2](./SECURITY.md).

`secret_configured` es una columna **generada** (`secret_ref is not null`). Sin
ella, la consola tendría que leer `secret_ref` para saber si hay referencia, y
esa columna está revocada. Es la pieza que permite cerrarla sin dejar la
pantalla ciega.

## 4. `deployment_targets` (extendida)

Ver [DEPLOYMENTS.md](./DEPLOYMENTS.md).

## 5. `saas_provisioning_requests`

Cada intento de provisionar un tenant en un producto.

### Idempotencia, en dos niveles

**Nivel 1 — clave determinista.**

```sql
build_provisioning_idempotency_key(tenant, product, version)
  = 'ma-prov-v' || version || '-' || sha256(tenant:product:version)
```

Determinista a propósito: dos clics simultáneos generan la **misma** clave, y el
índice único la rechaza. Con una clave aleatoria habría una ventana en la que
dos peticiones del mismo intento producirían claves distintas.

**Nivel 2 — una solicitud viva por (tenant, producto).**

```sql
create unique index saas_prov_live_uk
  on saas_provisioning_requests (tenant_id, saas_product_id)
  where status not in ('FAILED', 'CANCELLED');
```

`FAILED` y `CANCELLED` quedan fuera del predicado: son los dos estados desde los
que tiene sentido volver a empezar.

Además, la RPC devuelve la solicitud existente en vez de crear otra: cinco clics
producen una solicitud y cinco respuestas idénticas.

### Semántica de la clave

| Situación | Clave |
| --- | --- |
| Reintento del mismo intento | **La misma** |
| Reprovisioning explícito tras cancelar/fallar | Nueva (`request_version` +1) |

Un trigger impide alterar la clave de una solicitud viva: si cambiara, el
producto vería un alta distinta y podría duplicar el tenant.

### Máquina de estados

Ver [ARCHITECTURE.md §6](./ARCHITECTURE.md). Reglas que conviene recordar:

- Desde `PROVISIONING` **no** se cancela: hay una llamada en vuelo.
- `FAILED` vuelve a `READY_TO_PROVISION` sólo si quedan intentos.
- `ACTIVE` y `CANCELLED` son terminales.
- Un `FAILED` sin código de error está prohibido por CHECK: un fallo que nadie
  puede clasificar mañana no sirve de nada.
- Sin DELETE físico, ni para `service_role`.

## 6. `tenant_product_mappings`

`(tenant, producto)` único. Guarda los identificadores **del producto** y
`metadata` con recursos no sensibles (`initialWarehouseId`), protegida por el
guard anti-secretos del baseline.

CHECK: un mapeo `ACTIVE` exige `external_tenant_id` y `provisioned_at`. Un
«éxito» que nadie puede verificar después no es un éxito.

## 7. `saas_provisioning_events`

Timeline append-only por solicitud: estado, acción, mensaje, actor, rol,
correlación, intento, estado HTTP y detalle **saneado**.

Append-only real: `authenticated` tiene SELECT y nada más, no hay política de
escritura y un trigger bloquea el DELETE incluso para `service_role`.

## 8. Vistas

- `v_provisioning_targets` — configuración efectiva de cada destino. Expone
  `credential_secret_configured` (booleano), jamás el nombre del secreto.
- `v_saas_provisioning` — solicitud + tenant + destino + integración + mapeo.

Ambas `security_invoker`, como todas las vistas del proyecto: no son una puerta
trasera a RLS.

## 9. RPCs

| Grupo | Funciones |
| --- | --- |
| Configuración | `upsert_product_integration`, `upsert_credential_profile`, `configure_deployment_provisioning`, `set_deployment_health` |
| Permisos | `upsert_product_owner`, `deactivate_product_owner`, `grant_provisioning_role`, `revoke_provisioning_role` |
| Ciclo de vida | `create_saas_provisioning_request`, `retry_saas_provisioning_request`, `cancel_saas_provisioning_request`, `register_manual_provisioning` |
| Diagnóstico | `resolve_deployment_target`, `require_deployment_target`, `evaluate_provisioning_policy`, `check_provisioning_preconditions` |
| Gates humanos | `can_execute_saas_provisioning`, `can_check_deployment_health` |
| **Sólo servidor** | `provisioning_execution_context`, `begin_saas_provisioning`, `complete_saas_provisioning`, `fail_saas_provisioning`, `record_provisioning_event`, `deployment_health_context` |

Las seis últimas no tienen EXECUTE para `authenticated`, ni siquiera con el JWT
de un super admin: el camino humano es la Edge Function.

## 10. Política de provisioning

`MANUAL` (default seguro) · `AFTER_SUBSCRIPTION_ACTIVE` ·
`AFTER_PAYMENT_CONFIRMED`.

Jerarquía: **destino > integración > MANUAL**. Nunca un default escondido en el
código de la aplicación.

`AFTER_PAYMENT_CONFIRMED` sólo se satisface con un pago `CONFIRMED`. Un
`PENDING` es una promesa, y provisionar contra una promesa es regalar el
producto.
