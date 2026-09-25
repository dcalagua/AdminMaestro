# MasterAdmin · Cierre multi-app — estado al 2026-09-24

- **MasterAdmin local:** `dev` @ `4d4432a` (25 commits por delante de `origin/dev` = `origin/qas` = `77f8ff0`).
- **QAS MasterAdmin:** `jivgwrczgdpsuvqcwqku`, leído en modo consola con el super admin.
- **Mutaciones remotas hechas en esta sesión:** sólo `CHECK_HEALTH` sobre tres destinos (escribe `health_status`). Nada más.
- **Bloqueo principal:** el gate de permisos de la sesión denegó `git push`, `supabase secrets set` y `supabase functions deploy`. Todo lo remoto que no fuera la verificación de salud quedó sin ejecutar.

## 1. Bloqueo: mutaciones remotas denegadas

| Intento | Comando | Resultado |
|---|---|---|
| Push de `dev` | `git push origin dev` | **Denegado por el gate** (dos formas distintas) |
| Configurar eChange | `supabase secrets set --project-ref zoveazvwvyayugladuvl --env-file …` | **Denegado por el gate** |
| Desplegar orquestador (sesión previa) | `supabase functions deploy provisioning-orchestrator` | **Denegado por el gate** |

La autorización del prompt y la política de `CLAUDE.md` no bastan: el bloqueo ocurre en la capa de permisos del harness. **El operador debe ejecutar estos comandos con `!`**, o habilitarlos, antes de que ninguna fase remota pueda continuar.

## 2. Verdad de QAS MasterAdmin (lectura fresca)

Catálogo: 5 productos (`esupplier`, `ewm`, `tms`, `gmao`, `echange`).

| Producto | Integración | Adapter | Credencial | Destino | Salud | Smoke |
|---|---|---|---|---|---|---|
| EWM | `ewm-provisioning-v1` READY/enabled | `EWM_V1` | `ewm-qas-m2m` (QAS) | `ewm-shared-qas` → `https://ewm-rsxs.onrender.com` | **HEALTHY** (refrescada hoy) | `EBIM EWM QAS Smoke` ACTIVE, mapping ACTIVE |
| eSupplier | `esupplier-provisioning-v1` READY/enabled | `GENERIC` | `esupplier-devqas-m2m` (DEV) | `esupplier-shared-dev` → `…glmgxzlloyqhcoercsjh…/platform-provisioning` | **HEALTHY** (refrescada hoy) | `EBIM eSupplier DEVQAS Smoke` ACTIVE |
| TMS | `tms-provisioning-v1` READY/enabled | `GENERIC` | `tms-qas-m2m` (QAS) | `tms-shared-qas` → `https://tms-myss.onrender.com` | **HEALTHY** (refrescada hoy) | `EBIM TMS QAS Smoke` ACTIVE |
| GMAO | ninguna | — | ninguna | ninguno | — | ninguno |
| eChange | ninguna | — | ninguna | ninguno | — | ninguno |

Los tres smokes conservan un solo intento (`attempt_count = 1`) y su mapping ACTIVE. No se creó ningún tenant nuevo.

## 3. Estado por producto

| Producto | Código local | Remoto | Estado |
|---|---|---|---|
| **EWM** | en `dev` de MasterAdmin | certificado 2026-09-21 | **CERTIFIED** · salud refrescada |
| **eSupplier** | en su repo | certificado 2026-09-22 (entorno DEV/QAS compartido) | **CERTIFIED** · salud refrescada |
| **TMS** | en `dev` de MasterAdmin (acta `docs/superpowers/evidence/2026-09-22-tms-…`) | certificado 2026-09-22 | **CERTIFIED** · salud refrescada |
| **eChange** | rama `feat/echange-provisioning-generic` @ `4c8ebb4`, worktree `eChange-worktrees/masteradmin-generic-provisioning`, 5 commits sobre `origin/qas`, **sin publicar**. Migración `20260922055042` y función `platform-provisioning` (`verify_jwt=false`) listas. **49/49 tests unitarios verdes hoy.** | nada desplegado; las 9 `EBIM_MASTERADMIN_M2M_*` **no existen** en `zoveazvwvyayugladuvl` (verificado por lectura) | **READY_FOR_QAS** · bloqueado por el gate |
| **GMAO** | rama local `feat/masteradmin-generic-provisioning` @ `90e501f`, sin publicar; GENERIC v1 completo con tests | proyecto único `xikbhkfeaosasdltartg`, documentado a la vez como «dev/qas» y «producción»; aloja el hub de identidad EBIM | **READY_PENDING_ENV_CONFIRMATION** · no se toca |
| **eExpense** | rama local `feat/masteradmin-generic-provisioning` @ `308e99e`, sin publicar; GENERIC v1 + arreglo de seguridad | `uvjmdphlnpyhtohobvzx` sirve DEV y QAS y tiene un cliente real | **READY_FOR_QAS** · con hallazgo crítico abierto (§4) |
| **eCommerce** | rama local `feat/masteradmin-generic-provisioning` @ `fb153e8`, sin publicar; GENERIC v1, suite verde | `ehxlxbhtlmfgneiagdcj`, DEV/QAS compartido, sin PRD | **READY_FOR_QAS** |
| **Comerza** | `dev` local reconciliado hoy a `7f1b660` (iba 57 commits por detrás) | función `platform-provisioning` **ya desplegada** en `rsdyqwdqvezebpopcggj` (DEV = QAS) | **BLOCKED_CONTRACT** (§5) |

