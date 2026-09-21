# Adaptador de contrato EWM V1 para el orquestador de provisioning — Diseño

**Fecha:** 2026-09-21
**Estado:** diseño para plan de implementación. Sin código, sin migraciones, sin cambios remotos.
**Base:** `dev` @ `a25e4a7` (incluye `fix(provisioning): handle CORS preflight`, que se mantiene separado de este diseño).
**Contrato EWM de referencia:** `WMS-by-EBIM`, rama `origin/qas` (merge `7e45d70`), `docs/platform-provisioning/API_CONTRACT.md`.

---

## 1. Problema

MasterAdmin habla un contrato de provisioning genérico (el «estándar EBIM v1»,
[`docs/platform-provisioning/ADAPTERS.md`](../../platform-provisioning/ADAPTERS.md)).
EWM implementó y certificó **otro** contrato para el mismo propósito. Los dos
difieren en todo lo que importa:

| Punto | Estándar MasterAdmin v1 | Contrato EWM | Efecto hoy |
| --- | --- | --- | --- |
| Cuerpo del POST | `tenantCode`, `tenantName`, `adminEmail`, `organization{code,…}`, `company{code,…}`, `plan`, `masterAdmin{…}` | `controlPlaneTenantId`, `organization{id,slug,name,…,currency,timezone}`, `company{id,…}`, `initialWarehouse{…}`, `admin{email,fullName}`, `deploymentMode` | `400 VALIDATION_ERROR` |
| Respuesta | exige `externalTenantId` | `provisioningId`, `status`, `replayed`, `controlPlaneTenantId`, `organizationId`, `companyId`, `initialWarehouseId`, `adminAppUserId`, `adminProvisioningStatus`, `deploymentMode`, `createdAt` | Un `201` real terminaría en `PROVIDER_RESPONSE_INVALID` |
| Ruta de consulta | marcadores `{externalTenantId}` (= id de la **solicitud**) y `{tenantCode}` | `/tenants/{controlPlaneTenantId}` | `PATH_TEMPLATE_INVALID` |
| Consulta de estado | el orquestador sólo expone `PROVISION` y `CHECK_HEALTH` | `GET` con `ewm:tenant:read` | Sin camino |
| Replay | `ACTIVE` es terminal | `200 replayed:true` | Sin camino para certificarlo |

No se puede modificar EWM, y tampoco el estándar genérico: otras aplicaciones
se construyeron contra él.

## 2. Objetivos

1. Soportar EWM **sin modificar EWM**, mediante un adaptador de contrato `EWM_V1` seleccionado por configuración.
2. Dejar el comportamiento genérico **idéntico**, demostrado por pruebas de «antes = después».
3. Añadir de forma **opcional** la consulta de estado (`GET_STATUS`) y una certificación de replay que no altera el ciclo de vida.
4. Concentrar toda la lógica EWM en **un** módulo del orquestador y **un** descriptor de UI.
5. Mantener todas las garantías de seguridad existentes.

## 3. No-objetivos

- Cambiar el payload estándar, `parseProvisioningResponse`, las rutas o los scopes de cualquier integración existente.
- Migrar otras integraciones a un adaptador nuevo.
- Implementar suspend/activate/delete (tampoco existen en EWM, API_CONTRACT §8).
- Reconciliar automáticamente una solicitud `FAILED` a partir de `GET_STATUS` (la consulta es de sólo lectura).
- Cambiar el modelo criptográfico (ES256/RS256, TTL ≤ 300 s, `secret_ref`).
- Endurecer la interpretación de acciones desconocidas del orquestador (ver §8, fila 11; queda como mejora aparte).
- Mezclar este trabajo con el commit de CORS.

## 4. Restricciones de compatibilidad hacia atrás

1. Toda fila existente de `product_integrations` resuelve a `GENERIC` sin intervención.
2. Ninguna migración actualiza filas existentes con un valor semánticamente distinto.
3. La expresión SQL que construye `payload` en `provisioning_execution_context` se conserva **carácter a carácter**.
4. `parseProvisioningResponse`, `sanitizeResources`, `url-guard.ts`, `m2m.ts`, `retry.ts` y `errors.ts` no cambian de comportamiento.
5. Las firmas de las RPC existentes siguen aceptando exactamente las mismas llamadas. Un parámetro nuevo siempre tiene default, y ese default preserva el valor almacenado.
6. Las respuestas JSON del orquestador para `PROVISION` y `CHECK_HEALTH` conservan su forma exacta para las integraciones `GENERIC`.
7. Ninguna aplicación distinta de EWM (eSupplier, eChange, eExpense, GMAO, Comerza, TMS) necesita cambios.

## 5. Arquitectura actual relevante

```
React ──invoke──► provisioning-orchestrator (Edge Function)
                    │ 1. JWT humano → 2. RPC booleana de permiso → 3. service_role
                    │ 4. check_provisioning_preconditions(request_id)
                    │ 5. provisioning_execution_context(request_id)  ← payload estándar
                    │ 6. begin_saas_provisioning
                    │ 7. resolveAdapter(integration_type, environment)
                    │ 8. adapter.provision(context)
                    │ 9. complete_saas_provisioning | fail_saas_provisioning
                    ▼
               HttpM2mAdapter: url-guard → m2m claims → firma → fetch (redirect manual) → parseProvisioningResponse
```

Piezas y hechos verificados en el código:

| Pieza | Hecho |
| --- | --- |
| `registry.ts` `resolveAdapter(type, env, deps)` | La clave es `integration_type`; `HTTP_M2M` → `HttpM2mAdapter` |
| `adapters/http-m2m.ts` | Cuerpo = `JSON.stringify(context.payload)`. Marcadores = `{ externalTenantId: request.id, tenantCode }`. Parser = `parseProvisioningResponse` |
| `types.ts` `ProvisioningAdapter` | Ya declara `provision` y `getStatus`; `getStatus` no está conectado al orquestador |
| `provisioning_execution_context` (`20260915000500`) | Devuelve `request`, `product`, `deployment`, `integration`, `credential`, `payload`. La organización es `tenants.customer_organization_id` y la sociedad es `tenants.company_id` |
| `product_integrations.metadata jsonb` | Existe, pero **se excluye del diff de auditoría** (`to_jsonb(i) - 'metadata'` en `upsert_product_integration`) y no tiene restricciones |
| `deployment_targets.metadata`, `tenants.metadata`, `tenant_product_mappings.metadata` | JSONB existentes; el de mappings recibe `resources` |
| `saas_provisioning_requests` | No tiene columna JSONB de configuración |
| `idempotency_key` | Determinista: `build_provisioning_idempotency_key(tenant, product, version)`; es la misma en todos los reintentos de una versión |
| `record_provisioning_event` | Inserta en el timeline **sin** cambiar el estado |
| `errors.ts` `normalizeProviderFailure` | Ya lee `code` y `detail`, compatible con RFC 7807 (EWM) |
| Zona horaria | No existe columna en ninguna tabla. Existe `locale.timezone` en la cascada `platform_defaults` → `org_config` → `company_config` → `tenant_settings`, resuelta por `platform.effective_tenant_config(p_tenant)` |
| Nombre del admin | No existe: `tenants` sólo guarda `admin_email`. `profiles.full_name` existe sólo si el admin tiene cuenta en MasterAdmin, lo que no es el caso habitual |
| Orquestador, acción | `action === 'CHECK_HEALTH' ? … : provision` — cualquier otro valor ejecuta `PROVISION` |

