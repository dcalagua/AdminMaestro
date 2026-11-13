# Contrato `tenant-inventory.v1` · inventario de clientes de cada app

Estado: **v1 PROPUESTO**. Implementado del lado de MasterAdmin (consumidor) en la migración
`20261021000100_tenant_sync.sql` y la Edge Function `tenant-sync`. **Ninguna app lo implementa todavía**:
hasta que una app lo certifique, la consola muestra «Inventario no disponible en esta app» y MasterAdmin
no detecta los clientes que existen solo en esa app.

Runbook de operación: [`docs/runbooks/tenant-sync.md`](../runbooks/tenant-sync.md).

## 1. Por qué

La auditoría del 2026-11-12 encontró 32 clientes en las apps que MasterAdmin no conoce (entre ellos
clientes reales) y un vínculo roto. MasterAdmin solo sabe lo que él mismo dio de alta. Los contratos
existentes leen **un** tenant conocido (`GET_STATUS`, `GET …/lifecycle`); ninguno permite descubrir los
que MasterAdmin no conoce. Este contrato añade **un listado de solo lectura**, sin datos operativos.

## 2. Capacidad opcional por integración

| Pieza | Dónde |
|---|---|
| Ruta (relativa a `base_url`) | `product_integrations.inventory_path`, p. ej. `/tenants` |
| Scope del token | `product_integrations.inventory_read_scope` = `<productCode>:tenants:list` |
| Alta de la capacidad | `platform.configure_inventory_integration(integración, ruta, scope)` — `platform.integration.manage` |

Ruta y scope van juntos (los dos o ninguno). El scope es **de solo lectura y propio**: la base rechaza que
coincida con el de alta, el de escritura de entitlements o el de escritura de lifecycle. Una app que no lo
tiene configurado **no anuncia** el inventario: la sincronización no lo llama y no inventa nada.

## 3. Transporte

El mismo que `entitlements.v1` y `lifecycle.v1`: HTTP M2M con JWT asimétrico (ES256/RS256) firmado por
MasterAdmin con la clave de la integración; mismo `iss`, `aud`, `sub`; `jti` de un solo uso; un token nuevo
por petición; TTL ≤ 300 s.

```
GET {base_url}{inventory_path}?limit=200&cursor=<opaco>
Authorization: Bearer <jwt con scope <productCode>:tenants:list>
X-Correlation-Id: <uuid>
X-MasterAdmin-Contract: tenant-inventory.v1
Accept: application/json
```

- `limit`: 1..500 (MasterAdmin pide 200). `cursor`: el `nextCursor` de la página anterior; ausente en la primera.
- El tenant **no** viaja en la ruta ni en el cuerpo: el listado es del entorno al que apunta `base_url`.
- Sin redirecciones (MasterAdmin no las sigue). Sin cuerpo en la petición.

## 4. Respuesta `200`

```json
{
  "contract": "tenant-inventory.v1",
  "productCode": "esupplier",
  "environment": "QAS",
  "items": [
    {
      "externalTenantId": "46",
      "externalOrganizationId": "a809d7af-…",
      "externalCompanyId": "b5faf40c-…",
      "controlPlaneTenantId": "5c600000-0000-4000-8000-000000000001",
      "code": "ebim-esup-devqas-smoke",
      "name": "EBIM eSupplier DEVQAS Smoke",
      "status": "ACTIVE"
    }
  ],
  "nextCursor": null
}
```