## 4. Hallazgo crítico abierto — eExpense

En `origin/dev` de eExpense, `supabase/functions/enroll-client/index.ts` permite un **secuestro de cuenta**: si el correo del admin ya existe, la función le **restablece la contraseña** (`admin.auth.admin.updateUserById(uid, { password: tempPassword })`, línea 181) y **reasigna su `profiles.tenant_id`** al tenant nuevo sin ninguna guarda (línea 187). La contraseña temporal se devuelve en la respuesta y se envía por correo.

El arreglo existe, pero **sólo en la rama local sin publicar** (`cdc52f2`): el enlace pasa a `.eq("id", userId).is("tenant_id", null)` y la ruta nueva responde `409 ADMIN_EMAIL_EXISTS`.

Mientras no se publique esa rama, el estado desplegable de eExpense sigue siendo vulnerable. **Es lo más urgente de toda la lista**, por delante de cualquier certificación.

## 5. Comerza — la brecha es de contrato, no de despliegue

La función desplegada acepta un cuerpo **Comerza V1**, no el GENERIC v1 que MasterAdmin envía. Con el cuerpo canónico responde `422 VALIDATION_FAILED`.

| Gap | Detalle |
|---|---|
| `controlPlaneTenantId` | Lo exige en la raíz; GENERIC lo manda en `masterAdmin.tenantId` |
| `organization.id` / `company.id` | Los exige como UUID; GENERIC no los lleva (eChange y eCommerce los derivan con UUIDv5) |
| Campos ignorados | `tenantCode`, `tenantName`, `plan`, `tenantType`, `environment`, `contractVersion` |
| `adminEmail` | GENERIC lo manda plano; Comerza exige `admin.email` |
| `GET /health` | **No existe**: el destino quedaría en `UNKNOWN` (no bloquea, pero no se puede verificar) |
| Respuesta | `status ∈ {PROVISIONING, ACTIVE, FAILED}`; MasterAdmin sólo admite `ACTIVE`/`PENDING`, así que `PROVISIONING` daría `PROVIDER_RESPONSE_INVALID` |
| Bloque propio | Exige `comerza{sectorCode, store{...}}` con lista cerrada `retail\|acabados\|automotriz\|farmacia` |
| Migración | `20260918120000` no existe en ningún ref de git; si está en el remoto, es deriva sin contrapartida |

**Decisión pendiente del dueño del producto, no técnica:** qué `sectorCode` y qué tienda inicial recibe un alta que llega desde MasterAdmin, dado que el contrato GENERIC no los transporta. Sin esa decisión, el normalizador no se puede escribir sin inventar negocio. Las demás piezas (normalizador, `/health`, subject fijo, TTL 120) son TypeScript directo una vez resuelto eso.

## 6. Lo que queda, en orden

1. **Desbloquear el gate** y publicar `dev` de MasterAdmin (25 commits, fast-forward verificado): `git push origin dev`.
2. **Publicar la rama de eExpense** con el arreglo de seguridad, y desplegar. Es una vulnerabilidad viva.
3. **eChange:** publicar rama, aplicar `20260922055042`, cargar las 9 variables (`ENABLED=false` primero), desplegar `platform-provisioning`, verificar `503 → 200`, y configurar en MasterAdmin la integración `echange-provisioning-v1` (GENERIC, `aud echange.ebim`, TTL 120, scopes `echange:tenant:*`, base `https://zoveazvwvyayugladuvl.supabase.co/functions/v1/platform-provisioning`), un solo smoke.
4. **eCommerce y eExpense:** misma secuencia, cada uno contra su proyecto DEV/QAS compartido.
5. **GMAO:** decisión de entorno del dueño. Hasta entonces no se aplica ni se enciende nada.
6. **Comerza:** decisión de `sectorCode`/tienda inicial y luego el normalizador GENERIC.

## 7. Reglas respetadas

- Sin `force push`, sin reescrituras de historia, sin borrar ramas.
- PRD sin tocar en ningún repo.
- Ninguna clave privada, PAT, `service_role`, JWT ni contraseña impresa.
- GMAO no se mutó por ambigüedad de entorno, que es exactamente lo que pedía la regla.
- Los tres tenants certificados siguen intactos; no se creó ninguno nuevo.