## 6. Arquitectura propuesta

```
provisioning-orchestrator
   │  acción: PROVISION | CHECK_HEALTH | GET_STATUS | REPLAY_CERTIFICATION
   │  permiso: RPC booleana por acción (las dos primeras, sin cambios)
   │  contexto: provisioning_execution_context  (+ claves nuevas `source`, `adapter`)
   ▼
resolveAdapter(integration_type, environment, deps, adapter_key = 'GENERIC')
   │
   └─ HTTP_M2M ─► HttpM2mAdapter(deps, codec)
                     │  transporte, SSRF, firma, reintentos, redirecciones: ÚNICOS y compartidos
                     ├─ codec GENERIC  → comportamiento actual, byte a byte
                     └─ codec EWM_V1   → cuerpo EWM, marcadores EWM, normalización EWM
```

La diferencia entre contratos es **sólo** de forma: qué cuerpo se envía, qué
marcadores admite la ruta y cómo se lee la respuesta. El transporte y la
seguridad son los mismos. Por eso el punto de variación es un **codec** de
contrato inyectado en el `HttpM2mAdapter` existente, y no un segundo cliente
HTTP. Un segundo cliente duplicaría el guard SSRF, la firma y los reintentos,
que es exactamente el código donde un error sale caro.

La selección ocurre **una vez**, en `resolveAdapter`. Ninguna otra parte del
orquestador, de la UI ni de la base pregunta por EWM.

## 7. Abstracción del adaptador

Extensión aditiva de `types.ts`:

```ts
export type AdapterKey = 'GENERIC' | 'EWM_V1';
export type AdapterCapability = 'PROVISION' | 'GET_STATUS' | 'REPLAY_CERTIFICATION';

/** Forma del contrato. Sin E/S: no firma, no llama, no lee secretos. */
export interface ContractCodec {
  readonly key: AdapterKey;
  readonly capabilities: readonly AdapterCapability[];
  /** Bloqueos de datos ANTES de firmar o llamar. GENERIC devuelve []. */
  validateInput(context: ProvisioningContext): string[];
  buildCreateBody(context: ProvisioningContext): unknown;
  pathParams(context: ProvisioningContext): Record<string, string>;
  parseResponse(body: unknown, operation: 'create' | 'read'): AdapterResult;
}
```

Cambios aditivos en tipos existentes:

| Tipo | Cambio | Efecto sobre GENERIC |
| --- | --- | --- |
| `ProvisioningAdapter` | `capabilities: readonly AdapterCapability[]` y `validateInput?(context)` | `HttpM2mAdapter` con codec GENERIC declara `['PROVISION']`; `ManualAdapter` y `MockAdapter` declaran `['PROVISION']` |
| `AdapterResult` | `replayed?: boolean` | GENERIC nunca lo asigna: queda `undefined` |
| `AdapterOutcome` (rama `ok: true`) | `httpStatus?: number` | No se serializa en la respuesta de `PROVISION` |
| `ProvisioningContext` | `source?: ProvisioningSource` y `adapter?: { key: AdapterKey; capabilities: AdapterCapability[] }` | El codec GENERIC no los lee |

`resolveAdapter(type, environment, deps, adapterKey = 'GENERIC')`: el cuarto
parámetro tiene default, así que todas las llamadas y pruebas actuales siguen
siendo válidas. `adapterKey` distinto de `GENERIC` con un `type` distinto de
`HTTP_M2M` lanza `ADAPTER_NOT_IMPLEMENTED`. Esa combinación también la prohíbe
un CHECK de la base (§17).

Registro de codecs: un `Record<AdapterKey, ContractCodec>` estático en
`registry.ts`, en código compilado. No hay carga dinámica ni evaluación de
nada que venga de la base.

## 8. Preservación del adaptador genérico

`GENERIC_CODEC` se extrae **moviendo** las tres líneas actuales de
`http-m2m.ts` a un objeto, sin reescribirlas:

- `buildCreateBody = (c) => c.payload`, serializado con el mismo `JSON.stringify`;
- `pathParams = (c) => ({ externalTenantId: c.request.id, tenantCode: c.payload.tenantCode, controlPlaneTenantId: String(c.payload.masterAdmin.tenantId) })`;
- `parseResponse = (body) => parseProvisioningResponse(body)`;
- `validateInput = () => []`;
- `capabilities = ['PROVISION']`.