| Campo | Regla |
|---|---|
| `contract` | exactamente `tenant-inventory.v1` |
| `productCode` | el código de la app; si no es el de la integración, MasterAdmin descarta la respuesta (`PRODUCT_MISMATCH`) |
| `environment` | `DEV`, `QAS`, `DEMO` o `PRD`; debe ser el del destino (`WRONG_ENVIRONMENT`) |
| `items[].externalTenantId` | **obligatorio**, texto 1..200. Es **el mismo identificador que la app devuelve como `externalTenantId` en el alta** (lo que MasterAdmin guarda en `tenant_product_mappings.external_tenant_id`). En EWM, el id de la company; en eSupplier, el id numérico del tenant como texto |
| `items[].externalOrganizationId`, `externalCompanyId` | opcionales, texto ≤ 200 |
| `items[].controlPlaneTenantId` | UUID del tenant de MasterAdmin si la app lo tiene (alta hecha por MasterAdmin); `null` si el cliente se creó en la app |
| `items[].code` | opcional, ≤ 200: slug o código del cliente en la app (MasterAdmin lo propone como slug al registrarlo) |
| `items[].name` | opcional, ≤ 300: nombre comercial o razón social |
| `items[].status` | `ACTIVE`, `SUSPENDED` (lifecycle.v1 aplicado o bloqueo propio) o `INACTIVE` (dado de baja, archivado) |
| `nextCursor` | texto opaco ≤ 500 o `null` en la última página. Un cursor que no avanza es un error |

Reglas:

- **Solo identidad y estado**: nada de usuarios, correos, importes, datos fiscales ni conteos operativos.
- Lista **todos** los clientes del entorno, incluidos los de demo, smoke e internos: MasterAdmin decide qué
  hacer con ellos (registrar o descartar con motivo). La app no filtra.
- Orden estable entre páginas (p. ej. por id). Un cliente no aparece dos veces; si aparece, MasterAdmin lo cuenta una vez.
- Un ítem que no cumple estas reglas deja la página **incompleta**: MasterAdmin avisa de los clientes nuevos
  que sí pudo leer, pero no cierra hallazgos ni da vínculos por rotos con un inventario incompleto.

## 5. Errores

| Caso | HTTP | Cuerpo |
|---|---|---|
| Token inválido / scope ausente | 401 / 403 | `{"error":"…"}` |
| `limit` o `cursor` inválidos | 400 | `{"error":"INVALID_INVENTORY_QUERY"}` |
| Error interno | 5xx | `{"error":"…"}` (MasterAdmin reintenta una vez) |

Códigos estables `^[A-Z][A-Z0-9_]+$`, nunca trazas ni textos del proveedor.

## 6. Qué hace MasterAdmin con el inventario

La base (`record_tenant_sync_target_result`) cruza cada ítem con los vínculos activos del mismo destino:

| Situación | Resultado |
|---|---|
| `externalTenantId` coincide (sin distinguir mayúsculas) con un vínculo activo, o `controlPlaneTenantId` apunta a un tenant vinculado ahí | conocido |
| ninguna coincidencia | hallazgo **«Existe solo en la app»** (`APP_ONLY`) |
| inventario **completo** y un vínculo activo que no aparece | hallazgo **«Vínculo roto»** (`BROKEN_LINK`) |
| inventario completo y un «solo en la app» abierto que ya no aparece como desconocido | se cierra solo (`NO_LONGER_DETECTED`) |

«Registrar en el Admin Maestro» crea cuenta, tenant, solicitud y alta manual con los ids del inventario
**sin llamar a la app**. «Descartar» (datos de demo, smoke, internos) exige motivo y queda descartado aunque la
app lo siga listando.

## 7. Certificación por app

1. La app implementa `GET /tenants` en su canal de plataforma (el mismo que `/tenants/{id}/lifecycle`) y acepta
   el scope `<productCode>:tenants:list` con la clave pública de MasterAdmin.
2. En MasterAdmin: `select platform.configure_inventory_integration('<integración>', '/tenants', '<code>:tenants:list');`
3. «Sincronizar ahora» en **Apps → Sincronización con las apps**: la fila de la app muestra «Inventario: N clientes».
4. Evidencia en `docs/superpowers/evidence/<fecha>-<app>-tenant-inventory-certification.md`.

Estado por app (2026-11-13): ninguna lo implementa. Auditoría de referencia: 32 clientes solo en las apps
(eChange 3, eCommerce 5, Comerza 6, TMS 3, eSupplier 6, EWM 5, eExpense 2, GMAO 2).
