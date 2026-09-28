# FIX-ENT-v1 — contrato `ebim.entitlements/v1`

Contrato normativo de sincronización de entitlements entre MasterAdmin (emisor) y cada SaaS (receptor).
Spec: `docs/superpowers/specs/2026-09-27-ebim-commercial-control-plane-design.md` §7–§9, §19.
Plan: `docs/superpowers/plans/2026-09-27-ebim-commercial-control-plane-implementation.md` §3, §10.

**Este directorio es inmutable una vez publicado.** Una corrección es `v1.1` aditivo en un directorio nuevo; nunca se edita un archivo de `v1`. Cada SaaS copia el directorio completo y lo fija con `CHECKSUMS.sha256` (test `entitlements-fixtures-pin`).

## 1. Canonicalización y checksum

- JSON canónico = **RFC 8785 (JCS)**: claves ordenadas por unidades de código UTF-16, sin espacios, cadenas con los escapes de `JSON.stringify` de ECMAScript (`\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, resto de controles `< 0x20` como `\u00xx` en minúsculas; `/`, DEL y no-ASCII literales), números con `Number.prototype.toString` (`-0` → `0`, `1e21` → `1e+21`).
- `checksum` = `"sha256:"` + hex en minúsculas del SHA-256 de los **bytes UTF-8** del JSON canónico del snapshot **sin el campo `checksum`**.
- `jcs-vectors.json`: toda implementación (TS, Java, SQL) pasa todos los vectores. `sqlDomain: true` marca los que además reproduce la implementación SQL de MasterAdmin (enteros, decimales ≤ 15 dígitos significativos, claves ASCII).
- Tamaño máximo del snapshot canónico: **65 536 bytes**.

## 2. Snapshot (`schema.json`)

Campos (todos obligatorios, ningún campo adicional):

| Campo | Regla |
| --- | --- |
| `schema` | `"ebim.entitlements/v1"` |
| `environment` | `DEV`/`QAS`/`DEMO`/`PRD`; si no es el del receptor → `422 ENVIRONMENT_MISMATCH` |
| `controlPlaneTenantId` | UUID del tenant en MasterAdmin (el mismo del contrato de provisioning) |
| `productCode` | código del producto (`ecommerce`, `ewm`, …) |
| `external` | `tenantId`, `organizationId` (nullable), `companyIds[]` del mapping de provisioning |
| `snapshotVersion` / `previousVersion` | entero ≥ 1, monótono por tenant×producto / versión anterior o `null` |
| `effectiveAt` / `issuedAt` | ISO-8601 UTC. `effectiveAt ≤ issuedAt`: MasterAdmin nunca emite estado futuro |
| `appActive` | `false` → el SaaS bloquea el acceso operativo; **no borra datos** |
| `planCode` | código del plan vigente o `null` |
| `capabilities[]` | **Todas** las FEATURE/AI_FEATURE sellables `ACTIVE` del registro con `enabled` explícito (+ DEPRECATED aún concedidas). Las baseline no se listan. Una sellable **ausente** se deniega |
| `limits[]` | Solo LIMIT concedidos: `value`, `unit`, `enforcement` (`HARD`/`SOFT`). Ausente = sin límite comercial concedido; **nunca** significa ilimitado |
| `allowances[]` | Solo ALLOWANCE concedidos: `meterCode`, `included`, `period{start,end}`, `overageMode` (`BLOCK` mientras no haya precio de exceso, D-06) |
| `aiCredits` | `weights[]`, `weightsVersion` (vacío hasta la fase 17) |
| `scope` | `{level:"TENANT"}`, `{level:"COMPANY"}` (= todas) o `{level:"COMPANY", companyIds:[…]}` con ids de compañía de MasterAdmin |
| `sources[]` | `BASELINE`/`PLAN`/`ADDON`/`OVERRIDE` ordenadas; informativo |
| `correlationId` | UUID por emisión |
| `idempotencyKey` | `"ma-ent-v1-" + sha256hex("<controlPlaneTenantId>:<productCode>:<snapshotVersion>")` |
| `checksum` | §1 |

Arreglos ordenados por `code`; `sources`, `companyIds` ordenados.

**Prohibido** en cualquier nivel: claves que contengan `price`, `amount`, `currency`, `cost`, `secret`, `token`, `email`, `key`, `password` (salvo `idempotencyKey`) y valores con forma de correo, PEM o JWT. El emisor falla antes de enviar (`12-forbidden-keys.json` es el caso negativo del emisor).

## 3. Receptor

Rutas nuevas y aditivas en la base de provisioning del SaaS:

| Método y ruta | Scope |
| --- | --- |
| `PUT /tenants/{controlPlaneTenantId}/entitlements` | `<product>:entitlements:write` |
| `GET /tenants/{controlPlaneTenantId}/entitlements` | `<product>:entitlements:read` |
| `GET /entitlements/manifest` | `<product>:entitlements:read` |

JWT M2M existente (ES256/RS256, `iss=masteradmin.ebim`, `aud=<product>.ebim`, TTL ≤ 300 s). **`jti` de un solo uso** en estas rutas (tabla con TTL). Headers: `Idempotency-Key` = `snapshot.idempotencyKey`, `X-Correlation-Id`, `X-MasterAdmin-Contract: entitlements.v1`.

`PUT`, en una transacción, en este orden:

1. JWT → `401 UNAUTHENTICATED`; `jti` reutilizado → `401 JTI_REPLAYED`; scope → `403 INSUFFICIENT_SCOPE`.
2. Forma → `422 SNAPSHOT_INVALID`; > 64 KB → `413 SNAPSHOT_TOO_LARGE`; `environment` → `422 ENVIRONMENT_MISMATCH`; checksum recalculado → `422 CHECKSUM_MISMATCH`.
3. Tenant del path ≠ `controlPlaneTenantId` del cuerpo → `422 SNAPSHOT_INVALID`; tenant sin mapping local → `404 TENANT_NOT_PROVISIONED`.
4. Contra lo aplicado: `v < aplicada` → `409 STALE_SNAPSHOT` (+`appliedVersion`); `v == aplicada` y mismo checksum → `200 replayed:true`; `v == aplicada` y otro checksum → `409 VERSION_CONFLICT`; `v > aplicada` → aplicar (se admiten saltos).
5. Códigos desconocidos para el receptor: se guardan, **nunca se conceden**, se devuelven en `unknownCapabilities[]` y el estado queda `APPLIED_WITH_WARNINGS`.
6. Guardar el snapshot completo (last-good durable) y materializarlo reemplazando el conjunto de forma atómica; auditoría append-only.
7. `200 {appliedVersion, appliedChecksum, appliedAt, status, unknownCapabilities, replayed}`.

Errores: `{error, message, appliedVersion?}`. El cuerpo nunca incluye el snapshot recibido.

`GET` aplicado (`expected/get-applied.json`): `{controlPlaneTenantId, productCode, appliedVersion, appliedChecksum, appliedAt, status ∈ NONE|APPLIED|APPLIED_WITH_WARNINGS, unknownCapabilities, enforcementMode ∈ LEGACY|SHADOW|DUAL_READ|PRIMARY}`. Es la **única** prueba válida de sincronización.

Operación sin MasterAdmin: el enforcement lee solo el snapshot local; si MasterAdmin cae, el SaaS sigue con el último snapshot válido **sin expiración**.

## 4. Fixtures

`fixtures/NN-*.json` = `{description, receiver: {environment, knownCapabilities[], provisionedTenants[]}, steps: [{snapshot, expect}]}`. `expected/put-responses.json` indexa la respuesta esperada de cada paso. Los valores numéricos son **ilustrativos** (productos `fixture.*`), nunca precios. Tenants del rango `00000000-0000-4ccc-8000-0000000000NN`.

`reference-receiver.ts` es un receptor en memoria (solo tests) que implementa §3 y pasa todos los fixtures: los fixtures quedan validados antes de que un SaaS los use.