| # | CURRENT GENERIC BEHAVIOR | PROPOSED GENERIC BEHAVIOR | RESULT |
| --- | --- | --- | --- |
| 1 | Filas existentes de `product_integrations` usan `HttpM2mAdapter` según `integration_type` | Columna nueva `adapter_key` con default `GENERIC`: mismo adaptador, codec GENERIC | UNCHANGED |
| 2 | Cuerpo POST = `JSON.stringify(context.payload)` | `GENERIC_CODEC.buildCreateBody` devuelve `context.payload`, serializado igual | UNCHANGED |
| 3 | `payload` construido por `provisioning_execution_context` | Expresión SQL copiada carácter a carácter; sólo se añaden claves hermanas `source` y `adapter` | UNCHANGED |
| 4 | Cabeceras: `authorization`, `content-type`, `accept`, `x-correlation-id`, `idempotency-key`, `x-masteradmin-contract` | Mismo bloque, mismo orden | UNCHANGED |
| 5 | Marcadores `{externalTenantId}` y `{tenantCode}` | Mismos valores; se añade la clave `controlPlaneTenantId`, que ninguna plantilla existente referencia | UNCHANGED |
| 6 | Claims JWT, scope de creación, TTL, algoritmo | `m2m.ts` intacto; `scopesFor(integration, 'create')` intacto | UNCHANGED |
| 7 | Respuesta interpretada por `parseProvisioningResponse` | `GENERIC_CODEC.parseResponse` delega en la misma función | UNCHANGED |
| 8 | Respuesta del orquestador a `PROVISION`: `{request_id, status, attempts, mapping, external_tenant_id}` / `FAILED` / `PENDING` | Mismas claves; `replayed` es `undefined` y `JSON.stringify` lo omite | UNCHANGED |
| 9 | `CHECK_HEALTH` sin JWT M2M contra `health_path_template` | Sin cambios | UNCHANGED |
| 10 | Precondiciones `check_provisioning_preconditions` | Función SQL sin cambios. `validateInput` del codec GENERIC devuelve `[]` y no bloquea nada | UNCHANGED |
| 11 | Acción ausente o desconocida → `PROVISION` | Sólo `GET_STATUS` y `REPLAY_CERTIFICATION` se enrutan aparte; cualquier otro valor sigue yendo a `PROVISION` | UNCHANGED |
| 12 | Eventos del timeline en una ejecución genérica | Mismos eventos; los nuevos (`PROVIDER_REPLAYED`, `PROVIDER_REQUEST_FINGERPRINT`) sólo se escriben si el adaptador declara `REPLAY_CERTIFICATION` | UNCHANGED |
| 13 | `upsert_product_integration(...)` sin `p_adapter_key` | Parámetro nuevo con default `NULL`: al insertar → `GENERIC`; al actualizar → conserva el valor almacenado | UNCHANGED |
| 14 | `create_saas_provisioning_request(...)` | Sin cambios; la configuración de producto se fija con una RPC nueva y separada | UNCHANGED |
| 15 | UI de integraciones y solicitudes genéricas | Sin botones nuevos: la capacidad `GET_STATUS` no existe para GENERIC. El detalle de integración muestra un rótulo de sólo lectura «Contrato: Estándar EBIM v1» | UNCHANGED (sin acciones nuevas) |
| 16 | Guard SSRF, `allowed_hosts`, redirecciones manuales, reintentos | Mismo código, compartido por los dos codecs | UNCHANGED |

## 9. Mapeo exacto EWM V1

Selección: `product_integrations.adapter_key = 'EWM_V1'` con `integration_type = 'HTTP_M2M'`.

| Configuración EWM | Valor |
| --- | --- |
| `create_path_template` | `/internal/platform/v1/tenants` |
| `status_path_template` | `/internal/platform/v1/tenants/{controlPlaneTenantId}` |
| `health_path_template` | `/actuator/health` (la única ruta de salud que documenta EWM; no exige JWT) |
| `issuer` / `audience` / `subject` | `masteradmin.ebim` / `ewm.ebim` / `masteradmin-provisioning` |
| `algorithm` / `token_ttl_seconds` | `ES256` / `300` (EWM exige `exp − iat ≤ 5 min`) |
| `create_scope` / `read_scope` | `ewm:tenant:create` / `ewm:tenant:read` |
| `allowed_hosts` | `ewm-rsxs.onrender.com` (QAS) |
| `deployment_targets.base_url` | `https://ewm-rsxs.onrender.com` (QAS) |

## 10. Mapeo de la petición (EWM INPUT MAPPING)

Fuentes: `S` = `context.source`, la clave nueva de `provisioning_execution_context` (§14). `PC` = `saas_provisioning_requests.product_configuration` (§14).

| Campo MasterAdmin | Campo EWM | Fuente | Regla del codec (validación previa a firmar) |
| --- | --- | --- | --- |
| `tenants.id` | `controlPlaneTenantId` | `S.tenant.id` (igual a `payload.masterAdmin.tenantId`) | UUID |
| `organizations.id` | `organization.id` | `S.organization.id` (organización cliente, `tenants.customer_organization_id`) | UUID |
| `organizations.slug` | `organization.slug` | `S.organization.slug` | `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`. `is_slug` de MasterAdmin no limita longitud, así que un slug de más de 40 caracteres bloquea con `ORGANIZATION_SLUG_INCOMPATIBLE` |
| `organizations.display_name` | `organization.name` | `S.organization.display_name` | 1–200 |
| `organizations.legal_name` | `organization.legalName` | `S.organization.legal_name` | ≤ 200 |
| `organizations.tax_id` | `organization.taxId` | `S.organization.tax_id` | ≤ 32 o `null` |
| `organizations.country_code` | `organization.countryCode` | `S.organization.country_code` | ISO alfa-2 |
| `companies.currency` (sociedad del tenant) | `organization.currency` | `S.company.currency` | ISO 4217. EWM no la compara al reutilizar una organización (API_CONTRACT §6), así que no genera conflictos entre sociedades |
| zona horaria operativa | `organization.timezone` | `PC.organizationTimezone` | Zona IANA, obligatoria |
| `companies.id` | `company.id` | `S.company.id` (`tenants.company_id`) | UUID. Obligatoria: sin sociedad se bloquea con `COMPANY_REQUIRED` |
| `companies.name` | `company.name` | `S.company.name` | 1–200 |
| — | `company.legalName` | `null` (MasterAdmin no tiene razón social por sociedad) | Opcional en EWM |
| `companies.tax_id` | `company.taxId` | `S.company.tax_id` | ≤ 32 o `null` |
| `companies.erp_code` | `company.erpCode` | `S.company.erp_code` | Opcional |
| `companies.country_code` | `company.countryCode` | `S.company.country_code` | ISO alfa-2 |
| `companies.currency` | `company.currency` | `S.company.currency` | ISO 4217 |
| configuración de producto | `initialWarehouse.code` | `PC.initialWarehouse.code` | `^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$` |
| configuración de producto | `initialWarehouse.name` | `PC.initialWarehouse.name` | 1–200 |
| configuración de producto | `initialWarehouse.timezone` | `PC.initialWarehouse.timezone` | Zona IANA |
| configuración de producto | `initialWarehouse.erpCode` | `PC.initialWarehouse.erpCode` | Opcional, ≤ 32 |
| configuración de producto | `initialWarehouse.address` | `PC.initialWarehouse.address` | Opcional, ≤ 500 |
| configuración de producto | `initialWarehouse.is3pl` | `PC.initialWarehouse.is3pl` | Booleano; `false` si se omite |
| `tenants.admin_email` | `admin.email` | `S.tenant.admin_email` | Ya normalizado y sin `@ebim.pe` por CHECK de `tenants` |
| configuración de producto | `admin.fullName` | `PC.admin.fullName` | 1–200 |
| `tenants.deployment_mode` | `deploymentMode` | `S.tenant.deployment_mode` | `SHARED` \| `PARTNER_DEDICATED` \| `TENANT_DEDICATED` |

Cabeceras: las mismas del adaptador actual. EWM exige `Idempotency-Key` (≤ 200
caracteres, que la clave determinista cumple) y recomienda `X-Correlation-Id`
(se envía `request.correlation_id`).

