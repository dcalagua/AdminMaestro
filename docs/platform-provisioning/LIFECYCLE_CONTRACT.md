# Contrato `lifecycle.v1` · estado operativo del tenant en cada app

Estado: **v1 IMPLEMENTADO** en MasterAdmin y en las 8 apps de la suite (rama `dev` de cada repo).
Runbook de operación: [`docs/runbooks/tenant-lifecycle.md`](../runbooks/tenant-lifecycle.md).

## 1. Por qué un canal aparte

La enmienda D-14 de la spec (2026-09-29) fija que `appActive=false` en el snapshot de entitlements
retira **solo** lo comercial: la operación sigue. Y deja «el apagado operativo completo» como una
política aparte. `lifecycle.v1` es esa política:

- no toca el contrato `entitlements.v1` (sus textos y checksums siguen intactos);
- no sobrecarga `appActive`: un tenant sin una app contratada no queda bloqueado por eso;
- es **declarativo y versionado**, como los entitlements: MasterAdmin dice en qué estado debe estar el
  tenant y con qué versión; la app guarda la última versión aplicada y rechaza versiones viejas.

## 2. Transporte

El mismo de `entitlements.v1`: HTTP M2M con un JWT asimétrico firmado por MasterAdmin, verificado por
la app con la misma clave pública, el mismo `iss`, `aud` y `sub` de la integración, `jti` de un solo
uso y un token nuevo por intento.

| Operación | Ruta (relativa a `base_url`) | Scope del token |
|---|---|---|
| Aplicar estado | `PUT /tenants/{controlPlaneTenantId}/lifecycle` | `<productCode>:lifecycle:write` |
| Leer estado aplicado | `GET /tenants/{controlPlaneTenantId}/lifecycle` | `<productCode>:lifecycle:read` |

Los scopes son **distintos** de los de alta y de entitlements: una credencial de provisioning no
suspende a nadie. La ruta y los scopes se configuran por integración en MasterAdmin
(`product_integrations.lifecycle_path`, `lifecycle_write_scope`, `lifecycle_read_scope`). Una
integración sin ellos no recibe el canal y el Centro de la suite lo muestra como «App sin canal de
suspensión».

Cabeceras: `Authorization: Bearer <jwt>`, `Idempotency-Key`, `X-Correlation-Id`,
`X-MasterAdmin-Contract: lifecycle.v1`, `Content-Type: application/json`.

## 3. Cuerpo del PUT

```json
{
  "contract": "lifecycle.v1",
  "controlPlaneTenantId": "5c600000-0000-4000-8000-000000000001",
  "productCode": "esupplier",
  "environment": "DEV",
  "version": 3,
  "state": "SUSPENDED",
  "reason": "NON_PAYMENT",
  "effectiveAt": "2026-10-13T11:00:00Z",
  "idempotencyKey": "lifecycle:5c600000-0000-4000-8000-000000000001:esupplier:3",
  "correlationId": "1f0a3c1e-1b7e-4c47-9d55-3a4b1f2e9c10"
}
```

| Campo | Regla |
|---|---|
| `contract` | exactamente `lifecycle.v1` |
| `controlPlaneTenantId` | UUID; igual al de la ruta |
| `productCode` | el código de la app que recibe; si no coincide → 400 `PRODUCT_MISMATCH` |
| `environment` | `DEV`, `QAS`, `DEMO` o `PRD`; si no es el de la app → 400 `WRONG_ENVIRONMENT` |
| `version` | entero ≥ 1, creciente por tenant × app |
| `state` | `ACTIVE` o `SUSPENDED` |
| `reason` | con `SUSPENDED`: `NON_PAYMENT`, `MANUAL` o `TERMINATED`; con `ACTIVE`: `null` |
| `effectiveAt` | ISO-8601 con zona; informativo (la app aplica al recibir) |
| `idempotencyKey`, `correlationId` | texto ≤ 200; se guardan para auditoría |

Campos desconocidos → 400 `INVALID_LIFECYCLE`. No viajan datos personales ni importes.

## 4. Respuestas

| Caso | HTTP | Cuerpo |
|---|---|---|
| Aplicado | 200 | `{"controlPlaneTenantId","productCode","appliedVersion","state","reason","appliedAt","replayed":false}` |
| Misma versión y mismo estado | 200 | lo mismo con `"replayed": true` |
| Versión menor que la aplicada | 409 | `{"error":"STALE_LIFECYCLE","appliedVersion":n}` |
| Misma versión, otro estado | 409 | `{"error":"VERSION_CONFLICT","appliedVersion":n}` |
| Tenant no aprovisionado en la app | 404 | `{"error":"TENANT_NOT_PROVISIONED"}` |
| Cuerpo inválido | 400 | `{"error":"INVALID_LIFECYCLE" \| "PRODUCT_MISMATCH" \| "WRONG_ENVIRONMENT"}` |
| Token inválido / scope ausente | 401 / 403 | `{"error":"..."}` |