Cada bloqueo de validación se devuelve **antes** de `begin_saas_provisioning`
(§12), con la misma forma que las precondiciones:
`409 {error:'PRECONDICIONES_NO_CUMPLIDAS', blockers:[…]}`. No se consume ningún
intento y no se firma ningún token.

## 11. Normalización de la respuesta (EWM OUTPUT MAPPING)

`parseProvisioningResponse` no cambia y no conoce a EWM. El codec EWM tiene su
propio `parseResponse`, que produce el mismo `AdapterResult`:

| Campo EWM | Campo normalizado MasterAdmin | Regla |
| --- | --- | --- |
| `companyId` | `externalTenantId` | Obligatorio. EWM declara que `company.id` **es** su `tenant_id`. Debe coincidir con el `company.id` enviado; si no, `PROVIDER_RESPONSE_INVALID` |
| `organizationId` | `externalOrganizationId` | Obligatorio |
| `companyId` | `externalCompanyId` | Mismo valor que `externalTenantId` |
| `status` | `status` | Sólo se acepta `ACTIVE`; cualquier otro valor da `PROVIDER_RESPONSE_INVALID` |
| `replayed` | `replayed` | Booleano obligatorio |
| `provisioningId` | `rawReference` | Obligatorio |
| `initialWarehouseId` | `resources.initialWarehouseId` | Pasa por `sanitizeResources` (exportada, sin cambios) |
| `adminAppUserId` | `resources.adminAppUserId` | Ídem |
| `adminProvisioningStatus` | `resources.adminProvisioningStatus` | Ídem. La UI lo muestra como «preaprovisionado», nunca como «activo» (API_CONTRACT §2) |
| `deploymentMode` | `resources.deploymentMode` | Ídem |
| `controlPlaneTenantId` | — (control) | Debe ser igual al enviado; si no, `PROVIDER_RESPONSE_INVALID` |
| `createdAt` | — | No se persiste |

Estados HTTP:

| EWM | Resultado |
| --- | --- |
| `201` | Éxito, `replayed:false` |
| `200` | Éxito, `replayed:true`. En `PROVISION` es un éxito legítimo («perdí mi clave»), y además se registra el evento `PROVIDER_REPLAYED` |
| `4xx` / `5xx` RFC 7807 | `normalizeProviderFailure`, sin cambios: lee `code` y `detail`. Los `409` no se reintentan (`retry.ts` sin cambios); los seis conflictos de EWM exigen decisión humana |
| `404` en consulta | Resultado de consulta `found:false` (§12), no un fallo de la solicitud |

## 12. GET_STATUS

Acción nueva y **opcional** del orquestador: `{ action: 'GET_STATUS', request_id }`.

1. JWT humano, como hoy.
2. Permiso: RPC nueva `platform.can_read_saas_provisioning(p_request_id)` → `has_product_permission('platform.provisioning.read', producto)`. Devuelve un booleano explícito, igual que las RPC existentes.
3. `service_role` → `provisioning_execution_context`.
4. Capacidad: `context.adapter.capabilities` debe incluir `GET_STATUS` **y** el adaptador resuelto debe declararla. Si no, `409 CAPACIDAD_NO_SOPORTADA`.
5. Estado de la solicitud: `ACTIVE` o `FAILED`. Si no, `409 ESTADO_NO_CONSULTABLE`. `PROVISIONING` queda excluido porque hay una llamada en vuelo.
6. `adapter.getStatus(context)` → `GET {base}{status_path_template}` con el scope `read_scope`. Nunca con el de creación: `scopesFor(integration, 'read')` ya existe.
7. Se registra el evento `STATUS_CHECKED` con `{provider_http_status, found, remote_status, mapping_consistent}`, sin cuerpos y sin token.
8. Respuesta: `{ request_id, found, remote: {status, externalTenantId, externalOrganizationId, externalCompanyId, resources}, mapping_consistent }`.

**No** cambia el estado de la solicitud ni el mapping. `mapping_consistent`
compara los identificadores remotos con `source.mapping`. La reconciliación
queda fuera de alcance (§3).

Capacidad efectiva `GET_STATUS` = el adaptador la declara **y** la integración
tiene `status_path_template` y `read_scope`. `GENERIC` no la declara: hoy
ninguna integración genérica recibe consultas, y así sigue.

## 13. Marcadores de ruta

`buildProvisioningUrl` no cambia: ya sustituye cualquier `{clave}` presente en
`params` con `encodeURIComponent` y rechaza marcadores sin resolver. El cambio
está en los `params` que entrega el codec:

| Marcador | Valor | Estado |
| --- | --- | --- |
| `{externalTenantId}` | `request.id` | Existente, sin cambios |
| `{tenantCode}` | `payload.tenantCode` | Existente, sin cambios |
| `{controlPlaneTenantId}` | `tenants.id` | **Nuevo**, en ambos codecs |

La plantilla de la base sigue validada por `is_safe_url_path`, que ya admite
`{}`.

## 14. Configuración específica de producto

### 14.1 Selección del adaptador — columna nueva, no `metadata`

`product_integrations.metadata` existe, pero tiene dos problemas:

- no está auditado: `upsert_product_integration` lo excluye del diff;
- no tiene restricción de valores.

Cambiar el contrato con el que se habla a un SaaS **tiene** que quedar en la
auditoría y **no puede** aceptar valores libres. Por eso se añade:

```sql
create type platform.integration_adapter as enum ('GENERIC', 'EWM_V1');
alter table platform.product_integrations
  add column adapter_key platform.integration_adapter not null default 'GENERIC',
  add constraint product_integrations_adapter_ck
    check (adapter_key = 'GENERIC' or integration_type = 'HTTP_M2M');
```

`NOT NULL DEFAULT 'GENERIC'` es compatible: PostgreSQL asigna el default a las
filas existentes sin reescribir su semántica, y `GENERIC` es exactamente el
comportamiento actual.

### 14.2 Datos por solicitud — `product_configuration`

`initialWarehouse`, `admin.fullName` y las zonas horarias son datos **de un
alta concreta**, no de la integración ni del deployment. Además deben ser
**estables entre reintentos**: EWM responde `409 IDEMPOTENCY_CONFLICT` si la
misma clave llega con otro contenido. Ningún JSONB existente es por solicitud,
así que se añade:

```sql
alter table platform.saas_provisioning_requests
  add column product_configuration jsonb not null default '{}'::jsonb,
  add constraint saas_prov_product_configuration_ck check (
    jsonb_typeof(product_configuration) = 'object'
    and octet_length(product_configuration::text) <= 4096
  );
```

Se fija con una RPC nueva, `platform.set_saas_provisioning_configuration(p_request_id uuid, p_configuration jsonb)`:

- exige `has_product_permission('platform.provisioning.execute', producto)`;
- sólo acepta la solicitud con `attempt_count = 0` y estado `PENDING`, `READY_TO_PROVISION` o `WAITING_INFRA`. Después del primer envío la configuración es **inmutable**;
- registra el evento `PRODUCT_CONFIGURATION_SET`, con la lista de claves y sin valores;
- la validación **semántica** es del codec, que es el único que conoce la forma. La base valida sólo la estructura (objeto, tamaño).

Forma para `EWM_V1` (lista cerrada de claves; el codec rechaza cualquier otra):

```json
{
  "organizationTimezone": "America/Lima",
  "initialWarehouse": { "code": "CD01", "name": "Almacén principal", "timezone": "America/Lima",
                        "erpCode": null, "address": null, "is3pl": false },
  "admin": { "fullName": "Administrador Cliente" }
}
```

### 14.3 Nombre del administrador

No existe una fuente fiable. `tenants` sólo guarda `admin_email`, y
`profiles.full_name` sólo existe si esa persona tiene cuenta en MasterAdmin,
que no es el caso habitual de un admin de cliente. No se añade un campo
universal. Se captura en `product_configuration.admin.fullName`, y la UI lo
**precarga** con `profiles.full_name` cuando existe un perfil con ese correo.

### 14.4 Zona horaria

MasterAdmin no tiene columna de zona horaria. Sí tiene `locale.timezone` en la
cascada resuelta por `platform.effective_tenant_config(p_tenant)` (default de
plataforma `America/Lima`). La UI **precarga** con ese valor
`organizationTimezone` e `initialWarehouse.timezone`, y el operador los
confirma. El valor queda congelado en `product_configuration`, de modo que un
cambio posterior de la cascada no altera el cuerpo de un reintento. Si
`authenticated` no tiene `EXECUTE` sobre `effective_tenant_config`, la
migración lo concede. La función es `SECURITY INVOKER` y lee tablas con RLS,
así que cada operador sólo resuelve configuración que ya puede ver.

### 14.5 Contexto de ejecución — clave nueva `source`

`provisioning_execution_context` añade dos claves hermanas de `payload`. La
expresión de `payload` no se toca:

```
source: {
  tenant:       { id, slug, name, admin_email, deployment_mode },
  organization: { id, slug, legal_name, display_name, country_code, tax_id },
  company:      { id, name, erp_code, country_code, currency, tax_id } | null,
  mapping:      { external_tenant_id, external_organization_id, external_company_id } | null,
  product_configuration: <saas_provisioning_requests.product_configuration>
}
adapter: { key: <adapter_key>, capabilities: platform.integration_capabilities(...) }
```

`source` son identificadores y atributos de entidades de MasterAdmin, nada
específico de EWM. Cualquier codec futuro los reutiliza.

### 14.6 Capacidades en la base

`platform.integration_capabilities(p_adapter_key, p_status_path_template, p_read_scope) returns text[]` es `IMMUTABLE`:

- `GENERIC` → `{PROVISION}`;
- `EWM_V1` → `{PROVISION, REPLAY_CERTIFICATION}` más `GET_STATUS` cuando la ruta de estado y el scope de lectura no son nulos.

La usan el contexto (orquestador) y la vista de la UI, así que la regla vive
en un solo sitio. El orquestador además exige que el adaptador compilado
declare la capacidad. Las dos listas se contrastan en una prueba (§21).

## 15. Certificación de replay

Requisito: demostrar que EWM responde `200 replayed:true`, sin duplicar, a la
**misma** petición con la **misma** `Idempotency-Key`, sin reabrir `ACTIVE` y
sin botón de negocio.

Acción interna del orquestador: `{ action: 'REPLAY_CERTIFICATION', request_id }`. **No** aparece en la UI; la invoca la prueba E2E de certificación con la sesión de un operador autorizado.

1. Permiso: RPC nueva `platform.can_certify_saas_provisioning(p_request_id)` → `has_product_permission('platform.provisioning.retry', producto)` **y** `provisioning_environment <> 'PRD'`.
2. Capacidad `REPLAY_CERTIFICATION` (sólo `EWM_V1`).
3. La solicitud debe estar `ACTIVE`.
4. **Huella del cuerpo.** En el `PROVISION` que terminó en éxito, el orquestador registró el evento `PROVIDER_REQUEST_FINGERPRINT` con `{body_sha256}`: SHA-256 del texto exacto enviado, sin PII en claro. Esto sólo ocurre si el adaptador declara `REPLAY_CERTIFICATION`. La certificación reconstruye el cuerpo y compara las huellas:
   - sin huella → `409 REPLAY_FINGERPRINT_MISSING`, sin llamar;
   - huella distinta → `409 REPLAY_BODY_DRIFT`, sin llamar. Es la condición en que EWM respondería `IDEMPOTENCY_CONFLICT`.
5. `adapter.provision(context)`: mismo cuerpo, misma `idempotency_key`, misma `correlation_id`.
6. Se certifica **sólo** si el HTTP es `200`, `replayed === true` y los identificadores coinciden con `source.mapping`.
7. Se registra el evento `REPLAY_CERTIFICATION_PASSED` o `REPLAY_CERTIFICATION_FAILED` con `{provider_http_status, replayed, identifiers_match}`.
8. **Nunca** llama a `begin_`, `complete_` ni `fail_saas_provisioning`: el estado y el mapping no cambian. Un `201` en el replay se reporta como fallo de certificación, con la evidencia, porque indica un segundo alta del lado del proveedor.

Garantías de idempotencia: la clave sigue siendo la determinista existente; el
flujo normal no cambia; `ACTIVE` sigue siendo terminal.

## 16. Capacidades

| Capacidad | GENERIC | EWM_V1 | Dónde se exige |
| --- | --- | --- | --- |
| `PROVISION` | Sí (como hoy) | Sí | Orquestador (sin cambios de flujo) |
| `GET_STATUS` | No | Sí, si hay `status_path_template` y `read_scope` | Orquestador + UI |
| `REPLAY_CERTIFICATION` | No | Sí; `can_certify` excluye PRD | Orquestador; sin UI |

La UI sólo muestra «Consultar estado» cuando la capacidad efectiva incluye
`GET_STATUS` **y** el usuario tiene `platform.provisioning.read`. Ocultar el
botón es UX; la autorización la da la RPC.

## 17. Impacto en la base de datos

**Migración necesaria: sí**, una sola, aditiva: `20260921000100_v4_contract_adapters.sql`.