`GET` devuelve `200 {"controlPlaneTenantId","productCode","appliedVersion"|null,"state","reason","appliedAt"|null}`.
Sin ningún PUT previo: `appliedVersion: null`, `state: "ACTIVE"`.

Los errores usan códigos estables en `error` (`^[A-Z][A-Z0-9_]+$`), nunca trazas ni textos del proveedor.

## 5. Qué hace la app con `SUSPENDED` (obligatorio)

| Ámbito | Comportamiento |
|---|---|
| Datos | **Nunca se borran.** Lectura y exportación siguen disponibles |
| Escritura operativa (crear, editar, aprobar, emitir, mover) | **bloqueada en el servidor**: en la base (trigger/RLS) o en el filtro HTTP único de la API. Error estable `TENANT_SUSPENDED` (HTTP 423 en APIs) |
| Integraciones y API M2M del cliente, portales externos | escritura bloqueada con el mismo error |
| Canales de plataforma (`/tenants/{id}/entitlements`, `/lifecycle`, alta, health) | **siempre abiertos**: así MasterAdmin puede reactivar |
| Login | permitido |
| UI | aviso fijo «Cuenta suspendida»: con `NON_PAYMENT`, «regularice el pago con su proveedor»; botones de escritura deshabilitados (solo UX: el servidor es la autoridad) |
| `ACTIVE` | todo se reanuda sin intervención y sin perder datos |

La UI nunca es la autoridad: un cliente que salta el aviso recibe el mismo `TENANT_SUSPENDED` del servidor.

### 5.1 Cómo lo implementa cada app (v1)

| Regla | Detalle |
|---|---|
| Registro propio | Tabla de la app (p. ej. `platform_tenant_lifecycle`) con `control_plane_tenant_id`, clave interna del tenant, `state`, `reason`, `applied_version`, `applied_at`, más bitácora append-only. **No** se reutiliza el `status` operativo previo de la app: en varias apps ese valor ya bloquea también la lectura o el login |
| Mapeo | `controlPlaneTenantId` → tenant interno con la tabla de alta de la propia app. Sin alta → 404 `TENANT_NOT_PROVISIONED` |
| Autoridad en la base (apps Supabase) | Trigger genérico `BEFORE INSERT OR UPDATE OR DELETE` en cada tabla de negocio con la columna del tenant. Lanza `TENANT_SUSPENDED` con SQLSTATE `PT423` (PostgREST lo devuelve como HTTP 423; con `P0xxx` sería un 500). Cubre RLS, RPC `SECURITY DEFINER`, `service_role` y webhooks. Una prueba estructural exige el trigger en toda tabla con esa columna |
| Exentas | Solo las tablas del canal de plataforma (alta, entitlements, lifecycle, bitácoras y outbox de uso). Cualquier otra exención se justifica en el documento de la app |
| APIs Java (TMS, EWM) | Filtro/interceptor único tras la autenticación: método distinto de GET/HEAD/OPTIONS sobre un tenant suspendido → 423 `TENANT_SUSPENDED`. EWM suma el trigger en la base porque parte de su web escribe por RPC sin pasar por Java |
| Estado legible para la UI | RPC/endpoint de solo lectura del propio tenant (`state`, `reason`, `appliedAt`) para el aviso |

## 6. Qué hace MasterAdmin

- `platform.tenant_lifecycle_delivery` guarda, por tenant × app aprovisionada, el estado deseado
  (`desired_state`, `desired_reason`, `desired_version`) y lo último aplicado por la app.
- Cada cambio de estado del tenant sube la versión: `ACTIVE` → `ACTIVE`; `SUSPENDED` → `SUSPENDED` con
  la causa de la suspensión abierta; `CHURNED`/`ARCHIVED` → `SUSPENDED` con `TERMINATED`.
- El job `ebim-entitlement-sync` (cada 5 minutos) incluye `lifecycle`: reclama las entregas pendientes
  (`FOR UPDATE SKIP LOCKED`), hace el PUT y registra el resultado. Un 409 `STALE_LIFECYCLE` se resuelve
  re-emitiendo una versión mayor que la aplicada.
- El Centro de la suite muestra por tenant: «Bloqueo aplicado en la app», «Reactivado en la app»,
  «Entrega pendiente», «Incidente de entrega» o «App sin canal de suspensión».

## 7. Certificación por app

Para cada app, en DEV y luego en QAS:

1. Configurar en MasterAdmin la ruta y los scopes (`configure_lifecycle_integration`).
2. Suspender desde el Centro de la suite → en ≤ 5 min la app responde `TENANT_SUSPENDED` a una
   escritura y muestra el aviso; la lectura sigue.
3. Registrar un pago que salda la deuda → la app vuelve a operar sin intervención.
4. Evidencia en `docs/superpowers/evidence/<fecha>-<app>-lifecycle-certification.md`.