| Objeto | Tipo de cambio | Justificación |
| --- | --- | --- |
| enum `platform.integration_adapter ('GENERIC','EWM_V1')` | Nuevo | Catálogo cerrado de adaptadores; no hay valores libres |
| `product_integrations.adapter_key` `NOT NULL DEFAULT 'GENERIC'` + CHECK | Columna nueva | Selección auditada y restringida (`metadata` no está auditado) |
| `saas_provisioning_requests.product_configuration` `NOT NULL DEFAULT '{}'` + CHECK | Columna nueva | Datos por alta, congelados entre reintentos |
| `platform.integration_capabilities(...)` | Función nueva | Regla única de capacidades |
| `platform.set_saas_provisioning_configuration(...)` | RPC nueva | Única vía de escritura; inmutable tras el primer envío |
| `platform.can_read_saas_provisioning(uuid)`, `platform.can_certify_saas_provisioning(uuid)` | RPC nuevas | Autorización booleana explícita por acción |
| `platform.upsert_product_integration` | `DROP` + `CREATE` con `p_adapter_key … default null` al final | Se añade un parámetro. Se elimina la firma anterior para no crear una sobrecarga ambigua en PostgREST. Las llamadas existentes, que no lo mandan, siguen funcionando y preservan el valor |
| `platform.provisioning_execution_context` | `CREATE OR REPLACE`: se añaden `source` y `adapter` | `payload` idéntico |
| vista `platform.v_saas_provisioning` | `CREATE OR REPLACE VIEW` con la columna `capabilities` **al final** | La UI decide qué acciones mostrar |
| `grant execute on function platform.effective_tenant_config(uuid) to authenticated` | Sólo si no existe | Precarga de zona horaria (§14.4) |

**No se hace:**

- actualizar filas existentes;
- renombrar o eliminar columnas;
- tocar la expresión de `payload`;
- tocar `check_provisioning_preconditions`, `begin_`, `complete_`, `fail_saas_provisioning` o `create_saas_provisioning_request`;
- añadir campos de EWM a tablas universales.

Grants: las RPC nuevas se revocan a `public`/`anon` y se conceden a
`authenticated`, siguiendo el patrón de `20260915000600`. `provisioning_execution_context` sigue exigiendo `service_role`.

## 18. Impacto en la UI

Mínimo, y sólo en tres puntos:

1. **Detalle de integración, pestaña General.** Selector «Contrato» con las opciones del enum («Estándar EBIM v1», «EWM v1»). Es editable sólo con `platform.integration.manage`; para el resto es un rótulo de sólo lectura. Se guarda con `upsert_product_integration(p_adapter_key)`.
2. **Solicitud de provisioning**, en `SaasProvisioningPage` y en la pestaña «Productos / Provisioning» del tenant.
   - Si el adaptador de la integración resuelta exige configuración y la solicitud no se ha enviado, aparece el formulario «Datos de alta en el producto». Lo genera el descriptor del adaptador, con los campos de §14.2 y las precargas de §14.3–14.4.
   - Mientras falte, «Ejecutar» muestra los bloqueos que devuelve el orquestador (misma forma que las precondiciones actuales).
3. **«Consultar estado».** Botón por fila, sólo con la capacidad `GET_STATUS`. El resultado aparece en un diálogo: estado remoto, identificadores, admin «preaprovisionado» y si coincide con el mapping.

Toda variación por adaptador vive en **un** archivo: `src/features/deployments/contractAdapters.ts`, un descriptor por `adapter_key` con etiqueta, esquema zod del formulario y precargas. No hay `if (adapter === 'EWM_V1')` fuera de ese archivo. Los usuarios comerciales no ven integraciones ni contratos, como hoy.

## 19. Seguridad

| Garantía | Cómo se mantiene |
| --- | --- |
| SSRF y `allowed_hosts` | Mismo `buildProvisioningUrl` y `assertSafeRedirect`; el codec no elige host, método ni base |
| `secret_ref` | Sin cambios; los codecs nunca ven secretos |
| M2M corto, ES256, `iss`/`aud`/`scope` | `m2m.ts` sin cambios; `GET_STATUS` usa `read_scope`, nunca el de creación |
| RBAC | Cada acción nueva tiene su RPC booleana previa a `service_role`; la certificación queda excluida de PRD |
| Adaptadores arbitrarios | `adapter_key` es un enum con CHECK; los codecs son código compilado en un `Record` estático; nada de la base se evalúa |
| Plantillas o expresiones | `product_configuration` es **dato**: lista cerrada de claves, tipos, longitudes y regex; nunca se interpreta |
| Tamaño y forma | CHECK de objeto y ≤ 4 KB |
| Auditoría | `adapter_key` entra en el diff de `upsert_product_integration`; configuración y acciones nuevas quedan en `saas_provisioning_events` |
| PII | La huella es un SHA-256; los eventos guardan claves y códigos, no valores; `product_configuration` hereda la RLS de la solicitud |
| Clave privada | Sin cambios de modelo. La clave EWM existente (P-256, SEC1) se convierte a PKCS#8 **al cargarla** como secret; no se regenera ni toca disco (§23) |
| CORS | Commit separado (`a25e4a7`); no se modifica aquí |

## 20. Observabilidad y auditoría

| Evento (`saas_provisioning_events.action`) | Cuándo | `detail` |
| --- | --- | --- |
| `PRODUCT_CONFIGURATION_SET` | `set_saas_provisioning_configuration` | claves presentes |
| `PROVIDER_REQUEST_FINGERPRINT` | `PROVISION` con éxito, sólo con `REPLAY_CERTIFICATION` | `{body_sha256}` |
| `PROVIDER_REPLAYED` | `PROVISION` con éxito y `replayed:true` | `{provider_http_status}` |
| `STATUS_CHECKED` | `GET_STATUS` | `{provider_http_status, found, remote_status, mapping_consistent}` |
| `REPLAY_CERTIFICATION_PASSED` / `_FAILED` | `REPLAY_CERTIFICATION` | `{provider_http_status, replayed, identifiers_match}` |

Todos llevan `correlation_id`, actor y rol, como los eventos existentes, y
todos pasan por `record_provisioning_event` sin cambiar el estado.

## 21. Pruebas

**Orden obligatorio:** antes de refactorizar `http-m2m.ts`, se añade la
prueba dorada GENERIC (fila 1 de la tabla) contra el código **actual** y se
confirma en verde. El refactor debe mantenerla verde sin editarla.

| Área | Prueba | Suite |
| --- | --- | --- |
| GENERIC antes = después | Para un contexto fijo (reloj, `jti` y resolutor de secretos inyectados): URL, método, cabeceras, texto exacto del cuerpo, claims decodificados y `AdapterResult` idénticos a la instantánea tomada con el código actual | vitest `http-m2m.generic-golden.test.ts` |
| GENERIC por defecto | `resolveAdapter('HTTP_M2M', env, deps)` sin cuarto parámetro usa el codec GENERIC; `capabilities = ['PROVISION']` | vitest `registry.test.ts` |
| Payload SQL intacto | Para las solicitudes del seed, `payload` es igual al JSON recalculado con la expresión previa a la migración, copiada literalmente en la prueba | pgTAP `23_v4_contract_adapters.test.sql` |
| Filas existentes | Toda fila previa queda con `adapter_key = 'GENERIC'`; `product_configuration = '{}'` | pgTAP |
| Upsert preserva | Una llamada sin `p_adapter_key` a una integración `EWM_V1` no la devuelve a GENERIC | pgTAP |
| Petición EWM | Cuerpo exacto de §10 para un contexto fijo; `organization.name = display_name`; `company.legalName = null`; `is3pl` por defecto `false` | vitest `ewm-v1.test.ts` |
| Validación EWM | Bloqueos: sociedad nula, slug > 40, código de almacén inválido, zona vacía, `fullName` ausente, clave desconocida en la configuración; sin firma ni llamada | vitest |
| Normalización EWM | `201` y `200` → `AdapterResult` de §11; `controlPlaneTenantId` o `companyId` distintos del enviado → `PROVIDER_RESPONSE_INVALID`; `status` distinto de `ACTIVE` → inválido; `resources` saneados | vitest |
| Ruta de estado | `{controlPlaneTenantId}` se resuelve con `tenants.id`, codificado; los marcadores existentes siguen iguales | vitest `url-guard` + `ewm-v1` |
| Scopes | `PROVISION` firma `ewm:tenant:create`; `GET_STATUS` firma `ewm:tenant:read` y nunca el de creación | vitest |
| Idempotencia | Reintento y replay envían la misma `idempotency-key` y el mismo texto; una deriva de huella aborta sin llamar | vitest |
| Capacidades | `integration_capabilities` (SQL) coincide con `capabilities` de cada codec compilado, para todas las claves del enum | pgTAP + vitest sobre una tabla compartida en la prueba |
| Autorización | `can_read_…` y `can_certify_…` respetan RBAC y producto; `can_certify` es falso en PRD; `set_…_configuration` falla tras el primer intento | pgTAP `22`/`23` |
| Seguridad | SSRF y redirecciones con el codec EWM (reutiliza los 60 casos de `url-guard`); `product_configuration` con claves extra, tipos inválidos o > 4 KB se rechaza | vitest + pgTAP |
| Firma M2M | ES256 con clave PKCS#8 de prueba; `exp − iat ≤ 300` | vitest `m2m.test.ts` (existente) + `ewm-v1` |
| CORS | Sin cambios; `cors.test.ts` sigue en verde | vitest |
| E2E QAS | Crear (201) → `GET_STATUS` (200) → `REPLAY_CERTIFICATION` (200, `replayed:true`, sin duplicado) contra EWM QAS real | Playwright `e2e/v4-ewm-qas-certification.spec.ts`, fuera de la suite por defecto y activado por variable de entorno |

Además: `typecheck`, `lint`, `build` y la suite completa en verde.

## 22. Estrategia de migración y compatibilidad

1. Commit 1: prueba dorada GENERIC contra el código actual (verde).
2. Commit 2: migración aditiva más pgTAP de preservación.
3. Commit 3: codec GENERIC extraído y registro con `adapterKey` (la prueba dorada, intacta, sigue verde).
4. Commit 4: codec EWM y acciones `GET_STATUS` y `REPLAY_CERTIFICATION`.
5. Commit 5: UI (descriptor, selector, formulario, «Consultar estado»).
6. Commit 6: E2E de certificación y documentación (`ADAPTERS.md` §6 con la fila `EWM_V1`).

Cada commit deja la suite completa en verde. Ninguno cambia datos existentes.

## 23. Despliegue en QAS

Precondición: el commit de CORS ya está desplegado. Por `CLAUDE.md`, el agente
no ejecuta `db push` contra remoto: la migración la aplica el operador
autorizado.

1. Aplicar la migración a `jivgwrczgdpsuvqcwqku` y ejecutar las pruebas pgTAP de preservación contra una copia local.
2. Desplegar sólo `provisioning-orchestrator`.
3. Cargar el secret convirtiendo SEC1 a PKCS#8, sin archivo intermedio y sin mostrar el valor:
   `supabase secrets set --project-ref jivgwrczgdpsuvqcwqku --env-file <(printf 'EWM_QAS_M2M_PRIVATE_KEY="%s"\n' "$(openssl pkcs8 -topk8 -nocrypt -in "$HOME/.ebim-keys/masteradmin/ewm/qas/private.pem")")`
   Verificación: el nombre aparece en `supabase secrets list`.
4. En la consola, para `ewm-provisioning-v1`: contrato «EWM v1», `status_path_template = /internal/platform/v1/tenants/{controlPlaneTenantId}`, `health_path_template = /actuator/health` y el resto según §9.
5. Habilitar en orden: credencial `ewm-qas-m2m` → integración (READY) → deployment `ewm-shared-qas` (READY, habilitado).
6. «Verificar conexión» → `HEALTHY`. Prueba alcance de red y TLS, no el M2M.
7. Crear el tenant de prueba EWM (SHARED, QAS) con sociedad, crear la solicitud y fijar la configuración de producto.
8. Ejecutar → `201`, `ACTIVE`, mapping con `externalTenantId = company.id`.
9. «Consultar estado» → `200`, `mapping_consistent: true`. Es la prueba del M2M de lectura.
10. E2E `REPLAY_CERTIFICATION` → `200`, `replayed:true`, identificadores iguales.

## 24. Rollback

| Nivel | Acción | Efecto |
| --- | --- | --- |
| Configuración (inmediato) | Deshabilitar el deployment `ewm-shared-qas`, o volver la integración a GENERIC/DRAFT | EWM deja de recibir llamadas; nada más cambia |
| Función | Redesplegar la versión anterior de `provisioning-orchestrator` | Ignora `source`/`adapter` y `product_configuration`; GENERIC idéntico |
| Esquema | No hace falta revertir: columnas con default y funciones nuevas no alteran lo existente. Si se exige retirarlas, se hace con una migración inversa que elimina objetos nuevos sin tocar datos previos, **después** de volver a GENERIC toda integración `EWM_V1` | — |
| Datos en EWM | No hay DELETE en EWM (API_CONTRACT §8). Un tenant de prueba creado queda en EWM y se documenta en el acta de certificación | — |

## 25. Criterios de aceptación

1. La prueba dorada GENERIC, escrita contra el código actual, pasa sin modificaciones después del refactor.
2. pgTAP demuestra que `payload` no cambia, que las filas previas quedan GENERIC y que `upsert` preserva `adapter_key`.
3. Ninguna integración distinta de `ewm-provisioning-v1` cambia de configuración, y ninguna otra aplicación recibe llamadas nuevas.
4. `grep` de `EWM_V1`/`ewm` fuera de `adapters/ewm-v1.ts`, `registry.ts`, la migración, las pruebas, `contractAdapters.ts` y la documentación: cero resultados en código de producción.
5. `GET_STATUS` sólo se ofrece y sólo se ejecuta con la capacidad efectiva, y usa `ewm:tenant:read`.
6. `REPLAY_CERTIFICATION` no cambia estado ni mapping, se niega en PRD y aborta sin llamar ante una deriva de huella.
7. En QAS: crear `201`, consultar `200`, replay `200` con `replayed:true`, sin duplicado y con `externalTenantId` estable.
8. La suite completa, `typecheck`, `lint` y `build` en verde; el CORS sigue en verde.
9. Ninguna clave privada ni JWT completo en BD, logs, repositorio o frontend.

## 26. Archivos que probablemente cambiarán

| Archivo | Cambio |
| --- | --- |
| `supabase/migrations/20260921000100_v4_contract_adapters.sql` | Nuevo (§17) |
| `supabase/tests/23_v4_contract_adapters.test.sql` | Nuevo |
| `supabase/functions/_shared/provisioning/types.ts` | Tipos aditivos (§7) |
| `supabase/functions/_shared/provisioning/adapters/http-m2m.ts` | Recibe el codec; transporte sin cambios |
| `supabase/functions/_shared/provisioning/adapters/generic.ts` | Nuevo: `GENERIC_CODEC` (código movido) |
| `supabase/functions/_shared/provisioning/adapters/ewm-v1.ts` | Nuevo: todo EWM |
| `supabase/functions/_shared/provisioning/registry.ts` | `adapterKey` con default y registro de codecs |
| `supabase/functions/_shared/provisioning/index.ts` | Exportaciones |
| `supabase/functions/provisioning-orchestrator/index.ts` | Rutas `GET_STATUS` y `REPLAY_CERTIFICATION`; `validateInput` antes de `begin`; eventos opcionales |
| `supabase/functions/_shared/provisioning/*.test.ts`, `adapters/*.test.ts` | Pruebas de §21 |
| `src/features/deployments/contractAdapters.ts` | Nuevo: descriptor de UI por adaptador |
| `src/features/platform/IntegrationDetailPage.tsx` | Selector de contrato |
| `src/features/deployments/SaasProvisioningPage.tsx`, `src/features/tenants/TenantDetailPage.tsx` | Formulario de configuración y «Consultar estado» |
| `src/services/mutations.ts`, `src/services/queries.ts` | `useSetProvisioningConfiguration`, `useGetProvisioningStatus`, `p_adapter_key`, lectura de `capabilities` |
| `src/types/database.types.ts` | Regenerado |
| `e2e/v4-ewm-qas-certification.spec.ts` | Nuevo, opt-in |
| `docs/platform-provisioning/ADAPTERS.md` | Fila `EWM_V1` y capacidades |

## Decisiones tomadas en este diseño

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Codec inyectado en `HttpM2mAdapter` | Segundo adaptador HTTP | No duplicar SSRF, firma ni reintentos |
| Columna enum `adapter_key` | `product_integrations.metadata` | `metadata` no se audita ni tiene restricciones |
| `product_configuration` por solicitud | `tenants.metadata` / `deployment_targets.metadata` | Es dato de un alta y debe congelarse entre reintentos |
| `externalTenantId ← companyId` | `provisioningId` | EWM declara que `company.id` es su `tenant_id`; `provisioningId` va a `rawReference` |
| `organization.currency ← moneda de la sociedad del tenant` | Moneda por defecto de plataforma | Dato real de la entidad; EWM no la usa como identidad |
| `admin.fullName` capturado | Campo universal nuevo en `tenants` | No hay fuente fiable y el requisito es no ampliar el modelo universal |
| Replay por acción interna sin UI | Botón «Reenviar» | No crea una operación de negocio nueva ni reabre `ACTIVE` |
| Acción desconocida sigue yendo a `PROVISION` | Rechazar con 400 | Preservar el comportamiento actual; el endurecimiento se trata aparte |

## Enmiendas (incorporadas durante la implementación)

| # | Enmienda | Motivo |
| --- | --- | --- |
| A1 | `GET_STATUS` también se admite con la solicitud en `READY_TO_PROVISION`, además de `ACTIVE` y `FAILED`. `PROVISIONING` sigue excluido | Única forma, sin crear nada y sin modificar EWM, de demostrar que EWM acepta el JWT ES256: sobre un `controlPlaneTenantId` aún no aprovisionado, `404 RESOURCE_NOT_FOUND` = firma válida; `401` = firma rechazada |
| A2 | `set_saas_provisioning_configuration` escribe del lado del servidor `resolvedCurrency = companies.currency` de la sociedad del tenant, y el codec la usa para `organization.currency` y `company.currency`. El valor del cliente se descarta | La moneda queda congelada con el resto: un cambio posterior de la sociedad no altera el cuerpo de un reintento (riesgo R1) |
| A3 | La UI mínima vive sólo en `SaasProvisioningPage` (formulario y «Consultar estado»); la pestaña del tenant no cambia | Menos superficie; §18 permitía ambos lugares |
| A4 | `set_saas_provisioning_configuration` bloquea la fila (`FOR UPDATE`) y el `UPDATE` vuelve a exigir `attempt_count = 0`; para contratos que certifican replay, el orquestador relee el contexto después de `begin` | Cierra la carrera entre un guardado y el primer envío (revisión independiente) |
| A5 | `REPLAY_CERTIFICATION` se niega en PRD también en el orquestador, para cualquier canal | El canal servidor no pasa por `can_certify_saas_provisioning` |
| A6 | El codec EWM bloquea zonas con otra capitalización (`america/lima`), correos `@ebim.pe` (`ADMIN_EMAIL_NOT_ALLOWED`) y valida `organizationId` de la respuesta | Evita gastar un intento en rechazos seguros de EWM y completa la verificación de identificadores |
| A7 | `set_saas_provisioning_configuration` inserta `PRODUCT_CONFIGURATION_SET` directamente en `saas_provisioning_events` | `record_provisioning_event` exige el claim de servicio y esta RPC la invoca un humano |
